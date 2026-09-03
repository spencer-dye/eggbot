import { describe, expect, it, vi } from 'vitest';

import type { DecisionEngine, FantasyActionIntent } from '@eggbot/agent';
import {
  actionId,
  decisionId,
  leagueId,
  playerId,
  rosterSlotId,
  snapshotId,
  teamId,
  type ActionResult,
  type FantasyAction,
  type LeagueSnapshot,
  type Roster,
} from '@eggbot/core';
import type { FantasyPlatformReader } from '@eggbot/platform';
import { createPolicyEngine } from '@eggbot/policy';

import { AutonomousWaiverManager } from './waivers.js';

const league = leagueId('league');
const team = teamId('team');
const starterSlot = rosterSlotId('starter');
const benchSlot = rosterSlotId('bench');
const starter = player('starter');
const bench = player('bench');
const waiver = player('waiver');
const freeAgent = player('free-agent');

describe('AutonomousWaiverManager', () => {
  it('runs a guarded dry-run and retains ordered approval evidence', async () => {
    const executor = executorReturning('dry-run');
    const result = await manager(executor).run(options());

    expect(result.status).toBe('dry-run');
    expect(result.policyApproval?.actions).toHaveLength(1);
    expect(result.policyApproval?.actions[0]).toMatchObject({
      type: 'waiver-claim',
      addPlayerId: waiver.id,
      dropPlayerId: bench.id,
      bid: 3,
    });
    expect(result.preflightResults[0]?.status).toBe('dry-run');
    expect(result.executionResults).toEqual([]);
    expect(result.resolutionStatus).toBe('not-applicable');
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('requires successful preflight before submitting claims', async () => {
    const executor = executorReturning('executed');
    const result = await manager(executor).run(options('execute'));

    expect(result.status).toBe('submitted');
    expect(result.resolutions).toEqual([
      { actionId: actionId('action'), kind: 'pending-waiver' },
    ]);
    expect(result.resolutionStatus).toBe('pending');
    expect(executor.execute).toHaveBeenNthCalledWith(
      1,
      result.policyApproval?.actions,
      { mode: 'dry-run' },
    );
    expect(executor.execute).toHaveBeenNthCalledWith(
      2,
      result.policyApproval?.actions,
      { mode: 'execute' },
    );
  });

  it('verifies immediate free-agent mutations through a roster re-read', async () => {
    const sourceSnapshot = snapshotWithOpenSpots();
    const observedRoster: Roster = {
      teamId: team,
      entries: [
        ...sourceSnapshot.teams[0]!.roster.entries,
        { player: freeAgent },
      ],
    };
    const rosterReader = {
      getRoster: vi.fn(() => Promise.resolve(observedRoster)),
    };
    const result = await manager(executorReturning('executed'), {
      snapshot: sourceSnapshot,
      rosterReader,
      decisionEngine: engineReturning([
        {
          type: 'add-player',
          leagueId: league,
          teamId: team,
          playerId: freeAgent.id,
        },
      ]),
    }).run(options('execute'));

    expect(result.status).toBe('executed');
    expect(result.resolutionStatus).toBe('verified');
    expect(result.resolutions).toEqual([
      {
        actionId: actionId('action'),
        kind: 'immediate',
        verification: {
          status: 'verified',
          observedRoster,
          issues: [],
        },
      },
    ]);
    expect(rosterReader.getRoster).toHaveBeenCalledOnce();
  });

  it('separates immediate verification from pending waiver submission', async () => {
    const sourceSnapshot = snapshotWithOpenSpots();
    const observedRoster: Roster = {
      teamId: team,
      entries: [
        ...sourceSnapshot.teams[0]!.roster.entries,
        { player: freeAgent },
      ],
    };
    const result = await manager(executorReturning('executed'), {
      snapshot: sourceSnapshot,
      rosterReader: { getRoster: () => Promise.resolve(observedRoster) },
      decisionEngine: engineReturning([
        {
          type: 'add-player',
          leagueId: league,
          teamId: team,
          playerId: freeAgent.id,
        },
        {
          type: 'waiver-claim',
          leagueId: league,
          teamId: team,
          addPlayerId: waiver.id,
          bid: 3,
        },
      ]),
    }).run(options('execute'));

    expect(result.status).toBe('executed-and-submitted');
    expect(result.resolutionStatus).toBe('verified-and-pending');
    expect(result.resolutions).toEqual([
      {
        actionId: actionId('action'),
        kind: 'immediate',
        verification: {
          status: 'verified',
          observedRoster,
          issues: [],
        },
      },
      { actionId: actionId('action-1'), kind: 'pending-waiver' },
    ]);

    const mismatch = await manager(executorReturning('executed'), {
      snapshot: sourceSnapshot,
      rosterReader: {
        getRoster: () => Promise.resolve(sourceSnapshot.teams[0]!.roster),
      },
      decisionEngine: engineReturning([
        {
          type: 'add-player',
          leagueId: league,
          teamId: team,
          playerId: freeAgent.id,
        },
        {
          type: 'waiver-claim',
          leagueId: league,
          teamId: team,
          addPlayerId: waiver.id,
          bid: 3,
        },
      ]),
    }).run(options('execute'));

    expect(mismatch.resolutionStatus).toBe('mismatch-and-pending');
  });

  it('records immediate roster mismatches and read failures per action', async () => {
    const sourceSnapshot = snapshotWithOpenSpots();
    const action = {
      type: 'add-player' as const,
      leagueId: league,
      teamId: team,
      playerId: freeAgent.id,
    };
    const mismatch = await manager(executorReturning('executed'), {
      snapshot: sourceSnapshot,
      rosterReader: {
        getRoster: () => Promise.resolve(sourceSnapshot.teams[0]!.roster),
      },
      decisionEngine: engineReturning([action]),
    }).run(options('execute'));
    const failed = await manager(executorReturning('executed'), {
      snapshot: sourceSnapshot,
      rosterReader: {
        getRoster: () =>
          Promise.reject(
            Object.assign(new Error('Yahoo roster read failed'), {
              code: 'YAHOO_HTTP_ERROR',
              status: 503,
              retryable: true,
            }),
          ),
      },
      decisionEngine: engineReturning([action]),
    }).run(options('execute'));

    expect(mismatch.resolutions[0]).toMatchObject({
      kind: 'immediate',
      verification: {
        status: 'mismatch',
        issues: [{ code: 'ADDED_PLAYER_MISSING', playerId: freeAgent.id }],
      },
    });
    expect(mismatch.status).toBe('executed');
    expect(mismatch.resolutionStatus).toBe('mismatch');
    expect(failed.resolutions[0]).toEqual({
      actionId: actionId('action'),
      kind: 'immediate',
      verification: {
        status: 'failed',
        error: {
          code: 'ROSTER_VERIFICATION_FAILED',
          message: 'Yahoo roster read failed',
          causeCode: 'YAHOO_HTTP_ERROR',
          providerStatus: 503,
          retryable: true,
        },
      },
    });
    expect(failed.status).toBe('executed');
    expect(failed.resolutionStatus).toBe('failed');
  });

  it('does not submit when platform preflight fails', async () => {
    const execute = vi.fn((actions: readonly FantasyAction[]) =>
      Promise.resolve(
        actions.map((action): ActionResult => ({
          status: 'failed',
          action,
          error: {
            code: 'WAIVER_CLOSED',
            message: 'Claims are closed',
            retryable: false,
          },
        })),
      ),
    );
    const result = await manager({ execute }).run(options('execute'));

    expect(result.status).toBe('preflight-failed');
    expect(result.executionResults).toEqual([]);
    expect(result.resolutionStatus).toBe('not-attempted');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

function manager(
  executor: { execute: ReturnType<typeof vi.fn> },
  overrides: {
    readonly snapshot?: LeagueSnapshot;
    readonly decisionEngine?: DecisionEngine;
    readonly rosterReader?: Pick<FantasyPlatformReader, 'getRoster'>;
  } = {},
) {
  const sourceSnapshot = overrides.snapshot ?? snapshot;
  return new AutonomousWaiverManager({
    snapshotService: { capture: () => Promise.resolve(sourceSnapshot) },
    projectionProvider: { getProjections: () => Promise.resolve(projections) },
    decisionEngine: overrides.decisionEngine ?? {
      id: 'waiver-test',
      version: '1.0.0',
      kind: 'deterministic',
      decide: () =>
        Promise.resolve({
          rationale: 'Projected waiver upgrade.',
          proposedActions: [
            {
              type: 'waiver-claim',
              leagueId: league,
              teamId: team,
              addPlayerId: waiver.id,
              dropPlayerId: bench.id,
              bid: 3,
            },
          ],
        }),
    },
    policyEngine: createPolicyEngine({
      guardrails: {
        maxSnapshotAgeMs: 5 * 60 * 1_000,
        maxActionsPerDecision: 2,
        maxRosterMutationActions: 2,
        maxWaiverBid: 10,
      },
    }),
    executor,
    rosterReader: overrides.rosterReader ?? {
      getRoster: () => Promise.resolve(sourceSnapshot.teams[0]!.roster),
    },
    maxProjectionAgeMs: 5 * 60 * 1_000,
    clock: () => new Date('2026-09-01T12:01:00.000Z'),
    runIdFactory: () => 'run',
    decisionIdFactory: () => decisionId('decision'),
    actionIdFactory: (index) =>
      actionId(index === 0 ? 'action' : `action-${index}`),
  });
}

function engineReturning(
  actions: readonly FantasyActionIntent[],
): DecisionEngine {
  return {
    id: 'waiver-test',
    version: '1.0.0',
    kind: 'deterministic',
    decide: () =>
      Promise.resolve({
        rationale: 'Acquisition test.',
        proposedActions: actions,
      }),
  };
}

function snapshotWithOpenSpots(): LeagueSnapshot {
  const extraSlot = rosterSlotId('extra-bench');
  return {
    ...snapshot,
    league: {
      ...snapshot.league,
      settings: {
        ...snapshot.league.settings,
        rosterSlots: [
          ...snapshot.league.settings.rosterSlots,
          {
            id: extraSlot,
            name: 'BN',
            kind: 'bench',
            eligiblePositions: ['RB'],
          },
        ],
      },
    },
    teams: [
      {
        ...snapshot.teams[0]!,
        roster: {
          teamId: team,
          entries: snapshot.teams[0]!.roster.entries.slice(0, 1),
        },
        lineup: {
          ...snapshot.teams[0]!.lineup,
          assignments: snapshot.teams[0]!.lineup.assignments.slice(0, 1),
        },
      },
    ],
    playerPool: {
      freeAgents: {
        items: [freeAgent],
        coverage: { kind: 'bounded', requestedLimit: 10, returnedCount: 1 },
      },
      waivers: snapshot.playerPool.waivers,
    },
  };
}

function executorReturning(result: 'dry-run' | 'executed') {
  return {
    execute: vi.fn(
      (actions: readonly FantasyAction[], execution: { mode: string }) =>
        Promise.resolve(
          actions.map((action): ActionResult =>
            execution.mode === 'dry-run'
              ? {
                  status: 'dry-run',
                  action,
                  summary: 'validated',
                  validation: 'local',
                }
              : result === 'executed'
                ? { status: 'executed', action }
                : {
                    status: 'dry-run',
                    action,
                    summary: 'validated',
                    validation: 'local',
                  },
          ),
        ),
    ),
  };
}

function options(executionMode: 'dry-run' | 'execute' = 'dry-run') {
  return {
    leagueId: league,
    managedTeamId: team,
    scoringPeriod: '3',
    executionMode,
    freeAgentLimit: 10,
    waiverLimit: 10,
    transactionLimit: 10,
  };
}

function player(id: string) {
  return {
    id: playerId(id),
    fullName: id,
    eligiblePositions: ['RB'] as const,
  };
}

const projections = {
  scoringPeriod: '3',
  observedAt: '2026-09-01T11:59:00.000Z',
  source: 'test',
  players: [
    { playerId: starter.id, points: 20 },
    { playerId: bench.id, points: 5 },
    { playerId: waiver.id, points: 15 },
    { playerId: freeAgent.id, points: 12 },
  ],
};

const snapshot: LeagueSnapshot = {
  id: snapshotId('snapshot'),
  captureStartedAt: '2026-09-01T12:00:00.000Z',
  capturedAt: '2026-09-01T12:00:01.000Z',
  consistency: 'best-effort',
  scoringPeriod: '3',
  league: {
    id: league,
    name: 'League',
    season: 2026,
    settings: {
      rosterSlots: [
        {
          id: starterSlot,
          name: 'RB',
          kind: 'active',
          eligiblePositions: ['RB'],
        },
        {
          id: benchSlot,
          name: 'BN',
          kind: 'bench',
          eligiblePositions: ['RB'],
        },
      ],
      scoringRules: [],
      acquisitionRules: { waiverSystem: 'budget', waiverBudget: 100 },
    },
  },
  teams: [
    {
      team: {
        id: team,
        leagueId: league,
        name: 'Managed',
        acquisitionState: {
          waiverPriority: 2,
          waiverBudgetRemaining: 20,
          seasonAcquisitions: 2,
        },
      },
      roster: {
        teamId: team,
        entries: [{ player: starter }, { player: bench }],
      },
      lineup: {
        teamId: team,
        scoringPeriod: '3',
        assignments: [
          { slotId: starterSlot, playerId: starter.id },
          { slotId: benchSlot, playerId: bench.id },
        ],
      },
    },
  ],
  standings: [{ teamId: team, rank: 1 }],
  matchups: [],
  playerPool: {
    freeAgents: {
      items: [],
      coverage: { kind: 'bounded', requestedLimit: 10, returnedCount: 0 },
    },
    waivers: {
      items: [waiver],
      coverage: { kind: 'bounded', requestedLimit: 10, returnedCount: 1 },
    },
  },
  recentTransactions: {
    items: [],
    coverage: { kind: 'bounded', requestedLimit: 10, returnedCount: 0 },
  },
  integrityWarnings: [],
};
