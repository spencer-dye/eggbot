import type { FantasyDecision, LeagueSnapshot } from '@eggbot/core';

export interface DecisionContext {
  readonly snapshot: LeagueSnapshot;
  readonly analytics: Readonly<Record<string, unknown>>;
}

/** Proposes inspectable data and has no platform execution capability. */
export interface DecisionEngine {
  readonly id: string;
  readonly version: string;
  decide(context: DecisionContext): Promise<FantasyDecision>;
}
