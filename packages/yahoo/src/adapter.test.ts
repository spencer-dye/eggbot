import { describe, expect, it, vi } from 'vitest';

import { YahooFantasyReader } from './adapter.js';
import { YahooHttpClient } from './http.js';
import { yahooLeagueId } from './identifiers.js';

describe('YahooFantasyReader', () => {
  it('paginates available players and keeps Yahoo filters inside the adapter', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(playerPage(25, 0))
      .mockResolvedValueOnce(playerPage(1, 25));
    const reader = new YahooFantasyReader({
      httpClient: new YahooHttpClient({
        tokenProvider: { getAccessToken: () => Promise.resolve('token') },
        fetch: fetchMock,
      }),
    });

    const players = await reader.getAvailablePlayers(
      yahooLeagueId('449.l.1234'),
      {
        text: 'Smith Jr',
        positions: ['DEF'],
        limit: 26,
      },
    );

    expect(players).toHaveLength(26);
    expect(players[25]?.id).toBe('yahoo:player:449.p.25');
    expect(requestUrl(fetchMock.mock.calls[0]?.[0])).toContain(
      '/league/449.l.1234/players;status=A;start=0;count=25;search=Smith%20Jr;position=DEF',
    );
    expect(requestUrl(fetchMock.mock.calls[1]?.[0])).toContain(
      'start=25;count=1',
    );
  });

  it('queries every requested position, selects waivers, and deduplicates players', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(playerKeys(['449.p.1', '449.p.2']))
      .mockResolvedValueOnce(playerKeys(['449.p.2', '449.p.3']));
    const reader = new YahooFantasyReader({
      httpClient: new YahooHttpClient({
        tokenProvider: { getAccessToken: () => Promise.resolve('token') },
        fetch: fetchMock,
      }),
    });

    const players = await reader.getAvailablePlayers(
      yahooLeagueId('449.l.1234'),
      {
        positions: ['RB', 'WR'],
        availability: 'waivers',
        limit: 3,
      },
    );

    expect(players.map((player) => player.id)).toEqual([
      'yahoo:player:449.p.1',
      'yahoo:player:449.p.2',
      'yahoo:player:449.p.3',
    ]);
    expect(requestUrl(fetchMock.mock.calls[0]?.[0])).toContain(
      'status=W;start=0;count=3;position=RB',
    );
    expect(requestUrl(fetchMock.mock.calls[1]?.[0])).toContain(
      'status=W;start=0;count=3;position=WR',
    );
  });
});

function playerPage(count: number, start: number): Response {
  const players = Object.fromEntries(
    Array.from({ length: count }, (_, offset) => {
      const id = start + offset;
      return [
        String(offset),
        {
          player: [
            { player_key: `449.p.${id}` },
            { name: { full: `Player ${id}` } },
            { eligible_positions: [{ position: 'DEF' }] },
          ],
        },
      ];
    }),
  );
  return new Response(
    JSON.stringify({
      fantasy_content: {
        league: [{ players: { ...players, count } }],
      },
    }),
  );
}

function playerKeys(keys: readonly string[]): Response {
  const players = Object.fromEntries(
    keys.map((key, index) => [
      String(index),
      {
        player: [
          { player_key: key },
          { name: { full: `Player ${key}` } },
          { eligible_positions: [{ position: 'RB' }] },
        ],
      },
    ]),
  );
  return new Response(
    JSON.stringify({
      fantasy_content: {
        league: [{ players: { ...players, count: keys.length } }],
      },
    }),
  );
}

function requestUrl(input: string | URL | Request | undefined): string {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.toString();
  return input ?? '';
}
