import type { FantasyDecision, LeagueSnapshot, TeamId } from '@eggbot/core';

export type AnalyticsSnapshot = Readonly<Record<string, unknown>>;

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
  return context;
}

/** Proposes inspectable data and has no platform execution capability. */
export interface DecisionEngine {
  readonly id: string;
  readonly version: string;
  decide(context: DecisionContext): Promise<FantasyDecision>;
}
