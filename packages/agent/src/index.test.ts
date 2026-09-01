import { describe, expect, it } from 'vitest';

import {
  leagueId,
  snapshotId,
  teamId,
  type LeagueSnapshot,
} from '@eggbot/core';
import type { LeagueAnalytics } from '@eggbot/analytics';

import { createDecisionContext } from './index.js';

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

describe('createDecisionContext', () => {
  it('accepts an explicitly managed team in the snapshot', () => {
    expect(
      createDecisionContext({ snapshot, managedTeamId, analytics }),
    ).toMatchObject({ managedTeamId });
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
