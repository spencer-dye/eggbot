import type {
  JsonObject,
  JsonValue,
  OperationalStorageAdapter,
  StorageRecord,
} from './index.js';
import { validateJson } from './validation.js';

const auditPrefix = 'audit/v1/';

export type AuditOutcome =
  'succeeded' | 'failed' | 'uncertain' | 'rejected' | 'dry-run' | 'pending';

export interface AuditEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly category: string;
  readonly subjectId: string;
  readonly outcome: AuditOutcome;
  /** Caller-normalized payload. Secrets must be redacted before this boundary. */
  readonly payload: JsonValue;
}

export interface AuditQuery {
  readonly category?: string;
  readonly subjectId?: string;
  readonly outcome?: AuditOutcome;
  readonly limit?: number;
}

export interface AuditHistory {
  append(event: AuditEvent): Promise<void>;
  get(id: string): Promise<AuditEvent | undefined>;
  list(query?: AuditQuery): Promise<readonly AuditEvent[]>;
}

export class AuditHistoryError extends Error {
  readonly code: 'DUPLICATE_AUDIT_EVENT';
  readonly eventId: string;

  constructor(eventId: string) {
    super(`Audit event ${eventId} already exists`);
    this.name = 'AuditHistoryError';
    this.code = 'DUPLICATE_AUDIT_EVENT';
    this.eventId = eventId;
  }
}

export class StorageAuditHistory implements AuditHistory {
  readonly #storage: OperationalStorageAdapter;

  constructor(storage: OperationalStorageAdapter) {
    this.#storage = storage;
  }

  async append(event: AuditEvent): Promise<void> {
    validateEvent(event);
    const created = await this.#storage.create({
      key: keyFor(event.id),
      updatedAt: new Date(Date.parse(event.occurredAt)).toISOString(),
      value: eventToJson(event),
    });
    if (!created) throw new AuditHistoryError(event.id);
  }

  async get(id: string): Promise<AuditEvent | undefined> {
    const record = await this.#storage.get<JsonObject>(keyFor(id));
    return record === undefined ? undefined : eventFromRecord(record);
  }

  async list(query: AuditQuery = {}): Promise<readonly AuditEvent[]> {
    validateQuery(query);
    const events = (await this.#storage.list<JsonObject>(auditPrefix))
      .map(eventFromRecord)
      .filter(
        (event) =>
          (query.category === undefined || event.category === query.category) &&
          (query.subjectId === undefined ||
            event.subjectId === query.subjectId) &&
          (query.outcome === undefined || event.outcome === query.outcome),
      )
      .sort(
        (left, right) =>
          Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
          left.id.localeCompare(right.id),
      );
    return query.limit === undefined ? events : events.slice(0, query.limit);
  }
}

function validateEvent(event: AuditEvent): void {
  for (const [name, value] of [
    ['id', event.id],
    ['category', event.category],
    ['subjectId', event.subjectId],
  ] as const) {
    if (value.trim().length === 0)
      throw new TypeError(`Audit ${name} is empty`);
  }
  if (Number.isNaN(Date.parse(event.occurredAt))) {
    throw new TypeError('Audit occurredAt timestamp is invalid');
  }
  requireOutcome(event.outcome);
  validateJson(event.payload, 'payload');
}

function validateQuery(query: AuditQuery): void {
  if (
    query.limit !== undefined &&
    (!Number.isSafeInteger(query.limit) || query.limit <= 0)
  ) {
    throw new RangeError('Audit query limit must be a positive safe integer');
  }
}

function keyFor(id: string): string {
  if (id.trim().length === 0) throw new TypeError('Audit ID is empty');
  return `${auditPrefix}${encodeURIComponent(id)}`;
}

function eventToJson(event: AuditEvent): JsonObject {
  return {
    id: event.id,
    occurredAt: new Date(Date.parse(event.occurredAt)).toISOString(),
    category: event.category,
    subjectId: event.subjectId,
    outcome: event.outcome,
    payload: event.payload,
  };
}

function eventFromRecord(record: StorageRecord<JsonObject>): AuditEvent {
  const value = record.value;
  if (!Object.hasOwn(value, 'payload')) {
    throw new TypeError('Audit payload is missing');
  }
  const event: AuditEvent = {
    id: requireString(value.id, 'id'),
    occurredAt: requireString(value.occurredAt, 'occurredAt'),
    category: requireString(value.category, 'category'),
    subjectId: requireString(value.subjectId, 'subjectId'),
    outcome: requireOutcome(value.outcome),
    payload: value.payload!,
  };
  validateEvent(event);
  if (keyFor(event.id) !== record.key) {
    throw new TypeError('Audit key does not match event ID');
  }
  return event;
}

function requireString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== 'string')
    throw new TypeError(`Audit ${name} is invalid`);
  return value;
}

function requireOutcome(value: JsonValue | undefined): AuditOutcome {
  if (
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'uncertain' ||
    value === 'rejected' ||
    value === 'dry-run' ||
    value === 'pending'
  ) {
    return value;
  }
  throw new TypeError('Audit outcome is invalid');
}
