import { describe, expect, it } from 'vitest';

import {
  leagueId,
  playerId,
  rosterSlotId,
  snapshotId,
  teamId,
  type LeagueSnapshot,
  type Player,
} from '@eggbot/core';

import { analyzeLeagueSnapshot } from './league-analytics.js';
import {
  AnalyticsValidationError,
  type PlayerProjection,
  type ProjectionSet,
} from './types.js';

const firstTeamId = teamId('team-1');
const secondTeamId = teamId('team-2');
const qbSlot = rosterSlotId('slot-qb');
const rbSlot = rosterSlotId('slot-rb');
const benchSlot = rosterSlotId('slot-bench');
const firstQb = player('first-qb', ['QB']);
const firstRb = player('first-rb', ['RB']);
const secondQb = player('second-qb', ['QB']);
const secondRb = player('second-rb', ['RB']);
const freeQbOne = player('free-qb-1', ['QB']);
const freeQbTwo = player('free-qb-2', ['QB']);
const freeRb = player('free-rb', ['RB']);
const waiverRb = player('waiver-rb', ['RB']);

describe('analyzeLeagueSnapshot', () => {
  it('derives lineup, matchup, available-pool, value, and risk facts', () => {
    const result = analyzeLeagueSnapshot(
      snapshotFixture(),
      projectionSet([
        { playerId: firstQb.id, points: 20, floor: 15, ceiling: 25 },
        { playerId: secondQb.id, points: 17, floor: 14, ceiling: 22 },
        { playerId: secondRb.id, points: 10, floor: 6, ceiling: 15 },
        { playerId: freeQbOne.id, points: 12 },
        { playerId: freeQbTwo.id, points: 8 },
        { playerId: freeRb.id, points: 7 },
        { playerId: waiverRb.id, points: 9 },
      ]),
    );

    expect(result.sourceSnapshotId).toBe('snapshot-1');
    expect(result.projectionProvenance).toEqual({
      scoringPeriod: '3',
      observedAt: '2026-09-01T11:45:00.000Z',
      source: 'test-projections',
      version: 'fixture-1',
    });
    expect(result.playerProjections[0]).toEqual({
      playerId: firstQb.id,
      points: 20,
      floor: 15,
      ceiling: 25,
    });
    expect(result.lineupProjections[0]).toEqual({
      teamId: firstTeamId,
      scoringPeriod: '3',
      projectedPoints: 20,
      projectionCoverage: { projectedCount: 1, totalCount: 2, ratio: 0.5 },
      missingProjectionPlayerIds: [firstRb.id],
      unfilledActiveSlotIds: [],
      projectedFloorPoints: 15,
      floorCoverage: { projectedCount: 1, totalCount: 2, ratio: 0.5 },
      projectedCeilingPoints: 25,
      ceilingCoverage: { projectedCount: 1, totalCount: 2, ratio: 0.5 },
    });
    expect(result.matchupProjections[0]?.participants).toEqual([
      expect.objectContaining({
        teamId: firstTeamId,
        projectedPoints: 20,
        marginCoverage: 'partial',
      }),
      expect.objectContaining({
        teamId: secondTeamId,
        projectedPoints: 27,
        marginCoverage: 'partial',
      }),
    ]);
    expect(
      result.matchupProjections[0]?.participants.every(
        (participant) => participant.marginToBestOpponent === undefined,
      ),
    ).toBe(true);
    expect(result.bestAvailablePlayers).toEqual([
      {
        position: 'QB',
        capturedAvailablePlayerCount: 2,
        projectedAvailablePlayerCount: 2,
        playerId: freeQbOne.id,
        projectedPoints: 12,
      },
      {
        position: 'RB',
        capturedAvailablePlayerCount: 3,
        projectedAvailablePlayerCount: 2,
        playerId: waiverRb.id,
        projectedPoints: 9,
      },
    ]);
    expect(result.playerValuesOverBestAvailable).toContainEqual({
      playerId: firstQb.id,
      teamId: firstTeamId,
      position: 'QB',
      projectedPoints: 20,
      bestAvailableProjectedPoints: 12,
      valueOverBestAvailable: 8,
    });
    expect(result.availablePositionScarcity).toEqual([
      {
        position: 'QB',
        capturedAvailablePlayerCount: 2,
        projectedAvailablePlayerCount: 2,
        topAvailablePoints: 12,
        medianAvailablePoints: 10,
        topToMedianDrop: 2,
      },
      {
        position: 'RB',
        capturedAvailablePlayerCount: 3,
        projectedAvailablePlayerCount: 2,
        topAvailablePoints: 9,
        medianAvailablePoints: 8,
        topToMedianDrop: 1,
      },
    ]);
    expect(result.rosterRisk[0]).toEqual({
      teamId: firstTeamId,
      unfilledActiveSlotCount: 0,
      missingStarterProjectionCount: 1,
      starterProjectionCoverage: {
        projectedCount: 1,
        totalCount: 2,
        ratio: 0.5,
      },
      topStarterPointShare: 1,
      projectedDownsidePoints: 5,
      floorProjectionCoverage: {
        projectedCount: 1,
        totalCount: 2,
        ratio: 0.5,
      },
      sourceIntegrityWarningCount: 1,
    });
    expect(result.warnings).toContainEqual({
      code: 'SOURCE_SNAPSHOT_INTEGRITY_WARNING',
      playerId: firstRb.id,
      sourceCode: 'PLAYER_POOL_ROSTER_OVERLAP',
    });
    expect(
      result.warnings.filter(({ code }) => code === 'BOUNDED_PLAYER_POOL'),
    ).toHaveLength(2);
  });

  it('reports unfilled slots independently from missing projections', () => {
    const snapshot = snapshotFixture();
    const first = snapshot.teams[0];
    if (first === undefined) throw new Error('missing fixture team');
    const result = analyzeLeagueSnapshot(
      {
        ...snapshot,
        teams: [
          {
            ...first,
            lineup: {
              ...first.lineup,
              assignments: [{ slotId: qbSlot, playerId: firstQb.id }],
            },
          },
          ...snapshot.teams.slice(1),
        ],
      },
      projectionSet([{ playerId: firstQb.id, points: 20 }]),
    );

    expect(result.lineupProjections[0]).toMatchObject({
      unfilledActiveSlotIds: [rbSlot],
      missingProjectionPlayerIds: [],
    });
    expect(result.matchupProjections[0]?.participants).toMatchObject([
      { teamId: firstTeamId, marginCoverage: 'partial' },
      { teamId: secondTeamId, marginCoverage: 'partial' },
    ]);
  });

  it('reports matchup margins only when every participant is complete', () => {
    const result = analyzeLeagueSnapshot(
      snapshotFixture(),
      projectionSet([
        { playerId: firstQb.id, points: 20 },
        { playerId: firstRb.id, points: 11 },
        { playerId: secondQb.id, points: 17 },
        { playerId: secondRb.id, points: 10 },
      ]),
    );

    expect(result.matchupProjections[0]?.participants).toMatchObject([
      {
        teamId: firstTeamId,
        marginCoverage: 'complete',
        marginToBestOpponent: 4,
      },
      {
        teamId: secondTeamId,
        marginCoverage: 'complete',
        marginToBestOpponent: -4,
      },
    ]);
  });

  it('rejects a projection set for another scoring period', () => {
    expectAnalyticsError(
      () =>
        analyzeLeagueSnapshot(snapshotFixture(), {
          ...projectionSet([]),
          scoringPeriod: '4',
        }),
      'PROJECTION_PERIOD_MISMATCH',
    );
  });

  it.each([
    {
      projectionSet: { ...projectionSet([]), source: ' ' },
      code: 'INVALID_PROJECTION_SOURCE',
    },
    {
      projectionSet: { ...projectionSet([]), observedAt: 'not-a-timestamp' },
      code: 'INVALID_PROJECTION_TIMESTAMP',
    },
    {
      projectionSet: { ...projectionSet([]), version: '' },
      code: 'INVALID_PROJECTION_VERSION',
    },
  ])(
    'rejects invalid projection provenance with $code',
    ({ projectionSet: invalidSet, code }) => {
      expectAnalyticsError(
        () => analyzeLeagueSnapshot(snapshotFixture(), invalidSet),
        code,
      );
    },
  );

  it.each([
    {
      projections: [
        { playerId: firstQb.id, points: 10 },
        { playerId: firstQb.id, points: 11 },
      ],
      code: 'DUPLICATE_PLAYER_PROJECTION',
    },
    {
      projections: [{ playerId: firstQb.id, points: Number.NaN }],
      code: 'NON_FINITE_PROJECTION',
    },
    {
      projections: [{ playerId: firstQb.id, points: 10, floor: 11 }],
      code: 'INVALID_PROJECTION_RANGE',
    },
  ])('rejects invalid projection input with $code', ({ projections, code }) => {
    expectAnalyticsError(
      () =>
        analyzeLeagueSnapshot(snapshotFixture(), projectionSet(projections)),
      code,
    );
  });
});

function projectionSet(players: readonly PlayerProjection[]): ProjectionSet {
  return {
    scoringPeriod: '3',
    observedAt: '2026-09-01T11:45:00.000Z',
    source: 'test-projections',
    version: 'fixture-1',
    players,
  };
}

function expectAnalyticsError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error('Expected analytics validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(AnalyticsValidationError);
    if (!(error instanceof AnalyticsValidationError)) return;
    expect(error.code).toBe(code);
  }
}

function snapshotFixture(): LeagueSnapshot {
  return {
    id: snapshotId('snapshot-1'),
    captureStartedAt: '2026-09-01T12:00:00.000Z',
    capturedAt: '2026-09-01T12:00:01.000Z',
    consistency: 'best-effort',
    scoringPeriod: '3',
    league: {
      id: leagueId('league-1'),
      name: 'League',
      season: 2026,
      settings: {
        teamCount: 2,
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
            eligiblePositions: ['QB', 'RB'],
          },
        ],
        scoringRules: [],
      },
    },
    teams: [
      teamSnapshot(firstTeamId, 'First', [firstQb, firstRb]),
      teamSnapshot(secondTeamId, 'Second', [secondQb, secondRb]),
    ],
    standings: [
      { teamId: firstTeamId, rank: 1 },
      { teamId: secondTeamId, rank: 2 },
    ],
    matchups: [
      {
        scoringPeriod: '3',
        participants: [{ teamId: firstTeamId }, { teamId: secondTeamId }],
      },
    ],
    playerPool: {
      freeAgents: {
        items: [freeQbOne, freeQbTwo, freeRb, firstRb],
        coverage: { kind: 'bounded', requestedLimit: 10, returnedCount: 4 },
      },
      waivers: {
        items: [waiverRb],
        coverage: { kind: 'bounded', requestedLimit: 10, returnedCount: 1 },
      },
    },
    recentTransactions: {
      items: [],
      coverage: { kind: 'bounded', requestedLimit: 5, returnedCount: 0 },
    },
    integrityWarnings: [
      {
        code: 'PLAYER_POOL_ROSTER_OVERLAP',
        severity: 'observation-race',
        playerId: firstRb.id,
        pool: 'free-agent',
      },
    ],
  };
}

function teamSnapshot(
  id: typeof firstTeamId,
  name: string,
  roster: readonly Player[],
) {
  return {
    team: { id, leagueId: leagueId('league-1'), name },
    roster: { teamId: id, entries: roster.map((player) => ({ player })) },
    lineup: {
      teamId: id,
      scoringPeriod: '3',
      assignments: [
        { slotId: qbSlot, playerId: roster[0]?.id as Player['id'] },
        { slotId: rbSlot, playerId: roster[1]?.id as Player['id'] },
      ],
    },
  };
}

function player(
  id: string,
  eligiblePositions: Player['eligiblePositions'],
): Player {
  return { id: playerId(id), fullName: id, eligiblePositions };
}
