import { playerId, type PlayerId } from '@eggbot/core';
import { z } from 'zod';

import {
  FootballDataValidationError,
  type DepthChartSet,
  type InjuryReportSet,
  type PlayerNewsSet,
  type ProjectionSet,
  type ScheduleSet,
  type UsageSet,
} from './types.js';

const nonEmpty = z.string().trim().min(1);
const timestamp = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Expected a parseable timestamp',
  });
const provenance = {
  observedAt: timestamp,
  source: nonEmpty,
  version: nonEmpty.optional(),
};
const finiteNumber = z.number().finite();
const count = finiteNumber.int().nonnegative();
const share = finiteNumber.min(0).max(1);

const projectionSetSchema = z
  .object({
    ...provenance,
    scoringPeriod: nonEmpty,
    players: z.array(
      z
        .object({
          playerId: nonEmpty,
          points: finiteNumber,
          floor: finiteNumber.optional(),
          ceiling: finiteNumber.optional(),
        })
        .strict()
        .superRefine((projection, context) => {
          if (
            projection.floor !== undefined &&
            projection.floor > projection.points
          ) {
            context.addIssue({
              code: 'custom',
              message: 'Projection floor cannot exceed points',
              path: ['floor'],
            });
          }
          if (
            projection.ceiling !== undefined &&
            projection.ceiling < projection.points
          ) {
            context.addIssue({
              code: 'custom',
              message: 'Projection ceiling cannot be below points',
              path: ['ceiling'],
            });
          }
        }),
    ),
  })
  .strict();

const injurySetSchema = z
  .object({
    ...provenance,
    reports: z.array(
      z
        .object({
          playerId: nonEmpty,
          status: z.enum([
            'healthy',
            'questionable',
            'doubtful',
            'out',
            'injured-reserve',
            'physically-unable-to-perform',
            'suspended',
            'unknown',
          ]),
          detail: nonEmpty.optional(),
          reportedAt: timestamp.optional(),
          expectedReturn: nonEmpty.optional(),
        })
        .strict(),
    ),
  })
  .strict();

const depthChartSetSchema = z
  .object({
    ...provenance,
    entries: z.array(
      z
        .object({
          playerId: nonEmpty,
          professionalTeam: nonEmpty,
          position: nonEmpty,
          rank: finiteNumber.int().positive(),
          role: nonEmpty.optional(),
        })
        .strict(),
    ),
  })
  .strict();

const usageSetSchema = z
  .object({
    ...provenance,
    scoringPeriod: nonEmpty,
    players: z.array(
      z
        .object({
          playerId: nonEmpty,
          scoringPeriod: nonEmpty,
          window: z.enum(['scoring-period', 'season-to-date', 'rolling']),
          games: count.optional(),
          snaps: count.optional(),
          snapShare: share.optional(),
          routesRun: count.optional(),
          routeParticipation: share.optional(),
          targets: count.optional(),
          targetShare: share.optional(),
          carries: count.optional(),
          rushingAttemptShare: share.optional(),
          touches: count.optional(),
        })
        .strict(),
    ),
  })
  .strict();

const newsSetSchema = z
  .object({
    ...provenance,
    items: z.array(
      z
        .object({
          id: nonEmpty,
          playerIds: z.array(nonEmpty),
          headline: nonEmpty,
          summary: nonEmpty.optional(),
          url: z.string().url().optional(),
          publishedAt: timestamp,
        })
        .strict(),
    ),
  })
  .strict();

const scheduleSetSchema = z
  .object({
    ...provenance,
    scoringPeriod: nonEmpty,
    games: z.array(
      z
        .object({
          id: nonEmpty,
          scoringPeriod: nonEmpty,
          startsAt: timestamp,
          homeTeam: nonEmpty,
          awayTeam: nonEmpty,
          status: z.enum([
            'scheduled',
            'in-progress',
            'final',
            'postponed',
            'canceled',
          ]),
          homeScore: count.optional(),
          awayScore: count.optional(),
        })
        .strict()
        .refine((game) => game.homeTeam !== game.awayTeam, {
          message: 'Home and away teams must differ',
          path: ['awayTeam'],
        }),
    ),
  })
  .strict();

export function parseProjectionSet(value: unknown): ProjectionSet {
  return parsed('projections', 'INVALID_PROJECTION_SET', () => {
    const set = projectionSetSchema.parse(value);
    assertUnique(
      set.players.map(({ playerId: id }) => id),
      'player projection',
    );
    return {
      ...normalizeProvenance(set),
      scoringPeriod: set.scoringPeriod,
      players: set.players.map((projection) => ({
        playerId: playerId(projection.playerId),
        points: projection.points,
        ...(projection.floor === undefined ? {} : { floor: projection.floor }),
        ...(projection.ceiling === undefined
          ? {}
          : { ceiling: projection.ceiling }),
      })),
    };
  });
}

export function parseInjuryReportSet(value: unknown): InjuryReportSet {
  return parsed('injuries', 'INVALID_INJURY_REPORT_SET', () => {
    const set = injurySetSchema.parse(value);
    assertUnique(
      set.reports.map(({ playerId: id }) => id),
      'injury report',
    );
    return {
      ...normalizeProvenance(set),
      reports: set.reports.map((report) => ({
        playerId: playerId(report.playerId),
        status: report.status,
        ...(report.detail === undefined ? {} : { detail: report.detail }),
        ...(report.reportedAt === undefined
          ? {}
          : { reportedAt: report.reportedAt }),
        ...(report.expectedReturn === undefined
          ? {}
          : { expectedReturn: report.expectedReturn }),
      })),
    };
  });
}

export function parseDepthChartSet(value: unknown): DepthChartSet {
  return parsed('depth-charts', 'INVALID_DEPTH_CHART_SET', () => {
    const set = depthChartSetSchema.parse(value);
    assertUnique(
      set.entries.map(({ playerId: id }) => id),
      'depth-chart player',
    );
    return {
      ...normalizeProvenance(set),
      entries: set.entries.map((entry) => ({
        playerId: playerId(entry.playerId),
        professionalTeam: entry.professionalTeam,
        position: entry.position,
        rank: entry.rank,
        ...(entry.role === undefined ? {} : { role: entry.role }),
      })),
    };
  });
}

export function parseUsageSet(value: unknown): UsageSet {
  return parsed('usage', 'INVALID_USAGE_SET', () => {
    const set = usageSetSchema.parse(value);
    assertUnique(
      set.players.map(({ playerId: id }) => id),
      'usage player',
    );
    return {
      ...normalizeProvenance(set),
      scoringPeriod: set.scoringPeriod,
      players: set.players.map((usage) => ({
        playerId: playerId(usage.playerId),
        scoringPeriod: usage.scoringPeriod,
        window: usage.window,
        ...(usage.games === undefined ? {} : { games: usage.games }),
        ...(usage.snaps === undefined ? {} : { snaps: usage.snaps }),
        ...(usage.snapShare === undefined
          ? {}
          : { snapShare: usage.snapShare }),
        ...(usage.routesRun === undefined
          ? {}
          : { routesRun: usage.routesRun }),
        ...(usage.routeParticipation === undefined
          ? {}
          : { routeParticipation: usage.routeParticipation }),
        ...(usage.targets === undefined ? {} : { targets: usage.targets }),
        ...(usage.targetShare === undefined
          ? {}
          : { targetShare: usage.targetShare }),
        ...(usage.carries === undefined ? {} : { carries: usage.carries }),
        ...(usage.rushingAttemptShare === undefined
          ? {}
          : { rushingAttemptShare: usage.rushingAttemptShare }),
        ...(usage.touches === undefined ? {} : { touches: usage.touches }),
      })),
    };
  });
}

export function parsePlayerNewsSet(value: unknown): PlayerNewsSet {
  return parsed('news', 'INVALID_NEWS_SET', () => {
    const set = newsSetSchema.parse(value);
    assertUnique(
      set.items.map(({ id }) => id),
      'news item',
    );
    return {
      ...normalizeProvenance(set),
      items: set.items.map((item) => ({
        id: item.id,
        playerIds: unique(item.playerIds).map((id) => playerId(id)),
        headline: item.headline,
        publishedAt: item.publishedAt,
        ...(item.summary === undefined ? {} : { summary: item.summary }),
        ...(item.url === undefined ? {} : { url: item.url }),
      })),
    };
  });
}

export function parseScheduleSet(value: unknown): ScheduleSet {
  return parsed('schedule', 'INVALID_SCHEDULE_SET', () => {
    const set = scheduleSetSchema.parse(value);
    assertUnique(
      set.games.map(({ id }) => id),
      'professional game',
    );
    return {
      ...normalizeProvenance(set),
      scoringPeriod: set.scoringPeriod,
      games: set.games.map((game) => ({
        id: game.id,
        scoringPeriod: game.scoringPeriod,
        startsAt: game.startsAt,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        status: game.status,
        ...(game.homeScore === undefined ? {} : { homeScore: game.homeScore }),
        ...(game.awayScore === undefined ? {} : { awayScore: game.awayScore }),
      })),
    };
  });
}

function normalizeProvenance(value: {
  readonly observedAt: string;
  readonly source: string;
  readonly version?: string | undefined;
}) {
  return {
    observedAt: value.observedAt,
    source: value.source,
    ...(value.version === undefined ? {} : { version: value.version }),
  };
}

function parsed<Value>(
  resource: string,
  code: string,
  parse: () => Value,
): Value {
  try {
    return parse();
  } catch (cause) {
    if (cause instanceof FootballDataValidationError) throw cause;
    throw new FootballDataValidationError(
      `External football data validation failed for ${resource}`,
      { code, resource, cause },
    );
  }
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new FootballDataValidationError(`Duplicate ${label}: ${value}`, {
        code: 'DUPLICATE_FOOTBALL_DATA',
        resource: value,
      });
    }
    seen.add(value);
  }
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

export function playerIdsInNews(set: PlayerNewsSet): readonly PlayerId[] {
  return set.items.flatMap(({ playerIds }) => playerIds);
}
