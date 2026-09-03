import type { AuditHistory, AuditOutcome } from './audit-history.js';
import type { JsonValue } from './index.js';

export interface AuditedOperation<Value> {
  /** Stable logical operation ID shared across recovery attempts. */
  readonly operationId: string;
  /** Unique ID for this at-least-once attempt. */
  readonly attemptId: string;
  readonly category: string;
  readonly subjectId: string;
  readonly startedPayload?: JsonValue;
  run(): Promise<Value>;
  serializeResult(value: Value): JsonValue;
  classifyOutcome(value: Value): AuditOutcome;
}

export interface AuditedOperationRunnerOptions {
  readonly history: AuditHistory;
  readonly clock?: () => Date;
}

export class OperationalAuditError extends Error {
  readonly stage: 'start' | 'terminal-after-success' | 'terminal-after-failure';
  readonly operationStarted: boolean;
  readonly operationCompleted: boolean;
  readonly operationResult: unknown;
  readonly operationError: unknown;

  constructor(
    message: string,
    options: {
      stage: OperationalAuditError['stage'];
      operationStarted: boolean;
      operationCompleted: boolean;
      operationResult?: unknown;
      operationError?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'OperationalAuditError';
    this.stage = options.stage;
    this.operationStarted = options.operationStarted;
    this.operationCompleted = options.operationCompleted;
    this.operationResult = options.operationResult;
    this.operationError = options.operationError;
  }
}

/** Requires durable start and terminal audit events around an operation. */
export class AuditedOperationRunner {
  readonly #history: AuditHistory;
  readonly #clock: () => Date;

  constructor(options: AuditedOperationRunnerOptions) {
    this.#history = options.history;
    this.#clock = options.clock ?? (() => new Date());
  }

  async run<Value>(operation: AuditedOperation<Value>): Promise<Value> {
    validateIdentity(operation);
    try {
      await this.#history.append({
        id: `${operation.attemptId}:started`,
        occurredAt: this.#timestamp(),
        category: operation.category,
        subjectId: operation.subjectId,
        outcome: 'pending',
        payload: {
          operationId: operation.operationId,
          attemptId: operation.attemptId,
          detail: operation.startedPayload ?? null,
        },
      });
    } catch (error) {
      throw new OperationalAuditError(
        'Operation was not started because its audit record was not durable',
        {
          stage: 'start',
          operationStarted: false,
          operationCompleted: false,
          cause: error,
        },
      );
    }

    let result: Value;
    try {
      result = await operation.run();
    } catch (operationError) {
      try {
        await this.#history.append({
          id: `${operation.attemptId}:terminal`,
          occurredAt: this.#timestamp(),
          category: operation.category,
          subjectId: operation.subjectId,
          outcome: 'failed',
          payload: {
            operationId: operation.operationId,
            attemptId: operation.attemptId,
            error: errorJson(operationError),
          },
        });
      } catch (auditError) {
        throw new OperationalAuditError(
          'Operation failed and its terminal audit record was not durable',
          {
            stage: 'terminal-after-failure',
            operationStarted: true,
            operationCompleted: false,
            operationError,
            cause: auditError,
          },
        );
      }
      throw operationError;
    }

    try {
      await this.#history.append({
        id: `${operation.attemptId}:terminal`,
        occurredAt: this.#timestamp(),
        category: operation.category,
        subjectId: operation.subjectId,
        outcome: operation.classifyOutcome(result),
        payload: {
          operationId: operation.operationId,
          attemptId: operation.attemptId,
          result: operation.serializeResult(result),
        },
      });
    } catch (error) {
      throw new OperationalAuditError(
        'Operation completed but its terminal audit record was not durable',
        {
          stage: 'terminal-after-success',
          operationStarted: true,
          operationCompleted: true,
          operationResult: result,
          cause: error,
        },
      );
    }
    return result;
  }

  #timestamp(): string {
    const value = this.#clock();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new TypeError('Audit clock returned an invalid date');
    }
    return value.toISOString();
  }
}

function validateIdentity(operation: {
  readonly operationId: string;
  readonly attemptId: string;
  readonly category: string;
  readonly subjectId: string;
}): void {
  for (const [name, value] of [
    ['operationId', operation.operationId],
    ['attemptId', operation.attemptId],
    ['category', operation.category],
    ['subjectId', operation.subjectId],
  ] as const) {
    if (value.trim().length === 0) throw new TypeError(`${name} is empty`);
  }
}

function errorJson(error: unknown): JsonValue {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: String(error) };
}
