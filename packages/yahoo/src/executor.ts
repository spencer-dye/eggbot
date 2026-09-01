import { createHash } from 'node:crypto';

import type {
  ActionId,
  ActionResult,
  FantasyAction,
  PlayerId,
} from '@eggbot/core';
import type {
  ExecutionOptions,
  FantasyPlatformExecutor,
  FantasyPlatformReader,
} from '@eggbot/platform';

import {
  YahooActionValidationError,
  YahooApiError,
  YahooResponseValidationError,
} from './errors.js';
import type { YahooHttpClient } from './http.js';
import {
  yahooLeagueKey,
  yahooLeagueKeyFromTeamKey,
  yahooRosterSlotReference,
  yahooTeamKey,
} from './identifiers.js';
import {
  buildYahooWriteRequest,
  type YahooWriteRequest,
} from './write-requests.js';

type ExecutedResult = Extract<ActionResult, { status: 'executed' }>;

export interface YahooExecutionRecord {
  readonly actionId: ActionId;
  readonly fingerprint: string;
  readonly result: ExecutedResult;
}

export interface YahooExecutionJournal {
  load(actionId: ActionId): Promise<YahooExecutionRecord | undefined>;
  save(record: YahooExecutionRecord): Promise<void>;
}

export class InMemoryYahooExecutionJournal implements YahooExecutionJournal {
  readonly #records = new Map<ActionId, YahooExecutionRecord>();

  load(actionId: ActionId): Promise<YahooExecutionRecord | undefined> {
    return Promise.resolve(this.#records.get(actionId));
  }

  save(record: YahooExecutionRecord): Promise<void> {
    this.#records.set(record.actionId, record);
    return Promise.resolve();
  }
}

export interface YahooFantasyExecutorOptions {
  readonly httpClient: YahooHttpClient;
  readonly reader: FantasyPlatformReader;
  /** Runtime kill switch. Execute mode is rejected unless this is true. */
  readonly allowWrites?: boolean;
  readonly journal?: YahooExecutionJournal;
}

export class YahooFantasyExecutor implements FantasyPlatformExecutor {
  readonly #http: YahooHttpClient;
  readonly #reader: FantasyPlatformReader;
  readonly #allowWrites: boolean;
  readonly #journal: YahooExecutionJournal;
  readonly #inFlight = new Map<
    ActionId,
    { fingerprint: string; promise: Promise<ActionResult> }
  >();

  constructor(options: YahooFantasyExecutorOptions) {
    this.#http = options.httpClient;
    this.#reader = options.reader;
    this.#allowWrites = options.allowWrites ?? false;
    this.#journal = options.journal ?? new InMemoryYahooExecutionJournal();
  }

  preview(action: FantasyAction): YahooWriteRequest {
    validateActionShape(action);
    return buildYahooWriteRequest(action);
  }

  async execute(
    actions: readonly FantasyAction[],
    options: ExecutionOptions,
  ): Promise<readonly ActionResult[]> {
    if (options.mode !== 'dry-run' && options.mode !== 'execute') {
      throw new RangeError('Yahoo execution mode must be dry-run or execute');
    }
    const results: ActionResult[] = [];
    for (const action of actions) {
      results.push(await this.#executeOne(action, options.mode));
    }
    return results;
  }

  async #executeOne(
    action: FantasyAction,
    mode: ExecutionOptions['mode'],
  ): Promise<ActionResult> {
    try {
      validateActionShape(action);
      const request = buildYahooWriteRequest(action);
      if (mode === 'dry-run') {
        await validateCurrentState(action, this.#reader);
        return { status: 'dry-run', action, summary: request.summary };
      }
      if (!this.#allowWrites) {
        throw new YahooActionValidationError(
          'Yahoo writes are disabled; set allowWrites only after obtaining write access',
          { code: 'WRITES_DISABLED', actionId: action.id },
        );
      }
      return await this.#executeIdempotently(request);
    } catch (error) {
      return failed(action, error);
    }
  }

  async #executeIdempotently(
    request: YahooWriteRequest,
  ): Promise<ActionResult> {
    const { action } = request;
    const fingerprint = fingerprintAction(action);
    const running = this.#inFlight.get(action.id);
    if (running !== undefined) {
      if (running.fingerprint !== fingerprint) {
        throw idempotencyConflict(action);
      }
      return running.promise;
    }

    const promise = this.#performIdempotentWrite(request, fingerprint);
    this.#inFlight.set(action.id, { fingerprint, promise });
    try {
      return await promise;
    } finally {
      this.#inFlight.delete(action.id);
    }
  }

  async #performIdempotentWrite(
    request: YahooWriteRequest,
    fingerprint: string,
  ): Promise<ActionResult> {
    const previous = await this.#journal.load(request.action.id);
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint) {
        throw idempotencyConflict(request.action);
      }
      return previous.result;
    }

    await validateCurrentState(request.action, this.#reader);

    const response = await this.#http.sendXml(
      request.method,
      request.path,
      request.body,
    );
    const result: ExecutedResult = {
      status: 'executed',
      action: request.action,
      ...(response.location === undefined
        ? {}
        : { externalReference: response.location }),
    };
    try {
      await this.#journal.save({
        actionId: request.action.id,
        fingerprint,
        result,
      });
      return result;
    } catch {
      return {
        ...result,
        warnings: [
          'Yahoo accepted the write, but the idempotency journal could not be saved',
        ],
      };
    }
  }
}

async function validateCurrentState(
  action: FantasyAction,
  reader: FantasyPlatformReader,
): Promise<void> {
  const leagueKey = yahooLeagueKey(action.leagueId);
  const teamKey = yahooTeamKey(action.teamId);
  if (yahooLeagueKeyFromTeamKey(teamKey) !== leagueKey) {
    invalid(
      action,
      'ACTION_RESOURCE_MISMATCH',
      'Team does not belong to league',
    );
  }
  const roster = await reader.getRoster(action.teamId);
  const rostered = new Set(roster.entries.map(({ player }) => player.id));

  if (action.type !== 'set-lineup') {
    if (rostered.has(action.addPlayerId)) {
      invalid(
        action,
        'PLAYER_ALREADY_ROSTERED',
        'Added player is already rostered',
      );
    }
    if (
      action.dropPlayerId !== undefined &&
      !rostered.has(action.dropPlayerId)
    ) {
      invalid(
        action,
        'DROP_PLAYER_NOT_ROSTERED',
        'Dropped player is not rostered',
      );
    }
    return;
  }

  const league = await reader.getLeague(action.leagueId);
  const slots = new Map(
    league.settings.rosterSlots.map((slot) => [slot.id, slot]),
  );
  const players = new Map(
    roster.entries.map(({ player }) => [player.id, player]),
  );
  for (const assignment of action.assignments) {
    const slot = slots.get(assignment.slotId);
    const player = players.get(assignment.playerId);
    if (slot === undefined) {
      invalid(
        action,
        'UNKNOWN_ROSTER_SLOT',
        'Lineup roster slot does not exist',
      );
    }
    if (player === undefined) {
      invalid(action, 'PLAYER_NOT_ROSTERED', 'Lineup player is not rostered');
    }
    if (
      slot.kind === 'active' &&
      !slot.eligiblePositions.some((position) =>
        player.eligiblePositions.includes(position),
      )
    ) {
      invalid(
        action,
        'PLAYER_INELIGIBLE_FOR_SLOT',
        `${player.fullName} is not eligible for ${slot.name}`,
      );
    }
  }
}

function validateActionShape(action: FantasyAction): void {
  if (typeof action.id !== 'string' || action.id.trim().length === 0) {
    invalid(action, 'INVALID_ACTION', 'Action id is required');
  }
  if (action.type === 'set-lineup') {
    const week = Number(action.scoringPeriod);
    if (!Number.isSafeInteger(week) || week < 1) {
      invalid(
        action,
        'INVALID_SCORING_PERIOD',
        'Yahoo week must be a positive integer',
      );
    }
    if (action.assignments.length === 0) {
      invalid(
        action,
        'EMPTY_LINEUP',
        'At least one lineup assignment is required',
      );
    }
    ensureUnique(
      action,
      action.assignments.map(({ playerId }) => playerId),
      'DUPLICATE_LINEUP_PLAYER',
    );
    ensureUnique(
      action,
      action.assignments.map(({ slotId }) => slotId),
      'DUPLICATE_LINEUP_SLOT',
    );
    for (const assignment of action.assignments) {
      yahooRosterSlotReference(assignment.slotId);
    }
    return;
  }
  if (
    action.dropPlayerId !== undefined &&
    action.addPlayerId === action.dropPlayerId
  ) {
    invalid(action, 'SAME_ADD_DROP_PLAYER', 'Add and drop players must differ');
  }
  if (
    action.type === 'waiver-claim' &&
    action.bid !== undefined &&
    (!Number.isSafeInteger(action.bid) || action.bid < 0)
  ) {
    invalid(
      action,
      'INVALID_FAAB_BID',
      'FAAB bid must be a non-negative integer',
    );
  }
}

function ensureUnique(
  action: FantasyAction,
  values: readonly (PlayerId | string)[],
  code: string,
): void {
  if (new Set(values).size !== values.length) {
    invalid(action, code, 'Lineup assignments must be unique');
  }
}

function invalid(action: FantasyAction, code: string, message: string): never {
  throw new YahooActionValidationError(message, { code, actionId: action.id });
}

function idempotencyConflict(
  action: FantasyAction,
): YahooActionValidationError {
  return new YahooActionValidationError(
    'Action id was already used for a different action payload',
    { code: 'IDEMPOTENCY_CONFLICT', actionId: action.id },
  );
}

function fingerprintAction(action: FantasyAction): string {
  return createHash('sha256').update(canonicalJson(action)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function failed(action: FantasyAction, error: unknown): ActionResult {
  const known =
    error instanceof YahooActionValidationError ||
    error instanceof YahooApiError ||
    error instanceof YahooResponseValidationError;
  const status = error instanceof YahooApiError ? error.status : undefined;
  return {
    status: 'failed',
    action,
    error: {
      code:
        error instanceof YahooActionValidationError ||
        error instanceof YahooApiError
          ? error.code
          : error instanceof YahooResponseValidationError
            ? 'INVALID_YAHOO_RESPONSE'
            : 'YAHOO_EXECUTION_FAILED',
      message: known ? error.message : 'Unexpected Yahoo execution failure',
      retryable:
        error instanceof YahooApiError &&
        (error.code === 'API_TRANSPORT_ERROR' ||
          status === 408 ||
          status === 429 ||
          (status !== undefined && status >= 500)),
    },
  };
}
