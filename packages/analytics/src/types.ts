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

export interface AnalyticsMetric {
  readonly key: string;
  readonly value: number;
  readonly unit?: string;
}

export interface AnalyticsProvider<Input = unknown> {
  readonly id: string;
  analyze(input: Input): Promise<readonly AnalyticsMetric[]>;
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
  /** Difference from the strongest other participant. */
  readonly marginToBestOpponent?: number;
}

export interface MatchupProjection {
  readonly scoringPeriod: string;
  readonly participants: readonly MatchupParticipantProjection[];
}

export interface PositionReplacementLevel {
  readonly position: Position;
  readonly availablePlayerCount: number;
  readonly projectedPlayerCount: number;
  readonly replacementPlayerId?: PlayerId;
  readonly replacementPoints?: number;
}

export interface PlayerValueOverReplacement {
  readonly playerId: PlayerId;
  readonly teamId: TeamId;
  readonly position: Position;
  readonly projectedPoints: number;
  readonly replacementPoints: number;
  readonly valueOverReplacement: number;
}

export interface PositionScarcity {
  readonly position: Position;
  readonly availablePlayerCount: number;
  readonly projectedPlayerCount: number;
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
      readonly code: 'NO_PROJECTED_REPLACEMENT';
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
  readonly lineupProjections: readonly LineupProjection[];
  readonly matchupProjections: readonly MatchupProjection[];
  readonly replacementLevels: readonly PositionReplacementLevel[];
  readonly playerValues: readonly PlayerValueOverReplacement[];
  readonly positionalScarcity: readonly PositionScarcity[];
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
