import { describe, expect, it, vi } from 'vitest';

import {
  actionId,
  type AddDropAction,
  type League,
  type Player,
  type Roster,
  type SetLineupAction,
} from '@eggbot/core';
import type { FantasyPlatformReader } from '@eggbot/platform';

import { YahooFantasyExecutor } from './executor.js';
import { YahooHttpClient } from './http.js';
import {
  yahooLeagueId,
  yahooPlayerId,
  yahooRosterSlotId,
  yahooTeamId,
} from './identifiers.js';

const leagueKey = '449.l.123';
const teamKey = '449.l.123.t.4';
const leagueId = yahooLeagueId(leagueKey);
const teamId = yahooTeamId(teamKey);
const rosteredPlayer: Player = {
  id: yahooPlayerId('449.p.20'),
  fullName: 'Rostered Player',
  eligiblePositions: ['RB'],
};
const slotId = yahooRosterSlotId(leagueKey, 'RB', 1);
const roster: Roster = {
  teamId,
  entries: [{ player: rosteredPlayer }],
};
const league: League = {
  id: leagueId,
  name: 'Test League',
  season: 2026,
  settings: {
    rosterSlots: [
      { id: slotId, name: 'RB', kind: 'active', eligiblePositions: ['RB'] },
    ],
    scoringRules: [],
  },
};

describe('YahooFantasyExecutor', () => {
  it('validates and previews without issuing a write', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const executor = createExecutor(fetchMock, false);
    const action = lineupAction();

    const result = await executor.execute([action], { mode: 'dry-run' });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ status: 'dry-run', action });
    expect(result[0]?.status === 'dry-run' && result[0].summary).toContain(
      'week 7',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    const preview = executor.preview(action);
    expect(preview.method).toBe('PUT');
    expect(preview.body).toContain('<position>RB</position>');
  });

  it('requires the runtime write kill switch', async () => {
    const action = addDropAction();
    const result = await createExecutor(vi.fn<typeof fetch>(), false).execute(
      [action],
      { mode: 'execute' },
    );

    expect(result).toMatchObject([
      {
        status: 'failed',
        error: { code: 'WRITES_DISABLED', retryable: false },
      },
    ]);
  });

  it('writes once when the same action id and payload are retried', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(undefined, { status: 201 }));
    const executor = createExecutor(fetchMock, true);
    const action = addDropAction();

    const first = await executor.execute([action], { mode: 'execute' });
    const second = await executor.execute([action], { mode: 'execute' });

    expect(first).toMatchObject([{ status: 'executed' }]);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of an action id for a different payload', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(undefined, { status: 201 }));
    const executor = createExecutor(fetchMock, true);
    const first = addDropAction();
    const changed = {
      ...first,
      addPlayerId: yahooPlayerId('449.p.999'),
    };

    await executor.execute([first], { mode: 'execute' });
    const result = await executor.execute([changed], { mode: 'execute' });

    expect(result).toMatchObject([
      {
        status: 'failed',
        error: { code: 'IDEMPOTENCY_CONFLICT', retryable: false },
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid current roster state before a write', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const action = { ...lineupAction(), assignments: [] };

    const result = await createExecutor(fetchMock, true).execute([action], {
      mode: 'execute',
    });

    expect(result).toMatchObject([
      { status: 'failed', error: { code: 'EMPTY_LINEUP' } },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function createExecutor(
  fetchMock: ReturnType<typeof vi.fn>,
  allowWrites: boolean,
) {
  const httpClient = new YahooHttpClient({
    tokenProvider: { getAccessToken: () => Promise.resolve('token') },
    fetch: fetchMock as typeof fetch,
  });
  return new YahooFantasyExecutor({
    httpClient,
    reader: readerFixture(),
    allowWrites,
  });
}

function readerFixture(): FantasyPlatformReader {
  return {
    getUserGames: () => Promise.resolve([]),
    getUserLeagues: () => Promise.resolve([]),
    getLeague: () => Promise.resolve(league),
    getTeams: () => Promise.resolve([]),
    getRoster: () => Promise.resolve(roster),
    getLineup: () => Promise.reject(new Error('unused')),
    getMatchups: () => Promise.resolve([]),
    getStandings: () => Promise.resolve([]),
    getAvailablePlayers: () => Promise.resolve([]),
    getTransactions: () => Promise.resolve([]),
  };
}

function lineupAction(): SetLineupAction {
  return {
    id: actionId('lineup-1'),
    type: 'set-lineup',
    leagueId,
    teamId,
    scoringPeriod: '7',
    assignments: [{ playerId: rosteredPlayer.id, slotId }],
  };
}

function addDropAction(): AddDropAction {
  return {
    id: actionId('add-drop-1'),
    type: 'add-drop',
    leagueId,
    teamId,
    addPlayerId: yahooPlayerId('449.p.10'),
    dropPlayerId: rosteredPlayer.id,
  };
}
