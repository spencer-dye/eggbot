import { describe, expect, it, vi } from 'vitest';

import type { DecisionEngine } from '@eggbot/agent';
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
import type { FantasyPlatformExecutor } from '@eggbot/platform';
import { createPolicyEngine } from '@eggbot/policy';

import {
  AutonomousLineupManager,
  LineupManagementError,
  type AutonomousLineupManagerOptions,
  type LineupManagementOptions,
} from './index.js';

const league = leagueId('league');
const team = teamId('team');
const qbSlot = rosterSlotId('qb');
const benchSlot = rosterSlotId('bench');
const extraBenchSlot = rosterSlotId('extra-bench');
const starter = {
  id: playerId('starter'),
  fullName: 'Starter',
  eligiblePositions: ['QB'] as const,
};
const backup = {
  id: playerId('backup'),
  fullName: 'Backup',
  eligiblePositions: ['QB'] as const,
};
const extraPlayer = {
  id: playerId('extra-player'),
  fullName: 'Extra Player',
  eligiblePositions: ['QB'] as const,
};

describe('AutonomousLineupManager', () => {
  it('runs the complete dry-run workflow and returns its audit record', async () => {
    const executor = executorReturning('dry-run');
    const manager = createManager({ executor });

    const result = await manager.run(runOptions());

    expect(result.status).toBe('dry-run');
    expect(result.snapshot).toBe(snapshot);
    expect(result.analytics.playerProjections).toEqual(projections.players);
    expect(result.decisionRun.decision.proposedActions).toHaveLength(1);
    expect(result.policyEvaluation.results[0]?.status).toBe('approved');
    expect(result.policyApproval?.actions).toHaveLength(1);
    expect(result.preflightResults[0]?.status).toBe('dry-run');
    expect(result.executionResults).toEqual([]);
    expect(result.verification.status).toBe('not-applicable');
    expect(executor.executeMock).toHaveBeenCalledWith(
      result.policyApproval?.actions,
      { mode: 'dry-run' },
    );
  });

  it('does not call the executor when the engine proposes no action', async () => {
    const executor = executorReturning('dry-run');
    const manager = createManager({
      executor,
      decisionEngine: engineReturning([]),
    });

    const result = await manager.run(runOptions());

    expect(result.status).toBe('no-action');
    expect(result.policyApproval).toBeUndefined();
    expect(executor.executeMock).not.toHaveBeenCalled();
  });

  it('blocks the entire run when an engine proposes a non-lineup action', async () => {
    const executor = executorReturning('dry-run');
    const drop: Omit<Extract<FantasyAction, { type: 'drop-player' }>, 'id'> = {
      type: 'drop-player',
      leagueId: league,
      teamId: team,
      playerId: backup.id,
    };
    const manager = createManager({
      executor,
      decisionEngine: engineReturning([drop]),
    });

    const result = await manager.run(runOptions());

    expect(result.status).toBe('rejected');
    expect(result.policyEvaluation.results[0]?.status).toBe('approved');
    expect(result.scopeIssues).toEqual([
      expect.objectContaining({
        code: 'NON_LINEUP_ACTION',
        actionType: 'drop-player',
      }),
    ]);
    expect(result.policyApproval).toBeUndefined();
    expect(executor.executeMock).not.toHaveBeenCalled();
  });

  it('does not execute a lineup rejected by policy', async () => {
    const executor = executorReturning('dry-run');
    const manager = createManager({
      executor,
      decisionEngine: engineReturning([
        {
          type: 'set-lineup',
          leagueId: league,
          teamId: team,
          scoringPeriod: '3',
          assignments: [{ slotId: qbSlot, playerId: playerId('not-rostered') }],
        },
      ]),
    });

    const result = await manager.run(runOptions());

    expect(result.status).toBe('rejected');
    expect(result.policyEvaluation.results[0]?.status).toBe('rejected');
    expect(result.policyApproval).toBeUndefined();
    expect(executor.executeMock).not.toHaveBeenCalled();
  });

  it('rechecks freshness immediately before execution', async () => {
    const executor = executorReturning('executed');
    const manager = createManager({
      executor,
      clock: clockFrom([
        '2026-09-01T12:01:00.000Z',
        '2026-09-01T12:01:00.000Z',
        '2026-09-01T12:01:00.000Z',
        '2026-09-01T12:01:00.000Z',
        '2026-09-01T12:01:00.000Z',
        '2026-09-01T12:01:00.000Z',
        '2026-09-01T12:10:00.000Z',
        '2026-09-01T12:10:00.000Z',
      ]),
    });

    const result = await manager.run(runOptions('execute'));

    expect(result.status).toBe('stale-before-execution');
    expect(result.policyApproval?.actions).toHaveLength(1);
    expect(result.preflightResults[0]?.status).toBe('dry-run');
    expect(executor.executeMock).toHaveBeenCalledTimes(1);
  });

  it('does not execute when projections expire during preflight', async () => {
    let now = new Date('2026-09-01T12:01:00.000Z');
    const execute = vi.fn(
      (
        actions: readonly FantasyAction[],
        executionOptions: { readonly mode: 'dry-run' | 'execute' },
      ) => {
        if (executionOptions.mode === 'dry-run') {
          now = new Date('2026-09-01T12:02:01.000Z');
        }
        return Promise.resolve(
          actions.map((action): ActionResult =>
            executionOptions.mode === 'dry-run'
              ? {
                  status: 'dry-run',
                  action,
                  summary: 'Would set lineup',
                  validation: 'local',
                }
              : { status: 'executed', action },
          ),
        );
      },
    );
    const manager = createManager({
      executor: { execute },
      maxProjectionAgeMs: 2 * 60 * 1_000,
      clock: () => now,
    });

    const result = await manager.run(runOptions('execute'));

    expect(result.status).toBe('stale-before-execution');
    expect(result.preflightResults[0]?.status).toBe('dry-run');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('requires a successful dry-run before execution and verifies observed state', async () => {
    const executor = executorReturning('executed');
    const lineupReader = {
      getLineup: vi.fn(() => Promise.resolve(verifiedLineup)),
    };
    const result = await createManager({ executor, lineupReader }).run(
      runOptions('execute'),
    );

    expect(executor.executeMock).toHaveBeenNthCalledWith(
      1,
      result.policyApproval?.actions,
      { mode: 'dry-run' },
    );
    expect(executor.executeMock).toHaveBeenNthCalledWith(
      2,
      result.policyApproval?.actions,
      { mode: 'execute' },
    );
    expect(result.status).toBe('executed');
    expect(result.preflightResults[0]?.status).toBe('dry-run');
    expect(result.executionResults[0]?.status).toBe('executed');
    expect(result.verification).toEqual({
      status: 'verified',
      observedLineup: verifiedLineup,
      issues: [],
    });
    expect(lineupReader.getLineup).toHaveBeenCalledWith(team, '3');
  });

  it('does not mutate when platform preflight fails', async () => {
    const execute = vi.fn((actions: readonly FantasyAction[]) =>
      Promise.resolve(
        actions.map((action): ActionResult => ({
          status: 'failed',
          action,
          error: {
            code: 'LOCKED',
            message: 'Player is locked',
            retryable: false,
          },
        })),
      ),
    );

    const result = await createManager({ executor: { execute } }).run(
      runOptions('execute'),
    );

    expect(result.status).toBe('preflight-failed');
    expect(result.preflightResults[0]?.status).toBe('failed');
    expect(result.executionResults).toEqual([]);
    expect(result.verification.status).toBe('not-attempted');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('records verification mismatches and read failures separately', async () => {
    const mismatch = await createManager({
      executor: executorReturning('executed'),
      lineupReader: {
        getLineup: () => Promise.resolve(snapshot.teams[0]!.lineup),
      },
    }).run(runOptions('execute'));
    const failed = await createManager({
      executor: executorReturning('executed'),
      lineupReader: {
        getLineup: () =>
          Promise.reject(
            Object.assign(new Error('Yahoo read failed'), {
              code: 'YAHOO_HTTP_ERROR',
              status: 503,
              retryable: true,
            }),
          ),
      },
    }).run(runOptions('execute'));

    expect(mismatch.status).toBe('executed');
    expect(mismatch.verification).toMatchObject({
      status: 'mismatch',
      issues: [
        { code: 'ASSIGNMENT_MISMATCH', slotId: qbSlot },
        { code: 'ASSIGNMENT_MISMATCH', slotId: benchSlot },
      ],
    });
    expect(failed.status).toBe('executed');
    expect(failed.verification).toEqual({
      status: 'failed',
      error: {
        code: 'LINEUP_VERIFICATION_FAILED',
        message: 'Yahoo read failed',
        causeCode: 'YAHOO_HTTP_ERROR',
        providerStatus: 503,
        retryable: true,
      },
    });
  });

  it('verifies unchanged snapshot assignments as part of the intended lineup', async () => {
    const expandedSnapshot: LeagueSnapshot = {
      ...snapshot,
      league: {
        ...snapshot.league,
        settings: {
          ...snapshot.league.settings,
          rosterSlots: [
            ...snapshot.league.settings.rosterSlots,
            {
              id: extraBenchSlot,
              name: 'BN',
              kind: 'bench',
              eligiblePositions: ['QB'],
            },
          ],
        },
      },
      teams: [
        {
          ...snapshot.teams[0]!,
          roster: {
            teamId: team,
            entries: [
              ...snapshot.teams[0]!.roster.entries,
              { player: extraPlayer },
            ],
          },
          lineup: {
            ...snapshot.teams[0]!.lineup,
            assignments: [
              ...snapshot.teams[0]!.lineup.assignments,
              { slotId: extraBenchSlot, playerId: extraPlayer.id },
            ],
          },
        },
      ],
    };
    const result = await createManager({
      snapshotService: {
        capture: () => Promise.resolve(expandedSnapshot),
      },
      projectionProvider: {
        getProjections: () =>
          Promise.resolve({
            ...projections,
            players: [
              ...projections.players,
              { playerId: extraPlayer.id, points: 5 },
            ],
          }),
      },
      executor: executorReturning('executed'),
      lineupReader: {
        getLineup: () => Promise.resolve(verifiedLineup),
      },
    }).run(runOptions('execute'));

    expect(result.verification).toMatchObject({
      status: 'mismatch',
      issues: [
        {
          code: 'ASSIGNMENT_MISMATCH',
          slotId: extraBenchSlot,
          expectedPlayerId: extraPlayer.id,
        },
      ],
    });
  });

  it('records failed and uncertain executor outcomes distinctly', async () => {
    const failed = await createManager({
      executor: executorReturning('failed'),
    }).run(runOptions('execute'));
    const uncertain = await createManager({
      executor: executorReturning('execution-uncertain'),
    }).run(runOptions('execute'));

    expect(failed.status).toBe('execution-failed');
    expect(uncertain.status).toBe('execution-uncertain');
  });

  it('requires freshness configuration and rejects overlapping runs', async () => {
    expectManagerError(
      () =>
        createManager({
          policyEngine: createPolicyEngine(),
        }),
      'SNAPSHOT_FRESHNESS_REQUIRED',
    );
    expectManagerError(
      () => createManager({ maxProjectionAgeMs: 0 }),
      'PROJECTION_FRESHNESS_REQUIRED',
    );

    let releaseCapture: ((snapshot: LeagueSnapshot) => void) | undefined;
    const snapshotService = {
      capture: vi.fn(
        () =>
          new Promise<LeagueSnapshot>((resolve) => {
            releaseCapture = resolve;
          }),
      ),
    };
    const instance = createManager({ snapshotService });
    const first = instance.run(runOptions());

    await expect(instance.run(runOptions())).rejects.toMatchObject({
      code: 'RUN_ALREADY_ACTIVE',
    });
    releaseCapture?.(snapshot);
    await expect(first).resolves.toMatchObject({ status: 'dry-run' });
  });

  it('rejects stale projection inputs before decision-making', async () => {
    await expect(
      createManager({ maxProjectionAgeMs: 60_000 }).run(runOptions()),
    ).rejects.toMatchObject({
      code: 'PROJECTIONS_TOO_OLD',
      stage: 'analytics',
    });
  });

  it('fails closed when the executor violates its result contract', async () => {
    const executor: FantasyPlatformExecutor = {
      execute: vi.fn(() => Promise.resolve([])),
    };

    await expect(
      createManager({ executor }).run(runOptions()),
    ).rejects.toMatchObject({
      code: 'EXECUTOR_CONTRACT_VIOLATION',
      stage: 'execution',
    });
  });

  it('fails closed when a policy engine returns another run provenance', async () => {
    const policy = createPolicyEngine({
      guardrails: { maxSnapshotAgeMs: 5 * 60 * 1_000 },
    });
    const policyEngine = {
      ...policy,
      evaluate: async (...args: Parameters<typeof policy.evaluate>) => ({
        ...(await policy.evaluate(...args)),
        sourceSnapshotId: snapshotId('other-snapshot'),
      }),
    };

    await expect(
      createManager({ policyEngine }).run(runOptions()),
    ).rejects.toMatchObject({
      code: 'POLICY_CONTRACT_VIOLATION',
      stage: 'policy',
    });
  });
});

function createManager(
  overrides: Partial<AutonomousLineupManagerOptions> = {},
): AutonomousLineupManager {
  return new AutonomousLineupManager({
    snapshotService: {
      capture: vi.fn(() => Promise.resolve(snapshot)),
    },
    projectionProvider: {
      getProjections: vi.fn(() => Promise.resolve(projections)),
    },
    decisionEngine: lineupEngine,
    policyEngine: createPolicyEngine({
      guardrails: { maxSnapshotAgeMs: 5 * 60 * 1_000 },
    }),
    executor: executorReturning('dry-run'),
    lineupReader: {
      getLineup: vi.fn(() => Promise.resolve(verifiedLineup)),
    },
    maxProjectionAgeMs: 30 * 60 * 1_000,
    clock: () => new Date('2026-09-01T12:01:00.000Z'),
    runIdFactory: () => 'run-1',
    decisionIdFactory: () => decisionId('decision-1'),
    actionIdFactory: () => actionId('action-1'),
    ...overrides,
  });
}

function runOptions(
  executionMode: 'dry-run' | 'execute' = 'dry-run',
): LineupManagementOptions {
  return {
    leagueId: league,
    managedTeamId: team,
    scoringPeriod: '3',
    freeAgentLimit: 1,
    waiverLimit: 1,
    transactionLimit: 1,
    executionMode,
  };
}

const lineupEngine = engineReturning([
  {
    type: 'set-lineup',
    leagueId: league,
    teamId: team,
    scoringPeriod: '3',
    assignments: [
      { slotId: qbSlot, playerId: backup.id },
      { slotId: benchSlot, playerId: starter.id },
    ],
  },
]);

function engineReturning(
  proposedActions: Awaited<
    ReturnType<DecisionEngine['decide']>
  >['proposedActions'],
): DecisionEngine {
  return {
    id: 'test-engine',
    version: '1.0.0',
    kind: 'deterministic',
    decide: () =>
      Promise.resolve({ rationale: 'Test decision', proposedActions }),
  };
}

function executorReturning(
  status: ActionResult['status'],
): FantasyPlatformExecutor & { executeMock: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(
    (
      actions: readonly FantasyAction[],
      options: { readonly mode: 'dry-run' | 'execute' },
    ) =>
      Promise.resolve(
        actions.map((action): ActionResult => {
          if (options.mode === 'dry-run') {
            return {
              status: 'dry-run',
              action,
              summary: 'Would set lineup',
              validation: 'local',
            };
          }
          if (status === 'executed') return { status, action };
          if (status === 'execution-uncertain') {
            return {
              status,
              action,
              error: { code: 'UNKNOWN', message: 'Unknown', retryable: false },
            };
          }
          return {
            status: 'failed',
            action,
            error: { code: 'FAILED', message: 'Failed', retryable: false },
          };
        }),
      ),
  );
  return {
    execute,
    executeMock: execute,
  };
}

function expectManagerError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error('Expected lineup manager construction to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(LineupManagementError);
    if (!(error instanceof LineupManagementError)) return;
    expect(error.code).toBe(code);
  }
}

function clockFrom(values: readonly string[]): () => Date {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    if (value === undefined) throw new Error('clock fixture is empty');
    return new Date(value);
  };
}

const projections = {
  scoringPeriod: '3',
  observedAt: '2026-09-01T11:59:00.000Z',
  source: 'test',
  players: [
    { playerId: starter.id, points: 10 },
    { playerId: backup.id, points: 20 },
  ],
};

const verifiedLineup = {
  teamId: team,
  scoringPeriod: '3',
  assignments: [
    { slotId: qbSlot, playerId: backup.id },
    { slotId: benchSlot, playerId: starter.id },
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
        { id: qbSlot, name: 'QB', kind: 'active', eligiblePositions: ['QB'] },
        {
          id: benchSlot,
          name: 'BN',
          kind: 'bench',
          eligiblePositions: ['QB'],
        },
      ],
      scoringRules: [],
    },
  },
  teams: [
    {
      team: { id: team, leagueId: league, name: 'Managed' },
      roster: {
        teamId: team,
        entries: [{ player: starter }, { player: backup }],
      },
      lineup: {
        teamId: team,
        scoringPeriod: '3',
        assignments: [
          { slotId: qbSlot, playerId: starter.id },
          { slotId: benchSlot, playerId: backup.id },
        ],
      },
    },
  ],
  standings: [{ teamId: team, rank: 1 }],
  matchups: [],
  playerPool: {
    freeAgents: {
      items: [],
      coverage: { kind: 'bounded', requestedLimit: 1, returnedCount: 0 },
    },
    waivers: {
      items: [],
      coverage: { kind: 'bounded', requestedLimit: 1, returnedCount: 0 },
    },
  },
  recentTransactions: {
    items: [],
    coverage: { kind: 'bounded', requestedLimit: 1, returnedCount: 0 },
  },
  integrityWarnings: [],
};
