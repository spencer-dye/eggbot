import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryStorageAdapter } from '@eggbot/storage';

import {
  RecoverableScheduler,
  StorageJobStateStore,
  runWithRetry,
} from './index.js';
import type { RetryExhaustedError } from './index.js';

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
      attempts: 1,
      lastStartedAt: '2026-09-02T12:00:00.000Z',
      lastCompletedAt: '2026-09-02T12:00:00.000Z',
    });
    scheduler.close();
  });

  it('recovers a run interrupted while marked running', async () => {
    const states = new StorageJobStateStore(new InMemoryStorageAdapter());
    await states.save({
      jobId: 'recovery',
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
