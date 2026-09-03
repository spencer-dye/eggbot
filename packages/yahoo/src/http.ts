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

export interface YahooWriteResponse {
  readonly status: number;
  readonly location?: string;
  readonly body?: unknown;
}

export class YahooHttpClient {
  readonly #tokenProvider: YahooAccessTokenProvider;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: URL;

  constructor(options: YahooHttpClientOptions) {
    this.#tokenProvider = options.tokenProvider;
    this.#fetch = options.fetch ?? globalThis.fetch;
    try {
      this.#baseUrl = new URL(options.baseUrl ?? DEFAULT_API_BASE_URL);
    } catch (cause) {
      throw new YahooApiError('Yahoo API base URL is invalid', {
        code: 'INVALID_API_BASE_URL',
        cause,
      });
    }
    if (
      !['http:', 'https:'].includes(this.#baseUrl.protocol) ||
      this.#baseUrl.search.length > 0 ||
      this.#baseUrl.hash.length > 0
    ) {
      throw new YahooApiError('Yahoo API base URL is invalid', {
        code: 'INVALID_API_BASE_URL',
      });
    }
    if (!this.#baseUrl.pathname.endsWith('/')) {
      this.#baseUrl.pathname += '/';
    }
  }

  async get(
    path: string,
    query: Readonly<Record<string, string | number | undefined>> = {},
  ): Promise<unknown> {
    const url = this.#relativeUrl(path);
    url.searchParams.set('format', 'json');
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response = await this.#request(url, false, { method: 'GET' });
    if (response.status === 401) {
      response = await this.#request(url, true, { method: 'GET' });
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

  async sendXml(
    method: 'POST' | 'PUT',
    path: string,
    body: string,
  ): Promise<YahooWriteResponse> {
    const url = this.#relativeUrl(path);
    const init: RequestInit = {
      method,
      body,
      headers: {
        accept: 'application/json, application/xml, text/xml',
        'content-type': 'application/xml; charset=utf-8',
      },
    };
    let response = await this.#request(url, false, init);
    if (response.status === 401) {
      response = await this.#request(url, true, init);
    }
    const responseBody = await readFlexibleBody(response);
    if (!response.ok) {
      throw new YahooApiError(
        `Yahoo API write failed with status ${response.status}`,
        {
          code: 'API_WRITE_FAILED',
          status: response.status,
          responseBody,
        },
      );
    }
    const location = response.headers.get('location') ?? undefined;
    return {
      status: response.status,
      ...(location === undefined ? {} : { location }),
      ...(responseBody === undefined ? {} : { body: responseBody }),
    };
  }

  #relativeUrl(path: string): URL {
    const relativePath = path.replace(/^\/+/, '');
    let url: URL;
    try {
      url = new URL(relativePath, this.#baseUrl);
    } catch (cause) {
      throw new YahooApiError('Yahoo client path is invalid', {
        code: 'INVALID_API_PATH',
        cause,
      });
    }
    const basePath = this.#baseUrl.pathname.endsWith('/')
      ? this.#baseUrl.pathname
      : `${this.#baseUrl.pathname}/`;
    if (
      url.origin !== this.#baseUrl.origin ||
      !url.pathname.startsWith(basePath)
    ) {
      throw new YahooApiError('Yahoo client paths must be relative', {
        code: 'INVALID_API_PATH',
      });
    }
    return url;
  }

  async #request(
    url: URL,
    forceRefresh: boolean,
    init: RequestInit,
  ): Promise<Response> {
    const accessToken = await this.#tokenProvider.getAccessToken(forceRefresh);
    try {
      return await this.#fetch(url, {
        ...init,
        headers: {
          ...init.headers,
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

async function readFlexibleBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
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
