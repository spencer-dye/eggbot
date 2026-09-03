import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AuditedOperationRunner,
  FileStorageAdapter,
  InMemoryStorageAdapter,
  StorageAuditHistory,
} from './index.js';
import type {
  AuditHistory,
  OperationalAuditError,
  StorageValidationError,
} from './index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe.each([
  ['memory', () => Promise.resolve(new InMemoryStorageAdapter())],
  [
    'file',
    async () => {
      const directory = await temporaryDirectory();
      return new FileStorageAdapter({ directory });
    },
  ],
] as const)('%s operational storage', (_name, createStorage) => {
  it('supports isolated reads, atomic create, replacement, listing, and deletion', async () => {
    const storage = await createStorage();
    const first = {
      key: 'jobs/a',
      value: { state: 'scheduled', attempts: 0 },
      updatedAt: '2026-09-02T12:00:00.000Z',
    } as const;

    expect(await storage.create(first)).toBe(true);
    expect(await storage.create(first)).toBe(false);
    const loaded = await storage.get(first.key);
    expect(loaded).toEqual(first);
    if (loaded !== undefined && typeof loaded.value === 'object') {
      (loaded.value as { state: string }).state = 'mutated';
    }
    expect(await storage.get(first.key)).toEqual(first);

    await storage.put({
      ...first,
      value: { state: 'completed', attempts: 1 },
      updatedAt: '2026-09-02T12:01:00.000Z',
    });
    await storage.put({
      key: 'other/a',
      value: null,
      updatedAt: '2026-09-02T12:01:00.000Z',
    });
    expect(await storage.list('jobs/')).toEqual([
      {
        ...first,
        value: { state: 'completed', attempts: 1 },
        updatedAt: '2026-09-02T12:01:00.000Z',
      },
    ]);
    expect(await storage.delete(first.key)).toBe(true);
    expect(await storage.delete(first.key)).toBe(false);
  });
});

describe('FileStorageAdapter validation', () => {
  it('fails closed for corrupt records', async () => {
    const directory = await temporaryDirectory();
    const storage = new FileStorageAdapter({ directory });
    await storage.put({
      key: 'valid',
      value: true,
      updatedAt: '2026-09-02T12:00:00.000Z',
    });
    const [filename] = await readdir(directory);
    expect(filename).toBeDefined();
    await writeFile(join(directory, filename!), '{broken', 'utf8');

    await expect(storage.get('valid')).rejects.toMatchObject({
      name: 'StorageValidationError',
      code: 'INVALID_STORED_JSON',
    } satisfies Partial<StorageValidationError>);
  });

  it('stores restrictive file envelopes without exposing keys as paths', async () => {
    const directory = await temporaryDirectory();
    const storage = new FileStorageAdapter({ directory });
    await storage.put({
      key: '../../unsafe',
      value: 'safe',
      updatedAt: '2026-09-02T12:00:00.000Z',
    });
    const [filename] = await readdir(directory);
    expect(filename).toMatch(/^[a-f0-9]{64}\.json$/u);
    expect(await readFile(join(directory, filename!), 'utf8')).toContain(
      '../../unsafe',
    );
  });
});

describe('StorageAuditHistory', () => {
  it('appends immutable events and queries newest-first', async () => {
    const history = new StorageAuditHistory(new InMemoryStorageAdapter());
    await history.append({
      id: 'event-1',
      occurredAt: '2026-09-02T12:00:00.000Z',
      category: 'lineup-run',
      subjectId: 'run-1',
      outcome: 'succeeded',
      payload: { status: 'executed' },
    });
    await history.append({
      id: 'event-2',
      occurredAt: '2026-09-02T12:01:00.000Z',
      category: 'waiver-run',
      subjectId: 'run-2',
      outcome: 'pending',
      payload: { status: 'submitted' },
    });

    expect(await history.get('event-1')).toMatchObject({ subjectId: 'run-1' });
    expect(await history.list({ limit: 1 })).toMatchObject([{ id: 'event-2' }]);
    expect(await history.list({ category: 'lineup-run' })).toMatchObject([
      { id: 'event-1' },
    ]);
    await expect(
      history.append({
        id: 'event-1',
        occurredAt: '2026-09-02T12:02:00.000Z',
        category: 'lineup-run',
        subjectId: 'run-1',
        outcome: 'failed',
        payload: null,
      }),
    ).rejects.toThrow('already exists');
  });
});

describe('AuditedOperationRunner', () => {
  it('durably brackets an operation with pending and terminal events', async () => {
    const history = new StorageAuditHistory(new InMemoryStorageAdapter());
    const runner = new AuditedOperationRunner({
      history,
      clock: () => new Date('2026-09-02T12:00:00.000Z'),
    });

    const result = await runner.run({
      operationId: 'lineup:league:team:week-1',
      attemptId: 'lineup:league:team:week-1:attempt-1',
      category: 'lineup-run',
      subjectId: 'league:team',
      run: () => Promise.resolve({ status: 'dry-run' }),
      serializeResult: (value) => value,
      classifyOutcome: () => 'dry-run',
    });

    expect(result).toEqual({ status: 'dry-run' });
    expect(await history.list()).toMatchObject([
      { outcome: 'pending' },
      { outcome: 'dry-run' },
    ]);
  });

  it('reports a completed operation whose terminal audit write failed', async () => {
    let appends = 0;
    const history: AuditHistory = {
      append: () => {
        appends += 1;
        return appends === 1
          ? Promise.resolve()
          : Promise.reject(new Error('audit disk unavailable'));
      },
      get: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
    };
    const runner = new AuditedOperationRunner({ history });

    await expect(
      runner.run({
        operationId: 'waiver:league:team:week-1',
        attemptId: 'waiver:league:team:week-1:attempt-1',
        category: 'waiver-run',
        subjectId: 'league:team',
        run: () => Promise.resolve({ status: 'submitted' }),
        serializeResult: (value) => value,
        classifyOutcome: () => 'pending',
      }),
    ).rejects.toMatchObject({
      stage: 'terminal-after-success',
      operationCompleted: true,
      operationResult: { status: 'submitted' },
    } satisfies Partial<OperationalAuditError>);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'eggbot-storage-'));
  temporaryDirectories.push(directory);
  return directory;
}
