import type {
  JsonValue,
  OperationalStorageAdapter,
  StorageRecord,
} from './index.js';
import { cloneRecord, validateRecord } from './validation.js';

export class InMemoryStorageAdapter implements OperationalStorageAdapter {
  readonly #records = new Map<string, StorageRecord>();

  get<Value extends JsonValue = JsonValue>(
    key: string,
  ): Promise<StorageRecord<Value> | undefined> {
    const record = this.#records.get(key);
    return Promise.resolve(
      record === undefined
        ? undefined
        : (cloneRecord(record) as StorageRecord<Value>),
    );
  }

  put<Value extends JsonValue>(record: StorageRecord<Value>): Promise<void> {
    validateRecord(record);
    this.#records.set(record.key, cloneRecord(record));
    return Promise.resolve();
  }

  create<Value extends JsonValue>(
    record: StorageRecord<Value>,
  ): Promise<boolean> {
    validateRecord(record);
    if (this.#records.has(record.key)) return Promise.resolve(false);
    this.#records.set(record.key, cloneRecord(record));
    return Promise.resolve(true);
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.#records.delete(key));
  }

  list<Value extends JsonValue = JsonValue>(
    prefix = '',
  ): Promise<readonly StorageRecord<Value>[]> {
    return Promise.resolve(
      [...this.#records.values()]
        .filter(({ key }) => key.startsWith(prefix))
        .sort((left, right) => left.key.localeCompare(right.key))
        .map((record) => cloneRecord(record) as StorageRecord<Value>),
    );
  }
}
