import type {
  ActionResult,
  FantasyAction,
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

export interface PlayerQuery {
  readonly text?: string;
  readonly positions?: readonly Position[];
  readonly limit?: number;
}

export interface FantasyGame {
  readonly platformReference: string;
  readonly code: string;
  readonly name: string;
  readonly season: number;
}

export interface LeagueSummary {
  readonly id: LeagueId;
  readonly name: string;
  readonly season: number;
}

export interface TransactionQuery {
  readonly limit?: number;
}

/** Read-only capabilities are separate so consumers can operate without write access. */
export interface FantasyPlatformReader {
  getUserGames(): Promise<readonly FantasyGame[]>;
  getUserLeagues(gameReference?: string): Promise<readonly LeagueSummary[]>;
  getLeague(leagueId: LeagueId): Promise<League>;
  getTeams(leagueId: LeagueId): Promise<readonly Team[]>;
  getRoster(teamId: TeamId): Promise<Roster>;
  getLineup(teamId: TeamId, scoringPeriod: string): Promise<Lineup>;
  getMatchups(
    leagueId: LeagueId,
    scoringPeriod: string,
  ): Promise<readonly Matchup[]>;
  getStandings(leagueId: LeagueId): Promise<readonly Standing[]>;
  getAvailablePlayers(
    leagueId: LeagueId,
    query?: PlayerQuery,
  ): Promise<readonly Player[]>;
  getTransactions(
    leagueId: LeagueId,
    query?: TransactionQuery,
  ): Promise<readonly Transaction[]>;
}

/** The only platform capability authorized to cause roster side effects. */
export interface FantasyPlatformExecutor {
  execute(actions: readonly FantasyAction[]): Promise<readonly ActionResult[]>;
}

export interface FantasyPlatform
  extends FantasyPlatformReader, FantasyPlatformExecutor {}

export interface PlatformAdapterMetadata {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: {
    readonly read: boolean;
    readonly execute: boolean;
  };
}
