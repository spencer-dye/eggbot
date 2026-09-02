import type {
  LeagueId,
  PlayerId,
  RosterSlotId,
  TeamId,
  TransactionId,
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
  readonly acquisitionRules?: AcquisitionRules;
}

export type WaiverSystem = 'priority' | 'budget' | 'unknown';

/** Normalized league controls relevant to acquisitions and waiver claims. */
export interface AcquisitionRules {
  readonly waiverSystem: WaiverSystem;
  readonly waiverPeriodDays?: number;
  readonly waiverBudget?: number;
  readonly maxWeeklyAcquisitions?: number;
  readonly maxSeasonAcquisitions?: number;
}

/** Current team-relative acquisition state, separate from static league rules. */
export interface TeamAcquisitionState {
  readonly waiverPriority?: number;
  readonly waiverBudgetRemaining?: number;
  readonly seasonAcquisitions?: number;
  readonly weeklyAcquisitions?: number;
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
  readonly acquisitionState?: TeamAcquisitionState;
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

/** Provider-independent standings facts; fields vary by league competition style. */
export interface Standing {
  readonly teamId: TeamId;
  readonly rank: number;
  readonly wins?: number;
  readonly losses?: number;
  readonly ties?: number;
  readonly percentage?: number;
  readonly pointsFor?: number;
  readonly pointsAgainst?: number;
}

export interface TransactionMove {
  readonly type: 'add' | 'drop' | 'trade' | 'other';
  readonly playerId: PlayerId;
  readonly sourceTeamId?: TeamId;
  readonly destinationTeamId?: TeamId;
}

/** Observed platform history, distinct from an EggBot action proposal. */
export interface Transaction {
  readonly id: TransactionId;
  readonly leagueId: LeagueId;
  readonly type:
    'add' | 'drop' | 'add-drop' | 'trade' | 'commissioner' | 'other';
  readonly status: string;
  readonly occurredAt?: string;
  readonly moves: readonly TransactionMove[];
}
