import { describe, expect, it, vi } from 'vitest';

import { YahooHttpClient } from './http.js';

describe('YahooHttpClient', () => {
  it('uses Bearer auth, requests JSON, and returns validated fantasy content', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ fantasy_content: { ok: true } }));
    const getAccessToken = vi
      .fn<(force?: boolean) => Promise<string>>()
      .mockResolvedValue('token');
    const client = new YahooHttpClient({
      tokenProvider: { getAccessToken },
      fetch: fetchMock,
    });

    await expect(client.get('/league/nfl.l.1')).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(requestUrl(url)).toContain('/fantasy/v2/league/nfl.l.1?format=json');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer token' });
  });

  it('forces one token refresh and retries after a 401', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ fantasy_content: { ok: true } }));
    const getAccessToken = vi
      .fn<(force?: boolean) => Promise<string>>()
      .mockResolvedValueOnce('expired')
      .mockResolvedValueOnce('refreshed');
    const client = new YahooHttpClient({
      tokenProvider: { getAccessToken },
      fetch: fetchMock,
    });

    await expect(client.get('/users;use_login=1/games')).resolves.toEqual({
      ok: true,
    });
    expect(getAccessToken.mock.calls).toEqual([[false], [true]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a successful response without the Yahoo envelope', async () => {
    const client = new YahooHttpClient({
      tokenProvider: { getAccessToken: () => Promise.resolve('token') },
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ unexpected: true })),
    });

    await expect(client.get('/league/nfl.l.1')).rejects.toMatchObject({
      name: 'YahooResponseValidationError',
      resource: 'fantasy_content',
    });
  });

  it('sends XML writes and refreshes once after a 401', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(
        new Response('<ok/>', {
          status: 201,
          headers: { location: '/transaction/1' },
        }),
      );
    const getAccessToken = vi
      .fn<(force?: boolean) => Promise<string>>()
      .mockResolvedValueOnce('expired')
      .mockResolvedValueOnce('refreshed');
    const client = new YahooHttpClient({
      tokenProvider: { getAccessToken },
      fetch: fetchMock,
    });

    await expect(
      client.sendXml('POST', '/league/1/transactions', '<transaction/>'),
    ).resolves.toEqual({
      status: 201,
      location: '/transaction/1',
      body: '<ok/>',
    });
    expect(getAccessToken.mock.calls).toEqual([[false], [true]]);
    const [, init] = fetchMock.mock.calls[1] ?? [];
    expect(init).toMatchObject({ method: 'POST', body: '<transaction/>' });
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer refreshed',
      'content-type': 'application/xml; charset=utf-8',
    });
  });

  it('returns a structured error for a rejected XML write', async () => {
    const client = new YahooHttpClient({
      tokenProvider: { getAccessToken: () => Promise.resolve('token') },
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('<error/>', { status: 403 })),
    });

    await expect(
      client.sendXml('PUT', '/team/1/roster', '<roster/>'),
    ).rejects.toMatchObject({
      name: 'YahooApiError',
      code: 'API_WRITE_FAILED',
      status: 403,
      responseBody: '<error/>',
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function requestUrl(input: string | URL | Request | undefined): string {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.toString();
  return input ?? '';
}
