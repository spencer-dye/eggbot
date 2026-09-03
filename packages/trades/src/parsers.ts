import { leagueId, playerId, teamId } from '@eggbot/core';
import { z } from 'zod';

import {
  TradeValidationError,
  type TradeScenario,
  type TradeValuationSet,
  type TradeValueHorizon,
} from './types.js';

const nonEmpty = z.string().trim().min(1);
const timestamp = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Expected a parseable timestamp',
  });
const season = z.number().finite().int().positive();
const horizonSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rest-of-season'), season }).strict(),
  z.object({ kind: z.literal('dynasty'), asOfSeason: season }).strict(),
  z.object({ kind: z.literal('custom'), label: nonEmpty }).strict(),
]);

const scenarioSchema = z
  .object({
    leagueId: nonEmpty,
    transfers: z
      .array(
        z
          .object({
            playerId: nonEmpty,
            fromTeamId: nonEmpty,
            toTeamId: nonEmpty,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const valuationSetSchema = z
  .object({
    leagueId: nonEmpty,
    observedAt: timestamp,
    source: nonEmpty,
    version: nonEmpty.optional(),
    unit: nonEmpty,
    horizon: horizonSchema,
    players: z.array(
      z
        .object({
          playerId: nonEmpty,
          value: z.number().finite().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

export function parseTradeScenario(value: unknown): TradeScenario {
  return parsed('scenario', 'INVALID_TRADE_SCENARIO', () => {
    const scenario = scenarioSchema.parse(value);
    const transfers = scenario.transfers.map((transfer) => ({
      playerId: playerId(transfer.playerId),
      fromTeamId: teamId(transfer.fromTeamId),
      toTeamId: teamId(transfer.toTeamId),
    }));
    assertUnique(
      transfers.map(({ playerId: id }) => id),
      'DUPLICATE_TRADED_PLAYER',
    );
    for (const transfer of transfers) {
      if (transfer.fromTeamId === transfer.toTeamId) {
        invalid('SAME_TEAM_TRANSFER', transfer.playerId);
      }
    }
    return { leagueId: leagueId(scenario.leagueId), transfers };
  });
}

export function parseTradeValuationSet(value: unknown): TradeValuationSet {
  return parsed('valuations', 'INVALID_TRADE_VALUATION_SET', () => {
    const valuations = valuationSetSchema.parse(value);
    assertUnique(
      valuations.players.map(({ playerId: id }) => id),
      'DUPLICATE_TRADE_VALUATION',
    );
    return {
      leagueId: leagueId(valuations.leagueId),
      observedAt: valuations.observedAt,
      source: valuations.source,
      ...(valuations.version === undefined
        ? {}
        : { version: valuations.version }),
      unit: valuations.unit,
      horizon: normalizeHorizon(valuations.horizon),
      players: valuations.players.map((valuation) => ({
        playerId: playerId(valuation.playerId),
        value: valuation.value,
      })),
    };
  });
}

function normalizeHorizon(
  horizon: z.infer<typeof horizonSchema>,
): TradeValueHorizon {
  switch (horizon.kind) {
    case 'rest-of-season':
      return { kind: horizon.kind, season: horizon.season };
    case 'dynasty':
      return { kind: horizon.kind, asOfSeason: horizon.asOfSeason };
    case 'custom':
      return { kind: horizon.kind, label: horizon.label };
  }
}

function parsed<Value>(
  resource: string,
  code: string,
  parse: () => Value,
): Value {
  try {
    return parse();
  } catch (cause) {
    if (cause instanceof TradeValidationError) throw cause;
    throw new TradeValidationError(
      `Trade input validation failed for ${resource}`,
      {
        code,
        resource,
        cause,
      },
    );
  }
}

function assertUnique(values: readonly string[], code: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) invalid(code, value);
    seen.add(value);
  }
}

function invalid(code: string, resource: string): never {
  throw new TradeValidationError(`Trade validation failed for ${resource}`, {
    code,
    resource,
  });
}
