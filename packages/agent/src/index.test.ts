import { describe, expect, it } from 'vitest';

import {
  actionId,
  decisionId,
  leagueId,
  playerId,
  snapshotId,
  teamId,
  type LeagueSnapshot,
} from '@eggbot/core';
import type { LeagueAnalytics } from '@eggbot/analytics';
import type { FootballIntelligenceSnapshot } from '@eggbot/football-data';

import {
  createDecisionContext,
  DecisionValidationError,
  runDecisionEngine,
  validateDecisionProposal,
  type DecisionEngine,
  type FantasyActionIntent,
} from './index.js';

const managedTeamId = teamId('managed-team');
const snapshot: LeagueSnapshot = {
  id: snapshotId('snapshot-1'),
  captureStartedAt: '2026-09-01T12:00:00.000Z',
  capturedAt: '2026-09-01T12:00:01.000Z',
  consistency: 'best-effort',
  scoringPeriod: '3',
  league: {
    id: leagueId('league-1'),
    name: 'League',
    season: 2026,
    settings: { rosterSlots: [], scoringRules: [] },
  },
  teams: [
    {
      team: {
        id: managedTeamId,
        leagueId: leagueId('league-1'),
        name: 'Managed Team',
      },
      roster: { teamId: managedTeamId, entries: [] },
      lineup: {
        teamId: managedTeamId,
        scoringPeriod: '3',
        assignments: [],
      },
    },
  ],
  standings: [{ teamId: managedTeamId, rank: 1 }],
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
const analytics: LeagueAnalytics = {
  sourceSnapshotId: snapshot.id,
  scoringPeriod: snapshot.scoringPeriod,
  projectionProvenance: {
    scoringPeriod: snapshot.scoringPeriod,
    observedAt: '2026-09-01T11:45:00.000Z',
    source: 'test-projections',
  },
  playerProjections: [],
  lineupProjections: [
    {
      teamId: managedTeamId,
      scoringPeriod: snapshot.scoringPeriod,
      projectedPoints: 0,
      projectionCoverage: { projectedCount: 0, totalCount: 0, ratio: 1 },
      missingProjectionPlayerIds: [],
      unfilledActiveSlotIds: [],
      floorCoverage: { projectedCount: 0, totalCount: 0, ratio: 1 },
      ceilingCoverage: { projectedCount: 0, totalCount: 0, ratio: 1 },
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
      missingStarterProjectionCount: 0,
      starterProjectionCoverage: {
        projectedCount: 0,
        totalCount: 0,
        ratio: 1,
      },
      floorProjectionCoverage: {
        projectedCount: 0,
        totalCount: 0,
        ratio: 1,
      },
      sourceIntegrityWarningCount: 0,
    },
  ],
  warnings: [],
};
const footballIntelligence: FootballIntelligenceSnapshot = {
  captureStartedAt: '2026-09-01T11:44:59.000Z',
  capturedAt: '2026-09-01T11:45:01.000Z',
  consistency: 'best-effort',
  scoringPeriod: snapshot.scoringPeriod,
  provider: { id: 'test-football-data', version: '1.0.0' },
  injuries: {
    observedAt: '2026-09-01T11:45:00.000Z',
    source: 'test-injuries',
    reports: [],
  },
  projections: {
    ...analytics.projectionProvenance,
    players: analytics.playerProjections,
  },
  depthCharts: {
    observedAt: '2026-09-01T11:45:00.000Z',
    source: 'test-depth-charts',
    entries: [],
  },
  usage: {
    observedAt: '2026-09-01T11:45:00.000Z',
    source: 'test-usage',
    scoringPeriod: snapshot.scoringPeriod,
    players: [],
  },
  news: {
    observedAt: '2026-09-01T11:45:00.000Z',
    source: 'test-news',
    items: [],
  },
  schedule: {
    observedAt: '2026-09-01T11:45:00.000Z',
    source: 'test-schedule',
    scoringPeriod: snapshot.scoringPeriod,
    games: [],
  },
};

describe('createDecisionContext', () => {
  it('accepts an explicitly managed team in the snapshot', () => {
    expect(
      createDecisionContext({ snapshot, managedTeamId, analytics }),
    ).toMatchObject({ managedTeamId });
  });

  it('accepts coherent football intelligence and rejects mismatched periods', () => {
    expect(
      createDecisionContext({
        snapshot,
        managedTeamId,
        analytics,
        footballIntelligence,
      }).footballIntelligence,
    ).toBe(footballIntelligence);
    expect(() =>
      createDecisionContext({
        snapshot,
        managedTeamId,
        analytics,
        footballIntelligence: {
          ...footballIntelligence,
          scoringPeriod: '4',
        },
      }),
    ).toThrowError(
      'Football intelligence scoring period does not match the league snapshot',
    );
  });

  it('rejects intelligence projections that differ from analytics inputs', () => {
    expect(() =>
      createDecisionContext({
        snapshot,
        managedTeamId,
        analytics,
        footballIntelligence: {
          ...footballIntelligence,
          projections: {
            ...footballIntelligence.projections,
            source: 'different-projections',
          },
        },
      }),
    ).toThrowError(
      'Football intelligence projections do not match the analytics inputs',
    );
  });

  it('rejects a managed team outside the snapshot', () => {
    expect(() =>
      createDecisionContext({
        snapshot,
        managedTeamId: teamId('unknown-team'),
        analytics,
      }),
    ).toThrowError('Managed team is not present in the league snapshot');
  });

  it('rejects analytics derived from another snapshot', () => {
    expect(() =>
      createDecisionContext({
        snapshot,
        managedTeamId,
        analytics: { ...analytics, sourceSnapshotId: snapshotId('other') },
      }),
    ).toThrowError('Analytics were not derived from the league snapshot');
  });

  it('rejects analytics that do not cover the managed team', () => {
    expect(() =>
      createDecisionContext({
        snapshot,
        managedTeamId,
        analytics: { ...analytics, rosterRisk: [] },
      }),
    ).toThrowError('Analytics do not cover the managed team');
  });

  it('rejects analytics with mismatched projection provenance', () => {
    expect(() =>
      createDecisionContext({
        snapshot,
        managedTeamId,
        analytics: {
          ...analytics,
          projectionProvenance: {
            ...analytics.projectionProvenance,
            scoringPeriod: '4',
          },
        },
      }),
    ).toThrowError(
      'Projection scoring period does not match the analytics result',
    );
  });
});

describe('runDecisionEngine', () => {
  it('assigns host-owned metadata and records engine provenance', async () => {
    const engine: DecisionEngine = {
      id: 'local-test',
      version: '1.0.0',
      kind: 'deterministic',
      decide: () =>
        Promise.resolve({
          rationale: 'Propose a scoped acquisition.',
          proposedActions: [
            {
              type: 'add-player',
              leagueId: snapshot.league.id,
              teamId: managedTeamId,
              playerId: playerId('player-1'),
            },
          ],
        }),
    };
    const times = [
      new Date('2026-09-01T12:01:00.000Z'),
      new Date('2026-09-01T12:01:00.250Z'),
    ];

    const result = await runDecisionEngine(
      engine,
      { snapshot, managedTeamId, analytics, footballIntelligence },
      {
        clock: () => {
          const value = times.shift();
          if (value === undefined) throw new Error('clock exhausted');
          return value;
        },
        decisionIdFactory: () => decisionId('decision-1'),
        actionIdFactory: (index) => actionId(`action-${index}`),
      },
    );

    expect(result).toEqual({
      engine: { id: 'local-test', version: '1.0.0', kind: 'deterministic' },
      sourceSnapshotId: snapshot.id,
      snapshot,
      managedTeamId,
      startedAt: '2026-09-01T12:01:00.000Z',
      completedAt: '2026-09-01T12:01:00.250Z',
      analytics,
      footballIntelligence,
      decision: {
        id: 'decision-1',
        createdAt: '2026-09-01T12:01:00.250Z',
        rationale: 'Propose a scoped acquisition.',
        proposedActions: [
          {
            id: 'action-0',
            type: 'add-player',
            leagueId: snapshot.league.id,
            teamId: managedTeamId,
            playerId: 'player-1',
          },
        ],
      },
    });
  });

  it('propagates engine failures without converting them to validation errors', async () => {
    const providerError = new Error('provider unavailable');
    const engine: DecisionEngine = {
      id: 'external-test',
      version: '1.0.0',
      kind: 'external-service',
      decide: () => Promise.reject(providerError),
    };

    await expect(
      runDecisionEngine(
        engine,
        { snapshot, managedTeamId, analytics },
        {
          clock: () => new Date('2026-09-01T12:01:00.000Z'),
          decisionIdFactory: () => decisionId('unused'),
          actionIdFactory: () => actionId('unused'),
        },
      ),
    ).rejects.toBe(providerError);
  });

  it('rejects duplicate host-generated action IDs', async () => {
    const engine: DecisionEngine = {
      id: 'local-test',
      version: '1.0.0',
      kind: 'deterministic',
      decide: () =>
        Promise.resolve({
          rationale: 'Two proposed acquisitions.',
          proposedActions: [
            {
              type: 'add-player',
              leagueId: snapshot.league.id,
              teamId: managedTeamId,
              playerId: playerId('player-1'),
            },
            {
              type: 'add-player',
              leagueId: snapshot.league.id,
              teamId: managedTeamId,
              playerId: playerId('player-2'),
            },
          ],
        }),
    };

    await expectDecisionErrorAsync(
      () =>
        runDecisionEngine(
          engine,
          { snapshot, managedTeamId, analytics },
          {
            clock: () => new Date('2026-09-01T12:01:00.000Z'),
            decisionIdFactory: () => decisionId('decision-2'),
            actionIdFactory: () => actionId('duplicate'),
          },
        ),
      'DUPLICATE_ACTION_ID',
    );
  });
});

describe('validateDecisionProposal', () => {
  const context = { snapshot, managedTeamId, analytics };
  const validAction: FantasyActionIntent = {
    type: 'add-player',
    leagueId: snapshot.league.id,
    teamId: managedTeamId,
    playerId: playerId('player-1'),
  };

  it('rebuilds actions from allowlisted fields and parses branded IDs', () => {
    const result = validateDecisionProposal(
      {
        rationale: '  Normalize model output.  ',
        arbitraryProposalField: true,
        proposedActions: [
          {
            id: 'model-controlled-id',
            type: 'add-player',
            leagueId: ` ${snapshot.league.id} `,
            teamId: ` ${managedTeamId} `,
            playerId: ' player-1 ',
            arbitraryStuff: 'discard me',
          },
          {
            type: 'set-lineup',
            leagueId: snapshot.league.id,
            teamId: managedTeamId,
            scoringPeriod: ' 3 ',
            assignments: [
              {
                slotId: ' slot-qb ',
                playerId: ' player-2 ',
                arbitraryAssignmentField: true,
              },
            ],
            arbitraryStuff: 'discard me too',
          },
        ],
      },
      context,
    );

    expect(result).toEqual({
      rationale: 'Normalize model output.',
      proposedActions: [
        {
          type: 'add-player',
          leagueId: snapshot.league.id,
          teamId: managedTeamId,
          playerId: 'player-1',
        },
        {
          type: 'set-lineup',
          leagueId: snapshot.league.id,
          teamId: managedTeamId,
          scoringPeriod: '3',
          assignments: [{ slotId: 'slot-qb', playerId: 'player-2' }],
        },
      ],
    });
  });

  it.each([
    {
      proposal: { rationale: ' ', proposedActions: [] },
      code: 'INVALID_RATIONALE',
    },
    {
      proposal: {
        rationale: 'Invalid player ID',
        proposedActions: [{ ...validAction, playerId: ' ' }],
      },
      code: 'MALFORMED_ACTION',
    },
    {
      proposal: {
        rationale: 'Wrong team',
        proposedActions: [{ ...validAction, teamId: teamId('other') }],
      },
      code: 'ACTION_TEAM_MISMATCH',
    },
    {
      proposal: {
        rationale: 'Wrong period',
        proposedActions: [
          {
            type: 'set-lineup',
            leagueId: snapshot.league.id,
            teamId: managedTeamId,
            scoringPeriod: '4',
            assignments: [],
          },
        ],
      },
      code: 'ACTION_PERIOD_MISMATCH',
    },
    {
      proposal: {
        rationale: 'Malformed action',
        proposedActions: [{ type: 'invented-action' }],
      },
      code: 'MALFORMED_ACTION',
    },
  ])('rejects invalid output with $code', ({ proposal, code }) => {
    expectDecisionError(
      () => validateDecisionProposal(proposal, context),
      code,
    );
  });
});

function expectDecisionError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error('Expected decision validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(DecisionValidationError);
    if (!(error instanceof DecisionValidationError)) return;
    expect(error.code).toBe(code);
  }
}

async function expectDecisionErrorAsync(
  operation: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation();
    throw new Error('Expected decision validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(DecisionValidationError);
    if (!(error instanceof DecisionValidationError)) return;
    expect(error.code).toBe(code);
  }
}
