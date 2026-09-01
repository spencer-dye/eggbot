import type {
  ActionId,
  FantasyAction,
  FantasyDecision,
  League,
  Roster,
} from '@eggbot/core';

export interface PolicyContext {
  readonly league: League;
  readonly roster: Roster;
  readonly evaluatedAt: string;
}

export interface PolicyIssue {
  readonly code: string;
  readonly message: string;
  readonly actionId: ActionId;
}

export type PolicyEvaluation =
  | {
      readonly status: 'approved';
      readonly decision: FantasyDecision;
      readonly approvedActions: readonly FantasyAction[];
      readonly issues: readonly [];
    }
  | {
      readonly status: 'rejected';
      readonly decision: FantasyDecision;
      readonly approvedActions: readonly FantasyAction[];
      readonly issues: readonly PolicyIssue[];
    };

export interface PolicyRule {
  readonly id: string;
  evaluate(
    action: FantasyAction,
    context: PolicyContext,
  ): PolicyIssue | undefined;
}

export interface PolicyEngine {
  evaluate(
    decision: FantasyDecision,
    context: PolicyContext,
  ): Promise<PolicyEvaluation>;
}

/** Creates a deterministic, fail-closed policy boundary from independent rules. */
export function createPolicyEngine(rules: readonly PolicyRule[]): PolicyEngine {
  return {
    evaluate(decision, context) {
      const issues = decision.proposedActions.flatMap((action) => {
        const issue = rules
          .map((rule) => rule.evaluate(action, context))
          .find(Boolean);
        return issue === undefined ? [] : [issue];
      });
      const rejectedIds = new Set(issues.map((issue) => issue.actionId));
      const approvedActions = decision.proposedActions.filter(
        (action) => !rejectedIds.has(action.id),
      );

      const evaluation: PolicyEvaluation =
        issues.length === 0
          ? { status: 'approved', decision, approvedActions, issues: [] }
          : { status: 'rejected', decision, approvedActions, issues };

      return Promise.resolve(evaluation);
    },
  };
}
