import type {
  LeagueId,
  PlayerId,
  RosterSlotId,
  TeamId,
} from './identifiers.js';

export type Position =
  | 'QB'
  | 'RB'
  | 'WR'
  | 'TE'
  | 'K'
  | 'DEF'
  | 'DL'
  | 'LB'
  | 'DB'
  | 'FLEX'
  | 'SUPER_FLEX';

export interface ScoringRule {
  readonly key: string;
  readonly points: number;
  readonly description?: string;
}

export interface RosterSlot {
  readonly id: RosterSlotId;
  readonly name: string;
  readonly kind: 'active' | 'bench' | 'reserve';
  readonly eligiblePositions: readonly Position[];
}

export interface LeagueSettings {
  readonly rosterSlots: readonly RosterSlot[];
  readonly scoringRules: readonly ScoringRule[];
  readonly teamCount?: number;
}

export interface League {
  readonly id: LeagueId;
  readonly name: string;
  readonly season: number;
  readonly settings: LeagueSettings;
}

export interface Team {
  readonly id: TeamId;
  readonly leagueId: LeagueId;
  readonly name: string;
}

export interface Player {
  readonly id: PlayerId;
  readonly fullName: string;
  readonly eligiblePositions: readonly Position[];
  readonly professionalTeam?: string;
}

export interface RosterEntry {
  readonly player: Player;
  readonly acquiredAt?: string;
}

/** All players controlled by a fantasy team, independent of weekly placement. */
export interface Roster {
  readonly teamId: TeamId;
  readonly entries: readonly RosterEntry[];
}

export interface LineupAssignment {
  readonly slotId: RosterSlotId;
  readonly playerId: PlayerId;
}

/** A team's slot assignments for a particular scoring period. */
export interface Lineup {
  readonly teamId: TeamId;
  readonly scoringPeriod: string;
  readonly assignments: readonly LineupAssignment[];
}

export interface MatchupParticipant {
  readonly teamId: TeamId;
  readonly score?: number;
}

export interface Matchup {
  readonly scoringPeriod: string;
  readonly participants: readonly MatchupParticipant[];
}
