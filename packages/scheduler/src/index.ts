import type { JsonValue, OperationalStorageAdapter } from '@eggbot/storage';

import {
  runWithRetry,
  validateRetryPolicy,
  type RetryOptions,
  type RetryPolicy,
} from './retry.js';

const maximumTimerDelayMs = 2_147_483_647;

export type JobTrigger =
  | { readonly type: 'once'; readonly runAt: string }
  | { readonly type: 'interval'; readonly everyMilliseconds: number };

export interface ScheduledJob {
  readonly id: string;
  readonly name: string;
  readonly trigger: JobTrigger;
  /** Retry is opt-in and must explicitly classify retryable failures. */
  readonly retry?: {
    readonly policy: RetryPolicy;
    readonly shouldRetry: RetryOptions['shouldRetry'];
  };
  run(signal: AbortSignal): Promise<void>;
}

export interface Scheduler {
  schedule(job: ScheduledJob): Promise<void>;
  cancel(jobId: string): Promise<boolean>;
}

export type JobRunStatus = 'scheduled' | 'running' | 'completed' | 'failed';

export interface JobState {
  readonly jobId: string;
  readonly trigger: JobTrigger;
  readonly status: JobRunStatus;
  readonly attempts: number;
  readonly updatedAt: string;
  readonly nextRunAt?: string;
  readonly lastStartedAt?: string;
  readonly lastCompletedAt?: string;
  readonly lastError?: { readonly name: string; readonly message: string };
}

export interface JobStateStore {
  load(jobId: string): Promise<JobState | undefined>;
  save(state: JobState): Promise<void>;
  delete(jobId: string): Promise<boolean>;
}

export class StorageJobStateStore implements JobStateStore {
  readonly #storage: OperationalStorageAdapter;

  constructor(storage: OperationalStorageAdapter) {
    this.#storage = storage;
  }

  async load(jobId: string): Promise<JobState | undefined> {
    const record = await this.#storage.get(
      `scheduler/v1/${encodeURIComponent(jobId)}`,
    );
    return record === undefined ? undefined : parseJobState(record.value);
  }

  save(state: JobState): Promise<void> {
    validateJobState(state);
    return this.#storage.put({
      key: `scheduler/v1/${encodeURIComponent(state.jobId)}`,
      updatedAt: state.updatedAt,
      value: JSON.parse(JSON.stringify(state)) as JsonValue,
    });
  }

  delete(jobId: string): Promise<boolean> {
    return this.#storage.delete(`scheduler/v1/${encodeURIComponent(jobId)}`);
  }
}

export interface RecoverableSchedulerOptions {
  readonly stateStore: JobStateStore;
  readonly clock?: () => Date;
  readonly onError?: (error: unknown, state: JobState) => void | Promise<void>;
}

/**
 * Single-process timer scheduler with durable run state. Applications re-register
 * job functions after restart; interrupted runs are then recovered at least once.
 */
export class RecoverableScheduler implements Scheduler {
  readonly #stateStore: JobStateStore;
  readonly #clock: () => Date;
  readonly #onError: (error: unknown, state: JobState) => void | Promise<void>;
  readonly #jobs = new Map<
    string,
    {
      job: ScheduledJob;
      timer?: ReturnType<typeof setTimeout>;
      controller?: AbortController;
    }
  >();

  constructor(options: RecoverableSchedulerOptions) {
    this.#stateStore = options.stateStore;
    this.#clock = options.clock ?? (() => new Date());
    this.#onError = options.onError ?? (() => undefined);
  }

  async schedule(job: ScheduledJob): Promise<void> {
    validateJob(job);
    if (this.#jobs.has(job.id)) {
      throw new Error(`Job ${job.id} is already scheduled`);
    }
    const previous = await this.#stateStore.load(job.id);
    if (previous !== undefined && !sameTrigger(previous.trigger, job.trigger)) {
      throw new Error(`Job ${job.id} trigger conflicts with durable state`);
    }
    if (previous?.status === 'completed' && job.trigger.type === 'once') return;

    const now = this.#timestamp();
    const nextRunAt = recoveredNextRunAt(job.trigger, previous, now);
    const state: JobState = {
      jobId: job.id,
      trigger: job.trigger,
      status: 'scheduled',
      attempts: previous?.attempts ?? 0,
      updatedAt: now,
      nextRunAt,
      ...(previous?.lastStartedAt === undefined
        ? {}
        : { lastStartedAt: previous.lastStartedAt }),
      ...(previous?.lastCompletedAt === undefined
        ? {}
        : { lastCompletedAt: previous.lastCompletedAt }),
      ...(previous?.lastError === undefined
        ? {}
        : { lastError: previous.lastError }),
    };
    await this.#stateStore.save(state);
    this.#jobs.set(job.id, { job });
    this.#arm(job.id, state);
  }

  async cancel(jobId: string): Promise<boolean> {
    const scheduled = this.#jobs.get(jobId);
    if (scheduled !== undefined) {
      if (scheduled.timer !== undefined) clearTimeout(scheduled.timer);
      scheduled.controller?.abort();
      this.#jobs.delete(jobId);
    }
    const deleted = await this.#stateStore.delete(jobId);
    return scheduled !== undefined || deleted;
  }

  close(): void {
    for (const [id, entry] of this.#jobs) {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.controller?.abort();
      this.#jobs.delete(id);
    }
  }

  #arm(jobId: string, state: JobState): void {
    const entry = this.#jobs.get(jobId);
    if (entry === undefined || state.nextRunAt === undefined) return;
    const delay = Math.max(0, Date.parse(state.nextRunAt) - this.#now());
    if (delay > maximumTimerDelayMs) {
      entry.timer = setTimeout(
        () => this.#arm(jobId, state),
        maximumTimerDelayMs,
      );
      return;
    }
    entry.timer = setTimeout(() => {
      void this.#run(jobId).catch(() => undefined);
    }, delay);
  }

  async #run(jobId: string): Promise<void> {
    const entry = this.#jobs.get(jobId);
    if (entry === undefined || entry.controller !== undefined) return;
    const controller = new AbortController();
    entry.controller = controller;
    const startedAt = this.#timestamp();
    let state: JobState = {
      jobId,
      trigger: entry.job.trigger,
      status: 'running',
      attempts: 1,
      updatedAt: startedAt,
      lastStartedAt: startedAt,
    };
    try {
      const prior = await this.#stateStore.load(jobId);
      state = { ...state, attempts: (prior?.attempts ?? 0) + 1 };
      await this.#stateStore.save(state);
      if (entry.job.retry === undefined) {
        await entry.job.run(controller.signal);
      } else {
        await runWithRetry(
          () => entry.job.run(controller.signal),
          entry.job.retry.policy,
          {
            signal: controller.signal,
            shouldRetry: entry.job.retry.shouldRetry,
          },
        );
      }
      const completedAt = this.#timestamp();
      state = nextState(entry.job, state, completedAt, 'completed');
      await this.#stateStore.save(state);
    } catch (error) {
      const failedAt = this.#timestamp();
      state = nextState(
        entry.job,
        state,
        failedAt,
        'failed',
        errorDetails(error),
      );
      try {
        await this.#stateStore.save(state);
      } catch (persistenceError) {
        await this.#onError(
          new AggregateError(
            [error, persistenceError],
            'Job failure could not be durably recorded',
          ),
          state,
        );
        return;
      }
      await this.#onError(error, state);
    } finally {
      delete entry.controller;
      if (entry.job.trigger.type === 'once') {
        this.#jobs.delete(jobId);
      } else {
        this.#arm(jobId, state);
      }
    }
  }

  #timestamp(): string {
    return new Date(this.#now()).toISOString();
  }

  #now(): number {
    const value = this.#clock();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new TypeError('Scheduler clock returned an invalid date');
    }
    return value.getTime();
  }
}

function nextState(
  job: ScheduledJob,
  prior: JobState,
  timestamp: string,
  outcome: 'completed' | 'failed',
  lastError?: JobState['lastError'],
): JobState {
  const interval = job.trigger.type === 'interval';
  return {
    ...prior,
    status: interval ? 'scheduled' : outcome,
    updatedAt: timestamp,
    ...(outcome === 'completed' ? { lastCompletedAt: timestamp } : {}),
    ...(lastError === undefined ? {} : { lastError }),
    ...(interval
      ? {
          nextRunAt: new Date(
            Date.parse(timestamp) + job.trigger.everyMilliseconds,
          ).toISOString(),
        }
      : {}),
  };
}

function recoveredNextRunAt(
  trigger: JobTrigger,
  previous: JobState | undefined,
  now: string,
): string {
  if (previous?.status === 'running') return now;
  if (previous?.nextRunAt !== undefined) return previous.nextRunAt;
  return trigger.type === 'once'
    ? new Date(Date.parse(trigger.runAt)).toISOString()
    : new Date(Date.parse(now) + trigger.everyMilliseconds).toISOString();
}

function validateJob(job: ScheduledJob): void {
  if (job.id.trim().length === 0 || job.name.trim().length === 0) {
    throw new TypeError('Scheduled job ID and name are required');
  }
  if (job.trigger.type === 'once') {
    if (Number.isNaN(Date.parse(job.trigger.runAt))) {
      throw new TypeError('One-time job has an invalid runAt timestamp');
    }
  } else if (
    !Number.isSafeInteger(job.trigger.everyMilliseconds) ||
    job.trigger.everyMilliseconds <= 0
  ) {
    throw new RangeError('Job interval must be a positive safe integer');
  }
  if (typeof job.run !== 'function') {
    throw new TypeError('Scheduled job run is invalid');
  }
  if (job.retry !== undefined) {
    if (typeof job.retry.shouldRetry !== 'function') {
      throw new TypeError('Scheduled job retry classifier is invalid');
    }
    validateRetryPolicy(job.retry.policy);
  }
}

function validateJobState(state: JobState): void {
  validateJob({
    id: state.jobId,
    name: state.jobId,
    trigger: state.trigger,
    run: () => Promise.resolve(),
  });
  if (!Number.isSafeInteger(state.attempts) || state.attempts < 0) {
    throw new TypeError('Job state attempts are invalid');
  }
  for (const value of [
    state.updatedAt,
    state.nextRunAt,
    state.lastStartedAt,
    state.lastCompletedAt,
  ]) {
    if (value !== undefined && Number.isNaN(Date.parse(value))) {
      throw new TypeError('Job state contains an invalid timestamp');
    }
  }
}

function parseJobState(value: unknown): JobState {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Job state is invalid');
  }
  const state = value as JobState;
  validateJobState(state);
  if (!['scheduled', 'running', 'completed', 'failed'].includes(state.status)) {
    throw new TypeError('Job state status is invalid');
  }
  return structuredClone(state);
}

function sameTrigger(left: JobTrigger, right: JobTrigger): boolean {
  return (
    left.type === right.type && JSON.stringify(left) === JSON.stringify(right)
  );
}

function errorDetails(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: String(error) };
}

export {
  RetryExhaustedError,
  runWithRetry,
  validateRetryPolicy,
  type RetryAttempt,
  type RetryOptions,
  type RetryPolicy,
} from './retry.js';

export const schedulerCapabilities = [
  'durable-job-state',
  'interrupted-run-recovery',
  'single-process-non-overlap',
  'explicit-retry-classification',
  'bounded-exponential-backoff',
] as const;
