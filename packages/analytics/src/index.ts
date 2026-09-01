import type { Lineup, PlayerId } from '@eggbot/core';

export interface PlayerProjection {
  readonly playerId: PlayerId;
  readonly points: number;
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

/** A small deterministic primitive; richer analytics belong to later phases. */
export function sumProjectedLineupPoints(
  lineup: Lineup,
  projections: readonly PlayerProjection[],
): number {
  const pointsByPlayer = new Map(
    projections.map(({ playerId, points }) => [playerId, points]),
  );

  return lineup.assignments.reduce(
    (total, assignment) =>
      total + (pointsByPlayer.get(assignment.playerId) ?? 0),
    0,
  );
}
