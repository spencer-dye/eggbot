import { describe, expect, it, vi } from 'vitest';

import {
  leagueId,
  playerId,
  rosterSlotId,
  snapshotId,
  teamId,
  transactionId,
  type League,
  type LeagueId,
  type Player,
  type Team,
} from '@eggbot/core';
import type { FantasyPlatformReader, PlayerQuery } from '@eggbot/platform';

import { LeagueSnapshotService } from './index.js';

const testLeagueId = leagueId('league-1');
const firstTeamId = teamId('team-1');
const secondTeamId = teamId('team-2');
const slotId = rosterSlotId('slot-1');
const league: League = {
  id: testLeagueId,
  name: 'Snapshot League',
  season: 2026,
  settings: {
    rosterSlots: [
      { id: slotId, name: 'QB', kind: 'active', eligiblePositions: ['QB'] },
    ],
    scoringRules: [],
  },
};
const teams: readonly Team[] = [
  { id: firstTeamId, leagueId: testLeagueId, name: 'One' },
  { id: secondTeamId, leagueId: testLeagueId, name: 'Two' },
];
const players = new Map([
  [firstTeamId, makePlayer('player-1')],
  [secondTeamId, makePlayer('player-2')],
]);

describe('LeagueSnapshotService', () => {
  it('captures normalized league-wide state with explicit collection bounds', async () => {
    const reader = readerFixture();
    const timestamps = ['2026-09-01T12:00:00.000Z', '2026-09-01T12:00:02.000Z'];
    const service = new LeagueSnapshotService({
      reader,
      now: () => timestamps.shift() ?? 'invalid',
      idFactory: () => snapshotId('snapshot-1'),
    });

    const result = await service.capture(captureOptions());

    expect(result).toMatchObject({
      id: 'snapshot-1',
      captureStartedAt: '2026-09-01T12:00:00.000Z',
      capturedAt: '2026-09-01T12:00:02.000Z',
      consistency: 'best-effort',
      scoringPeriod: '3',
      league,
    });
    expect(result.teams.map(({ team }) => team.id)).toEqual([
      firstTeamId,
      secondTeamId,
    ]);
    expect(result.playerPool.freeAgents.coverage).toEqual({
      kind: 'bounded',
      requestedLimit: 10,
      returnedCount: 1,
    });
    expect(result.playerPool.waivers.coverage).toEqual({
      kind: 'bounded',
      requestedLimit: 8,
      returnedCount: 1,
    });
    expect(result.recentTransactions.coverage).toEqual({
      kind: 'bounded',
      requestedLimit: 5,
      returnedCount: 1,
    });
    expect(reader.getAvailablePlayers).toHaveBeenCalledWith(testLeagueId, {
      availability: 'free-agent',
      limit: 10,
    });
    expect(reader.getAvailablePlayers).toHaveBeenCalledWith(testLeagueId, {
      availability: 'waivers',
      limit: 8,
    });
  });

  it('fails closed when a required platform read fails', async () => {
    const reader = readerFixture();
    reader.getStandings.mockRejectedValue(new Error('provider unavailable'));
    const service = serviceFor(reader);

    await expect(service.capture(captureOptions())).rejects.toMatchObject({
      name: 'LeagueSnapshotCaptureError',
      code: 'STANDINGS_READ_FAILED',
      resource: 'league-1',
    });
  });

  it('rejects cross-resource identity inconsistencies', async () => {
    const reader = readerFixture();
    reader.getRoster.mockImplementation((id) =>
      Promise.resolve({ teamId: teamId(`wrong-${id}`), entries: [] }),
    );
    const service = serviceFor(reader);

    await expect(service.capture(captureOptions())).rejects.toMatchObject({
      code: 'ROSTER_TEAM_MISMATCH',
    });
  });

  it('rejects invalid collection and concurrency limits before reading', async () => {
    const reader = readerFixture();
    const service = serviceFor(reader);

    await expect(
      service.capture({ ...captureOptions(), waiverLimit: 0 }),
    ).rejects.toMatchObject({ code: 'INVALID_CAPTURE_LIMIT' });
    expect(reader.getLeague).not.toHaveBeenCalled();
  });
});

function captureOptions() {
  return {
    leagueId: testLeagueId,
    scoringPeriod: '3',
    freeAgentLimit: 10,
    waiverLimit: 8,
    transactionLimit: 5,
    teamReadConcurrency: 2,
  } as const;
}

function serviceFor(reader: FantasyPlatformReader) {
  const timestamps = ['2026-09-01T12:00:00.000Z', '2026-09-01T12:00:01.000Z'];
  return new LeagueSnapshotService({
    reader,
    now: () => timestamps.shift() ?? 'invalid',
    idFactory: () => snapshotId('snapshot-test'),
  });
}

function readerFixture() {
  return {
    getUserGames: vi.fn(() => Promise.resolve([])),
    getUserLeagues: vi.fn(() => Promise.resolve([])),
    getLeague: vi.fn(() => Promise.resolve(league)),
    getTeams: vi.fn(() => Promise.resolve(teams)),
    getRoster: vi.fn((id: (typeof teams)[number]['id']) => {
      const player = players.get(id);
      return Promise.resolve({
        teamId: id,
        entries: player === undefined ? [] : [{ player }],
      });
    }),
    getLineup: vi.fn((id: (typeof teams)[number]['id'], period: string) => {
      const player = players.get(id);
      return Promise.resolve({
        teamId: id,
        scoringPeriod: period,
        assignments:
          player === undefined ? [] : [{ slotId, playerId: player.id }],
      });
    }),
    getMatchups: vi.fn(() =>
      Promise.resolve([
        {
          scoringPeriod: '3',
          participants: [{ teamId: firstTeamId }, { teamId: secondTeamId }],
        },
      ]),
    ),
    getStandings: vi.fn(() =>
      Promise.resolve([
        { teamId: firstTeamId, rank: 1 },
        { teamId: secondTeamId, rank: 2 },
      ]),
    ),
    getAvailablePlayers: vi.fn((_leagueId: LeagueId, query?: PlayerQuery) =>
      Promise.resolve([
        makePlayer(
          query?.availability === 'waivers' ? 'waiver-player' : 'free-agent',
        ),
      ]),
    ),
    getTransactions: vi.fn(() =>
      Promise.resolve([
        {
          id: transactionId('transaction-1'),
          leagueId: testLeagueId,
          type: 'add' as const,
          status: 'successful',
          moves: [],
        },
      ]),
    ),
  } satisfies FantasyPlatformReader;
}

function makePlayer(value: string): Player {
  return {
    id: playerId(value),
    fullName: value,
    eligiblePositions: ['QB'],
  };
}
