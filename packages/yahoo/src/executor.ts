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
import {
  YahooPlayerAvailabilityClient,
  type YahooPlayerAvailabilityReader,
} from './availability.js';
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
import { extractYahooTransactionReference } from './write-response.js';

type ExecutedResult = Extract<ActionResult, { status: 'executed' }>;
type FailedResult = Extract<ActionResult, { status: 'failed' }>;

interface YahooExecutionRecordBase {
  readonly actionId: ActionId;
  readonly fingerprint: string;
}

export type YahooExecutionRecord =
  | (YahooExecutionRecordBase & { readonly state: 'pending' })
  | (YahooExecutionRecordBase & {
      readonly state: 'executed';
      readonly result: ExecutedResult;
    })
  | (YahooExecutionRecordBase & {
      readonly state: 'failed';
      readonly result: FailedResult;
    });

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
  readonly availabilityReader?: YahooPlayerAvailabilityReader;
}

export class YahooFantasyExecutor implements FantasyPlatformExecutor {
  readonly #http: YahooHttpClient;
  readonly #reader: FantasyPlatformReader;
  readonly #allowWrites: boolean;
  readonly #journal: YahooExecutionJournal;
  readonly #availability: YahooPlayerAvailabilityReader;
  readonly #poisoned = new Map<
    ActionId,
    { fingerprint: string; result: ActionResult }
  >();
  readonly #inFlight = new Map<
    ActionId,
    { fingerprint: string; promise: Promise<ActionResult> }
  >();

  constructor(options: YahooFantasyExecutorOptions) {
    this.#http = options.httpClient;
    this.#reader = options.reader;
    this.#allowWrites = options.allowWrites ?? false;
    this.#journal = options.journal ?? new InMemoryYahooExecutionJournal();
    this.#availability =
      options.availabilityReader ??
      new YahooPlayerAvailabilityClient(options.httpClient);
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
        await validateCurrentState(action, this.#reader, this.#availability);
        return {
          status: 'dry-run',
          action,
          summary: request.summary,
          validation: 'local',
          warnings: [
            'Yahoo remains authoritative for locks, acquisition limits, roster legality, waiver rules, and FAAB balance',
          ],
        };
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
    const poisoned = this.#poisoned.get(action.id);
    if (poisoned !== undefined) {
      if (poisoned.fingerprint !== fingerprint) {
        throw idempotencyConflict(action);
      }
      return poisoned.result;
    }
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
      if (previous.state === 'executed' || previous.state === 'failed') {
        return previous.result;
      }
      return this.#poison(
        request.action,
        fingerprint,
        'JOURNAL_OUTCOME_PENDING',
        'A prior execution attempt has no durable outcome; reconcile with Yahoo before retrying',
      );
    }

    await validateCurrentState(
      request.action,
      this.#reader,
      this.#availability,
    );

    try {
      await this.#journal.save({
        state: 'pending',
        actionId: request.action.id,
        fingerprint,
      });
    } catch (error) {
      throw new YahooActionValidationError(
        'Execution journal could not durably record intent; Yahoo was not called',
        {
          code: 'JOURNAL_PREPARE_FAILED',
          actionId: request.action.id,
          cause: error,
        },
      );
    }

    let response;
    try {
      response = await this.#http.sendXml(
        request.method,
        request.path,
        request.body,
      );
    } catch (error) {
      if (request.method === 'POST' && isAmbiguousWriteFailure(error)) {
        return this.#poison(
          request.action,
          fingerprint,
          'YAHOO_POST_OUTCOME_UNKNOWN',
          'Yahoo may have accepted the transaction; reconcile before retrying',
        );
      }
      const result = failed(request.action, error);
      if (result.status !== 'failed') return result;
      try {
        await this.#journal.save({
          state: 'failed',
          actionId: request.action.id,
          fingerprint,
          result,
        });
      } catch {
        // Yahoo definitively rejected this request; a journal failure cannot
        // turn that rejection into a successful mutation.
      }
      return result;
    }
    const externalReference =
      request.method === 'POST'
        ? extractYahooTransactionReference(response.body, response.location)
        : response.location;
    const result: ExecutedResult = {
      status: 'executed',
      action: request.action,
      ...(externalReference === undefined ? {} : { externalReference }),
    };
    try {
      await this.#journal.save({
        state: 'executed',
        actionId: request.action.id,
        fingerprint,
        result,
      });
      return result;
    } catch {
      return this.#poison(
        request.action,
        fingerprint,
        'JOURNAL_COMMIT_FAILED',
        'Yahoo accepted the write, but its result was not durably recorded; reconcile before retrying',
        externalReference,
      );
    }
  }

  #poison(
    action: FantasyAction,
    fingerprint: string,
    code: string,
    message: string,
    externalReference?: string,
  ): ActionResult {
    const result: ActionResult = {
      status: 'execution-uncertain',
      action,
      ...(externalReference === undefined ? {} : { externalReference }),
      error: { code, message, retryable: false },
    };
    this.#poisoned.set(action.id, { fingerprint, result });
    return result;
  }
}

async function validateCurrentState(
  action: FantasyAction,
  reader: FantasyPlatformReader,
  availabilityReader: YahooPlayerAvailabilityReader,
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
    const addPlayerId = addedPlayerId(action);
    const dropPlayerId = droppedPlayerId(action);
    if (addPlayerId !== undefined && rostered.has(addPlayerId)) {
      invalid(
        action,
        'PLAYER_ALREADY_ROSTERED',
        'Added player is already rostered',
      );
    }
    if (dropPlayerId !== undefined && !rostered.has(dropPlayerId)) {
      invalid(
        action,
        'DROP_PLAYER_NOT_ROSTERED',
        'Dropped player is not rostered',
      );
    }
    if (addPlayerId !== undefined) {
      const availability = await availabilityReader.getPlayerAvailability(
        action.leagueId,
        addPlayerId,
      );
      const expected =
        action.type === 'waiver-claim' ? 'waivers' : 'free-agent';
      if (availability !== expected) {
        invalid(
          action,
          'PLAYER_AVAILABILITY_MISMATCH',
          `${action.type} requires a ${expected} target, but Yahoo reports ${availability}`,
        );
      }
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

  const current = await reader.getLineup(action.teamId, action.scoringPeriod);
  const movedPlayers = new Set(
    action.assignments.map(({ playerId }) => playerId),
  );
  const resultingSlots = new Map(
    current.assignments
      .filter(({ playerId }) => !movedPlayers.has(playerId))
      .map(({ slotId, playerId }) => [slotId, playerId]),
  );
  for (const assignment of action.assignments) {
    if (resultingSlots.has(assignment.slotId)) {
      invalid(
        action,
        'LINEUP_SLOT_OCCUPIED',
        'A proposed slot remains occupied by an untouched player',
      );
    }
    resultingSlots.set(assignment.slotId, assignment.playerId);
  }
  const emptyActiveSlot = league.settings.rosterSlots.find(
    (slot) => slot.kind === 'active' && !resultingSlots.has(slot.id),
  );
  if (emptyActiveSlot !== undefined) {
    invalid(
      action,
      'INCOMPLETE_STARTING_LINEUP',
      `Resulting lineup leaves ${emptyActiveSlot.name} empty`,
    );
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
  const addPlayerId = addedPlayerId(action);
  const dropPlayerId = droppedPlayerId(action);
  if (addPlayerId !== undefined && addPlayerId === dropPlayerId) {
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

function addedPlayerId(
  action: Exclude<FantasyAction, { type: 'set-lineup' }>,
): PlayerId | undefined {
  if (action.type === 'add-player') return action.playerId;
  if (action.type === 'drop-player') return undefined;
  return action.addPlayerId;
}

function droppedPlayerId(
  action: Exclude<FantasyAction, { type: 'set-lineup' }>,
): PlayerId | undefined {
  if (action.type === 'drop-player') return action.playerId;
  if (action.type === 'add-player') return undefined;
  return action.dropPlayerId;
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

function isAmbiguousWriteFailure(error: unknown): boolean {
  if (!(error instanceof YahooApiError)) return false;
  return (
    error.code === 'API_TRANSPORT_ERROR' ||
    error.status === 408 ||
    error.status === 429 ||
    (error.status !== undefined && error.status >= 500)
  );
}
