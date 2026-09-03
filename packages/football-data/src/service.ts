import { playerId, type PlayerId } from '@eggbot/core';

import {
  parseDepthChartSet,
  parseInjuryReportSet,
  parsePlayerNewsSet,
  parseProjectionSet,
  parseScheduleSet,
  parseUsageSet,
  playerIdsInNews,
} from './parsers.js';
import {
  FootballDataValidationError,
  type FootballDataProvider,
  type FootballDataProviderRequest,
  type FootballDataRequest,
  type FootballIntelligenceSnapshot,
  type ExternalPlayerReference,
  type PlayerIdentityResolver,
} from './types.js';

export interface FootballIntelligenceServiceOptions {
  readonly provider: FootballDataProvider;
  readonly identityResolver: PlayerIdentityResolver;
  /** Explicit provider-clock tolerance; defaults to no future skew. */
  readonly maxFutureSkewMs?: number;
  readonly clock?: () => Date;
}

export class FootballIntelligenceService {
  readonly #provider: FootballDataProvider;
  readonly #identityResolver: PlayerIdentityResolver;
  readonly #maxFutureSkewMs: number;
  readonly #clock: () => Date;

  constructor(options: FootballIntelligenceServiceOptions) {
    validateDescriptor(options.provider.id, 'provider.id');
    validateDescriptor(options.provider.version, 'provider.version');
    if (
      options.maxFutureSkewMs !== undefined &&
      (!Number.isFinite(options.maxFutureSkewMs) || options.maxFutureSkewMs < 0)
    ) {
      invalid('INVALID_FUTURE_SKEW', String(options.maxFutureSkewMs));
    }
    this.#provider = options.provider;
    this.#identityResolver = options.identityResolver;
    this.#maxFutureSkewMs = options.maxFutureSkewMs ?? 0;
    this.#clock = options.clock ?? (() => new Date());
  }

  async capture(
    request: FootballDataRequest,
  ): Promise<FootballIntelligenceSnapshot> {
    const normalizedRequest = validateRequest(request);
    const captureStartedAt = this.#timestamp('captureStartedAt');
    const providerRequest = await this.#resolveIdentities(normalizedRequest);
    const [
      injuriesValue,
      projectionsValue,
      depthChartsValue,
      usageValue,
      newsValue,
      scheduleValue,
    ] = await Promise.all([
      this.#provider.getInjuries(providerRequest),
      this.#provider.getProjections(providerRequest),
      this.#provider.getDepthCharts(providerRequest),
      this.#provider.getUsage(providerRequest),
      this.#provider.getNews(providerRequest),
      this.#provider.getSchedule(providerRequest),
    ]);
    const injuries = parseInjuryReportSet(injuriesValue);
    const projections = parseProjectionSet(projectionsValue);
    const depthCharts = parseDepthChartSet(depthChartsValue);
    const usage = parseUsageSet(usageValue);
    const news = parsePlayerNewsSet(newsValue);
    const schedule = parseScheduleSet(scheduleValue);
    const capturedAt = this.#timestamp('capturedAt');
    if (Date.parse(capturedAt) < Date.parse(captureStartedAt)) {
      invalid('INVALID_CAPTURE_WINDOW', `${captureStartedAt}:${capturedAt}`);
    }

    validatePeriod(
      normalizedRequest.scoringPeriod,
      'projections',
      projections.scoringPeriod,
    );
    validatePeriod(
      normalizedRequest.scoringPeriod,
      'usage',
      usage.scoringPeriod,
    );
    validatePeriod(
      normalizedRequest.scoringPeriod,
      'schedule',
      schedule.scoringPeriod,
    );
    for (const player of usage.players) {
      validatePeriod(
        normalizedRequest.scoringPeriod,
        `usage:${player.playerId}`,
        player.scoringPeriod,
      );
    }
    for (const game of schedule.games) {
      validatePeriod(
        normalizedRequest.scoringPeriod,
        `schedule:${game.id}`,
        game.scoringPeriod,
      );
    }
    validatePlayerScope(normalizedRequest, [
      ...injuries.reports.map(({ playerId: id }) => id),
      ...projections.players.map(({ playerId: id }) => id),
      ...depthCharts.entries.map(({ playerId: id }) => id),
      ...usage.players.map(({ playerId: id }) => id),
      ...playerIdsInNews(news),
    ]);
    validateTeamScope(
      normalizedRequest,
      depthCharts.entries.map(({ professionalTeam }) => professionalTeam),
      schedule.games,
    );
    validateTemporalCoherence(
      capturedAt,
      this.#maxFutureSkewMs,
      injuries,
      projections,
      depthCharts,
      usage,
      news,
      schedule,
    );
    return {
      captureStartedAt,
      capturedAt,
      consistency: 'best-effort',
      scoringPeriod: normalizedRequest.scoringPeriod,
      provider: { id: this.#provider.id, version: this.#provider.version },
      injuries,
      projections,
      depthCharts,
      usage,
      news,
      schedule,
    };
  }

  async #resolveIdentities(
    request: FootballDataRequest,
  ): Promise<FootballDataProviderRequest> {
    if (request.playerIds === undefined) {
      return {
        scoringPeriod: request.scoringPeriod,
        ...(request.professionalTeams === undefined
          ? {}
          : { professionalTeams: request.professionalTeams }),
      };
    }
    const resolved = await this.#identityResolver.resolve(
      request.playerIds,
      this.#provider.id,
    );
    const players = validateResolvedIdentities(
      request.playerIds,
      this.#provider.id,
      resolved,
    );
    return {
      scoringPeriod: request.scoringPeriod,
      players,
      ...(request.professionalTeams === undefined
        ? {}
        : { professionalTeams: request.professionalTeams }),
    };
  }

  #timestamp(resource: string): string {
    const value = this.#clock();
    if (Number.isNaN(value.getTime())) invalid('INVALID_CLOCK_VALUE', resource);
    return value.toISOString();
  }
}

function validateResolvedIdentities(
  requestedPlayerIds: readonly PlayerId[],
  provider: string,
  value: unknown,
): readonly ExternalPlayerReference[] {
  if (!Array.isArray(value)) invalid('INVALID_IDENTITY_RESOLUTION', provider);
  const requested = new Set<string>(requestedPlayerIds);
  const seenPlayers = new Set<string>();
  const seenExternal = new Set<string>();
  const resolved = value.map((candidate, index) => {
    if (typeof candidate !== 'object' || candidate === null) {
      invalid('INVALID_IDENTITY_RESOLUTION', `${provider}:${index}`);
    }
    const record = candidate as Record<string, unknown>;
    const reference = record.reference;
    if (typeof reference !== 'object' || reference === null) {
      invalid('INVALID_IDENTITY_RESOLUTION', `${provider}:${index}:reference`);
    }
    const referenceRecord = reference as Record<string, unknown>;
    const resolvedPlayerId = parseResolvedPlayerId(record.playerId, provider);
    if (!requested.has(resolvedPlayerId)) {
      invalid('IDENTITY_OUTSIDE_REQUEST_SCOPE', resolvedPlayerId);
    }
    if (seenPlayers.has(resolvedPlayerId)) {
      invalid('DUPLICATE_RESOLVED_PLAYER', resolvedPlayerId);
    }
    if (referenceRecord.provider !== provider) {
      invalid('IDENTITY_PROVIDER_MISMATCH', resolvedPlayerId);
    }
    if (
      typeof referenceRecord.value !== 'string' ||
      referenceRecord.value.trim().length === 0
    ) {
      invalid('INVALID_EXTERNAL_PLAYER_ID', resolvedPlayerId);
    }
    const externalValue = referenceRecord.value.trim();
    if (seenExternal.has(externalValue)) {
      invalid('AMBIGUOUS_EXTERNAL_PLAYER_ID', externalValue);
    }
    seenPlayers.add(resolvedPlayerId);
    seenExternal.add(externalValue);
    return {
      playerId: resolvedPlayerId,
      reference: { provider, value: externalValue },
    };
  });
  if (seenPlayers.size !== requested.size) {
    const missing = requestedPlayerIds.find((id) => !seenPlayers.has(id));
    invalid('IDENTITY_RESOLUTION_INCOMPLETE', missing ?? provider);
  }
  return resolved;
}

function parseResolvedPlayerId(value: unknown, resource: string): PlayerId {
  try {
    return playerId(value);
  } catch (cause) {
    throw new FootballDataValidationError(
      `Football intelligence identity validation failed for ${resource}`,
      { code: 'INVALID_RESOLVED_PLAYER_ID', resource, cause },
    );
  }
}

function validateRequest(request: FootballDataRequest): FootballDataRequest {
  validateDescriptor(request.scoringPeriod, 'scoringPeriod');
  const playerIds = request.playerIds?.map((id) => playerId(id));
  const professionalTeams = request.professionalTeams?.map((team) => {
    validateDescriptor(team, 'professionalTeam');
    return team;
  });
  assertUnique(playerIds ?? [], 'request player');
  assertUnique(professionalTeams ?? [], 'request professional team');
  return {
    scoringPeriod: request.scoringPeriod,
    ...(playerIds === undefined ? {} : { playerIds }),
    ...(professionalTeams === undefined ? {} : { professionalTeams }),
  };
}

function validatePeriod(
  expected: string,
  resource: string,
  actual: string,
): void {
  if (actual !== expected) {
    invalid(
      'FOOTBALL_DATA_PERIOD_MISMATCH',
      `${resource}:${actual}:${expected}`,
    );
  }
}

function validateTemporalCoherence(
  capturedAt: string,
  maxFutureSkewMs: number,
  injuries: FootballIntelligenceSnapshot['injuries'],
  projections: FootballIntelligenceSnapshot['projections'],
  depthCharts: FootballIntelligenceSnapshot['depthCharts'],
  usage: FootballIntelligenceSnapshot['usage'],
  news: FootballIntelligenceSnapshot['news'],
  schedule: FootballIntelligenceSnapshot['schedule'],
): void {
  const latestAllowed = Date.parse(capturedAt) + maxFutureSkewMs;
  const timestamps: Array<readonly [resource: string, value: string]> = [
    ['injuries.observedAt', injuries.observedAt],
    ['projections.observedAt', projections.observedAt],
    ['depthCharts.observedAt', depthCharts.observedAt],
    ['usage.observedAt', usage.observedAt],
    ['news.observedAt', news.observedAt],
    ['schedule.observedAt', schedule.observedAt],
    ...injuries.reports.flatMap((report): Array<readonly [string, string]> =>
      report.reportedAt === undefined
        ? []
        : [[`injuries:${report.playerId}.reportedAt`, report.reportedAt]],
    ),
    ...news.items.map((item): readonly [string, string] => [
      `news:${item.id}.publishedAt`,
      item.publishedAt,
    ]),
  ];
  for (const [resource, value] of timestamps) {
    if (Date.parse(value) > latestAllowed) {
      invalid('FUTURE_FOOTBALL_DATA_TIMESTAMP', resource);
    }
  }
}

function validatePlayerScope(
  request: FootballDataRequest,
  observed: readonly string[],
): void {
  if (request.playerIds === undefined) return;
  const requested = new Set<string>(request.playerIds);
  for (const id of observed) {
    if (!requested.has(id)) invalid('PLAYER_OUTSIDE_REQUEST_SCOPE', id);
  }
}

function validateTeamScope(
  request: FootballDataRequest,
  depthChartTeams: readonly string[],
  games: readonly {
    readonly id: string;
    readonly homeTeam: string;
    readonly awayTeam: string;
  }[],
): void {
  if (request.professionalTeams === undefined) return;
  const requested = new Set(request.professionalTeams);
  for (const team of depthChartTeams) {
    if (!requested.has(team)) invalid('TEAM_OUTSIDE_REQUEST_SCOPE', team);
  }
  for (const game of games) {
    if (!requested.has(game.homeTeam) && !requested.has(game.awayTeam)) {
      invalid('GAME_OUTSIDE_REQUEST_SCOPE', game.id);
    }
  }
}

function validateDescriptor(value: string, resource: string): void {
  if (value.trim().length === 0)
    invalid('INVALID_FOOTBALL_DATA_DESCRIPTOR', resource);
}

function assertUnique(values: readonly string[], resource: string): void {
  if (new Set(values).size !== values.length) {
    invalid('DUPLICATE_REQUEST_RESOURCE', resource);
  }
}

function invalid(code: string, resource: string): never {
  throw new FootballDataValidationError(
    `Football intelligence validation failed for ${resource}`,
    { code, resource },
  );
}
