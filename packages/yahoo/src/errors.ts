export class YahooAuthenticationError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  constructor(
    message: string,
    options: { code: string; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'YahooAuthenticationError';
    this.code = options.code;
    this.status = options.status;
  }
}

export class YahooApiError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly responseBody?: unknown;

  constructor(
    message: string,
    options: {
      code: string;
      status?: number;
      responseBody?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'YahooApiError';
    this.code = options.code;
    this.status = options.status;
    this.responseBody = options.responseBody;
  }
}

export class YahooResponseValidationError extends Error {
  readonly resource: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options: { resource: string; details?: unknown; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'YahooResponseValidationError';
    this.resource = options.resource;
    this.details = options.details;
  }
}
