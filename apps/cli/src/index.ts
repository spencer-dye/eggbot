import type { DecisionContext, DecisionEngine } from '@eggbot/agent';
import { sumProjectedLineupPoints } from '@eggbot/analytics';
import {
  decisionId,
  teamId,
  type FantasyDecision,
  type Lineup,
} from '@eggbot/core';
import type { FantasyPlatformReader } from '@eggbot/platform';
import { createPolicyEngine, type PolicyEngine } from '@eggbot/policy';
import type { Scheduler } from '@eggbot/scheduler';
import type { StorageAdapter } from '@eggbot/storage';
import { yahooAdapterMetadata } from '@eggbot/yahoo';

/** Documents the ports an eventual application composition root will supply. */
interface EggBotPorts {
  readonly platform: FantasyPlatformReader;
  readonly decisionEngine: DecisionEngine;
  readonly policy: PolicyEngine;
  readonly storage: StorageAdapter;
  readonly scheduler: Scheduler;
}

const deterministicNoOpEngine: DecisionEngine = {
  id: 'phase-zero-no-op',
  version: '1.0.0',
  decide(context: DecisionContext): Promise<FantasyDecision> {
    return Promise.resolve({
      id: decisionId(`phase-zero-decision-${context.league.id}`),
      createdAt: new Date(0).toISOString(),
      rationale: 'Phase 0 proves composition without proposing a side effect.',
      proposedActions: [],
    });
  },
};

const policy = createPolicyEngine([]);
const emptyLineup: Lineup = {
  teamId: teamId('phase-zero-team'),
  scoringPeriod: 'demo',
  assignments: [],
};

const phaseZeroProof = {
  analyticsResult: sumProjectedLineupPoints(emptyLineup, []),
  decisionEngine: deterministicNoOpEngine.id,
  platformBoundary: yahooAdapterMetadata,
  policyBoundary: policy.constructor.name,
  requiredPorts: [
    'platform',
    'storage',
    'scheduler',
  ] satisfies readonly (keyof EggBotPorts)[],
};

console.log(JSON.stringify(phaseZeroProof, null, 2));
