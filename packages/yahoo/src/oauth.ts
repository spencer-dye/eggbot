import { Buffer } from 'node:buffer';

import { z } from 'zod';

import { YahooAuthenticationError } from './errors.js';

const DEFAULT_AUTHORIZATION_URL =
  'https://api.login.yahoo.com/oauth2/request_auth';
const DEFAULT_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const DEFAULT_REFRESH_LEEWAY_MS = 60_000;

const oauthConfigSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  redirectUri: z.string().trim().min(1),
});

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().finite().positive(),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string().min(1),
});

const tokenSetSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  tokenType: z.string().min(1),
  expiresAt: z.number().finite(),
});

export interface YahooOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface YahooTokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenType: string;
  readonly expiresAt: number;
}

export interface YahooTokenStore {
  load(): Promise<YahooTokenSet | undefined>;
  save(tokens: YahooTokenSet): Promise<void>;
}

export interface YahooOAuthClientOptions {
  readonly config: YahooOAuthConfig;
  readonly tokens?: YahooTokenSet;
  readonly tokenStore?: YahooTokenStore;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly refreshLeewayMs?: number;
  readonly authorizationUrl?: string;
  readonly tokenUrl?: string;
}

export class YahooOAuthClient {
  readonly #config: YahooOAuthConfig;
  readonly #tokenStore: YahooTokenStore | undefined;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #refreshLeewayMs: number;
  readonly #authorizationUrl: string;
  readonly #tokenUrl: string;
  #tokens: YahooTokenSet | undefined;
  #didLoadStore: boolean;
  #refreshPromise: Promise<YahooTokenSet> | undefined;

  constructor(options: YahooOAuthClientOptions) {
    const config = oauthConfigSchema.safeParse(options.config);
    if (!config.success) {
      throw new YahooAuthenticationError(
        'Yahoo OAuth configuration is invalid',
        {
          code: 'INVALID_OAUTH_CONFIGURATION',
          cause: config.error,
        },
      );
    }
    this.#config = config.data;
    this.#tokens =
      options.tokens === undefined
        ? undefined
        : validateTokenSet(options.tokens);
    this.#tokenStore = options.tokenStore;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#refreshLeewayMs =
      options.refreshLeewayMs ?? DEFAULT_REFRESH_LEEWAY_MS;
    if (!Number.isFinite(this.#refreshLeewayMs) || this.#refreshLeewayMs < 0) {
      throw new YahooAuthenticationError(
        'Yahoo OAuth refresh leeway must be a finite non-negative number',
        { code: 'INVALID_REFRESH_LEEWAY' },
      );
    }
    this.#authorizationUrl = validateEndpoint(
      options.authorizationUrl ?? DEFAULT_AUTHORIZATION_URL,
      'authorization',
    );
    this.#tokenUrl = validateEndpoint(
      options.tokenUrl ?? DEFAULT_TOKEN_URL,
      'token',
    );
    this.#didLoadStore = options.tokens !== undefined;
  }

  createAuthorizationUrl(options: { readonly state?: string } = {}): URL {
    const url = new URL(this.#authorizationUrl);
    url.searchParams.set('client_id', this.#config.clientId);
    url.searchParams.set('redirect_uri', this.#config.redirectUri);
    url.searchParams.set('response_type', 'code');
    if (options.state !== undefined) {
      url.searchParams.set('state', options.state);
    }
    return url;
  }

  async exchangeAuthorizationCode(code: string): Promise<YahooTokenSet> {
    if (code.trim().length === 0) {
      throw new YahooAuthenticationError('Authorization code cannot be empty', {
        code: 'INVALID_AUTHORIZATION_CODE',
      });
    }

    const tokens = await this.#requestTokens({
      grant_type: 'authorization_code',
      redirect_uri: this.#config.redirectUri,
      code,
    });
    if (tokens.refreshToken === undefined) {
      throw new YahooAuthenticationError(
        'Yahoo did not return a refresh token',
        {
          code: 'MISSING_REFRESH_TOKEN',
        },
      );
    }
    return this.#setTokens(tokens);
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    const tokens = await this.#loadTokens();
    if (
      !forceRefresh &&
      tokens !== undefined &&
      tokens.expiresAt > this.#timestamp() + this.#refreshLeewayMs
    ) {
      return tokens.accessToken;
    }

    return (await this.refreshAccessToken()).accessToken;
  }

  async refreshAccessToken(): Promise<YahooTokenSet> {
    if (this.#refreshPromise !== undefined) {
      return this.#refreshPromise;
    }

    this.#refreshPromise = this.#performRefresh();
    try {
      return await this.#refreshPromise;
    } finally {
      this.#refreshPromise = undefined;
    }
  }

  async #performRefresh(): Promise<YahooTokenSet> {
    const current = await this.#loadTokens();
    if (current?.refreshToken === undefined) {
      throw new YahooAuthenticationError(
        'No Yahoo refresh token is available',
        {
          code: 'MISSING_REFRESH_TOKEN',
        },
      );
    }

    const refreshed = await this.#requestTokens({
      grant_type: 'refresh_token',
      redirect_uri: this.#config.redirectUri,
      refresh_token: current.refreshToken,
    });
    return this.#setTokens({
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? current.refreshToken,
    });
  }

  async #loadTokens(): Promise<YahooTokenSet | undefined> {
    if (!this.#didLoadStore) {
      const stored = await this.#tokenStore?.load();
      this.#tokens =
        stored === undefined ? undefined : validateTokenSet(stored);
      this.#didLoadStore = true;
    }
    return this.#tokens;
  }

  async #setTokens(tokens: YahooTokenSet): Promise<YahooTokenSet> {
    this.#tokens = tokens;
    this.#didLoadStore = true;
    await this.#tokenStore?.save(tokens);
    return tokens;
  }

  async #requestTokens(
    parameters: Readonly<Record<string, string>>,
  ): Promise<YahooTokenSet> {
    let response: Response;
    try {
      response = await this.#fetch(this.#tokenUrl, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(
            `${this.#config.clientId}:${this.#config.clientSecret}`,
          ).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(parameters),
      });
    } catch (error) {
      throw new YahooAuthenticationError('Yahoo token request failed', {
        code: 'TOKEN_TRANSPORT_ERROR',
        cause: error,
      });
    }

    const body = await readJson(response);
    if (!response.ok) {
      const errorRecord = isRecord(body) ? body : {};
      throw new YahooAuthenticationError(
        typeof errorRecord.error_description === 'string'
          ? errorRecord.error_description
          : 'Yahoo rejected the token request',
        {
          code:
            typeof errorRecord.error === 'string'
              ? errorRecord.error
              : 'TOKEN_REQUEST_FAILED',
          status: response.status,
        },
      );
    }

    const parsed = tokenResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new YahooAuthenticationError(
        'Yahoo returned an invalid token response',
        {
          code: 'INVALID_TOKEN_RESPONSE',
          status: response.status,
          cause: parsed.error,
        },
      );
    }

    const expiresAt = this.#timestamp() + parsed.data.expires_in * 1_000;
    if (!Number.isFinite(expiresAt)) {
      throw new YahooAuthenticationError(
        'Yahoo returned an invalid token expiration',
        { code: 'INVALID_TOKEN_RESPONSE', status: response.status },
      );
    }
    return {
      accessToken: parsed.data.access_token,
      tokenType: parsed.data.token_type,
      expiresAt,
      ...(parsed.data.refresh_token === undefined
        ? {}
        : { refreshToken: parsed.data.refresh_token }),
    };
  }

  #timestamp(): number {
    const value = this.#now();
    if (!Number.isFinite(value)) {
      throw new YahooAuthenticationError('Yahoo OAuth clock is invalid', {
        code: 'INVALID_CLOCK_VALUE',
      });
    }
    return value;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new YahooAuthenticationError(
      'Yahoo token response was not valid JSON',
      {
        code: 'INVALID_TOKEN_RESPONSE',
        status: response.status,
        cause: error,
      },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateEndpoint(value: string, resource: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new TypeError('Unsupported OAuth endpoint protocol');
    }
    return url.toString();
  } catch (cause) {
    throw new YahooAuthenticationError(
      `Yahoo OAuth ${resource} endpoint is invalid`,
      { code: 'INVALID_OAUTH_ENDPOINT', cause },
    );
  }
}

function validateTokenSet(value: unknown): YahooTokenSet {
  const parsed = tokenSetSchema.safeParse(value);
  if (!parsed.success) {
    throw new YahooAuthenticationError('Stored Yahoo tokens were invalid', {
      code: 'INVALID_STORED_TOKENS',
      cause: parsed.error,
    });
  }
  return {
    accessToken: parsed.data.accessToken,
    tokenType: parsed.data.tokenType,
    expiresAt: parsed.data.expiresAt,
    ...(parsed.data.refreshToken === undefined
      ? {}
      : { refreshToken: parsed.data.refreshToken }),
  };
}
