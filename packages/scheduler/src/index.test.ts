import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryStorageAdapter } from '@eggbot/storage';

import {
  RecoverableScheduler,
  StorageJobStateStore,
  runWithRetry,
} from './index.js';
import type {
  RetryExhaustedError,
  SchedulerClosedError,
  SchedulerConflictError,
} from './index.js';

describe('runWithRetry', () => {
  it('uses bounded exponential backoff for explicitly retryable failures', async () => {
    const delays: number[] = [];
    const attempts: number[] = [];
    const value = await runWithRetry(
      (attempt) => {
        attempts.push(attempt);
        return attempt < 3
          ? Promise.reject(new Error('transient'))
          : Promise.resolve('ok');
      },
      { maxAttempts: 3, initialDelayMs: 10, backoffMultiplier: 3 },
      {
        shouldRetry: () => true,
        sleep: (milliseconds) => {
          delays.push(milliseconds);
          return Promise.resolve();
        },
      },
    );

    expect(value).toBe('ok');
    expect(attempts).toEqual([1, 2, 3]);
    expect(delays).toEqual([10, 30]);
  });

  it('does not retry an error the caller classifies as unsafe', async () => {
    const operation = vi.fn(() => Promise.reject(new Error('uncertain write')));
    await expect(
      runWithRetry(
        operation,
        { maxAttempts: 5, initialDelayMs: 0 },
        { shouldRetry: () => false },
      ),
    ).rejects.toMatchObject({
      attempts: 1,
    } satisfies Partial<RetryExhaustedError>);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('RecoverableScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('durably records a completed one-time job', async () => {
    const states = new StorageJobStateStore(new InMemoryStorageAdapter());
    const scheduler = new RecoverableScheduler({ stateStore: states });
    const run = vi.fn(() => Promise.resolve());
    await scheduler.schedule({
      id: 'pregame',
      name: 'Pregame check',
      trigger: { type: 'once', runAt: '2026-09-02T12:00:00.000Z' },
      run,
    });

    await vi.runAllTimersAsync();

    expect(run).toHaveBeenCalledTimes(1);
    expect(await states.load('pregame')).toMatchObject({
      status: 'completed',
      generation: 0,
      attempts: 1,
      lastStartedAt: '2026-09-02T12:00:00.000Z',
      lastCompletedAt: '2026-09-02T12:00:00.000Z',
    });
    scheduler.close();
  });

  it('copies schedule configuration and rejects concurrent registration', async () => {
    let releaseLoad: (() => void) | undefined;
    const stateStore = {
      load: () =>
        new Promise<undefined>((resolve) => {
          releaseLoad = () => resolve(undefined);
        }),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve(false)),
    };
    const scheduler = new RecoverableScheduler({ stateStore });
    const trigger = {
      type: 'once' as const,
      runAt: '2026-09-02T13:00:00.000Z',
    };
    const job = {
      id: 'concurrent',
      name: 'Concurrent registration',
      trigger,
      run: () => Promise.resolve(),
    };
    const first = scheduler.schedule(job);

    await expect(scheduler.schedule(job)).rejects.toMatchObject({
      name: 'SchedulerConflictError',
      code: 'JOB_ALREADY_SCHEDULED',
      jobId: job.id,
    } satisfies Partial<SchedulerConflictError>);
    trigger.runAt = '2026-09-03T13:00:00.000Z';
    releaseLoad?.();
    await first;

    expect(stateStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: { type: 'once', runAt: '2026-09-02T13:00:00.000Z' },
      }),
    );
    scheduler.close();
  });

  it('does not arm an in-flight registration after close', async () => {
    let releaseLoad: (() => void) | undefined;
    const stateStore = {
      load: () =>
        new Promise<undefined>((resolve) => {
          releaseLoad = () => resolve(undefined);
        }),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve(false)),
    };
    const scheduler = new RecoverableScheduler({ stateStore });
    const run = vi.fn(() => Promise.resolve());
    const scheduling = scheduler.schedule({
      id: 'closing',
      name: 'Closing registration',
      trigger: { type: 'once', runAt: '2026-09-02T12:00:00.000Z' },
      run,
    });

    scheduler.close();
    releaseLoad?.();

    await expect(scheduling).rejects.toMatchObject({
      name: 'SchedulerClosedError',
      code: 'SCHEDULER_CLOSED',
    } satisfies Partial<SchedulerClosedError>);
    await expect(
      scheduler.schedule({
        id: 'after-close',
        name: 'After close',
        trigger: { type: 'once', runAt: '2026-09-02T12:00:00.000Z' },
        run,
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULER_CLOSED' });
    await vi.runAllTimersAsync();
    expect(stateStore.save).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('serializes cancellation behind an in-flight registration', async () => {
    const states = new StorageJobStateStore(new InMemoryStorageAdapter());
    let releaseLoad: (() => void) | undefined;
    let firstLoad = true;
    const stateStore = {
      load: vi.fn((jobId: string) => {
        if (!firstLoad) return states.load(jobId);
        firstLoad = false;
        return new Promise<Awaited<ReturnType<typeof states.load>>>(
          (resolve) => {
            releaseLoad = () => void states.load(jobId).then(resolve);
          },
        );
      }),
      save: (state: Parameters<typeof states.save>[0]) => states.save(state),
      delete: (jobId: string) => states.delete(jobId),
    };
    const scheduler = new RecoverableScheduler({ stateStore });
    const run = vi.fn(() => Promise.resolve());
    const scheduling = scheduler.schedule({
      id: 'register-cancel',
      name: 'Register and cancel',
      trigger: { type: 'once', runAt: '2026-09-02T12:00:00.000Z' },
      run,
    });
    const canceling = scheduler.cancel('register-cancel');

    releaseLoad?.();
    await scheduling;
    await expect(canceling).resolves.toBe(true);
    await vi.runAllTimersAsync();

    expect(run).not.toHaveBeenCalled();
    expect(await states.load('register-cancel')).toMatchObject({
      status: 'canceled',
      generation: 1,
    });
    scheduler.close();
  });

  it('recovers a run interrupted while marked running', async () => {
    const states = new StorageJobStateStore(new InMemoryStorageAdapter());
    await states.save({
      jobId: 'recovery',
      generation: 0,
      trigger: { type: 'once', runAt: '2026-09-02T11:00:00.000Z' },
      status: 'running',
      attempts: 1,
      updatedAt: '2026-09-02T11:00:00.000Z',
      lastStartedAt: '2026-09-02T11:00:00.000Z',
    });
    const scheduler = new RecoverableScheduler({ stateStore: states });
    const run = vi.fn(() => Promise.resolve());
    await scheduler.schedule({
      id: 'recovery',
      name: 'Recovered job',
      trigger: { type: 'once', runAt: '2026-09-02T11:00:00.000Z' },
      run,
    });

    await vi.runAllTimersAsync();

    expect(run).toHaveBeenCalledTimes(1);
    expect(await states.load('recovery')).toMatchObject({
      status: 'completed',
      attempts: 2,
    });
    scheduler.close();
  });

  it('classifies a conflicting durable trigger', async () => {
    const states = new StorageJobStateStore(new InMemoryStorageAdapter());
    await states.save({
      jobId: 'trigger-conflict',
      generation: 0,
      trigger: { type: 'interval', everyMilliseconds: 60_000 },
      status: 'scheduled',
      attempts: 0,
      updatedAt: '2026-09-02T12:00:00.000Z',
      nextRunAt: '2026-09-02T12:01:00.000Z',
    });
    const scheduler = new RecoverableScheduler({ stateStore: states });

    await expect(
      scheduler.schedule({
        id: 'trigger-conflict',
        name: 'Changed trigger',
        trigger: { type: 'interval', everyMilliseconds: 120_000 },
        run: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({
      name: 'SchedulerConflictError',
      code: 'JOB_TRIGGER_CONFLICT',
      jobId: 'trigger-conflict',
    } satisfies Partial<SchedulerConflictError>);
    scheduler.close();
  });

  it('keeps a durable tombstone when a canceled running job ignores abort', async () => {
    const states = new StorageJobStateStore(new InMemoryStorageAdapter());
    const scheduler = new RecoverableScheduler({ stateStore: states });
    let finish: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const job = {
      id: 'cancel-race',
      name: 'Cancel race',
      trigger: { type: 'once', runAt: '2026-09-02T12:00:00.000Z' } as const,
      run,
    };
    await scheduler.schedule(job);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledOnce();

    expect(await scheduler.cancel(job.id)).toBe(true);
    finish?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(await states.load(job.id)).toMatchObject({
      status: 'canceled',
      generation: 1,
    });
    const restarted = new RecoverableScheduler({ stateStore: states });
    await restarted.schedule(job);
    await vi.runAllTimersAsync();
    expect(run).toHaveBeenCalledOnce();
    restarted.close();
  });

  it('records terminal failure and reports it', async () => {
    const states = new StorageJobStateStore(new InMemoryStorageAdapter());
    const onError = vi.fn();
    const scheduler = new RecoverableScheduler({ stateStore: states, onError });
    await scheduler.schedule({
      id: 'failure',
      name: 'Failure',
      trigger: { type: 'once', runAt: '2026-09-02T12:00:00.000Z' },
      run: () => Promise.reject(new Error('boom')),
    });

    await vi.runAllTimersAsync();

    expect(onError).toHaveBeenCalledOnce();
    expect(await states.load('failure')).toMatchObject({
      status: 'failed',
      lastError: { name: 'Error', message: 'boom' },
    });
    scheduler.close();
  });
});
