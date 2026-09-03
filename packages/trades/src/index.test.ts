import { describe, expect, it } from 'vitest';

import {
  leagueId,
  playerId,
  rosterSlotId,
  snapshotId,
  teamId,
  type LeagueSnapshot,
} from '@eggbot/core';

import {
  evaluateTrade,
  parseTradeScenario,
  parseTradeValuationSet,
  TradeValidationError,
  type TradeScenario,
  type TradeValuationSet,
} from './index.js';

const league = leagueId('league');
const teamA = teamId('team-a');
const teamB = teamId('team-b');
const playerA = playerId('player-a');
const playerA2 = playerId('player-a-2');
const playerB = playerId('player-b');
const playerB2 = playerId('player-b-2');
const snapshot: LeagueSnapshot = {
  id: snapshotId('snapshot'),
  captureStartedAt: '2026-09-02T12:00:00.000Z',
  capturedAt: '2026-09-02T12:00:01.000Z',
  consistency: 'best-effort',
  scoringPeriod: 'week-1',
  league: {
    id: league,
    name: 'League',
    season: 2026,
    settings: {
      rosterSlots: [
        {
          id: rosterSlotId('starter'),
          name: 'Starter',
          kind: 'active',
          eligiblePositions: ['RB'],
        },
        {
          id: rosterSlotId('bench'),
          name: 'Bench',
          kind: 'bench',
          eligiblePositions: ['RB'],
        },
      ],
      scoringRules: [],
      teamCount: 2,
    },
  },
  teams: [
    {
      team: { id: teamA, leagueId: league, name: 'Team A' },
      roster: {
        teamId: teamA,
        entries: [
          { player: player(playerA, 'Player A') },
          { player: player(playerA2, 'Player A2') },
        ],
      },
      lineup: { teamId: teamA, scoringPeriod: 'week-1', assignments: [] },
    },
    {
      team: { id: teamB, leagueId: league, name: 'Team B' },
      roster: {
        teamId: teamB,
        entries: [
          { player: player(playerB, 'Player B') },
          { player: player(playerB2, 'Player B2') },
        ],
      },
      lineup: { teamId: teamB, scoringPeriod: 'week-1', assignments: [] },
    },
  ],
  standings: [
    { teamId: teamA, rank: 1 },
    { teamId: teamB, rank: 2 },
  ],
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
const scenario: TradeScenario = {
  leagueId: league,
  transfers: [
    { playerId: playerA, fromTeamId: teamA, toTeamId: teamB },
    { playerId: playerB, fromTeamId: teamB, toTeamId: teamA },
  ],
};
const valuations: TradeValuationSet = {
  leagueId: league,
  observedAt: '2026-09-02T12:00:02.000Z',
  source: 'test-trade-values',
  version: '1.0.0',
  unit: 'rest-of-season-points',
  horizon: { kind: 'rest-of-season', season: 2026 },
  players: [
    { playerId: playerA, value: 10 },
    { playerId: playerB, value: 8 },
  ],
};
const options = { evaluatedAt: '2026-09-02T12:00:03.000Z' };

describe('evaluateTrade', () => {
  it('calculates complete per-team value and roster effects without recommending an outcome', () => {
    const evaluation = evaluateTrade(snapshot, scenario, valuations, options);

    expect(evaluation).toEqual({
      sourceSnapshotId: snapshot.id,
      leagueId: league,
      evaluatedAt: options.evaluatedAt,
      scenario,
      valuationProvenance: {
        leagueId: league,
        observedAt: valuations.observedAt,
        source: valuations.source,
        version: valuations.version,
        unit: valuations.unit,
        horizon: valuations.horizon,
      },
      playerValues: valuations.players,
      valuationCoverage: 'complete',
      teams: [
        {
          teamId: teamA,
          outgoingPlayerIds: [playerA],
          incomingPlayerIds: [playerB],
          outgoingValue: {
            knownValue: 10,
            coverage: {
              valuedCount: 1,
              totalCount: 1,
              ratio: 1,
              missingPlayerIds: [],
            },
          },
          incomingValue: {
            knownValue: 8,
            coverage: {
              valuedCount: 1,
              totalCount: 1,
              ratio: 1,
              missingPlayerIds: [],
            },
          },
          netValueChange: -2,
          rosterSizeBefore: 2,
          rosterSizeAfter: 2,
          rosterCapacity: 2,
          capacityStatus: 'within-capacity',
        },
        {
          teamId: teamB,
          outgoingPlayerIds: [playerB],
          incomingPlayerIds: [playerA],
          outgoingValue: {
            knownValue: 8,
            coverage: {
              valuedCount: 1,
              totalCount: 1,
              ratio: 1,
              missingPlayerIds: [],
            },
          },
          incomingValue: {
            knownValue: 10,
            coverage: {
              valuedCount: 1,
              totalCount: 1,
              ratio: 1,
              missingPlayerIds: [],
            },
          },
          netValueChange: 2,
          rosterSizeBefore: 2,
          rosterSizeAfter: 2,
          rosterCapacity: 2,
          capacityStatus: 'within-capacity',
        },
      ],
      issues: [],
    });
    expect(evaluation).not.toHaveProperty('recommendation');
    expect(evaluation).not.toHaveProperty('approved');
  });

  it('makes incomplete valuation coverage explicit and omits net values', () => {
    const evaluation = evaluateTrade(
      snapshot,
      scenario,
      { ...valuations, players: [{ playerId: playerA, value: 10 }] },
      options,
    );

    expect(evaluation.valuationCoverage).toBe('partial');
    expect(evaluation.teams[0]).not.toHaveProperty('netValueChange');
    expect(evaluation.teams[1]).not.toHaveProperty('netValueChange');
    expect(evaluation.issues).toEqual([
      {
        code: 'INCOMPLETE_TRADE_VALUATION',
        teamId: teamA,
        direction: 'incoming',
        missingPlayerIds: [playerB],
      },
      {
        code: 'INCOMPLETE_TRADE_VALUATION',
        teamId: teamB,
        direction: 'outgoing',
        missingPlayerIds: [playerB],
      },
    ]);
  });

  it('reports resulting roster-capacity violations as evaluation evidence', () => {
    const oneWay: TradeScenario = {
      leagueId: league,
      transfers: [{ playerId: playerA, fromTeamId: teamA, toTeamId: teamB }],
    };
    const evaluation = evaluateTrade(snapshot, oneWay, valuations, options);

    expect(
      evaluation.teams.find(({ teamId }) => teamId === teamB),
    ).toMatchObject({
      rosterSizeBefore: 2,
      rosterSizeAfter: 3,
      rosterCapacity: 2,
      capacityStatus: 'exceeded',
    });
    expect(evaluation.issues).toContainEqual({
      code: 'ROSTER_CAPACITY_EXCEEDED',
      teamId: teamB,
      rosterSizeAfter: 3,
      rosterCapacity: 2,
    });
  });

  it('rejects unknown ownership instead of evaluating an impossible scenario', () => {
    expectTradeError(
      () =>
        evaluateTrade(
          snapshot,
          {
            leagueId: league,
            transfers: [
              { playerId: playerA, fromTeamId: teamB, toTeamId: teamA },
            ],
          },
          valuations,
          options,
        ),
      'TRADE_PLAYER_OWNERSHIP_MISMATCH',
    );
  });

  it('rejects mismatched league, season, and temporal provenance', () => {
    expectTradeError(
      () =>
        evaluateTrade(
          snapshot,
          scenario,
          { ...valuations, leagueId: leagueId('other') },
          options,
        ),
      'TRADE_VALUATION_LEAGUE_MISMATCH',
    );
    expectTradeError(
      () =>
        evaluateTrade(
          snapshot,
          scenario,
          {
            ...valuations,
            horizon: { kind: 'rest-of-season', season: 2025 },
          },
          options,
        ),
      'TRADE_VALUATION_SEASON_MISMATCH',
    );
    expectTradeError(
      () =>
        evaluateTrade(
          snapshot,
          scenario,
          { ...valuations, observedAt: '2026-09-02T12:00:04.000Z' },
          options,
        ),
      'FUTURE_TRADE_VALUATION',
    );
  });
});

describe('trade input parsers', () => {
  it('rejects duplicate players, same-team transfers, and unknown fields', () => {
    expectTradeError(
      () =>
        parseTradeScenario({
          leagueId: league,
          transfers: [
            { playerId: playerA, fromTeamId: teamA, toTeamId: teamB },
            { playerId: playerA, fromTeamId: teamA, toTeamId: teamB },
          ],
        }),
      'DUPLICATE_TRADED_PLAYER',
    );
    expectTradeError(
      () =>
        parseTradeScenario({
          leagueId: league,
          transfers: [
            { playerId: playerA, fromTeamId: teamA, toTeamId: teamA },
          ],
        }),
      'SAME_TEAM_TRANSFER',
    );
    expect(() =>
      parseTradeScenario({ ...scenario, arbitrary: true }),
    ).toThrowError(TradeValidationError);
  });

  it('rejects duplicate, negative, and non-finite valuations', () => {
    expectTradeError(
      () =>
        parseTradeValuationSet({
          ...valuations,
          players: [
            { playerId: playerA, value: 1 },
            { playerId: playerA, value: 2 },
          ],
        }),
      'DUPLICATE_TRADE_VALUATION',
    );
    for (const value of [-1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() =>
        parseTradeValuationSet({
          ...valuations,
          players: [{ playerId: playerA, value }],
        }),
      ).toThrowError(TradeValidationError);
    }
  });
});

function expectTradeError(run: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(TradeValidationError);
  expect(thrown).toMatchObject({ code });
}

function player(id: ReturnType<typeof playerId>, fullName: string) {
  return { id, fullName, eligiblePositions: ['RB'] as const };
}
