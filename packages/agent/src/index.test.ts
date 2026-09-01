import { describe, expect, it } from 'vitest';

import {
  leagueId,
  snapshotId,
  teamId,
  type LeagueSnapshot,
} from '@eggbot/core';

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

describe('createDecisionContext', () => {
  it('accepts an explicitly managed team in the snapshot', () => {
    expect(
      createDecisionContext({ snapshot, managedTeamId, analytics: {} }),
    ).toMatchObject({ managedTeamId });
  });

  it('rejects a managed team outside the snapshot', () => {
    expect(() =>
      createDecisionContext({
        snapshot,
        managedTeamId: teamId('unknown-team'),
        analytics: {},
      }),
    ).toThrowError('Managed team is not present in the league snapshot');
  });
});
