import type { DecisionEngineDescriptor, DecisionRun } from '@eggbot/agent';
import type {
  ActionId,
  DecisionId,
  FantasyAction,
  PlayerId,
  SnapshotId,
  TeamId,
} from '@eggbot/core';

export interface PolicyContext {
  readonly evaluatedAt: string;
}

export interface PolicyIssueResource {
  readonly kind:
    | 'decision'
    | 'snapshot'
    | 'action'
    | 'player'
    | 'roster-slot'
    | 'scoring-period';
  readonly id: string;
}

export interface PolicyRuleIssue {
  readonly code: string;
  readonly message: string;
  readonly resource?: PolicyIssueResource;
  readonly relatedActionIds?: readonly ActionId[];
}

export interface PolicyIssue extends PolicyRuleIssue {
  readonly actionId: ActionId;
  readonly ruleId: string;
}

export type ActionPolicyEvaluation =
  | {
      readonly action: FantasyAction;
      readonly status: 'approved';
      readonly issues: readonly [];
    }
  | {
      readonly action: FantasyAction;
      readonly status: 'rejected';
      readonly issues: readonly PolicyIssue[];
    };

export interface PolicyEvaluation {
  readonly run: DecisionRun;
  readonly policy: PolicyEngineDescriptor;
  readonly sourceSnapshotId: SnapshotId;
  readonly managedTeamId: TeamId;
  readonly evaluatedAt: string;
  readonly results: readonly ActionPolicyEvaluation[];
}

export interface PolicyApproval {
  readonly decisionId: DecisionId;
  readonly engine: DecisionEngineDescriptor;
  readonly policy: PolicyEngineDescriptor;
  readonly sourceSnapshotId: SnapshotId;
  readonly managedTeamId: TeamId;
  readonly evaluatedAt: string;
  readonly actions: readonly FantasyAction[];
}

export interface PolicyGuardrails {
  readonly protectedPlayerIds?: readonly PlayerId[];
  readonly maxActionsPerDecision?: number;
  readonly maxRosterMutationActions?: number;
  readonly maxWaiverBid?: number;
  readonly maxSnapshotAgeMs?: number;
}

export interface PolicyRule {
  readonly id: string;
  evaluate(
    action: FantasyAction,
    context: PolicyContext,
    run: DecisionRun,
  ): PolicyRuleIssue | readonly PolicyRuleIssue[] | undefined;
}

export interface PolicyEngineOptions {
  readonly id?: string;
  readonly version?: string;
  readonly guardrails?: PolicyGuardrails;
  readonly rules?: readonly PolicyRule[];
}

export interface PolicyEngineDescriptor {
  readonly id: string;
  readonly version: string;
  readonly guardrails: PolicyGuardrails;
  readonly ruleIds: readonly string[];
}

export interface PolicyEngine extends PolicyEngineDescriptor {
  evaluate(run: DecisionRun, context: PolicyContext): Promise<PolicyEvaluation>;
}

export class PolicyValidationError extends Error {
  readonly code: string;
  readonly resource: string | undefined;

  constructor(
    message: string,
    options: { code: string; resource?: string; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'PolicyValidationError';
    this.code = options.code;
    this.resource = options.resource;
  }
}
