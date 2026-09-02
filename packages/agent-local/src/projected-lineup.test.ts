import { describe, expect, it } from 'vitest';

import type { DecisionContext } from '@eggbot/agent';
import {
  leagueId,
  playerId,
  rosterSlotId,
  snapshotId,
  teamId,
  type LeagueSnapshot,
  type Player,
} from '@eggbot/core';

import { createProjectedLineupDecisionEngine } from './projected-lineup.js';

const league = leagueId('league');
const managedTeam = teamId('team');
const qb = rosterSlotId('qb');
const flex = rosterSlotId('flex');
const benchOne = rosterSlotId('bench-1');
const benchTwo = rosterSlotId('bench-2');
const reserve = rosterSlotId('reserve');
const lowQb = player('low-qb', ['QB']);
const highQb = player('high-qb', ['QB']);
const runningBack = player('running-back', ['RB']);
const receiver = player('receiver', ['WR']);
const reservedQb = player('reserved-qb', ['QB']);

describe('createProjectedLineupDecisionEngine', () => {
  it('proposes the maximum projected legal lineup and preserves reserve players', async () => {
    const engine = createProjectedLineupDecisionEngine();

    const proposal = await engine.decide(context());

    expect(proposal.proposedActions).toHaveLength(1);
    expect(proposal.proposedActions[0]).toMatchObject({
      type: 'set-lineup',
      leagueId: league,
      teamId: managedTeam,
      scoringPeriod: '3',
    });
    if (proposal.proposedActions[0]?.type !== 'set-lineup') {
      throw new Error('expected lineup action');
    }
    expect(proposal.proposedActions[0].assignments).toEqual(
      expect.arrayContaining([
        { slotId: qb, playerId: highQb.id },
        { slotId: flex, playerId: runningBack.id },
        { slotId: benchOne, playerId: lowQb.id },
        { slotId: benchTwo, playerId: receiver.id },
      ]),
    );
    expect(
      proposal.proposedActions[0].assignments.some(
        ({ playerId }) => playerId === reservedQb.id,
      ),
    ).toBe(false);
    expect(proposal.rationale).toContain('10.00 point gain');
  });

  it('fails closed when a movable roster projection is missing', async () => {
    const base = context();
    const incomplete: DecisionContext = {
      ...base,
      analytics: {
        ...base.analytics,
        playerProjections: base.analytics.playerProjections.filter(
          ({ playerId }) => playerId !== highQb.id,
        ),
      },
    };

    const proposal =
      await createProjectedLineupDecisionEngine().decide(incomplete);

    expect(proposal.proposedActions).toEqual([]);
    expect(proposal.rationale).toContain('coverage is incomplete');
  });

  it('does not churn a lineup below the configured gain threshold', async () => {
    const proposal = await createProjectedLineupDecisionEngine({
      minimumProjectedPointGain: 11,
    }).decide(context());

    expect(proposal.proposedActions).toEqual([]);
    expect(proposal.rationale).toContain('below 11.00');
  });

  it('abstains when the managed roster has source-integrity warnings', async () => {
    const base = context();
    const warned: DecisionContext = {
      ...base,
      analytics: {
        ...base.analytics,
        rosterRisk: base.analytics.rosterRisk.map((risk) => ({
          ...risk,
          sourceIntegrityWarningCount: 1,
        })),
      },
    };

    const proposal = await createProjectedLineupDecisionEngine().decide(warned);

    expect(proposal.proposedActions).toEqual([]);
    expect(proposal.rationale).toContain('source-integrity warnings');
  });

  it('rejects invalid gain configuration', () => {
    expect(() =>
      createProjectedLineupDecisionEngine({
        minimumProjectedPointGain: Number.NaN,
      }),
    ).toThrow(RangeError);
  });
});

function context(): DecisionContext {
  const snapshot = snapshotFixture();
  const playerProjections = [
    { playerId: lowQb.id, points: 10 },
    { playerId: highQb.id, points: 20 },
    { playerId: runningBack.id, points: 15 },
    { playerId: receiver.id, points: 12 },
  ];
  return {
    snapshot,
    managedTeamId: managedTeam,
    analytics: {
      sourceSnapshotId: snapshot.id,
      scoringPeriod: '3',
      projectionProvenance: {
        scoringPeriod: '3',
        observedAt: '2026-09-01T11:59:00.000Z',
        source: 'test',
      },
      playerProjections,
      lineupProjections: [
        {
          teamId: managedTeam,
          scoringPeriod: '3',
          projectedPoints: 25,
          projectionCoverage: { projectedCount: 2, totalCount: 2, ratio: 1 },
          missingProjectionPlayerIds: [],
          unfilledActiveSlotIds: [],
          floorCoverage: { projectedCount: 0, totalCount: 2, ratio: 0 },
          ceilingCoverage: { projectedCount: 0, totalCount: 2, ratio: 0 },
        },
      ],
      matchupProjections: [],
      bestAvailablePlayers: [],
      playerValuesOverBestAvailable: [],
      availablePositionScarcity: [],
      rosterRisk: [
        {
          teamId: managedTeam,
          unfilledActiveSlotCount: 0,
          missingStarterProjectionCount: 0,
          starterProjectionCoverage: {
            projectedCount: 2,
            totalCount: 2,
            ratio: 1,
          },
          floorProjectionCoverage: {
            projectedCount: 0,
            totalCount: 2,
            ratio: 0,
          },
          sourceIntegrityWarningCount: 0,
        },
      ],
      warnings: [],
    },
  };
}

function snapshotFixture(): LeagueSnapshot {
  return {
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
          { id: qb, name: 'QB', kind: 'active', eligiblePositions: ['QB'] },
          {
            id: flex,
            name: 'FLEX',
            kind: 'active',
            eligiblePositions: ['RB', 'WR'],
          },
          {
            id: benchOne,
            name: 'BN',
            kind: 'bench',
            eligiblePositions: ['QB', 'RB', 'WR'],
          },
          {
            id: benchTwo,
            name: 'BN',
            kind: 'bench',
            eligiblePositions: ['QB', 'RB', 'WR'],
          },
          {
            id: reserve,
            name: 'IR',
            kind: 'reserve',
            eligiblePositions: ['QB', 'RB', 'WR'],
          },
        ],
        scoringRules: [],
      },
    },
    teams: [
      {
        team: { id: managedTeam, leagueId: league, name: 'Managed' },
        roster: {
          teamId: managedTeam,
          entries: [lowQb, highQb, runningBack, receiver, reservedQb].map(
            (player) => ({ player }),
          ),
        },
        lineup: {
          teamId: managedTeam,
          scoringPeriod: '3',
          assignments: [
            { slotId: qb, playerId: lowQb.id },
            { slotId: flex, playerId: runningBack.id },
            { slotId: benchOne, playerId: highQb.id },
            { slotId: benchTwo, playerId: receiver.id },
            { slotId: reserve, playerId: reservedQb.id },
          ],
        },
      },
    ],
    standings: [{ teamId: managedTeam, rank: 1 }],
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
}

function player(
  id: string,
  eligiblePositions: Player['eligiblePositions'],
): Player {
  return { id: playerId(id), fullName: id, eligiblePositions };
}
