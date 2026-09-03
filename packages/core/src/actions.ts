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

export interface AddPlayerAction extends ActionBase {
  readonly type: 'add-player';
  readonly playerId: PlayerId;
}

export interface DropPlayerAction extends ActionBase {
  readonly type: 'drop-player';
  readonly playerId: PlayerId;
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
  /** Non-negative integer units in the league's waiver budget. */
  readonly bid?: number;
}

/** Inspectable intent only; constructing an action never performs a side effect. */
export type FantasyAction =
  | SetLineupAction
  | AddPlayerAction
  | DropPlayerAction
  | AddDropAction
  | WaiverClaimAction;

export interface FantasyDecision {
  readonly id: DecisionId;
  readonly createdAt: string;
  readonly rationale: string;
  readonly proposedActions: readonly FantasyAction[];
}

export type ActionResult =
  | {
      readonly status: 'dry-run';
      readonly action: FantasyAction;
      readonly summary: string;
      /** Local validation only; the provider remains authoritative. */
      readonly validation: 'local';
      readonly warnings?: readonly string[];
    }
  | {
      readonly status: 'executed';
      readonly action: FantasyAction;
      readonly roster?: Roster;
      readonly externalReference?: string;
      readonly warnings?: readonly string[];
    }
  | {
      /** The mutation may have succeeded, but its outcome is not durable. */
      readonly status: 'execution-uncertain';
      readonly action: FantasyAction;
      readonly externalReference?: string;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly retryable: false;
      };
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
