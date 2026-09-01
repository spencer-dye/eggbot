import type { LeagueSettings, Lineup, PlayerId } from '@eggbot/core';

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

/** Sums only assignments occupying active league slots. */
export function sumProjectedStartingLineupPoints(
  lineup: Lineup,
  leagueSettings: LeagueSettings,
  projections: readonly PlayerProjection[],
): number {
  const pointsByPlayer = new Map(
    projections.map(({ playerId, points }) => [playerId, points]),
  );
  const activeSlotIds = new Set(
    leagueSettings.rosterSlots
      .filter((slot) => slot.kind === 'active')
      .map((slot) => slot.id),
  );

  return lineup.assignments.reduce(
    (total, assignment) =>
      total +
      (activeSlotIds.has(assignment.slotId)
        ? (pointsByPlayer.get(assignment.playerId) ?? 0)
        : 0),
    0,
  );
}
