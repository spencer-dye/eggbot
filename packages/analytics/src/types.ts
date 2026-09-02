import type {
  PlayerId,
  Position,
  RosterSlotId,
  SnapshotId,
  TeamId,
} from '@eggbot/core';

export interface PlayerProjection {
  readonly playerId: PlayerId;
  readonly points: number;
  readonly floor?: number;
  readonly ceiling?: number;
}

export interface ProjectionSet {
  readonly scoringPeriod: string;
  readonly observedAt: string;
  readonly source: string;
  readonly version?: string;
  readonly players: readonly PlayerProjection[];
}

export interface ProjectionProvenance {
  readonly scoringPeriod: string;
  readonly observedAt: string;
  readonly source: string;
  readonly version?: string;
}

export interface ProjectionCoverage {
  readonly projectedCount: number;
  readonly totalCount: number;
  readonly ratio: number;
}

export interface LineupProjection {
  readonly teamId: TeamId;
  readonly scoringPeriod: string;
  /** Sum of known projections; inspect coverage before treating it as complete. */
  readonly projectedPoints: number;
  readonly projectionCoverage: ProjectionCoverage;
  readonly missingProjectionPlayerIds: readonly PlayerId[];
  readonly unfilledActiveSlotIds: readonly RosterSlotId[];
  readonly projectedFloorPoints?: number;
  readonly floorCoverage: ProjectionCoverage;
  readonly projectedCeilingPoints?: number;
  readonly ceilingCoverage: ProjectionCoverage;
}

export interface MatchupParticipantProjection {
  readonly teamId: TeamId;
  readonly projectedPoints: number;
  readonly projectionCoverage: ProjectionCoverage;
  /** Complete only when this participant and every opponent are complete. */
  readonly marginCoverage?: 'complete' | 'partial';
  /** Difference from the strongest opponent; omitted for partial coverage. */
  readonly marginToBestOpponent?: number;
}

export interface MatchupProjection {
  readonly scoringPeriod: string;
  readonly participants: readonly MatchupParticipantProjection[];
}

/** Best projected player in the captured free-agent and waiver pools. */
export interface BestAvailablePlayerAtPosition {
  readonly position: Position;
  readonly capturedAvailablePlayerCount: number;
  readonly projectedAvailablePlayerCount: number;
  readonly playerId?: PlayerId;
  readonly projectedPoints?: number;
}

export interface PlayerValueOverBestAvailable {
  readonly playerId: PlayerId;
  readonly teamId: TeamId;
  readonly position: Position;
  readonly projectedPoints: number;
  readonly bestAvailableProjectedPoints: number;
  readonly valueOverBestAvailable: number;
}

/** Distribution within the captured acquisition pool, not the whole league. */
export interface AvailablePositionScarcity {
  readonly position: Position;
  readonly capturedAvailablePlayerCount: number;
  readonly projectedAvailablePlayerCount: number;
  readonly topAvailablePoints?: number;
  readonly medianAvailablePoints?: number;
  readonly topToMedianDrop?: number;
}

export interface RosterRiskMetrics {
  readonly teamId: TeamId;
  readonly unfilledActiveSlotCount: number;
  readonly missingStarterProjectionCount: number;
  readonly starterProjectionCoverage: ProjectionCoverage;
  readonly topStarterPointShare?: number;
  readonly projectedDownsidePoints?: number;
  readonly floorProjectionCoverage: ProjectionCoverage;
  readonly sourceIntegrityWarningCount: number;
}

export type AnalyticsWarning =
  | {
      readonly code: 'BOUNDED_PLAYER_POOL';
      readonly pool: 'free-agent' | 'waivers';
      readonly requestedLimit: number;
      readonly returnedCount: number;
    }
  | {
      readonly code: 'NO_PROJECTED_AVAILABLE_PLAYER';
      readonly position: Position;
    }
  | {
      readonly code: 'SOURCE_SNAPSHOT_INTEGRITY_WARNING';
      readonly playerId: PlayerId;
      readonly sourceCode: string;
    };

export interface LeagueAnalytics {
  readonly sourceSnapshotId: SnapshotId;
  readonly scoringPeriod: string;
  readonly projectionProvenance: ProjectionProvenance;
  /** Exact normalized inputs retained so decisions are reproducible. */
  readonly playerProjections: readonly PlayerProjection[];
  readonly lineupProjections: readonly LineupProjection[];
  readonly matchupProjections: readonly MatchupProjection[];
  readonly bestAvailablePlayers: readonly BestAvailablePlayerAtPosition[];
  readonly playerValuesOverBestAvailable: readonly PlayerValueOverBestAvailable[];
  readonly availablePositionScarcity: readonly AvailablePositionScarcity[];
  readonly rosterRisk: readonly RosterRiskMetrics[];
  readonly warnings: readonly AnalyticsWarning[];
}

export class AnalyticsValidationError extends Error {
  readonly code: string;
  readonly resource: string | undefined;

  constructor(
    message: string,
    options: { code: string; resource?: string; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'AnalyticsValidationError';
    this.code = options.code;
    this.resource = options.resource;
  }
}
