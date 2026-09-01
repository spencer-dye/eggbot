import { describe, expect, it, vi } from 'vitest';

import {
  YahooOAuthClient,
  type YahooTokenSet,
  type YahooTokenStore,
} from './oauth.js';

const config = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.test/callback',
};

describe('YahooOAuthClient', () => {
  it('creates an authorization URL without exposing the client secret', () => {
    const client = new YahooOAuthClient({ config });
    const url = client.createAuthorizationUrl({ state: 'csrf-token' });

    expect(url.origin + url.pathname).toBe(
      'https://api.login.yahoo.com/oauth2/request_auth',
    );
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('csrf-token');
    expect(url.toString()).not.toContain('client-secret');
  });

  it('exchanges an authorization code and saves the token set', async () => {
    const saved: YahooTokenSet[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        token_type: 'bearer',
      }),
    );
    const client = new YahooOAuthClient({
      config,
      fetch: fetchMock,
      now: () => 1_000,
      tokenStore: {
        load: () => Promise.resolve(undefined),
        save: (tokens) => {
          saved.push(tokens);
          return Promise.resolve();
        },
      },
    });

    const tokens = await client.exchangeAuthorizationCode('authorization-code');

    expect(tokens).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      tokenType: 'bearer',
      expiresAt: 3_601_000,
    });
    expect(saved).toEqual([tokens]);
    const request = fetchMock.mock.calls[0];
    expect(requestUrl(request?.[0])).toContain('/oauth2/get_token');
    expect(requestBody(request?.[1]?.body)).toContain(
      'grant_type=authorization_code',
    );
    expect(request?.[1]?.headers).toMatchObject({
      authorization: 'Basic Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=',
    });
  });

  it('refreshes an expired token and persists a rotated refresh token', async () => {
    let stored: YahooTokenSet = {
      accessToken: 'expired',
      refreshToken: 'refresh-old',
      tokenType: 'bearer',
      expiresAt: 500,
    };
    const store: YahooTokenStore = {
      load: () => Promise.resolve(stored),
      save: (tokens) => {
        stored = tokens;
        return Promise.resolve();
      },
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        access_token: 'access-new',
        refresh_token: 'refresh-new',
        expires_in: 3600,
        token_type: 'bearer',
      }),
    );
    const client = new YahooOAuthClient({
      config,
      fetch: fetchMock,
      now: () => 1_000,
      tokenStore: store,
    });

    await expect(client.getAccessToken()).resolves.toBe('access-new');
    expect(stored.refreshToken).toBe('refresh-new');
    expect(requestBody(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
      'refresh_token=refresh-old',
    );
  });

  it('deduplicates simultaneous token refreshes', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        access_token: 'new',
        expires_in: 3600,
        token_type: 'bearer',
      }),
    );
    const client = new YahooOAuthClient({
      config,
      fetch: fetchMock,
      now: () => 1_000,
      tokens: {
        accessToken: 'old',
        refreshToken: 'refresh',
        tokenType: 'bearer',
        expiresAt: 0,
      },
    });

    await expect(
      Promise.all([client.getAccessToken(), client.getAccessToken()]),
    ).resolves.toEqual(['new', 'new']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestUrl(input: string | URL | Request | undefined): string {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.toString();
  return input ?? '';
}

function requestBody(body: BodyInit | null | undefined): string {
  return body instanceof URLSearchParams ? body.toString() : '';
}
