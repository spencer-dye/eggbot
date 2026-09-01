import type {
  FantasyDecision,
  League,
  Lineup,
  Matchup,
  Player,
  Roster,
} from '@eggbot/core';

export interface DecisionContext {
  readonly league: League;
  readonly roster: Roster;
  readonly lineup?: Lineup;
  readonly matchups: readonly Matchup[];
  readonly availablePlayers: readonly Player[];
  readonly analytics: Readonly<Record<string, unknown>>;
  readonly observedAt: string;
}

/** Proposes inspectable data and has no platform execution capability. */
export interface DecisionEngine {
  readonly id: string;
  readonly version: string;
  decide(context: DecisionContext): Promise<FantasyDecision>;
}
