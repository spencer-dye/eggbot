import type {
  League,
  LeagueId,
  Lineup,
  Matchup,
  Player,
  Position,
  Roster,
  Standing,
  Team,
  TeamId,
  Transaction,
} from '@eggbot/core';
import type {
  FantasyGame,
  FantasyPlatformReader,
  LeagueSummary,
  PlayerQuery,
  TransactionQuery,
} from '@eggbot/platform';

import type { YahooHttpClient } from './http.js';
import { yahooLeagueKey, yahooTeamKey } from './identifiers.js';
import {
  mapGames,
  mapLeague,
  mapLeagueSummaries,
  mapLineup,
  mapMatchups,
  mapPlayers,
  mapRoster,
  mapStandings,
  mapTeams,
  mapTransactions,
} from './mappers.js';

const PAGE_SIZE = 25;

export interface YahooFantasyReaderOptions {
  readonly httpClient: YahooHttpClient;
  readonly gameCode?: string;
}

export class YahooFantasyReader implements FantasyPlatformReader {
  readonly #http: YahooHttpClient;
  readonly #gameCode: string;

  constructor(options: YahooFantasyReaderOptions) {
    this.#http = options.httpClient;
    this.#gameCode = options.gameCode ?? 'nfl';
  }

  async getUserGames(): Promise<readonly FantasyGame[]> {
    const content = await this.#http.get(
      `/users;use_login=1/games;game_keys=${encodeMatrixValue(this.#gameCode)}`,
    );
    return mapGames(content);
  }

  async getUserLeagues(
    gameReference?: string,
  ): Promise<readonly LeagueSummary[]> {
    const gameSelector =
      gameReference === undefined
        ? `game_keys=${encodeMatrixValue(this.#gameCode)}`
        : `game_keys=${encodeMatrixValue(gameReference)}`;
    const content = await this.#http.get(
      `/users;use_login=1/games;${gameSelector}/leagues`,
    );
    return mapLeagueSummaries(content);
  }

  async getLeague(id: LeagueId): Promise<League> {
    const key = yahooLeagueKey(id);
    return mapLeague(
      await this.#http.get(`/league/${encodePathKey(key)};out=settings`),
    );
  }

  async getTeams(id: LeagueId): Promise<readonly Team[]> {
    const key = yahooLeagueKey(id);
    return mapTeams(
      await this.#http.get(`/league/${encodePathKey(key)}/teams`),
    );
  }

  async getRoster(id: TeamId): Promise<Roster> {
    const key = yahooTeamKey(id);
    return mapRoster(
      await this.#http.get(`/team/${encodePathKey(key)}/roster`),
      key,
    );
  }

  async getLineup(id: TeamId, scoringPeriod: string): Promise<Lineup> {
    const key = yahooTeamKey(id);
    const content = await this.#http.get(
      `/team/${encodePathKey(key)}/roster;week=${encodeMatrixValue(scoringPeriod)}`,
    );
    return mapLineup(content, key, scoringPeriod);
  }

  async getMatchups(
    id: LeagueId,
    scoringPeriod: string,
  ): Promise<readonly Matchup[]> {
    const key = yahooLeagueKey(id);
    const content = await this.#http.get(
      `/league/${encodePathKey(key)}/scoreboard;week=${encodeMatrixValue(scoringPeriod)}`,
    );
    return mapMatchups(content, scoringPeriod);
  }

  async getStandings(id: LeagueId): Promise<readonly Standing[]> {
    const key = yahooLeagueKey(id);
    return mapStandings(
      await this.#http.get(`/league/${encodePathKey(key)}/standings`),
    );
  }

  async getAvailablePlayers(
    id: LeagueId,
    query: PlayerQuery = {},
  ): Promise<readonly Player[]> {
    const key = yahooLeagueKey(id);
    const limit = normalizeLimit(query.limit);
    const players: Player[] = [];

    while (players.length < limit) {
      const count = Math.min(PAGE_SIZE, limit - players.length);
      const filters = [
        'status=FA',
        `start=${players.length}`,
        `count=${count}`,
        ...(query.text === undefined
          ? []
          : [`search=${encodeMatrixValue(query.text)}`]),
        ...(query.positions?.[0] === undefined
          ? []
          : [
              `position=${encodeMatrixValue(toYahooPosition(query.positions[0]))}`,
            ]),
      ];
      const page = mapPlayers(
        await this.#http.get(
          `/league/${encodePathKey(key)}/players;${filters.join(';')}`,
        ),
      );
      players.push(...page);
      if (page.length < count) break;
    }

    return players.slice(0, limit);
  }

  async getTransactions(
    id: LeagueId,
    query: TransactionQuery = {},
  ): Promise<readonly Transaction[]> {
    const key = yahooLeagueKey(id);
    const limit = normalizeLimit(query.limit);
    const transactions: Transaction[] = [];

    while (transactions.length < limit) {
      const count = Math.min(PAGE_SIZE, limit - transactions.length);
      const page = mapTransactions(
        await this.#http.get(
          `/league/${encodePathKey(key)}/transactions;start=${transactions.length};count=${count}`,
        ),
        key,
      );
      transactions.push(...page);
      if (page.length < count) break;
    }

    return transactions.slice(0, limit);
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return PAGE_SIZE;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError('Yahoo collection limit must be a positive integer');
  }
  return limit;
}

function encodePathKey(value: string): string {
  return value
    .split('.')
    .map((part) => encodeURIComponent(part))
    .join('.');
}

function encodeMatrixValue(value: string): string {
  return encodeURIComponent(value);
}

function toYahooPosition(position: Position): string {
  if (position === 'DEF') return 'D';
  if (position === 'FLEX') return 'W/R/T';
  if (position === 'SUPER_FLEX') return 'Q/W/R/T';
  return position;
}
