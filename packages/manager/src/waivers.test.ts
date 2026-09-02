import { describe, expect, it, vi } from 'vitest';

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
} from '@eggbot/core';
import { createPolicyEngine } from '@eggbot/policy';

import { AutonomousWaiverManager } from './waivers.js';

const league = leagueId('league');
const team = teamId('team');
const starterSlot = rosterSlotId('starter');
const benchSlot = rosterSlotId('bench');
const starter = player('starter');
const bench = player('bench');
const waiver = player('waiver');

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
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('requires successful preflight before submitting claims', async () => {
    const executor = executorReturning('executed');
    const result = await manager(executor).run(options('execute'));

    expect(result.status).toBe('submitted');
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
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

function manager(executor: { execute: ReturnType<typeof vi.fn> }) {
  return new AutonomousWaiverManager({
    snapshotService: { capture: () => Promise.resolve(snapshot) },
    projectionProvider: { getProjections: () => Promise.resolve(projections) },
    decisionEngine: {
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
    maxProjectionAgeMs: 5 * 60 * 1_000,
    clock: () => new Date('2026-09-01T12:01:00.000Z'),
    runIdFactory: () => 'run',
    decisionIdFactory: () => decisionId('decision'),
    actionIdFactory: () => actionId('action'),
  });
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
