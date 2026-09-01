import type { FantasyDecision, LeagueSnapshot, TeamId } from '@eggbot/core';
import type { LeagueAnalytics } from '@eggbot/analytics';

export type AnalyticsSnapshot = LeagueAnalytics;

export interface DecisionContext {
  readonly snapshot: LeagueSnapshot;
  readonly managedTeamId: TeamId;
  readonly analytics: AnalyticsSnapshot;
}

/** Validates that the requested management scope exists in the snapshot. */
export function createDecisionContext(
  context: DecisionContext,
): DecisionContext {
  if (
    !context.snapshot.teams.some(
      ({ team }) => team.id === context.managedTeamId,
    )
  ) {
    throw new RangeError('Managed team is not present in the league snapshot');
  }
  if (context.analytics.sourceSnapshotId !== context.snapshot.id) {
    throw new RangeError('Analytics were not derived from the league snapshot');
  }
  if (context.analytics.scoringPeriod !== context.snapshot.scoringPeriod) {
    throw new RangeError(
      'Analytics scoring period does not match the league snapshot',
    );
  }
  if (
    !context.analytics.lineupProjections.some(
      ({ teamId }) => teamId === context.managedTeamId,
    ) ||
    !context.analytics.rosterRisk.some(
      ({ teamId }) => teamId === context.managedTeamId,
    )
  ) {
    throw new RangeError('Analytics do not cover the managed team');
  }
  return context;
}

/** Proposes inspectable data and has no platform execution capability. */
export interface DecisionEngine {
  readonly id: string;
  readonly version: string;
  decide(context: DecisionContext): Promise<FantasyDecision>;
}
