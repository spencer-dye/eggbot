import type {
  League,
  Lineup,
  Matchup,
  Player,
  Position,
  Roster,
  RosterSlot,
  ScoringRule,
  Standing,
  Team,
  Transaction,
  TransactionMove,
} from '@eggbot/core';
import type { FantasyGame, LeagueSummary } from '@eggbot/platform';
import { z } from 'zod';

import { YahooResponseValidationError } from './errors.js';
import {
  yahooLeagueId,
  yahooLeagueKeyFromTeamKey,
  yahooPlayerId,
  yahooRosterSlotId,
  yahooTeamId,
  yahooTransactionId,
} from './identifiers.js';
import {
  findFirstValue,
  findResources,
  findStringValues,
  parseResource,
  toRecord,
} from './yahoo-json.js';

const gameSchema = z.object({
  game_key: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  season: z.coerce.number().int().positive(),
});

const leagueSummarySchema = z.object({
  league_key: z.string().min(1),
  name: z.string().min(1),
  season: z.coerce.number().int().positive(),
});

const leagueSchema = leagueSummarySchema.extend({
  num_teams: z.coerce.number().int().positive().optional(),
  settings: z.unknown(),
});

const teamSchema = z.object({
  team_key: z.string().min(1),
  name: z.string().min(1),
});

const playerSchema = z.object({
  player_key: z.string().min(1),
  name: z.union([z.string().min(1), z.object({ full: z.string().min(1) })]),
  editorial_team_abbr: z.string().min(1).optional(),
  eligible_positions: z.unknown().optional(),
  selected_position: z.unknown().optional(),
});

const rosterPositionSchema = z.object({
  position: z.string().min(1),
  count: z.coerce.number().int().nonnegative(),
});

const transactionSchema = z.object({
  transaction_key: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  timestamp: z.coerce.number().nonnegative().optional(),
  players: z.unknown().optional(),
});

const allFootballPositions: readonly Position[] = [
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DEF',
  'DL',
  'LB',
  'DB',
];

export function mapGames(content: unknown): readonly FantasyGame[] {
  return findResources(content, 'game').map((resource) => {
    const game = parseResource(gameSchema, resource, 'game');
    return {
      platformReference: game.game_key,
      code: game.code,
      name: game.name,
      season: game.season,
    };
  });
}

export function mapLeagueSummaries(content: unknown): readonly LeagueSummary[] {
  return findResources(content, 'league').map((resource) => {
    const league = parseResource(leagueSummarySchema, resource, 'league');
    return {
      id: yahooLeagueId(league.league_key),
      name: league.name,
      season: league.season,
    };
  });
}

export function mapLeague(content: unknown): League {
  const resource = requireSingleResource(content, 'league');
  const league = parseResource(leagueSchema, resource, 'league');

  return {
    id: yahooLeagueId(league.league_key),
    name: league.name,
    season: league.season,
    settings: {
      rosterSlots: mapRosterSlots(league.settings, league.league_key),
      scoringRules: mapScoringRules(league.settings),
      ...(league.num_teams === undefined
        ? {}
        : { teamCount: league.num_teams }),
    },
  };
}

export function mapTeams(content: unknown): readonly Team[] {
  return findResources(content, 'team').map(mapTeamResource);
}

export function mapRoster(content: unknown, requestedTeamKey: string): Roster {
  return {
    teamId: yahooTeamId(requestedTeamKey),
    entries: findResources(content, 'player').map((resource) => ({
      player: mapPlayerResource(resource),
    })),
  };
}

export function mapLineup(
  content: unknown,
  requestedTeamKey: string,
  scoringPeriod: string,
): Lineup {
  const leagueKey = yahooLeagueKeyFromTeamKey(requestedTeamKey);
  const slotCounts = new Map<string, number>();
  const assignments = findResources(content, 'player').flatMap((resource) => {
    const player = parseResource(playerSchema, resource, 'player');
    const selectedPosition = findStringValues(
      player.selected_position,
      'position',
    )[0];
    if (selectedPosition === undefined) return [];

    const ordinal = (slotCounts.get(selectedPosition) ?? 0) + 1;
    slotCounts.set(selectedPosition, ordinal);
    return [
      {
        slotId: yahooRosterSlotId(leagueKey, selectedPosition, ordinal),
        playerId: yahooPlayerId(player.player_key),
      },
    ];
  });

  return {
    teamId: yahooTeamId(requestedTeamKey),
    scoringPeriod,
    assignments,
  };
}

export function mapPlayers(content: unknown): readonly Player[] {
  return findResources(content, 'player').map(mapPlayerResource);
}

export function mapStandings(content: unknown): readonly Standing[] {
  return findResources(content, 'team').map((resource) => {
    const team = parseResource(teamSchema, resource, 'team');
    const standings = toRecord(findFirstValue(resource, 'team_standings'));
    const outcomeTotals = toRecord(findFirstValue(standings, 'outcome_totals'));
    const wins = optionalNumber(outcomeTotals.wins);
    const losses = optionalNumber(outcomeTotals.losses);
    const ties = optionalNumber(outcomeTotals.ties);
    const percentage = optionalNumber(findFirstValue(standings, 'percentage'));
    const pointsFor = optionalNumber(findFirstValue(standings, 'points_for'));
    const pointsAgainst = optionalNumber(
      findFirstValue(standings, 'points_against'),
    );

    return {
      teamId: yahooTeamId(team.team_key),
      rank: requiredNumber(findFirstValue(standings, 'rank'), 'standing.rank'),
      ...(wins === undefined ? {} : { wins }),
      ...(losses === undefined ? {} : { losses }),
      ...(ties === undefined ? {} : { ties }),
      ...(percentage === undefined ? {} : { percentage }),
      ...(pointsFor === undefined ? {} : { pointsFor }),
      ...(pointsAgainst === undefined ? {} : { pointsAgainst }),
    };
  });
}

export function mapMatchups(
  content: unknown,
  requestedScoringPeriod: string,
): readonly Matchup[] {
  return findResources(content, 'matchup').map((resource) => {
    const week = findFirstValue(resource, 'week');
    const participants = findResources(
      findFirstValue(resource, 'teams'),
      'team',
    ).map((teamResource) => {
      const team = parseResource(teamSchema, teamResource, 'matchup team');
      const score = optionalNumber(
        findFirstValue(findFirstValue(teamResource, 'team_points'), 'total'),
      );
      return {
        teamId: yahooTeamId(team.team_key),
        ...(score === undefined ? {} : { score }),
      };
    });

    return {
      scoringPeriod:
        typeof week === 'string' || typeof week === 'number'
          ? String(week)
          : requestedScoringPeriod,
      participants,
    };
  });
}

export function mapTransactions(
  content: unknown,
  leagueKey: string,
): readonly Transaction[] {
  return findResources(content, 'transaction').map((resource) => {
    const transaction = parseResource(
      transactionSchema,
      resource,
      'transaction',
    );
    const moves = findResources(transaction.players, 'player').flatMap(
      mapTransactionMove,
    );

    return {
      id: yahooTransactionId(transaction.transaction_key),
      leagueId: yahooLeagueId(leagueKey),
      type: normalizeTransactionType(transaction.type),
      status: transaction.status,
      ...(transaction.timestamp === undefined
        ? {}
        : {
            occurredAt: new Date(transaction.timestamp * 1_000).toISOString(),
          }),
      moves,
    };
  });
}

function mapTeamResource(resource: unknown): Team {
  const team = parseResource(teamSchema, resource, 'team');
  return {
    id: yahooTeamId(team.team_key),
    leagueId: yahooLeagueId(yahooLeagueKeyFromTeamKey(team.team_key)),
    name: team.name,
  };
}

function mapPlayerResource(resource: unknown): Player {
  const player = parseResource(playerSchema, resource, 'player');
  const positions = uniquePositions(
    findStringValues(player.eligible_positions, 'position').flatMap(
      mapYahooPosition,
    ),
  );

  return {
    id: yahooPlayerId(player.player_key),
    fullName: typeof player.name === 'string' ? player.name : player.name.full,
    eligiblePositions: positions,
    ...(player.editorial_team_abbr === undefined
      ? {}
      : { professionalTeam: player.editorial_team_abbr }),
  };
}

function mapRosterSlots(
  settings: unknown,
  leagueKey: string,
): readonly RosterSlot[] {
  return findResources(settings, 'roster_position').flatMap((resource) => {
    const rosterPosition = parseResource(
      rosterPositionSchema,
      resource,
      'roster position',
    );
    return Array.from({ length: rosterPosition.count }, (_, index) => ({
      id: yahooRosterSlotId(leagueKey, rosterPosition.position, index + 1),
      name: rosterPosition.position,
      kind: slotKind(rosterPosition.position),
      eligiblePositions: mapYahooPosition(rosterPosition.position),
    }));
  });
}

function mapScoringRules(settings: unknown): readonly ScoringRule[] {
  const descriptions = new Map<string, string>();
  for (const resource of findResources(
    findFirstValue(settings, 'stat_categories'),
    'stat',
  )) {
    const record = toRecord(resource);
    const id = scalarString(record.stat_id);
    const name = scalarString(record.name) ?? scalarString(record.display_name);
    if (id !== undefined && name !== undefined) descriptions.set(id, name);
  }

  return findResources(
    findFirstValue(settings, 'stat_modifiers'),
    'stat',
  ).flatMap((resource) => {
    const record = toRecord(resource);
    const id = scalarString(record.stat_id);
    const points = optionalNumber(record.value);
    if (id === undefined || points === undefined) return [];
    const description = descriptions.get(id);
    return [
      {
        key: `yahoo.stat.${id}`,
        points,
        ...(description === undefined ? {} : { description }),
      },
    ];
  });
}

function mapTransactionMove(resource: unknown): readonly TransactionMove[] {
  const player = parseResource(playerSchema, resource, 'transaction player');
  const data = findFirstValue(resource, 'transaction_data');
  if (data === undefined) return [];

  const record = toRecord(data);
  const sourceKey = scalarString(record.source_team_key);
  const destinationKey = scalarString(record.destination_team_key);
  return [
    {
      type: normalizeMoveType(scalarString(record.type)),
      playerId: yahooPlayerId(player.player_key),
      ...(sourceKey === undefined
        ? {}
        : { sourceTeamId: yahooTeamId(sourceKey) }),
      ...(destinationKey === undefined
        ? {}
        : { destinationTeamId: yahooTeamId(destinationKey) }),
    },
  ];
}

function requireSingleResource(
  content: unknown,
  resourceName: string,
): unknown {
  const resources = findResources(content, resourceName);
  const resource = resources[0];
  if (resource === undefined) {
    throw new YahooResponseValidationError(
      `Yahoo response contained no ${resourceName}`,
      {
        resource: resourceName,
      },
    );
  }
  return resource;
}

function mapYahooPosition(value: string): readonly Position[] {
  const normalized = value.toUpperCase();
  const direct: Partial<Record<string, Position>> = {
    QB: 'QB',
    RB: 'RB',
    WR: 'WR',
    TE: 'TE',
    K: 'K',
    D: 'DEF',
    DEF: 'DEF',
    DT: 'DL',
    DE: 'DL',
    DL: 'DL',
    LB: 'LB',
    CB: 'DB',
    S: 'DB',
    DB: 'DB',
  };
  const position = direct[normalized];
  if (position !== undefined) return [position];
  if (normalized === 'W/R') return ['WR', 'RB'];
  if (normalized === 'W/T') return ['WR', 'TE'];
  if (normalized === 'W/R/T') return ['WR', 'RB', 'TE'];
  if (['Q/W/R/T', 'Q/R/W/T', 'SUPERFLEX'].includes(normalized)) {
    return ['QB', 'WR', 'RB', 'TE'];
  }
  if (['BN', 'IR', 'IR+', 'NA', 'UTIL'].includes(normalized))
    return allFootballPositions;
  return [];
}

function slotKind(position: string): RosterSlot['kind'] {
  const normalized = position.toUpperCase();
  if (normalized === 'BN') return 'bench';
  if (['IR', 'IR+', 'NA'].includes(normalized)) return 'reserve';
  return 'active';
}

function normalizeTransactionType(value: string): Transaction['type'] {
  if (value === 'add/drop') return 'add-drop';
  if (['add', 'drop', 'trade', 'commissioner'].includes(value)) {
    return value as Transaction['type'];
  }
  return 'other';
}

function normalizeMoveType(value: string | undefined): TransactionMove['type'] {
  if (value === 'add' || value === 'drop' || value === 'trade') return value;
  return 'other';
}

function uniquePositions(positions: readonly Position[]): readonly Position[] {
  return [...new Set(positions)];
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function requiredNumber(value: unknown, resource: string): number {
  const number = optionalNumber(value);
  if (number === undefined) {
    throw new YahooResponseValidationError(
      `Yahoo ${resource} was not numeric`,
      {
        resource,
        details: value,
      },
    );
  }
  return number;
}
