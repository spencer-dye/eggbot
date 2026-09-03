export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export interface StorageRecord<Value extends JsonValue = JsonValue> {
  readonly key: string;
  readonly value: Value;
  readonly updatedAt: string;
}

/** Minimal database-neutral key/value persistence port. */
export interface StorageAdapter {
  get<Value extends JsonValue = JsonValue>(
    key: string,
  ): Promise<StorageRecord<Value> | undefined>;
  put<Value extends JsonValue>(record: StorageRecord<Value>): Promise<void>;
  delete(key: string): Promise<boolean>;
}

/** Operational capabilities needed for immutable history and recovery scans. */
export interface OperationalStorageAdapter extends StorageAdapter {
  create<Value extends JsonValue>(
    record: StorageRecord<Value>,
  ): Promise<boolean>;
  list<Value extends JsonValue = JsonValue>(
    prefix?: string,
  ): Promise<readonly StorageRecord<Value>[]>;
}

export {
  FileStorageAdapter,
  StorageValidationError,
  type FileStorageAdapterOptions,
} from './file-storage.js';
export { InMemoryStorageAdapter } from './memory-storage.js';
export {
  StorageAuditHistory,
  type AuditEvent,
  type AuditHistory,
  type AuditOutcome,
  type AuditQuery,
} from './audit-history.js';
export {
  AuditedOperationRunner,
  OperationalAuditError,
  type AuditedOperation,
  type AuditedOperationRunnerOptions,
} from './audited-operation.js';

export const storageCapabilities = [
  'database-neutral-port',
  'atomic-file-storage',
  'no-clobber-create',
  'immutable-audit-history',
  'audited-operation-lifecycle',
  'recovery-scans',
] as const;
