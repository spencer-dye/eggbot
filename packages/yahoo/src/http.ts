import { YahooApiError, YahooResponseValidationError } from './errors.js';
import { parseFantasyContent } from './yahoo-json.js';

const DEFAULT_API_BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2/';

export interface YahooAccessTokenProvider {
  getAccessToken(forceRefresh?: boolean): Promise<string>;
}

export interface YahooHttpClientOptions {
  readonly tokenProvider: YahooAccessTokenProvider;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
}

export class YahooHttpClient {
  readonly #tokenProvider: YahooAccessTokenProvider;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;

  constructor(options: YahooHttpClientOptions) {
    this.#tokenProvider = options.tokenProvider;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#baseUrl = options.baseUrl ?? DEFAULT_API_BASE_URL;
  }

  async get(
    path: string,
    query: Readonly<Record<string, string | number | undefined>> = {},
  ): Promise<unknown> {
    if (path.startsWith('http:') || path.startsWith('https:')) {
      throw new YahooApiError('Yahoo client paths must be relative', {
        code: 'INVALID_API_PATH',
      });
    }

    const url = new URL(path.replace(/^\//, ''), this.#baseUrl);
    url.searchParams.set('format', 'json');
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response = await this.#request(url, false);
    if (response.status === 401) {
      response = await this.#request(url, true);
    }

    const body = await readBody(response);
    if (!response.ok) {
      throw new YahooApiError(
        `Yahoo API request failed with status ${response.status}`,
        {
          code: 'API_REQUEST_FAILED',
          status: response.status,
          responseBody: body,
        },
      );
    }

    try {
      return parseFantasyContent(body);
    } catch (error) {
      if (error instanceof YahooResponseValidationError) throw error;
      throw new YahooResponseValidationError(
        'Yahoo fantasy response was invalid',
        {
          resource: path,
          cause: error,
        },
      );
    }
  }

  async #request(url: URL, forceRefresh: boolean): Promise<Response> {
    const accessToken = await this.#tokenProvider.getAccessToken(forceRefresh);
    try {
      return await this.#fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
      });
    } catch (error) {
      throw new YahooApiError('Yahoo API transport failed', {
        code: 'API_TRANSPORT_ERROR',
        cause: error,
      });
    }
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new YahooResponseValidationError(
      'Yahoo API response was not valid JSON',
      {
        resource: response.url,
        details: text.slice(0, 500),
        cause: error,
      },
    );
  }
}
