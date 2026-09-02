import { describe, expect, it } from 'vitest';

import type { DecisionContext } from '@eggbot/agent';
import {
  leagueId,
  playerId,
  rosterSlotId,
  snapshotId,
  teamId,
  type LeagueSnapshot,
} from '@eggbot/core';

import { createProjectedWaiverDecisionEngine } from './projected-waivers.js';

const league = leagueId('league');
const team = teamId('team');
const starterSlot = rosterSlotId('starter');
const benchSlot = rosterSlotId('bench');
const starter = player('starter');
const bench = player('bench');
const freeAgent = player('free-agent');
const waiver = player('waiver');

describe('createProjectedWaiverDecisionEngine', () => {
  it('ranks upgrades, preserves claim ordering, and budgets the worst case', async () => {
    const context = makeContext('budget');
    const proposal = await createProjectedWaiverDecisionEngine({
      maximumActions: 2,
      minimumProjectedPointGain: 1,
      bidStrategy: { kind: 'fixed', amount: 4 },
    }).decide(context);

    expect(proposal.proposedActions).toEqual([
      {
        type: 'waiver-claim',
        leagueId: league,
        teamId: team,
        addPlayerId: waiver.id,
        dropPlayerId: bench.id,
        bid: 4,
      },
    ]);
    expect(proposal.rationale).toContain('10 points');
  });

  it('uses immediate add/drop for free agents', async () => {
    const context = makeContext('priority', [freeAgent], []);
    const proposal =
      await createProjectedWaiverDecisionEngine().decide(context);

    expect(proposal.proposedActions).toEqual([
      {
        type: 'add-drop',
        leagueId: league,
        teamId: team,
        addPlayerId: freeAgent.id,
        dropPlayerId: bench.id,
      },
    ]);
  });

  it('omits bids for priority waivers', async () => {
    const proposal = await createProjectedWaiverDecisionEngine().decide(
      makeContext('priority', [], [waiver]),
    );

    expect(proposal.proposedActions[0]).toEqual({
      type: 'waiver-claim',
      leagueId: league,
      teamId: team,
      addPlayerId: waiver.id,
      dropPlayerId: bench.id,
    });
  });

  it('preserves a low waiver priority when configured', async () => {
    const proposal = await createProjectedWaiverDecisionEngine({
      includeFreeAgents: false,
      maximumWaiverPriorityRank: 1,
    }).decide(makeContext('priority', [], [waiver]));

    expect(proposal.proposedActions).toEqual([]);
  });

  it('abstains from budget waivers without balance or a bid strategy', async () => {
    const source = makeContext('budget', [], [waiver]);
    const context: DecisionContext = {
      ...source,
      snapshot: {
        ...source.snapshot,
        teams: [
          {
            ...source.snapshot.teams[0]!,
            team: {
              id: team,
              leagueId: league,
              name: 'Managed',
            },
          },
        ],
      },
    };

    const proposal =
      await createProjectedWaiverDecisionEngine().decide(context);

    expect(proposal.proposedActions).toEqual([]);
    expect(proposal.rationale).toContain('No safe claim');
  });

  it('abstains when projection coverage or acquisition-limit state is incomplete', async () => {
    const source = makeContext('priority');
    const missingProjection: DecisionContext = {
      ...source,
      analytics: {
        ...source.analytics,
        playerProjections: source.analytics.playerProjections.filter(
          ({ playerId }) => playerId !== waiver.id,
        ),
      },
    };
    const missingUsage: DecisionContext = {
      ...source,
      snapshot: {
        ...source.snapshot,
        league: {
          ...source.snapshot.league,
          settings: {
            ...source.snapshot.league.settings,
            acquisitionRules: {
              waiverSystem: 'priority',
              maxWeeklyAcquisitions: 3,
            },
          },
        },
      },
    };

    expect(
      (await createProjectedWaiverDecisionEngine().decide(missingProjection))
        .proposedActions,
    ).toEqual([]);
    expect(
      (await createProjectedWaiverDecisionEngine().decide(missingUsage))
        .rationale,
    ).toContain('weekly-limit usage');
  });
});

function player(id: string) {
  return {
    id: playerId(id),
    fullName: id,
    eligiblePositions: ['RB'] as const,
  };
}

function makeContext(
  waiverSystem: 'budget' | 'priority',
  freeAgents = [freeAgent],
  waivers = [waiver],
): DecisionContext {
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
        acquisitionRules: { waiverSystem, waiverBudget: 100 },
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
            waiverBudgetRemaining: 10,
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
        items: freeAgents,
        coverage: {
          kind: 'bounded',
          requestedLimit: 10,
          returnedCount: freeAgents.length,
        },
      },
      waivers: {
        items: waivers,
        coverage: {
          kind: 'bounded',
          requestedLimit: 10,
          returnedCount: waivers.length,
        },
      },
    },
    recentTransactions: {
      items: [],
      coverage: { kind: 'bounded', requestedLimit: 10, returnedCount: 0 },
    },
    integrityWarnings: [],
  };
  return {
    snapshot,
    managedTeamId: team,
    analytics: {
      sourceSnapshotId: snapshot.id,
      scoringPeriod: '3',
      projectionProvenance: {
        scoringPeriod: '3',
        observedAt: '2026-09-01T11:59:00.000Z',
        source: 'test',
      },
      playerProjections: [starter, bench, freeAgent, waiver].map((value) => ({
        playerId: value.id,
        points:
          value === starter
            ? 20
            : value === bench
              ? 5
              : value === waiver
                ? 15
                : 12,
      })),
      lineupProjections: [],
      matchupProjections: [],
      bestAvailablePlayers: [],
      playerValuesOverBestAvailable: [],
      availablePositionScarcity: [],
      rosterRisk: [],
      warnings: [],
    },
  };
}
