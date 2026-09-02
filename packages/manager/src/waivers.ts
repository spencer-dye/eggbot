import { randomUUID } from 'node:crypto';

import {
  runDecisionEngine,
  type DecisionEngine,
  type DecisionRun,
} from '@eggbot/agent';
import {
  analyzeLeagueSnapshot,
  type LeagueAnalytics,
  type ProjectionSet,
} from '@eggbot/analytics';
import {
  actionId,
  decisionId,
  type ActionId,
  type ActionResult,
  type FantasyAction,
  type LeagueSnapshot,
  type TeamId,
} from '@eggbot/core';
import type {
  ExecutionOptions,
  FantasyPlatformExecutor,
} from '@eggbot/platform';
import {
  createPolicyApproval,
  getApprovedActions,
  type PolicyApproval,
  type PolicyEngine,
  type PolicyEvaluation,
} from '@eggbot/policy';
import type {
  LeagueSnapshotCaptureOptions,
  LeagueSnapshotService,
} from '@eggbot/snapshot';

export interface WaiverProjectionProvider {
  getProjections(snapshot: LeagueSnapshot): Promise<ProjectionSet>;
}

export interface WaiverSnapshotCapturer {
  capture(options: LeagueSnapshotCaptureOptions): Promise<LeagueSnapshot>;
}

export interface AutonomousWaiverManagerOptions {
  readonly snapshotService: WaiverSnapshotCapturer | LeagueSnapshotService;
  readonly projectionProvider: WaiverProjectionProvider;
  readonly decisionEngine: DecisionEngine;
  readonly policyEngine: PolicyEngine;
  readonly executor: FantasyPlatformExecutor;
  readonly maxProjectionAgeMs: number;
  readonly clock?: () => Date;
  readonly runIdFactory?: () => string;
  readonly decisionIdFactory?: () => ReturnType<typeof decisionId>;
  readonly actionIdFactory?: (index: number) => ActionId;
}

export interface WaiverManagementOptions extends LeagueSnapshotCaptureOptions {
  readonly managedTeamId: TeamId;
  readonly executionMode: ExecutionOptions['mode'];
}

export interface WaiverScopeIssue {
  readonly code: 'NON_ACQUISITION_ACTION';
  readonly actionId: ActionId;
  readonly actionType: FantasyAction['type'];
  readonly message: string;
}

export type WaiverManagementStatus =
  | 'no-action'
  | 'rejected'
  | 'stale-before-execution'
  | 'preflight-failed'
  | 'dry-run'
  | 'submitted'
  | 'execution-failed'
  | 'execution-uncertain';

export interface WaiverManagementRun {
  readonly id: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly executionMode: ExecutionOptions['mode'];
  readonly status: WaiverManagementStatus;
  readonly snapshot: LeagueSnapshot;
  readonly analytics: LeagueAnalytics;
  readonly decisionRun: DecisionRun;
  readonly policyEvaluation: PolicyEvaluation;
  readonly policyApproval?: PolicyApproval;
  readonly scopeIssues: readonly WaiverScopeIssue[];
  readonly preflightResults: readonly ActionResult[];
  readonly executionResults: readonly ActionResult[];
}

export class WaiverManagementError extends Error {
  readonly code: string;
  readonly stage: string;

  constructor(
    message: string,
    options: { readonly code: string; readonly stage: string; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'WaiverManagementError';
    this.code = options.code;
    this.stage = options.stage;
  }
}

export class AutonomousWaiverManager {
  readonly #snapshotService: WaiverSnapshotCapturer;
  readonly #projectionProvider: WaiverProjectionProvider;
  readonly #decisionEngine: DecisionEngine;
  readonly #policyEngine: PolicyEngine;
  readonly #executor: FantasyPlatformExecutor;
  readonly #clock: () => Date;
  readonly #runIdFactory: () => string;
  readonly #decisionIdFactory: () => ReturnType<typeof decisionId>;
  readonly #actionIdFactory: (index: number) => ActionId;
  readonly #maxSnapshotAgeMs: number;
  readonly #maxProjectionAgeMs: number;
  #active = false;

  constructor(options: AutonomousWaiverManagerOptions) {
    const maxSnapshotAgeMs = options.policyEngine.guardrails.maxSnapshotAgeMs;
    if (maxSnapshotAgeMs === undefined || maxSnapshotAgeMs <= 0) {
      configurationError(
        'Autonomous waiver management requires a positive policy maxSnapshotAgeMs guardrail',
        'SNAPSHOT_FRESHNESS_REQUIRED',
      );
    }
    if (
      !Number.isSafeInteger(options.maxProjectionAgeMs) ||
      options.maxProjectionAgeMs <= 0
    ) {
      configurationError(
        'Autonomous waiver management requires a positive maxProjectionAgeMs',
        'PROJECTION_FRESHNESS_REQUIRED',
      );
    }
    this.#snapshotService = options.snapshotService;
    this.#projectionProvider = options.projectionProvider;
    this.#decisionEngine = options.decisionEngine;
    this.#policyEngine = options.policyEngine;
    this.#executor = options.executor;
    this.#clock = options.clock ?? (() => new Date());
    this.#runIdFactory = options.runIdFactory ?? randomUUID;
    this.#decisionIdFactory =
      options.decisionIdFactory ?? (() => decisionId(randomUUID()));
    this.#actionIdFactory =
      options.actionIdFactory ?? (() => actionId(randomUUID()));
    this.#maxSnapshotAgeMs = maxSnapshotAgeMs;
    this.#maxProjectionAgeMs = options.maxProjectionAgeMs;
  }

  async run(options: WaiverManagementOptions): Promise<WaiverManagementRun> {
    if (this.#active) {
      throw new WaiverManagementError(
        'A waiver-management run is already active on this manager instance',
        { code: 'RUN_ALREADY_ACTIVE', stage: 'orchestration' },
      );
    }
    if (
      options.executionMode !== 'dry-run' &&
      options.executionMode !== 'execute'
    ) {
      configurationError(
        'Execution mode must be explicit',
        'INVALID_EXECUTION_MODE',
      );
    }
    this.#active = true;
    try {
      return await this.#run(options);
    } finally {
      this.#active = false;
    }
  }

  async #run(options: WaiverManagementOptions): Promise<WaiverManagementRun> {
    const id = this.#runIdFactory();
    if (typeof id !== 'string' || id.trim().length === 0) {
      configurationError(
        'Run ID factory returned an invalid ID',
        'INVALID_RUN_ID',
      );
    }
    const startedAt = this.#timestamp('startedAt');
    const snapshot = await this.#snapshotService.capture(options);
    const projectionSet =
      await this.#projectionProvider.getProjections(snapshot);
    this.#validateProjectionFreshness(projectionSet);
    const analytics = analyzeLeagueSnapshot(snapshot, projectionSet);
    const decisionRun = await runDecisionEngine(
      this.#decisionEngine,
      { snapshot, managedTeamId: options.managedTeamId, analytics },
      {
        clock: this.#clock,
        decisionIdFactory: this.#decisionIdFactory,
        actionIdFactory: (index) => this.#actionIdFactory(index),
      },
    );
    const policyEvaluation = await this.#policyEngine.evaluate(decisionRun, {
      evaluatedAt: this.#timestamp('evaluatedAt'),
    });
    validateWaiverPolicyEvaluation(
      policyEvaluation,
      decisionRun,
      this.#policyEngine,
    );
    const proposed = decisionRun.decision.proposedActions;
    const scopeIssues = proposed.flatMap(
      (action): readonly WaiverScopeIssue[] =>
        action.type === 'set-lineup' || action.type === 'drop-player'
          ? [
              {
                code: 'NON_ACQUISITION_ACTION',
                actionId: action.id,
                actionType: action.type,
                message:
                  'Phase 8 waiver management permits only acquisitions and atomic replacements',
              },
            ]
          : [],
    );
    if (proposed.length === 0) {
      return this.#complete({
        id,
        startedAt,
        options,
        status: 'no-action',
        snapshot,
        analytics,
        decisionRun,
        policyEvaluation,
        scopeIssues,
      });
    }
    const approved = getApprovedActions(policyEvaluation);
    if (scopeIssues.length > 0 || approved.length !== proposed.length) {
      return this.#complete({
        id,
        startedAt,
        options,
        status: 'rejected',
        snapshot,
        analytics,
        decisionRun,
        policyEvaluation,
        scopeIssues,
      });
    }
    const policyApproval = createPolicyApproval(policyEvaluation);
    if (this.#snapshotIsStale(snapshot, 'preflightAt')) {
      return this.#complete({
        id,
        startedAt,
        options,
        status: 'stale-before-execution',
        snapshot,
        analytics,
        decisionRun,
        policyEvaluation,
        policyApproval,
        scopeIssues,
      });
    }
    const preflightResults = await this.#executor.execute(approved, {
      mode: 'dry-run',
    });
    validateWaiverExecutionResults(approved, preflightResults, 'dry-run');
    if (preflightResults.some(({ status }) => status !== 'dry-run')) {
      return this.#complete({
        id,
        startedAt,
        options,
        status: 'preflight-failed',
        snapshot,
        analytics,
        decisionRun,
        policyEvaluation,
        policyApproval,
        scopeIssues,
        preflightResults,
      });
    }
    if (options.executionMode === 'dry-run') {
      return this.#complete({
        id,
        startedAt,
        options,
        status: 'dry-run',
        snapshot,
        analytics,
        decisionRun,
        policyEvaluation,
        policyApproval,
        scopeIssues,
        preflightResults,
      });
    }
    if (this.#snapshotIsStale(snapshot, 'preExecuteAt')) {
      return this.#complete({
        id,
        startedAt,
        options,
        status: 'stale-before-execution',
        snapshot,
        analytics,
        decisionRun,
        policyEvaluation,
        policyApproval,
        scopeIssues,
        preflightResults,
      });
    }
    const executionResults = await this.#executor.execute(approved, {
      mode: 'execute',
    });
    validateWaiverExecutionResults(approved, executionResults, 'execute');
    return this.#complete({
      id,
      startedAt,
      options,
      status: waiverExecutionStatus(executionResults),
      snapshot,
      analytics,
      decisionRun,
      policyEvaluation,
      policyApproval,
      scopeIssues,
      preflightResults,
      executionResults,
    });
  }

  #validateProjectionFreshness(projections: ProjectionSet): void {
    const checked = Date.parse(this.#timestamp('projectionCheckedAt'));
    const observed = Date.parse(projections.observedAt);
    if (Number.isNaN(observed)) {
      throw new WaiverManagementError(
        'Projection inputs contain an invalid observation timestamp',
        { code: 'INVALID_PROJECTION_TIMESTAMP', stage: 'analytics' },
      );
    }
    if (observed > checked) {
      throw new WaiverManagementError(
        'Projection inputs are timestamped in the future',
        { code: 'PROJECTION_TIMESTAMP_IN_FUTURE', stage: 'analytics' },
      );
    }
    if (checked - observed > this.#maxProjectionAgeMs) {
      throw new WaiverManagementError(
        'Projection inputs are too old for autonomous waiver management',
        { code: 'PROJECTIONS_TOO_OLD', stage: 'analytics' },
      );
    }
  }

  #snapshotIsStale(snapshot: LeagueSnapshot, resource: string): boolean {
    return (
      Date.parse(this.#timestamp(resource)) - Date.parse(snapshot.capturedAt) >
      this.#maxSnapshotAgeMs
    );
  }

  #complete(input: {
    readonly id: string;
    readonly startedAt: string;
    readonly options: WaiverManagementOptions;
    readonly status: WaiverManagementStatus;
    readonly snapshot: LeagueSnapshot;
    readonly analytics: LeagueAnalytics;
    readonly decisionRun: DecisionRun;
    readonly policyEvaluation: PolicyEvaluation;
    readonly policyApproval?: PolicyApproval;
    readonly scopeIssues: readonly WaiverScopeIssue[];
    readonly preflightResults?: readonly ActionResult[];
    readonly executionResults?: readonly ActionResult[];
  }): WaiverManagementRun {
    const completedAt = this.#timestamp('completedAt');
    if (Date.parse(completedAt) < Date.parse(input.startedAt)) {
      throw new WaiverManagementError('Manager clock moved backward', {
        code: 'CLOCK_MOVED_BACKWARD',
        stage: 'orchestration',
      });
    }
    return {
      id: input.id,
      startedAt: input.startedAt,
      completedAt,
      executionMode: input.options.executionMode,
      status: input.status,
      snapshot: input.snapshot,
      analytics: input.analytics,
      decisionRun: input.decisionRun,
      policyEvaluation: input.policyEvaluation,
      ...(input.policyApproval === undefined
        ? {}
        : { policyApproval: input.policyApproval }),
      scopeIssues: input.scopeIssues,
      preflightResults: input.preflightResults ?? [],
      executionResults: input.executionResults ?? [],
    };
  }

  #timestamp(resource: string): string {
    const value = this.#clock();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new WaiverManagementError(
        `Manager clock returned an invalid value for ${resource}`,
        { code: 'INVALID_CLOCK_VALUE', stage: 'orchestration' },
      );
    }
    return value.toISOString();
  }
}

function validateWaiverExecutionResults(
  actions: readonly FantasyAction[],
  results: readonly ActionResult[],
  mode: ExecutionOptions['mode'],
): void {
  if (
    results.length !== actions.length ||
    results.some(
      (result, index) =>
        !sameWaiverAction(result.action, actions[index]) ||
        (mode === 'dry-run' &&
          (result.status === 'executed' ||
            result.status === 'execution-uncertain')) ||
        (mode === 'execute' && result.status === 'dry-run'),
    )
  ) {
    throw new WaiverManagementError(
      'Executor results do not correspond to the approved action batch',
      { code: 'EXECUTOR_CONTRACT_VIOLATION', stage: 'execution' },
    );
  }
}

function validateWaiverPolicyEvaluation(
  evaluation: PolicyEvaluation,
  run: DecisionRun,
  policy: PolicyEngine,
): void {
  if (
    evaluation.run !== run ||
    evaluation.sourceSnapshotId !== run.snapshot.id ||
    evaluation.managedTeamId !== run.managedTeamId ||
    evaluation.policy.id !== policy.id ||
    evaluation.policy.version !== policy.version ||
    evaluation.results.length !== run.decision.proposedActions.length ||
    evaluation.results.some(
      (result, index) =>
        !sameWaiverAction(result.action, run.decision.proposedActions[index]),
    )
  ) {
    throw new WaiverManagementError(
      'Policy evaluation does not correspond to the decision run',
      { code: 'POLICY_CONTRACT_VIOLATION', stage: 'policy' },
    );
  }
}

function sameWaiverAction(
  left: FantasyAction,
  right: FantasyAction | undefined,
): boolean {
  if (
    right === undefined ||
    left.id !== right.id ||
    left.type !== right.type ||
    left.leagueId !== right.leagueId ||
    left.teamId !== right.teamId
  ) {
    return false;
  }
  if (left.type === 'add-player' && right.type === 'add-player') {
    return left.playerId === right.playerId;
  }
  if (left.type === 'add-drop' && right.type === 'add-drop') {
    return (
      left.addPlayerId === right.addPlayerId &&
      left.dropPlayerId === right.dropPlayerId
    );
  }
  return (
    left.type === 'waiver-claim' &&
    right.type === 'waiver-claim' &&
    left.addPlayerId === right.addPlayerId &&
    left.dropPlayerId === right.dropPlayerId &&
    left.bid === right.bid
  );
}

function waiverExecutionStatus(
  results: readonly ActionResult[],
): WaiverManagementStatus {
  if (results.some(({ status }) => status === 'execution-uncertain')) {
    return 'execution-uncertain';
  }
  if (results.some(({ status }) => status === 'failed')) {
    return 'execution-failed';
  }
  return 'submitted';
}

function configurationError(message: string, code: string): never {
  throw new WaiverManagementError(message, {
    code,
    stage: 'configuration',
  });
}
