import type {
  DecisionContext,
  DecisionEngine,
  DecisionProposal,
} from '@eggbot/agent';

export type LocalDecisionFunction = (
  context: DecisionContext,
) => DecisionProposal | Promise<DecisionProposal>;

export interface LocalDecisionEngineOptions {
  readonly id: string;
  readonly version: string;
  readonly kind?: 'deterministic' | 'human';
  readonly decide: LocalDecisionFunction;
}

export interface NoActionDecisionEngineOptions {
  readonly id: string;
  readonly version: string;
  readonly rationale: string;
}

export function createLocalDecisionEngine(
  options: LocalDecisionEngineOptions,
): DecisionEngine {
  return {
    id: options.id,
    version: options.version,
    kind: options.kind ?? 'deterministic',
    decide: (context) => Promise.resolve(options.decide(context)),
  };
}

export function createNoActionDecisionEngine(
  options: NoActionDecisionEngineOptions,
): DecisionEngine {
  return createLocalDecisionEngine({
    id: options.id,
    version: options.version,
    decide: () => ({
      rationale: options.rationale,
      proposedActions: [],
    }),
  });
}

export {
  createProjectedLineupDecisionEngine,
  type ProjectedLineupDecisionEngineOptions,
} from './projected-lineup.js';
export {
  createProjectedWaiverDecisionEngine,
  type ProjectedWaiverDecisionEngineOptions,
  type WaiverBidStrategy,
} from './projected-waivers.js';
