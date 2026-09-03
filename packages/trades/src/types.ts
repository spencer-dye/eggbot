import type { LeagueId, PlayerId, SnapshotId, TeamId } from '@eggbot/core';

export interface PlayerTradeTransfer {
  readonly playerId: PlayerId;
  readonly fromTeamId: TeamId;
  readonly toTeamId: TeamId;
}

/** A hypothetical, evaluation-only set of explicit player movements. */
export interface TradeScenario {
  readonly leagueId: LeagueId;
  readonly transfers: readonly PlayerTradeTransfer[];
}

export type TradeValueHorizon =
  | { readonly kind: 'rest-of-season'; readonly season: number }
  | { readonly kind: 'dynasty'; readonly asOfSeason: number }
  | { readonly kind: 'custom'; readonly label: string };

export interface PlayerTradeValue {
  readonly playerId: PlayerId;
  /** Non-negative comparable units within this valuation set. */
  readonly value: number;
}

export interface TradeValuationSet {
  readonly leagueId: LeagueId;
  readonly observedAt: string;
  readonly source: string;
  readonly version?: string;
  readonly unit: string;
  readonly horizon: TradeValueHorizon;
  readonly players: readonly PlayerTradeValue[];
}

export interface TradeValueCoverage {
  readonly valuedCount: number;
  readonly totalCount: number;
  readonly ratio: number;
  readonly missingPlayerIds: readonly PlayerId[];
}

export interface TradePackageValue {
  readonly knownValue: number;
  readonly coverage: TradeValueCoverage;
}

export interface TradeTeamEvaluation {
  readonly teamId: TeamId;
  readonly outgoingPlayerIds: readonly PlayerId[];
  readonly incomingPlayerIds: readonly PlayerId[];
  readonly outgoingValue: TradePackageValue;
  readonly incomingValue: TradePackageValue;
  /**
   * Raw incoming value minus raw outgoing value. Omitted unless both package
   * valuations are complete. This does not account for roster-slot opportunity
   * cost, replacement players, or strategic fit.
   */
  readonly rawPackageValueDelta?: number;
  readonly rosterSizeBefore: number;
  readonly rosterSizeAfter: number;
  readonly rosterCapacity: number;
  readonly capacityStatus: 'within-capacity' | 'exceeded';
}

export type TradeEvaluationIssue =
  | {
      readonly code: 'INCOMPLETE_TRADE_VALUATION';
      readonly teamId: TeamId;
      readonly direction: 'incoming' | 'outgoing';
      readonly missingPlayerIds: readonly PlayerId[];
    }
  | {
      readonly code: 'ROSTER_CAPACITY_EXCEEDED';
      readonly teamId: TeamId;
      readonly rosterSizeAfter: number;
      readonly rosterCapacity: number;
    }
  | {
      readonly code: 'SOURCE_SNAPSHOT_INTEGRITY_WARNING';
      readonly playerId: PlayerId;
      readonly sourceCode: string;
    };

export interface TradeValuationProvenance {
  readonly leagueId: LeagueId;
  readonly observedAt: string;
  readonly source: string;
  readonly version?: string;
  readonly unit: string;
  readonly horizon: TradeValueHorizon;
}

export interface TradeEvaluation {
  readonly sourceSnapshotId: SnapshotId;
  readonly leagueId: LeagueId;
  readonly evaluatedAt: string;
  /** Age of the source snapshot at evaluation time. */
  readonly snapshotAgeMs: number;
  /** Age of the valuation set at evaluation time. */
  readonly valuationAgeMs: number;
  readonly scenario: TradeScenario;
  readonly valuationProvenance: TradeValuationProvenance;
  /** Exact normalized value inputs retained for audit and reproduction. */
  readonly playerValues: readonly PlayerTradeValue[];
  readonly valuationCoverage: 'complete' | 'partial';
  readonly teams: readonly TradeTeamEvaluation[];
  readonly issues: readonly TradeEvaluationIssue[];
}

export class TradeValidationError extends Error {
  readonly code: string;
  readonly resource: string | undefined;

  constructor(
    message: string,
    options: {
      readonly code: string;
      readonly resource?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'TradeValidationError';
    this.code = options.code;
    this.resource = options.resource;
  }
}
