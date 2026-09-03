import { playerId } from '@eggbot/core';

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
  type FootballDataRequest,
  type FootballIntelligenceSnapshot,
} from './types.js';

export interface FootballIntelligenceServiceOptions {
  readonly provider: FootballDataProvider;
  readonly clock?: () => Date;
}

export class FootballIntelligenceService {
  readonly #provider: FootballDataProvider;
  readonly #clock: () => Date;

  constructor(options: FootballIntelligenceServiceOptions) {
    validateDescriptor(options.provider.id, 'provider.id');
    validateDescriptor(options.provider.version, 'provider.version');
    this.#provider = options.provider;
    this.#clock = options.clock ?? (() => new Date());
  }

  async capture(
    request: FootballDataRequest,
  ): Promise<FootballIntelligenceSnapshot> {
    const normalizedRequest = validateRequest(request);
    const captureStartedAt = this.#timestamp('captureStartedAt');
    const [
      injuriesValue,
      projectionsValue,
      depthChartsValue,
      usageValue,
      newsValue,
      scheduleValue,
    ] = await Promise.all([
      this.#provider.getInjuries(normalizedRequest),
      this.#provider.getProjections(normalizedRequest),
      this.#provider.getDepthCharts(normalizedRequest),
      this.#provider.getUsage(normalizedRequest),
      this.#provider.getNews(normalizedRequest),
      this.#provider.getSchedule(normalizedRequest),
    ]);
    const injuries = parseInjuryReportSet(injuriesValue);
    const projections = parseProjectionSet(projectionsValue);
    const depthCharts = parseDepthChartSet(depthChartsValue);
    const usage = parseUsageSet(usageValue);
    const news = parsePlayerNewsSet(newsValue);
    const schedule = parseScheduleSet(scheduleValue);

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

    const capturedAt = this.#timestamp('capturedAt');
    if (Date.parse(capturedAt) < Date.parse(captureStartedAt)) {
      invalid('INVALID_CAPTURE_WINDOW', `${captureStartedAt}:${capturedAt}`);
    }
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

  #timestamp(resource: string): string {
    const value = this.#clock();
    if (Number.isNaN(value.getTime())) invalid('INVALID_CLOCK_VALUE', resource);
    return value.toISOString();
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
