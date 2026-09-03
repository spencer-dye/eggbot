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
import { InMemoryStorageAdapter } from '@eggbot/storage';

import type { YahooPlayerAvailability } from './availability.js';
import {
  YahooFantasyExecutor,
  StorageYahooExecutionJournal,
  type YahooExecutionJournal,
} from './executor.js';
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
    expect(result[0]).toMatchObject({ validation: 'local' });
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
      .mockResolvedValue(
        new Response(
          '<fantasy_content><transaction><transaction_key>449.l.123.tr.9</transaction_key></transaction></fantasy_content>',
          { status: 201 },
        ),
      );
    const executor = createExecutor(fetchMock, true);
    const action = addDropAction();

    const first = await executor.execute([action], { mode: 'execute' });
    const second = await executor.execute([action], { mode: 'execute' });

    expect(first).toMatchObject([
      {
        status: 'executed',
        externalReference: 'yahoo:transaction:449.l.123.tr.9',
      },
    ]);
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

  it('poisons a transaction when Yahoo succeeds but journal commit fails', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          '<transaction><transaction_key>449.l.123.w.c.2_10</transaction_key></transaction>',
          { status: 201 },
        ),
      );
    let saves = 0;
    const journal: YahooExecutionJournal = {
      load: () => Promise.resolve(undefined),
      save: () => {
        saves += 1;
        return saves === 1
          ? Promise.resolve()
          : Promise.reject(new Error('disk unavailable'));
      },
    };
    const executor = createExecutor(fetchMock, true, 'free-agent', journal);
    const action = addDropAction();

    const first = await executor.execute([action], { mode: 'execute' });
    const retry = await executor.execute([action], { mode: 'execute' });

    expect(first).toMatchObject([
      {
        status: 'execution-uncertain',
        externalReference: 'yahoo:transaction:449.l.123.w.c.2_10',
        error: { code: 'JOURNAL_COMMIT_FAILED', retryable: false },
      },
    ]);
    expect(retry).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a durable pending outcome', async () => {
    const action = addDropAction();
    let record: Awaited<ReturnType<YahooExecutionJournal['load']>>;
    const journal: YahooExecutionJournal = {
      load: () => Promise.resolve(record),
      save: (next) => {
        record = next;
        return Promise.resolve();
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('connection reset'));
    const firstExecutor = createExecutor(
      fetchMock,
      true,
      'free-agent',
      journal,
    );
    await firstExecutor.execute([action], { mode: 'execute' });
    const restartedExecutor = createExecutor(
      fetchMock,
      true,
      'free-agent',
      journal,
    );

    const result = await restartedExecutor.execute([action], {
      mode: 'execute',
    });

    expect(result).toMatchObject([
      {
        status: 'execution-uncertain',
        error: { code: 'JOURNAL_OUTCOME_PENDING', retryable: false },
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('persists execution outcomes across executor instances', async () => {
    const journal = new StorageYahooExecutionJournal({
      storage: new InMemoryStorageAdapter(),
      clock: () => new Date('2026-09-02T12:00:00.000Z'),
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(undefined, { status: 201 }));
    const action = addDropAction();
    const first = createExecutor(fetchMock, true, 'free-agent', journal);
    const restarted = createExecutor(fetchMock, true, 'free-agent', journal);

    const original = await first.execute([action], { mode: 'execute' });
    const replay = await restarted.execute([action], { mode: 'execute' });

    expect(replay).toEqual(original);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires explicit evidence to reconcile an uncertain pending write', async () => {
    const journal = new StorageYahooExecutionJournal({
      storage: new InMemoryStorageAdapter(),
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('connection reset'));
    const executor = createExecutor(fetchMock, true, 'free-agent', journal);
    const action = addDropAction();
    const uncertain = await executor.execute([action], { mode: 'execute' });
    expect(uncertain[0]?.status).toBe('execution-uncertain');

    await expect(
      executor.reconcile(action, { outcome: 'executed', evidence: '' }),
    ).rejects.toMatchObject({ code: 'RECONCILIATION_EVIDENCE_REQUIRED' });

    const reconciled = await executor.reconcile(action, {
      outcome: 'executed',
      evidence: 'Yahoo transaction history entry 449.l.123.tr.10',
      externalReference: 'yahoo:transaction:449.l.123.tr.10',
    });
    expect(reconciled).toMatchObject({
      status: 'executed',
      externalReference: 'yahoo:transaction:449.l.123.tr.10',
    });
    expect(await executor.execute([action], { mode: 'execute' })).toEqual([
      reconciled,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects free-agent actions for players currently on waivers', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const result = await createExecutor(fetchMock, true, 'waivers').execute(
      [addDropAction()],
      { mode: 'execute' },
    );

    expect(result).toMatchObject([
      {
        status: 'failed',
        error: { code: 'PLAYER_AVAILABILITY_MISMATCH' },
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function createExecutor(
  fetchMock: ReturnType<typeof vi.fn>,
  allowWrites: boolean,
  availability: YahooPlayerAvailability = 'free-agent',
  journal?: YahooExecutionJournal,
) {
  const httpClient = new YahooHttpClient({
    tokenProvider: { getAccessToken: () => Promise.resolve('token') },
    fetch: fetchMock as typeof fetch,
  });
  return new YahooFantasyExecutor({
    httpClient,
    reader: readerFixture(),
    allowWrites,
    availabilityReader: {
      getPlayerAvailability: () => Promise.resolve(availability),
    },
    ...(journal === undefined ? {} : { journal }),
  });
}

function readerFixture(): FantasyPlatformReader {
  return {
    getUserGames: () => Promise.resolve([]),
    getUserLeagues: () => Promise.resolve([]),
    getLeague: () => Promise.resolve(league),
    getTeams: () => Promise.resolve([]),
    getRoster: () => Promise.resolve(roster),
    getLineup: () =>
      Promise.resolve({
        teamId,
        scoringPeriod: '7',
        assignments: [{ playerId: rosteredPlayer.id, slotId }],
      }),
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
