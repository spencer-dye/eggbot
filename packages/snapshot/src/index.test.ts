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
    teamCount: 2,
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
    expect(result.integrityWarnings).toEqual([]);
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

  it('rejects invalid normalized team acquisition state', async () => {
    const reader = readerFixture();
    reader.getTeams.mockResolvedValue([
      {
        ...teams[0]!,
        acquisitionState: { waiverBudgetRemaining: -1 },
      },
      teams[1]!,
    ]);

    await expect(
      serviceFor(reader).capture(captureOptions()),
    ).rejects.toMatchObject({ code: 'INVALID_TEAM_ACQUISITION_STATE' });
  });

  it('rejects fractional normalized waiver budgets', async () => {
    const reader = readerFixture();
    reader.getLeague.mockResolvedValue({
      ...league,
      settings: {
        ...league.settings,
        acquisitionRules: { waiverSystem: 'budget', waiverBudget: 2.5 },
      },
    });

    await expect(
      serviceFor(reader).capture(captureOptions()),
    ).rejects.toMatchObject({ code: 'INVALID_ACQUISITION_RULE' });
  });

  it('rejects a configured team-count mismatch', async () => {
    const reader = readerFixture();
    reader.getTeams.mockResolvedValue([teams[0] as Team]);

    await expect(
      serviceFor(reader).capture(captureOptions()),
    ).rejects.toMatchObject({ code: 'TEAM_COUNT_MISMATCH' });
  });

  it('rejects incomplete standings coverage', async () => {
    const reader = readerFixture();
    reader.getStandings.mockResolvedValue([{ teamId: firstTeamId, rank: 1 }]);

    await expect(
      serviceFor(reader).capture(captureOptions()),
    ).rejects.toMatchObject({ code: 'STANDINGS_TEAM_COUNT_MISMATCH' });
  });

  it('rejects duplicate player ownership across team rosters', async () => {
    const reader = readerFixture();
    const duplicate = makePlayer('duplicate-player');
    reader.getRoster.mockImplementation((id) =>
      Promise.resolve({ teamId: id, entries: [{ player: duplicate }] }),
    );
    reader.getLineup.mockImplementation((id, period) =>
      Promise.resolve({
        teamId: id,
        scoringPeriod: period,
        assignments: [{ slotId, playerId: duplicate.id }],
      }),
    );

    await expect(
      serviceFor(reader).capture(captureOptions()),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ROSTER_OWNERSHIP' });
  });

  it('warns when best-effort player pools overlap a roster', async () => {
    const reader = readerFixture();
    reader.getAvailablePlayers.mockImplementation((_leagueId, query) =>
      Promise.resolve([
        query?.availability === 'free-agent'
          ? (players.get(firstTeamId) as Player)
          : makePlayer('waiver-player'),
      ]),
    );

    const result = await serviceFor(reader).capture(captureOptions());

    expect(result.integrityWarnings).toEqual([
      {
        code: 'PLAYER_POOL_ROSTER_OVERLAP',
        severity: 'observation-race',
        playerId: playerId('player-1'),
        pool: 'free-agent',
      },
    ]);
  });

  it('starts team reads without waiting for slower collection reads', async () => {
    const reader = readerFixture();
    let resolveFreeAgents: ((players: Player[]) => void) | undefined;
    reader.getAvailablePlayers.mockImplementation((_leagueId, query) =>
      query?.availability === 'free-agent'
        ? new Promise<Player[]>((resolve) => {
            resolveFreeAgents = resolve;
          })
        : Promise.resolve([makePlayer('waiver-player')]),
    );

    const capture = serviceFor(reader).capture(captureOptions());
    await vi.waitFor(() => expect(reader.getRoster).toHaveBeenCalled());
    if (resolveFreeAgents === undefined) throw new Error('missing resolver');
    resolveFreeAgents([makePlayer('free-agent')]);

    await expect(capture).resolves.toMatchObject({ id: 'snapshot-test' });
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
