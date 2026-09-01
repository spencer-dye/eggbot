import type { LineupAssignment, Roster } from './domain.js';
import type {
  ActionId,
  DecisionId,
  LeagueId,
  PlayerId,
  TeamId,
} from './identifiers.js';

interface ActionBase {
  readonly id: ActionId;
  readonly leagueId: LeagueId;
  readonly teamId: TeamId;
}

export interface SetLineupAction extends ActionBase {
  readonly type: 'set-lineup';
  readonly scoringPeriod: string;
  readonly assignments: readonly LineupAssignment[];
}

export interface AddDropAction extends ActionBase {
  readonly type: 'add-drop';
  readonly addPlayerId: PlayerId;
  readonly dropPlayerId: PlayerId;
}

export interface WaiverClaimAction extends ActionBase {
  readonly type: 'waiver-claim';
  readonly addPlayerId: PlayerId;
  readonly dropPlayerId?: PlayerId;
  readonly bid?: number;
}

/** Inspectable intent only; constructing an action never performs a side effect. */
export type FantasyAction = SetLineupAction | AddDropAction | WaiverClaimAction;

export interface FantasyDecision {
  readonly id: DecisionId;
  readonly createdAt: string;
  readonly rationale: string;
  readonly proposedActions: readonly FantasyAction[];
}

export type ActionResult =
  | {
      readonly status: 'executed';
      readonly action: FantasyAction;
      readonly roster?: Roster;
      readonly externalReference?: string;
    }
  | {
      readonly status: 'failed';
      readonly action: FantasyAction;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly retryable: boolean;
      };
    };
