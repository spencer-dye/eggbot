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
  readonly decision: FantasyDecision;
  readonly results: readonly ActionPolicyEvaluation[];
}

export interface PolicyRule {
  readonly id: string;
  evaluate(
    action: FantasyAction,
    context: PolicyContext,
  ): PolicyIssue | readonly PolicyIssue[] | undefined;
}

export interface PolicyEngine {
  evaluate(
    decision: FantasyDecision,
    context: PolicyContext,
  ): Promise<PolicyEvaluation>;
}

/** Creates a deterministic policy boundary with complete, per-action results. */
export function createPolicyEngine(rules: readonly PolicyRule[]): PolicyEngine {
  return {
    evaluate(decision, context) {
      const results = decision.proposedActions.map(
        (action): ActionPolicyEvaluation => {
          const issues = rules.reduce<PolicyIssue[]>((allIssues, rule) => {
            const result = rule.evaluate(action, context);
            if (result === undefined) return allIssues;
            if (isPolicyIssueArray(result)) allIssues.push(...result);
            else allIssues.push(result);
            return allIssues;
          }, []);
          return issues.length === 0
            ? { action, status: 'approved', issues: [] }
            : { action, status: 'rejected', issues };
        },
      );
      return Promise.resolve({ decision, results });
    },
  };
}

function isPolicyIssueArray(
  value: PolicyIssue | readonly PolicyIssue[],
): value is readonly PolicyIssue[] {
  return Array.isArray(value);
}

export function getApprovedActions(
  evaluation: PolicyEvaluation,
): readonly FantasyAction[] {
  return evaluation.results.flatMap((result) =>
    result.status === 'approved' ? [result.action] : [],
  );
}
