import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type {
  JsonValue,
  OperationalStorageAdapter,
  StorageRecord,
} from './index.js';
import { validateJson, validateRecord } from './validation.js';

interface StoredEnvelope {
  readonly format: 'eggbot-storage-v1';
  readonly record: StorageRecord;
}

export interface FileStorageAdapterOptions {
  readonly directory: string;
}

export class StorageValidationError extends Error {
  readonly code: string;
  readonly resource: string | undefined;

  constructor(
    message: string,
    options: { code: string; resource?: string; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'StorageValidationError';
    this.code = options.code;
    this.resource = options.resource;
  }
}

/**
 * Small single-host durable adapter. Records are isolated files, replacements
 * are atomic, and create is no-clobber. It is not a distributed database.
 */
export class FileStorageAdapter implements OperationalStorageAdapter {
  readonly #directory: string;

  constructor(options: FileStorageAdapterOptions) {
    if (options.directory.trim().length === 0) {
      throw new StorageValidationError('Storage directory is empty', {
        code: 'INVALID_STORAGE_DIRECTORY',
      });
    }
    this.#directory = resolve(options.directory);
  }

  async get<Value extends JsonValue = JsonValue>(
    key: string,
  ): Promise<StorageRecord<Value> | undefined> {
    const path = this.#path(key);
    try {
      return (await this.#read(path)) as StorageRecord<Value>;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return undefined;
      throw error;
    }
  }

  async put<Value extends JsonValue>(
    record: StorageRecord<Value>,
  ): Promise<void> {
    validateRecord(record);
    await this.#ensureDirectory();
    const path = this.#path(record.key);
    const temporary = this.#temporaryPath();
    try {
      await writeDurably(temporary, envelope(record));
      await rename(temporary, path);
      await syncDirectory(this.#directory);
    } finally {
      await unlink(temporary).catch(ignoreMissing);
    }
  }

  async create<Value extends JsonValue>(
    record: StorageRecord<Value>,
  ): Promise<boolean> {
    validateRecord(record);
    await this.#ensureDirectory();
    const temporary = this.#temporaryPath();
    try {
      await writeDurably(temporary, envelope(record));
      try {
        await link(temporary, this.#path(record.key));
      } catch (error) {
        if (isNodeError(error, 'EEXIST')) return false;
        throw error;
      }
      await syncDirectory(this.#directory);
      return true;
    } finally {
      await unlink(temporary).catch(ignoreMissing);
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      await unlink(this.#path(key));
      await syncDirectory(this.#directory);
      return true;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return false;
      throw error;
    }
  }

  async list<Value extends JsonValue = JsonValue>(
    prefix = '',
  ): Promise<readonly StorageRecord<Value>[]> {
    let names: string[];
    try {
      names = await readdir(this.#directory);
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return [];
      throw error;
    }
    const records = await Promise.all(
      names
        .filter((name) => name.endsWith('.json'))
        .map((name) => this.#read(join(this.#directory, name))),
    );
    return records
      .filter(({ key }) => key.startsWith(prefix))
      .sort((left, right) =>
        left.key.localeCompare(right.key),
      ) as unknown as readonly StorageRecord<Value>[];
  }

  async #read(path: string): Promise<StorageRecord> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) throw error;
      throw new StorageValidationError('Stored record is not valid JSON', {
        code: 'INVALID_STORED_JSON',
        resource: path,
        cause: error,
      });
    }
    try {
      validateJson(value, 'envelope');
      const envelopeValue = value as unknown as Partial<StoredEnvelope>;
      if (
        envelopeValue.format !== 'eggbot-storage-v1' ||
        typeof envelopeValue.record !== 'object' ||
        envelopeValue.record === null
      ) {
        throw new TypeError('Unknown storage envelope');
      }
      const record = envelopeValue.record;
      validateRecord(record);
      if (this.#path(record.key) !== path) {
        throw new TypeError('Storage key hash mismatch');
      }
      return record;
    } catch (error) {
      throw new StorageValidationError('Stored record failed validation', {
        code: 'INVALID_STORED_RECORD',
        resource: path,
        cause: error,
      });
    }
  }

  #path(key: string): string {
    if (key.trim().length === 0) {
      throw new StorageValidationError('Storage key is empty', {
        code: 'INVALID_STORAGE_KEY',
      });
    }
    const digest = createHash('sha256').update(key).digest('hex');
    return join(this.#directory, `${digest}.json`);
  }

  #temporaryPath(): string {
    return join(this.#directory, `.tmp-${randomUUID()}`);
  }

  #ensureDirectory(): Promise<void> {
    return mkdir(this.#directory, { recursive: true, mode: 0o700 }).then(
      () => undefined,
    );
  }
}

function envelope<Value extends JsonValue>(
  record: StorageRecord<Value>,
): string {
  return `${JSON.stringify({ format: 'eggbot-storage-v1', record } satisfies StoredEnvelope)}\n`;
}

async function writeDurably(path: string, contents: string): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function ignoreMissing(error: unknown): void {
  if (!isNodeError(error, 'ENOENT')) throw error;
}
