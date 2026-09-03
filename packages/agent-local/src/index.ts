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
  const id = requiredDescriptor(options.id, 'id');
  const version = requiredDescriptor(options.version, 'version');
  const kind = options.kind ?? 'deterministic';
  if (kind !== 'deterministic' && kind !== 'human') {
    throw new TypeError('Local decision engine kind is invalid');
  }
  if (typeof options.decide !== 'function') {
    throw new TypeError('Local decision function is invalid');
  }
  const decide = options.decide;
  return Object.freeze({
    id,
    version,
    kind,
    decide: (context: DecisionContext) => Promise.resolve(decide(context)),
  });
}

export function createNoActionDecisionEngine(
  options: NoActionDecisionEngineOptions,
): DecisionEngine {
  const rationale = requiredDescriptor(options.rationale, 'rationale');
  return createLocalDecisionEngine({
    id: options.id,
    version: options.version,
    decide: () => ({
      rationale,
      proposedActions: [],
    }),
  });
}

function requiredDescriptor(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new TypeError(`Local decision engine ${name} is empty`);
  }
  return value;
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
