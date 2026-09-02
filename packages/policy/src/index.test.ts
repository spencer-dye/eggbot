import { describe, expect, it } from 'vitest';

import type { DecisionRun } from '@eggbot/agent';
import {
  actionId,
  decisionId,
  leagueId,
  playerId,
  rosterSlotId,
  snapshotId,
  teamId,
  type FantasyAction,
  type LeagueSnapshot,
  type Player,
} from '@eggbot/core';

import {
  createPolicyApproval,
  createPolicyEngine,
  getApprovedActions,
  PolicyValidationError,
  type PolicyContext,
  type PolicyRule,
} from './index.js';

const managedTeamId = teamId('managed-team');
const league = leagueId('league-1');
const qbSlot = rosterSlotId('slot-qb');
const rbSlot = rosterSlotId('slot-rb');
const benchSlot = rosterSlotId('slot-bench');
const qbStarter = player('qb-starter', ['QB']);
const rbStarter = player('rb-starter', ['RB']);
const qbBench = player('qb-bench', ['QB']);
const freeRb = player('free-rb', ['RB']);
const freeWr = player('free-wr', ['WR']);
const waiverRb = player('waiver-rb', ['RB']);

describe('createPolicyEngine', () => {
  it('approves legal actions and derives a provenance-bearing approval', async () => {
    const lineup = lineupAction('lineup', [
      { slotId: qbSlot, playerId: qbStarter.id },
    ]);
    const addDrop: FantasyAction = {
      id: actionId('add-drop'),
      type: 'add-drop',
      leagueId: league,
      teamId: managedTeamId,
      addPlayerId: freeRb.id,
      dropPlayerId: qbBench.id,
    };
    const run = decisionRun([lineup, addDrop]);

    const evaluation = await createPolicyEngine().evaluate(run, context());

    expect(evaluation.results).toMatchObject([
      { status: 'approved', issues: [] },
      { status: 'approved', issues: [] },
    ]);
    expect(getApprovedActions(evaluation)).toEqual([lineup, addDrop]);
    expect(createPolicyApproval(evaluation)).toEqual({
      decisionId: run.decision.id,
      engine: run.engine,
      policy: {
        id: 'eggbot-policy',
        version: '1.0.0',
        guardrails: {},
        ruleIds: [],
      },
      sourceSnapshotId: run.sourceSnapshotId,
      managedTeamId,
      evaluatedAt: '2026-09-01T12:02:00.000Z',
      actions: [lineup, addDrop],
    });
  });

  it('retains built-in and custom rejection reasons with rule attribution', async () => {
    const action: FantasyAction = {
      id: actionId('protected-drop'),
      type: 'drop-player',
      leagueId: league,
      teamId: managedTeamId,
      playerId: qbBench.id,
    };
    const customRule: PolicyRule = {
      id: 'application.manual-review',
      evaluate: () => ({
        code: 'MANUAL_REVIEW_REQUIRED',
        message: 'Operator approval is required',
        resource: { kind: 'player', id: qbBench.id },
      }),
    };
    const evaluation = await createPolicyEngine({
      guardrails: { protectedPlayerIds: [qbBench.id] },
      rules: [customRule],
    }).evaluate(decisionRun([action]), context());

    expect(evaluation.results[0]).toMatchObject({
      status: 'rejected',
      issues: [
        { ruleId: 'eggbot.guardrail', code: 'PROTECTED_PLAYER' },
        {
          ruleId: 'application.manual-review',
          code: 'MANUAL_REVIEW_REQUIRED',
          actionId: action.id,
        },
      ],
    });
    expect(getApprovedActions(evaluation)).toEqual([]);
  });

  it('rejects invalid lineup state with complete structured reasons', async () => {
    const unknownSlot = rosterSlotId('unknown-slot');
    const unknownPlayer = playerId('unknown-player');
    const action = lineupAction('invalid-lineup', [
      { slotId: qbSlot, playerId: rbStarter.id },
      { slotId: qbSlot, playerId: rbStarter.id },
      { slotId: unknownSlot, playerId: unknownPlayer },
    ]);

    const evaluation = await createPolicyEngine().evaluate(
      decisionRun([action]),
      context(),
    );
    const codes = issueCodes(evaluation.results[0]);

    expect(codes).toEqual(
      expect.arrayContaining([
        'DUPLICATE_LINEUP_PLAYER',
        'DUPLICATE_LINEUP_SLOT',
        'UNKNOWN_ROSTER_SLOT',
        'PLAYER_NOT_ROSTERED',
        'PLAYER_INELIGIBLE_FOR_SLOT',
        'INCOMPLETE_STARTING_LINEUP',
      ]),
    );
  });

  it.each([
    {
      action: {
        id: actionId('drop-active'),
        type: 'drop-player',
        leagueId: league,
        teamId: managedTeamId,
        playerId: rbStarter.id,
      } satisfies FantasyAction,
      code: 'DROP_PLAYER_IN_ACTIVE_LINEUP',
    },
    {
      action: {
        id: actionId('add-waiver'),
        type: 'add-player',
        leagueId: league,
        teamId: managedTeamId,
        playerId: waiverRb.id,
      } satisfies FantasyAction,
      code: 'FREE_AGENT_ACTION_REQUIRES_WAIVER',
    },
    {
      action: {
        id: actionId('waive-free-agent'),
        type: 'waiver-claim',
        leagueId: league,
        teamId: managedTeamId,
        addPlayerId: freeRb.id,
        dropPlayerId: qbBench.id,
      } satisfies FantasyAction,
      code: 'WAIVER_TARGET_IS_FREE_AGENT',
    },
    {
      action: {
        id: actionId('drop-unknown'),
        type: 'drop-player',
        leagueId: league,
        teamId: managedTeamId,
        playerId: playerId('not-rostered'),
      } satisfies FantasyAction,
      code: 'DROP_PLAYER_NOT_ROSTERED',
    },
    {
      action: {
        id: actionId('same-player'),
        type: 'add-drop',
        leagueId: league,
        teamId: managedTeamId,
        addPlayerId: qbBench.id,
        dropPlayerId: qbBench.id,
      } satisfies FantasyAction,
      code: 'SAME_ADD_DROP_PLAYER',
    },
    {
      action: {
        id: actionId('full-roster'),
        type: 'add-player',
        leagueId: league,
        teamId: managedTeamId,
        playerId: freeWr.id,
      } satisfies FantasyAction,
      code: 'ROSTER_CAPACITY_EXCEEDED',
    },
  ])('rejects acquisition state with $code', async ({ action, code }) => {
    const evaluation = await createPolicyEngine().evaluate(
      decisionRun([action]),
      context(),
    );
    expect(issueCodes(evaluation.results[0])).toContain(code);
  });

  it('applies decision, mutation, waiver-bid, and snapshot-age guardrails', async () => {
    const waiver: FantasyAction = {
      id: actionId('waiver'),
      type: 'waiver-claim',
      leagueId: league,
      teamId: managedTeamId,
      addPlayerId: waiverRb.id,
      dropPlayerId: qbBench.id,
      bid: 11,
    };
    const drop: FantasyAction = {
      id: actionId('drop'),
      type: 'drop-player',
      leagueId: league,
      teamId: managedTeamId,
      playerId: rbStarter.id,
    };
    const evaluation = await createPolicyEngine({
      guardrails: {
        maxActionsPerDecision: 1,
        maxRosterMutationActions: 1,
        maxWaiverBid: 10,
        maxSnapshotAgeMs: 1_000,
      },
    }).evaluate(decisionRun([waiver, drop]), context());

    expect(issueCodes(evaluation.results[0])).toEqual(
      expect.arrayContaining([
        'DECISION_ACTION_LIMIT_EXCEEDED',
        'ROSTER_MUTATION_LIMIT_EXCEEDED',
        'WAIVER_BID_LIMIT_EXCEEDED',
        'SNAPSHOT_TOO_OLD',
      ]),
    );
    expect(issueCodes(evaluation.results[1])).toEqual(
      expect.arrayContaining([
        'DECISION_ACTION_LIMIT_EXCEEDED',
        'ROSTER_MUTATION_LIMIT_EXCEEDED',
        'SNAPSHOT_TOO_OLD',
      ]),
    );
  });

  it('rejects standalone acquisitions that collectively exceed roster capacity', async () => {
    const snapshot = snapshotFixture();
    const openRosterSnapshot: LeagueSnapshot = {
      ...snapshot,
      teams: [
        {
          ...snapshot.teams[0]!,
          roster: {
            teamId: managedTeamId,
            entries: snapshot.teams[0]!.roster.entries.slice(0, 2),
          },
          lineup: {
            ...snapshot.teams[0]!.lineup,
            assignments: snapshot.teams[0]!.lineup.assignments.slice(0, 2),
          },
        },
      ],
    };
    const first: FantasyAction = {
      id: actionId('first-add'),
      type: 'add-player',
      leagueId: league,
      teamId: managedTeamId,
      playerId: freeRb.id,
    };
    const second: FantasyAction = {
      id: actionId('second-add'),
      type: 'add-player',
      leagueId: league,
      teamId: managedTeamId,
      playerId: freeWr.id,
    };

    const evaluation = await createPolicyEngine().evaluate(
      decisionRun([first, second], openRosterSnapshot),
      context(),
    );

    expect(issueCodes(evaluation.results[0])).toContain(
      'BATCH_ROSTER_CAPACITY_EXCEEDED',
    );
    expect(issueCodes(evaluation.results[1])).toContain(
      'BATCH_ROSTER_CAPACITY_EXCEEDED',
    );
    expect(getApprovedActions(evaluation)).toEqual([]);
  });

  it('rejects waiver bids that collectively exceed remaining budget', async () => {
    const source = snapshotFixture();
    const secondWaiver = player('second-waiver', ['WR']);
    const budgetSnapshot: LeagueSnapshot = {
      ...source,
      teams: [
        {
          ...source.teams[0]!,
          team: {
            ...source.teams[0]!.team,
            acquisitionState: {
              ...source.teams[0]!.team.acquisitionState,
              waiverBudgetRemaining: 10,
            },
          },
          roster: {
            teamId: managedTeamId,
            entries: source.teams[0]!.roster.entries.slice(0, 1),
          },
          lineup: {
            ...source.teams[0]!.lineup,
            assignments: source.teams[0]!.lineup.assignments.slice(0, 1),
          },
        },
      ],
      playerPool: {
        ...source.playerPool,
        waivers: {
          items: [waiverRb, secondWaiver],
          coverage: { kind: 'bounded', requestedLimit: 10, returnedCount: 2 },
        },
      },
    };
    const claims: readonly FantasyAction[] = [waiverRb, secondWaiver].map(
      (target, index) => ({
        id: actionId(`claim-${index}`),
        type: 'waiver-claim',
        leagueId: league,
        teamId: managedTeamId,
        addPlayerId: target.id,
        bid: 6,
      }),
    );

    const evaluation = await createPolicyEngine().evaluate(
      decisionRun(claims, budgetSnapshot),
      context(),
    );

    expect(issueCodes(evaluation.results[0])).toContain(
      'WAIVER_BATCH_BUDGET_EXCEEDED',
    );
    expect(issueCodes(evaluation.results[1])).toContain(
      'WAIVER_BATCH_BUDGET_EXCEEDED',
    );
  });

  it('does not let an invalid drop create batch capacity', async () => {
    const snapshot = snapshotFixture();
    const openRosterSnapshot: LeagueSnapshot = {
      ...snapshot,
      teams: [
        {
          ...snapshot.teams[0]!,
          roster: {
            teamId: managedTeamId,
            entries: snapshot.teams[0]!.roster.entries.slice(0, 2),
          },
          lineup: {
            ...snapshot.teams[0]!.lineup,
            assignments: snapshot.teams[0]!.lineup.assignments.slice(0, 2),
          },
        },
      ],
    };
    const actions: readonly FantasyAction[] = [
      {
        id: actionId('first-add'),
        type: 'add-player',
        leagueId: league,
        teamId: managedTeamId,
        playerId: freeRb.id,
      },
      {
        id: actionId('second-add'),
        type: 'add-player',
        leagueId: league,
        teamId: managedTeamId,
        playerId: freeWr.id,
      },
      {
        id: actionId('invalid-drop'),
        type: 'drop-player',
        leagueId: league,
        teamId: managedTeamId,
        playerId: playerId('not-rostered'),
      },
    ];

    const evaluation = await createPolicyEngine().evaluate(
      decisionRun(actions, openRosterSnapshot),
      context(),
    );

    expect(issueCodes(evaluation.results[0])).toContain(
      'BATCH_ROSTER_CAPACITY_EXCEEDED',
    );
    expect(issueCodes(evaluation.results[1])).toContain(
      'BATCH_ROSTER_CAPACITY_EXCEEDED',
    );
    expect(issueCodes(evaluation.results[2])).toContain(
      'DROP_PLAYER_NOT_ROSTERED',
    );
  });

  it('keeps standalone additions snapshot-relative even when paired with a drop', async () => {
    const add: FantasyAction = {
      id: actionId('standalone-add'),
      type: 'add-player',
      leagueId: league,
      teamId: managedTeamId,
      playerId: freeWr.id,
    };
    const drop: FantasyAction = {
      id: actionId('standalone-drop'),
      type: 'drop-player',
      leagueId: league,
      teamId: managedTeamId,
      playerId: qbBench.id,
    };

    const evaluation = await createPolicyEngine().evaluate(
      decisionRun([drop, add]),
      context(),
    );

    expect(evaluation.results[0]?.status).toBe('approved');
    expect(issueCodes(evaluation.results[1])).toContain(
      'ROSTER_CAPACITY_EXCEEDED',
    );
  });

  it('freezes the policy descriptor and copied configuration', async () => {
    const protectedPlayerIds = [qbBench.id];
    const engine = createPolicyEngine({
      guardrails: { protectedPlayerIds },
    });
    protectedPlayerIds.push(rbStarter.id);

    const evaluation = await engine.evaluate(decisionRun([]), context());

    expect(Object.isFrozen(engine)).toBe(true);
    expect(Object.isFrozen(engine.guardrails)).toBe(true);
    expect(Object.isFrozen(engine.guardrails.protectedPlayerIds)).toBe(true);
    expect(Object.isFrozen(engine.ruleIds)).toBe(true);
    expect(Object.isFrozen(evaluation.policy)).toBe(true);
    expect(engine.guardrails.protectedPlayerIds).toEqual([qbBench.id]);
  });

  it('rejects cross-action player conflicts symmetrically', async () => {
    const add: FantasyAction = {
      id: actionId('add'),
      type: 'add-player',
      leagueId: league,
      teamId: managedTeamId,
      playerId: freeRb.id,
    };
    const waiver: FantasyAction = {
      id: actionId('waiver-same'),
      type: 'waiver-claim',
      leagueId: league,
      teamId: managedTeamId,
      addPlayerId: freeRb.id,
      dropPlayerId: qbBench.id,
    };
    const evaluation = await createPolicyEngine().evaluate(
      decisionRun([add, waiver]),
      context(),
    );

    for (const result of evaluation.results) {
      expect(issueCodes(result)).toContain('PLAYER_ACTION_CONFLICT');
      if (result.status === 'approved') throw new Error('expected rejection');
      expect(
        result.issues.find(({ code }) => code === 'PLAYER_ACTION_CONFLICT')
          ?.relatedActionIds,
      ).toHaveLength(1);
    }
  });

  it('attributes duplicate IDs and duplicate intents to the correct actions', async () => {
    const duplicateId = actionId('duplicate-id');
    const first: FantasyAction = {
      id: duplicateId,
      type: 'add-player',
      leagueId: league,
      teamId: managedTeamId,
      playerId: freeWr.id,
    };
    const second: FantasyAction = {
      id: duplicateId,
      type: 'drop-player',
      leagueId: league,
      teamId: managedTeamId,
      playerId: qbBench.id,
    };
    const repeatedIntent: FantasyAction = {
      ...first,
      id: actionId('repeated-intent'),
    };
    const evaluation = await createPolicyEngine().evaluate(
      decisionRun([first, second, repeatedIntent]),
      context(),
    );

    expect(issueCodes(evaluation.results[0])).toEqual(
      expect.arrayContaining(['DUPLICATE_ACTION_ID', 'DUPLICATE_ACTION']),
    );
    expect(issueCodes(evaluation.results[1])).toContain('DUPLICATE_ACTION_ID');
    expect(issueCodes(evaluation.results[1])).not.toContain('DUPLICATE_ACTION');
    expect(issueCodes(evaluation.results[2])).toContain('DUPLICATE_ACTION');
    expect(issueCodes(evaluation.results[2])).not.toContain(
      'DUPLICATE_ACTION_ID',
    );
  });

  it('rejects multiple lineup actions and lineup/drop conflicts', async () => {
    const first = lineupAction('lineup-one', [
      { slotId: qbSlot, playerId: qbBench.id },
      { slotId: benchSlot, playerId: qbStarter.id },
    ]);
    const second = lineupAction('lineup-two', [
      { slotId: qbSlot, playerId: qbStarter.id },
    ]);
    const drop: FantasyAction = {
      id: actionId('drop-lineup-player'),
      type: 'drop-player',
      leagueId: league,
      teamId: managedTeamId,
      playerId: qbStarter.id,
    };
    const evaluation = await createPolicyEngine().evaluate(
      decisionRun([first, second, drop]),
      context(),
    );

    expect(issueCodes(evaluation.results[0])).toEqual(
      expect.arrayContaining([
        'MULTIPLE_LINEUP_ACTIONS',
        'LINEUP_DROP_CONFLICT',
      ]),
    );
    expect(issueCodes(evaluation.results[1])).toEqual(
      expect.arrayContaining([
        'MULTIPLE_LINEUP_ACTIONS',
        'LINEUP_DROP_CONFLICT',
      ]),
    );
    expect(issueCodes(evaluation.results[2])).toContain('LINEUP_DROP_CONFLICT');
  });

  it('rejects mismatched run provenance as a validation error', async () => {
    const run = {
      ...decisionRun([]),
      sourceSnapshotId: snapshotId('other-snapshot'),
    };

    await expectPolicyError(
      () => createPolicyEngine().evaluate(run, context()),
      'RUN_SNAPSHOT_MISMATCH',
    );
  });

  it('rejects invalid guardrail and custom-rule configuration', () => {
    expectPolicyErrorSync(
      () =>
        createPolicyEngine({
          guardrails: { maxWaiverBid: -1 },
        }),
      'INVALID_GUARDRAIL',
    );
    const duplicate: PolicyRule = { id: 'same', evaluate: () => undefined };
    expectPolicyErrorSync(
      () => createPolicyEngine({ rules: [duplicate, duplicate] }),
      'DUPLICATE_RULE_ID',
    );
  });
});

function context(): PolicyContext {
  return {
    evaluatedAt: '2026-09-01T12:02:00.000Z',
  };
}

function decisionRun(
  actions: readonly FantasyAction[],
  snapshot: LeagueSnapshot = snapshotFixture(),
): DecisionRun {
  const analytics = analyticsFixture(snapshot);
  return {
    engine: { id: 'test-engine', version: '1.0.0', kind: 'deterministic' },
    sourceSnapshotId: snapshot.id,
    snapshot,
    managedTeamId,
    startedAt: '2026-09-01T12:01:00.000Z',
    completedAt: '2026-09-01T12:01:01.000Z',
    analytics,
    decision: {
      id: decisionId('decision-1'),
      createdAt: '2026-09-01T12:01:01.000Z',
      rationale: 'Policy test',
      proposedActions: actions,
    },
  };
}

function snapshotFixture(): LeagueSnapshot {
  return {
    id: snapshotId('snapshot-1'),
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
            id: qbSlot,
            name: 'QB',
            kind: 'active',
            eligiblePositions: ['QB'],
          },
          {
            id: rbSlot,
            name: 'RB',
            kind: 'active',
            eligiblePositions: ['RB'],
          },
          {
            id: benchSlot,
            name: 'BN',
            kind: 'bench',
            eligiblePositions: ['QB', 'RB', 'WR'],
          },
        ],
        scoringRules: [],
        acquisitionRules: { waiverSystem: 'budget', waiverBudget: 100 },
      },
    },
    teams: [
      {
        team: {
          id: managedTeamId,
          leagueId: league,
          name: 'Managed',
          acquisitionState: {
            waiverPriority: 1,
            waiverBudgetRemaining: 100,
            seasonAcquisitions: 0,
          },
        },
        roster: {
          teamId: managedTeamId,
          entries: [qbStarter, rbStarter, qbBench].map((player) => ({
            player,
          })),
        },
        lineup: {
          teamId: managedTeamId,
          scoringPeriod: '3',
          assignments: [
            { slotId: qbSlot, playerId: qbStarter.id },
            { slotId: rbSlot, playerId: rbStarter.id },
            { slotId: benchSlot, playerId: qbBench.id },
          ],
        },
      },
    ],
    standings: [{ teamId: managedTeamId, rank: 1 }],
    matchups: [],
    playerPool: {
      freeAgents: {
        items: [freeRb, freeWr],
        coverage: { kind: 'bounded', requestedLimit: 10, returnedCount: 2 },
      },
      waivers: {
        items: [waiverRb],
        coverage: { kind: 'bounded', requestedLimit: 10, returnedCount: 1 },
      },
    },
    recentTransactions: {
      items: [],
      coverage: { kind: 'bounded', requestedLimit: 10, returnedCount: 0 },
    },
    integrityWarnings: [],
  };
}

function analyticsFixture(snapshot: LeagueSnapshot): DecisionRun['analytics'] {
  return {
    sourceSnapshotId: snapshot.id,
    scoringPeriod: snapshot.scoringPeriod,
    projectionProvenance: {
      scoringPeriod: snapshot.scoringPeriod,
      observedAt: '2026-09-01T11:45:00.000Z',
      source: 'test',
    },
    playerProjections: [],
    lineupProjections: [
      {
        teamId: managedTeamId,
        scoringPeriod: snapshot.scoringPeriod,
        projectedPoints: 0,
        projectionCoverage: { projectedCount: 0, totalCount: 3, ratio: 0 },
        missingProjectionPlayerIds: [qbStarter.id, rbStarter.id, qbBench.id],
        unfilledActiveSlotIds: [],
        floorCoverage: { projectedCount: 0, totalCount: 3, ratio: 0 },
        ceilingCoverage: { projectedCount: 0, totalCount: 3, ratio: 0 },
      },
    ],
    matchupProjections: [],
    bestAvailablePlayers: [],
    playerValuesOverBestAvailable: [],
    availablePositionScarcity: [],
    rosterRisk: [
      {
        teamId: managedTeamId,
        unfilledActiveSlotCount: 0,
        missingStarterProjectionCount: 3,
        starterProjectionCoverage: {
          projectedCount: 0,
          totalCount: 3,
          ratio: 0,
        },
        floorProjectionCoverage: { projectedCount: 0, totalCount: 3, ratio: 0 },
        sourceIntegrityWarningCount: 0,
      },
    ],
    warnings: [],
  };
}

function lineupAction(
  id: string,
  assignments: Extract<FantasyAction, { type: 'set-lineup' }>['assignments'],
): FantasyAction {
  return {
    id: actionId(id),
    type: 'set-lineup',
    leagueId: league,
    teamId: managedTeamId,
    scoringPeriod: '3',
    assignments,
  };
}

function player(
  id: string,
  eligiblePositions: Player['eligiblePositions'],
): Player {
  return { id: playerId(id), fullName: id, eligiblePositions };
}

function issueCodes(
  result:
    | Awaited<
        ReturnType<ReturnType<typeof createPolicyEngine>['evaluate']>
      >['results'][number]
    | undefined,
): readonly string[] {
  return result?.issues.map(({ code }) => code) ?? [];
}

async function expectPolicyError(
  operation: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation();
    throw new Error('Expected policy validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(PolicyValidationError);
    if (!(error instanceof PolicyValidationError)) return;
    expect(error.code).toBe(code);
  }
}

function expectPolicyErrorSync(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error('Expected policy validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(PolicyValidationError);
    if (!(error instanceof PolicyValidationError)) return;
    expect(error.code).toBe(code);
  }
}
