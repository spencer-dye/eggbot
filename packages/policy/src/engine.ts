import type { DecisionRun } from '@eggbot/agent';
import type { FantasyAction } from '@eggbot/core';

import {
  createBuiltInPolicyState,
  detectActionConflicts,
  evaluateBatchAcquisitionLimits,
  evaluateBatchRosterCapacity,
  evaluateBuiltInAction,
  evaluateGlobalGuardrails,
  type PolicyIssueDraft,
} from './rules.js';
import {
  PolicyValidationError,
  type ActionPolicyEvaluation,
  type PolicyApproval,
  type PolicyContext,
  type PolicyEngine,
  type PolicyEngineOptions,
  type PolicyEvaluation,
  type PolicyGuardrails,
  type PolicyIssue,
  type PolicyRule,
  type PolicyRuleIssue,
} from './types.js';

export function createPolicyEngine(
  options: PolicyEngineOptions = {},
): PolicyEngine {
  const guardrails = freezeGuardrails(options.guardrails ?? {});
  const rules = Object.freeze([...(options.rules ?? [])]);
  const descriptor = Object.freeze({
    id: options.id ?? 'eggbot-policy',
    version: options.version ?? '1.0.0',
    guardrails,
    ruleIds: Object.freeze(rules.map(({ id }) => id)),
  });
  validateConfiguration(descriptor, rules);
  const engine: PolicyEngine = {
    ...descriptor,
    evaluate(run: DecisionRun, context: PolicyContext) {
      validateEvaluationContext(run, context);
      const actions = run.decision.proposedActions;
      const state = createBuiltInPolicyState(context, run, guardrails);
      const conflicts = detectActionConflicts(actions);
      const globalGuardrails = evaluateGlobalGuardrails(
        actions,
        run.snapshot,
        context,
        guardrails,
      );
      const draftsByAction = new Map(
        actions.map((action) => [
          action,
          [
            ...evaluateBuiltInAction(action, state, guardrails),
            ...(conflicts.get(action) ?? []),
            ...(globalGuardrails.get(action) ?? []),
            ...evaluateCustomRules(rules, action, context, run),
          ],
        ]),
      );
      const batchCandidates = actions.filter(
        (action) => (draftsByAction.get(action)?.length ?? 0) === 0,
      );
      const batchCapacity = evaluateBatchRosterCapacity(batchCandidates, state);
      const batchAcquisitions = evaluateBatchAcquisitionLimits(
        batchCandidates,
        state,
      );
      const results = actions.map((action): ActionPolicyEvaluation => {
        const issues = deduplicateIssues([
          ...(draftsByAction.get(action) ?? []),
          ...(batchCapacity.get(action) ?? []),
          ...(batchAcquisitions.get(action) ?? []),
        ]).map((draft): PolicyIssue => ({
          ...draft,
          actionId: action.id,
        }));
        return issues.length === 0
          ? { action, status: 'approved', issues: [] }
          : { action, status: 'rejected', issues };
      });
      return Promise.resolve({
        run,
        policy: descriptor,
        sourceSnapshotId: run.snapshot.id,
        managedTeamId: run.managedTeamId,
        evaluatedAt: context.evaluatedAt,
        results,
      });
    },
  };
  return Object.freeze(engine);
}

export function getApprovedActions(
  evaluation: PolicyEvaluation,
): readonly FantasyAction[] {
  return evaluation.results.flatMap((result) =>
    result.status === 'approved' ? [result.action] : [],
  );
}

export function createPolicyApproval(
  evaluation: PolicyEvaluation,
): PolicyApproval {
  return {
    decisionId: evaluation.run.decision.id,
    engine: evaluation.run.engine,
    policy: evaluation.policy,
    sourceSnapshotId: evaluation.sourceSnapshotId,
    managedTeamId: evaluation.managedTeamId,
    evaluatedAt: evaluation.evaluatedAt,
    actions: getApprovedActions(evaluation),
  };
}

function evaluateCustomRules(
  rules: readonly PolicyRule[],
  action: FantasyAction,
  context: PolicyContext,
  run: DecisionRun,
): readonly PolicyIssueDraft[] {
  return rules.flatMap((rule) => {
    const result = rule.evaluate(action, context, run);
    if (result === undefined) return [];
    const values = isPolicyRuleIssueArray(result) ? result : [result];
    return values.map((value) => normalizeRuleIssue(rule.id, value));
  });
}

function normalizeRuleIssue(
  ruleId: string,
  value: PolicyRuleIssue,
): PolicyIssueDraft {
  if (value.code.trim().length === 0 || value.message.trim().length === 0) {
    invalid('INVALID_RULE_RESULT', ruleId);
  }
  return {
    ruleId,
    code: value.code,
    message: value.message,
    ...(value.resource === undefined ? {} : { resource: value.resource }),
    ...(value.relatedActionIds === undefined
      ? {}
      : { relatedActionIds: value.relatedActionIds }),
  };
}

function isPolicyRuleIssueArray(
  value: PolicyRuleIssue | readonly PolicyRuleIssue[],
): value is readonly PolicyRuleIssue[] {
  return Array.isArray(value);
}

function deduplicateIssues(
  issues: readonly PolicyIssueDraft[],
): readonly PolicyIssueDraft[] {
  const unique = new Map<string, PolicyIssueDraft>();
  for (const issue of issues) {
    const key = JSON.stringify([
      issue.ruleId,
      issue.code,
      issue.resource?.kind,
      issue.resource?.id,
      issue.relatedActionIds,
    ]);
    if (!unique.has(key)) unique.set(key, issue);
  }
  return [...unique.values()];
}

function validateConfiguration(
  descriptor: {
    readonly id: string;
    readonly version: string;
    readonly guardrails: PolicyGuardrails;
  },
  rules: readonly PolicyRule[],
): void {
  if (descriptor.id.trim().length === 0)
    invalid('INVALID_POLICY_ID', descriptor.id);
  if (descriptor.version.trim().length === 0) {
    invalid('INVALID_POLICY_VERSION', descriptor.version);
  }
  const guardrails = descriptor.guardrails;
  for (const [name, value] of [
    ['maxActionsPerDecision', guardrails.maxActionsPerDecision],
    ['maxRosterMutationActions', guardrails.maxRosterMutationActions],
    ['maxWaiverBid', guardrails.maxWaiverBid],
    ['maxSnapshotAgeMs', guardrails.maxSnapshotAgeMs],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      invalid('INVALID_GUARDRAIL', name);
    }
  }
  const ids = new Set<string>();
  for (const rule of rules) {
    if (rule.id.trim().length === 0) invalid('INVALID_RULE_ID', rule.id);
    if (ids.has(rule.id)) invalid('DUPLICATE_RULE_ID', rule.id);
    ids.add(rule.id);
  }
}

function freezeGuardrails(guardrails: PolicyGuardrails): PolicyGuardrails {
  return Object.freeze({
    ...(guardrails.protectedPlayerIds === undefined
      ? {}
      : {
          protectedPlayerIds: Object.freeze([...guardrails.protectedPlayerIds]),
        }),
    ...(guardrails.maxActionsPerDecision === undefined
      ? {}
      : { maxActionsPerDecision: guardrails.maxActionsPerDecision }),
    ...(guardrails.maxRosterMutationActions === undefined
      ? {}
      : { maxRosterMutationActions: guardrails.maxRosterMutationActions }),
    ...(guardrails.maxWaiverBid === undefined
      ? {}
      : { maxWaiverBid: guardrails.maxWaiverBid }),
    ...(guardrails.maxSnapshotAgeMs === undefined
      ? {}
      : { maxSnapshotAgeMs: guardrails.maxSnapshotAgeMs }),
  });
}

function validateEvaluationContext(
  run: DecisionRun,
  context: PolicyContext,
): void {
  if (run.sourceSnapshotId !== run.snapshot.id) {
    invalid('RUN_SNAPSHOT_MISMATCH', run.snapshot.id);
  }
  if (run.analytics.sourceSnapshotId !== run.snapshot.id) {
    invalid('RUN_ANALYTICS_MISMATCH', run.snapshot.id);
  }
  if (!run.snapshot.teams.some(({ team }) => team.id === run.managedTeamId)) {
    invalid('MANAGED_TEAM_NOT_IN_SNAPSHOT', run.managedTeamId);
  }
  const evaluatedAt = Date.parse(context.evaluatedAt);
  const capturedAt = Date.parse(run.snapshot.capturedAt);
  const decisionAt = Date.parse(run.decision.createdAt);
  if (Number.isNaN(evaluatedAt)) {
    invalid('INVALID_EVALUATION_TIMESTAMP', context.evaluatedAt);
  }
  if (Number.isNaN(capturedAt)) {
    invalid('INVALID_SNAPSHOT_TIMESTAMP', run.snapshot.capturedAt);
  }
  if (Number.isNaN(decisionAt)) {
    invalid('INVALID_DECISION_TIMESTAMP', run.decision.createdAt);
  }
  if (evaluatedAt < decisionAt) {
    invalid('EVALUATION_PRECEDES_DECISION', context.evaluatedAt);
  }
}

function invalid(code: string, resource: string): never {
  throw new PolicyValidationError(`Policy validation failed for ${resource}`, {
    code,
    resource,
  });
}
