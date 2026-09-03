export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly backoffMultiplier?: number;
  readonly maxDelayMs?: number;
}

export interface RetryAttempt {
  readonly attempt: number;
  readonly error: unknown;
  readonly willRetry: boolean;
  readonly nextDelayMs?: number;
}

export interface RetryOptions {
  /** Required classifier prevents indiscriminate retries of mutations. */
  readonly shouldRetry: (error: unknown, attempt: number) => boolean;
  readonly signal?: AbortSignal;
  readonly sleep?: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  readonly onAttempt?: (attempt: RetryAttempt) => void | Promise<void>;
}

export class RetryExhaustedError extends Error {
  readonly attempts: number;

  constructor(attempts: number, cause: unknown) {
    super(
      `Operation failed after ${attempts} attempt${attempts === 1 ? '' : 's'}`,
      { cause },
    );
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
  }
}

export async function runWithRetry<Value>(
  operation: (attempt: number) => Promise<Value>,
  policy: RetryPolicy,
  options: RetryOptions,
): Promise<Value> {
  validateRetryPolicy(policy);
  const sleep = options.sleep ?? abortableSleep;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      return await operation(attempt);
    } catch (error) {
      const retryable = options.shouldRetry(error, attempt);
      const willRetry = retryable && attempt < policy.maxAttempts;
      const nextDelayMs = willRetry ? retryDelay(policy, attempt) : undefined;
      await options.onAttempt?.({
        attempt,
        error,
        willRetry,
        ...(nextDelayMs === undefined ? {} : { nextDelayMs }),
      });
      if (!willRetry) throw new RetryExhaustedError(attempt, error);
      if (nextDelayMs === undefined) throw new Error('Missing retry delay');
      await sleep(nextDelayMs, options.signal);
    }
  }
  throw new Error('Unreachable retry state');
}

function retryDelay(policy: RetryPolicy, failedAttempt: number): number {
  const multiplier = policy.backoffMultiplier ?? 2;
  const calculated = policy.initialDelayMs * multiplier ** (failedAttempt - 1);
  return Math.min(calculated, policy.maxDelayMs ?? Number.MAX_SAFE_INTEGER);
}

export function validateRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts <= 0) {
    throw new RangeError('Retry maxAttempts must be a positive safe integer');
  }
  if (
    !Number.isSafeInteger(policy.initialDelayMs) ||
    policy.initialDelayMs < 0
  ) {
    throw new RangeError(
      'Retry initialDelayMs must be a non-negative safe integer',
    );
  }
  if (
    policy.backoffMultiplier !== undefined &&
    (!Number.isFinite(policy.backoffMultiplier) || policy.backoffMultiplier < 1)
  ) {
    throw new RangeError(
      'Retry backoffMultiplier must be finite and at least one',
    );
  }
  if (
    policy.maxDelayMs !== undefined &&
    (!Number.isSafeInteger(policy.maxDelayMs) || policy.maxDelayMs < 0)
  ) {
    throw new RangeError(
      'Retry maxDelayMs must be a non-negative safe integer',
    );
  }
}

function abortableSleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  const delay = Math.min(milliseconds, 2_147_483_647);
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      if (delay === milliseconds) resolve();
      else
        void abortableSleep(milliseconds - delay, signal).then(resolve, reject);
    }, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortReason(signal);
}

function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error('Operation aborted', { cause: signal?.reason });
}
