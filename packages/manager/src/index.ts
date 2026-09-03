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
  type Lineup,
  type PlayerId,
  type RosterSlotId,
  type TeamId,
} from '@eggbot/core';
import type {
  ExecutionOptions,
  FantasyPlatformExecutor,
  FantasyPlatformReader,
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

export interface LineupProjectionProvider {
  getProjections(snapshot: LeagueSnapshot): Promise<ProjectionSet>;
}

export interface LeagueSnapshotCapturer {
  capture(options: LeagueSnapshotCaptureOptions): Promise<LeagueSnapshot>;
}

export interface AutonomousLineupManagerOptions {
  readonly snapshotService: LeagueSnapshotCapturer | LeagueSnapshotService;
  readonly projectionProvider: LineupProjectionProvider;
  readonly decisionEngine: DecisionEngine;
  readonly policyEngine: PolicyEngine;
  readonly executor: FantasyPlatformExecutor;
  readonly lineupReader: Pick<FantasyPlatformReader, 'getLineup'>;
  readonly maxProjectionAgeMs: number;
  readonly clock?: () => Date;
  readonly runIdFactory?: () => string;
  readonly decisionIdFactory?: () => ReturnType<typeof decisionId>;
  readonly actionIdFactory?: (index: number) => ActionId;
}

export interface LineupManagementOptions extends LeagueSnapshotCaptureOptions {
  readonly managedTeamId: TeamId;
  readonly executionMode: ExecutionOptions['mode'];
}

export interface LineupScopeIssue {
  readonly code: 'NON_LINEUP_ACTION' | 'MULTIPLE_LINEUP_ACTIONS';
  readonly actionId: ActionId;
  readonly actionType: FantasyAction['type'];
  readonly message: string;
}

export type LineupManagementStatus =
  | 'no-action'
  | 'rejected'
  | 'stale-before-execution'
  | 'preflight-failed'
  | 'dry-run'
  | 'executed'
  | 'execution-failed'
  | 'execution-uncertain';

export type LineupVerificationIssue =
  | {
      readonly code: 'TEAM_MISMATCH';
      readonly expectedTeamId: TeamId;
      readonly observedTeamId: TeamId;
    }
  | {
      readonly code: 'SCORING_PERIOD_MISMATCH';
      readonly expectedScoringPeriod: string;
      readonly observedScoringPeriod: string;
    }
  | {
      readonly code: 'ASSIGNMENT_MISMATCH';
      readonly slotId: RosterSlotId;
      readonly expectedPlayerId: PlayerId;
      readonly observedPlayerId?: PlayerId;
    }
  | {
      readonly code: 'DUPLICATE_OBSERVED_SLOT';
      readonly slotId: RosterSlotId;
    }
  | {
      readonly code: 'UNEXPECTED_ASSIGNMENT';
      readonly slotId: RosterSlotId;
      readonly observedPlayerId: PlayerId;
    };

export type LineupVerification =
  | { readonly status: 'not-applicable' | 'not-attempted' }
  | {
      readonly status: 'verified';
      readonly observedLineup: Lineup;
      readonly issues: readonly [];
    }
  | {
      readonly status: 'mismatch';
      readonly observedLineup: Lineup;
      readonly issues: readonly LineupVerificationIssue[];
    }
  | {
      readonly status: 'failed';
      readonly error: { readonly code: string; readonly message: string };
    };

export interface LineupManagementRun {
  readonly id: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly executionMode: ExecutionOptions['mode'];
  readonly status: LineupManagementStatus;
  readonly snapshot: LeagueSnapshot;
  readonly analytics: LeagueAnalytics;
  readonly decisionRun: DecisionRun;
  readonly policyEvaluation: PolicyEvaluation;
  readonly policyApproval?: PolicyApproval;
  readonly scopeIssues: readonly LineupScopeIssue[];
  readonly preflightResults: readonly ActionResult[];
  readonly executionResults: readonly ActionResult[];
  readonly verification: LineupVerification;
}

export class LineupManagementError extends Error {
  readonly code: string;
  readonly stage: string;

  constructor(
    message: string,
    options: { readonly code: string; readonly stage: string; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'LineupManagementError';
    this.code = options.code;
    this.stage = options.stage;
  }
}

export class AutonomousLineupManager {
  readonly #snapshotService: LeagueSnapshotCapturer;
  readonly #projectionProvider: LineupProjectionProvider;
  readonly #decisionEngine: DecisionEngine;
  readonly #policyEngine: PolicyEngine;
  readonly #executor: FantasyPlatformExecutor;
  readonly #lineupReader: Pick<FantasyPlatformReader, 'getLineup'>;
  readonly #clock: () => Date;
  readonly #runIdFactory: () => string;
  readonly #decisionIdFactory: () => ReturnType<typeof decisionId>;
  readonly #actionIdFactory: (index: number) => ActionId;
  readonly #maxSnapshotAgeMs: number;
  readonly #maxProjectionAgeMs: number;
  #active = false;

  constructor(options: AutonomousLineupManagerOptions) {
    const maxSnapshotAgeMs = options.policyEngine.guardrails.maxSnapshotAgeMs;
    if (maxSnapshotAgeMs === undefined || maxSnapshotAgeMs <= 0) {
      throw new LineupManagementError(
        'Autonomous lineup management requires a positive policy maxSnapshotAgeMs guardrail',
        { code: 'SNAPSHOT_FRESHNESS_REQUIRED', stage: 'configuration' },
      );
    }
    if (
      !Number.isSafeInteger(options.maxProjectionAgeMs) ||
      options.maxProjectionAgeMs <= 0
    ) {
      throw new LineupManagementError(
        'Autonomous lineup management requires a positive maxProjectionAgeMs',
        { code: 'PROJECTION_FRESHNESS_REQUIRED', stage: 'configuration' },
      );
    }
    this.#snapshotService = options.snapshotService;
    this.#projectionProvider = options.projectionProvider;
    this.#decisionEngine = options.decisionEngine;
    this.#policyEngine = options.policyEngine;
    this.#executor = options.executor;
    this.#lineupReader = options.lineupReader;
    this.#clock = options.clock ?? (() => new Date());
    this.#runIdFactory = options.runIdFactory ?? randomUUID;
    this.#decisionIdFactory =
      options.decisionIdFactory ?? (() => decisionId(randomUUID()));
    this.#actionIdFactory =
      options.actionIdFactory ?? (() => actionId(randomUUID()));
    this.#maxSnapshotAgeMs = maxSnapshotAgeMs;
    this.#maxProjectionAgeMs = options.maxProjectionAgeMs;
  }

  async run(options: LineupManagementOptions): Promise<LineupManagementRun> {
    if (this.#active) {
      throw new LineupManagementError(
        'A lineup-management run is already active on this manager instance',
        { code: 'RUN_ALREADY_ACTIVE', stage: 'orchestration' },
      );
    }
    if (
      options.executionMode !== 'dry-run' &&
      options.executionMode !== 'execute'
    ) {
      throw new LineupManagementError('Execution mode must be explicit', {
        code: 'INVALID_EXECUTION_MODE',
        stage: 'configuration',
      });
    }
    this.#active = true;
    try {
      return await this.#run(options);
    } finally {
      this.#active = false;
    }
  }

  async #run(options: LineupManagementOptions): Promise<LineupManagementRun> {
    const id = this.#runIdFactory();
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new LineupManagementError('Run ID factory returned an invalid ID', {
        code: 'INVALID_RUN_ID',
        stage: 'configuration',
      });
    }
    const startedAt = this.#timestamp('startedAt');
    const snapshot = await this.#snapshotService.capture(options);
    const projectionSet =
      await this.#projectionProvider.getProjections(snapshot);
    const projectionCheckedAt = this.#timestamp('projectionCheckedAt');
    const projectionObservedAt = Date.parse(projectionSet.observedAt);
    const projectionCheckedTime = Date.parse(projectionCheckedAt);
    const projectionAge = projectionCheckedTime - projectionObservedAt;
    if (Number.isNaN(projectionAge)) {
      throw new LineupManagementError(
        'Projection inputs contain an invalid observation timestamp',
        { code: 'INVALID_PROJECTION_TIMESTAMP', stage: 'analytics' },
      );
    }
    if (projectionObservedAt > projectionCheckedTime) {
      throw new LineupManagementError(
        'Projection inputs are timestamped in the future',
        { code: 'PROJECTION_TIMESTAMP_IN_FUTURE', stage: 'analytics' },
      );
    }
    if (projectionAge > this.#maxProjectionAgeMs) {
      throw new LineupManagementError(
        'Projection inputs are too old for autonomous lineup management',
        { code: 'PROJECTIONS_TOO_OLD', stage: 'analytics' },
      );
    }
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
    const evaluatedAt = this.#timestamp('evaluatedAt');
    const policyEvaluation = await this.#policyEngine.evaluate(decisionRun, {
      evaluatedAt,
    });
    validatePolicyEvaluation(policyEvaluation, decisionRun, this.#policyEngine);
    const proposedActions = decisionRun.decision.proposedActions;
    const multipleLineups =
      proposedActions.filter(({ type }) => type === 'set-lineup').length > 1;
    const scopeIssues = proposedActions.flatMap(
      (action): readonly LineupScopeIssue[] =>
        action.type === 'set-lineup'
          ? multipleLineups
            ? [
                {
                  code: 'MULTIPLE_LINEUP_ACTIONS',
                  actionId: action.id,
                  actionType: action.type,
                  message:
                    'Phase 7 lineup management permits at most one lineup action',
                },
              ]
            : []
          : [
              {
                code: 'NON_LINEUP_ACTION',
                actionId: action.id,
                actionType: action.type,
                message:
                  'Phase 7 lineup management cannot execute roster mutations',
              },
            ],
    );
    if (decisionRun.decision.proposedActions.length === 0) {
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
    if (scopeIssues.length > 0) {
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
    const approvedActions = getApprovedActions(policyEvaluation);
    if (approvedActions.length === 0) {
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
    const approvedLineupAction = requireApprovedLineupAction(approvedActions);
    const preflightAt = this.#timestamp('preflightAt');
    if (
      Date.parse(preflightAt) - Date.parse(snapshot.capturedAt) >
      this.#maxSnapshotAgeMs
    ) {
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
        verification: { status: 'not-attempted' },
      });
    }
    const preflightResults = await this.#executor.execute(approvedActions, {
      mode: 'dry-run',
    });
    validateExecutionResults(approvedActions, preflightResults, 'dry-run');
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
        verification: { status: 'not-attempted' },
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
        verification: { status: 'not-applicable' },
      });
    }
    const preExecuteAt = this.#timestamp('preExecuteAt');
    if (
      Date.parse(preExecuteAt) - Date.parse(snapshot.capturedAt) >
      this.#maxSnapshotAgeMs
    ) {
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
        verification: { status: 'not-attempted' },
      });
    }
    const executionResults = await this.#executor.execute(approvedActions, {
      mode: 'execute',
    });
    validateExecutionResults(approvedActions, executionResults, 'execute');
    const verification = executionResults.every(
      ({ status }) => status === 'executed',
    )
      ? await this.#verify(approvedLineupAction, snapshot)
      : ({ status: 'not-attempted' } as const);
    return this.#complete({
      id,
      startedAt,
      options,
      status: executionStatus(executionResults, options.executionMode),
      snapshot,
      analytics,
      decisionRun,
      policyEvaluation,
      policyApproval,
      scopeIssues,
      preflightResults,
      executionResults,
      verification,
    });
  }

  async #verify(
    action: Extract<FantasyAction, { type: 'set-lineup' }>,
    sourceSnapshot: LeagueSnapshot,
  ): Promise<LineupVerification> {
    try {
      const observedLineup = await this.#lineupReader.getLineup(
        action.teamId,
        action.scoringPeriod,
      );
      const issues = lineupVerificationIssues(
        action,
        sourceSnapshot,
        observedLineup,
      );
      return issues.length === 0
        ? { status: 'verified', observedLineup, issues: [] }
        : { status: 'mismatch', observedLineup, issues };
    } catch (error) {
      return {
        status: 'failed',
        error: {
          code: 'LINEUP_VERIFICATION_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'Unexpected lineup verification failure',
        },
      };
    }
  }

  #complete(input: {
    readonly id: string;
    readonly startedAt: string;
    readonly options: LineupManagementOptions;
    readonly status: LineupManagementStatus;
    readonly snapshot: LeagueSnapshot;
    readonly analytics: LeagueAnalytics;
    readonly decisionRun: DecisionRun;
    readonly policyEvaluation: PolicyEvaluation;
    readonly policyApproval?: PolicyApproval;
    readonly scopeIssues: readonly LineupScopeIssue[];
    readonly preflightResults?: readonly ActionResult[];
    readonly executionResults?: readonly ActionResult[];
    readonly verification?: LineupVerification;
  }): LineupManagementRun {
    const completedAt = this.#timestamp('completedAt');
    if (Date.parse(completedAt) < Date.parse(input.startedAt)) {
      throw new LineupManagementError('Manager clock moved backward', {
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
      verification: input.verification ?? { status: 'not-applicable' },
    };
  }

  #timestamp(resource: string): string {
    const value = this.#clock();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new LineupManagementError(
        `Manager clock returned an invalid value for ${resource}`,
        { code: 'INVALID_CLOCK_VALUE', stage: 'orchestration' },
      );
    }
    return value.toISOString();
  }
}

function validateExecutionResults(
  actions: readonly FantasyAction[],
  results: readonly ActionResult[],
  mode: ExecutionOptions['mode'],
): void {
  if (results.length !== actions.length) {
    executionContractError('Executor returned the wrong result count');
  }
  results.forEach((result, index) => {
    const action = actions[index];
    if (action === undefined || !sameAction(result.action, action)) {
      executionContractError('Executor result does not match action order');
    }
    if (
      (mode === 'dry-run' && result.status === 'executed') ||
      (mode === 'dry-run' && result.status === 'execution-uncertain') ||
      (mode === 'execute' && result.status === 'dry-run')
    ) {
      executionContractError('Executor result contradicts requested mode');
    }
  });
}

function requireApprovedLineupAction(
  actions: readonly FantasyAction[],
): Extract<FantasyAction, { type: 'set-lineup' }> {
  const action = actions[0];
  if (actions.length !== 1 || action?.type !== 'set-lineup') {
    throw new LineupManagementError(
      'Policy approved an invalid Phase 7 action set',
      { code: 'POLICY_CONTRACT_VIOLATION', stage: 'policy' },
    );
  }
  return action;
}

function lineupVerificationIssues(
  expected: Extract<FantasyAction, { type: 'set-lineup' }>,
  sourceSnapshot: LeagueSnapshot,
  observed: Lineup,
): readonly LineupVerificationIssue[] {
  const issues: LineupVerificationIssue[] = [];
  if (observed.teamId !== expected.teamId) {
    issues.push({
      code: 'TEAM_MISMATCH',
      expectedTeamId: expected.teamId,
      observedTeamId: observed.teamId,
    });
  }
  if (observed.scoringPeriod !== expected.scoringPeriod) {
    issues.push({
      code: 'SCORING_PERIOD_MISMATCH',
      expectedScoringPeriod: expected.scoringPeriod,
      observedScoringPeriod: observed.scoringPeriod,
    });
  }
  const observedBySlot = new Map<RosterSlotId, PlayerId>();
  const duplicateSlots = new Set<RosterSlotId>();
  for (const assignment of observed.assignments) {
    if (observedBySlot.has(assignment.slotId)) {
      duplicateSlots.add(assignment.slotId);
    }
    observedBySlot.set(assignment.slotId, assignment.playerId);
  }
  for (const slotId of duplicateSlots) {
    issues.push({ code: 'DUPLICATE_OBSERVED_SLOT', slotId });
  }
  const sourceLineup = sourceSnapshot.teams.find(
    ({ team }) => team.id === expected.teamId,
  )?.lineup;
  const movedPlayerIds = new Set(
    expected.assignments.map(({ playerId }) => playerId),
  );
  const expectedBySlot = new Map(
    sourceLineup?.assignments
      .filter(({ playerId }) => !movedPlayerIds.has(playerId))
      .map(({ slotId, playerId }) => [slotId, playerId]),
  );
  for (const assignment of expected.assignments) {
    expectedBySlot.set(assignment.slotId, assignment.playerId);
  }
  for (const [slotId, expectedPlayerId] of expectedBySlot) {
    const observedPlayerId = observedBySlot.get(slotId);
    if (observedPlayerId === expectedPlayerId) continue;
    issues.push({
      code: 'ASSIGNMENT_MISMATCH',
      slotId,
      expectedPlayerId,
      ...(observedPlayerId === undefined ? {} : { observedPlayerId }),
    });
  }
  for (const [slotId, observedPlayerId] of observedBySlot) {
    if (expectedBySlot.has(slotId)) continue;
    issues.push({
      code: 'UNEXPECTED_ASSIGNMENT',
      slotId,
      observedPlayerId,
    });
  }
  return issues;
}

function validatePolicyEvaluation(
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
        !sameAction(result.action, run.decision.proposedActions[index]),
    )
  ) {
    throw new LineupManagementError(
      'Policy evaluation does not correspond to the decision run',
      { code: 'POLICY_CONTRACT_VIOLATION', stage: 'policy' },
    );
  }
}

function sameAction(
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
  if (left.type === 'set-lineup' && right.type === 'set-lineup') {
    return (
      left.scoringPeriod === right.scoringPeriod &&
      left.assignments.length === right.assignments.length &&
      left.assignments.every(
        (assignment, index) =>
          assignment.slotId === right.assignments[index]?.slotId &&
          assignment.playerId === right.assignments[index]?.playerId,
      )
    );
  }
  if (left.type === 'add-player' && right.type === 'add-player') {
    return left.playerId === right.playerId;
  }
  if (left.type === 'drop-player' && right.type === 'drop-player') {
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

function executionStatus(
  results: readonly ActionResult[],
  mode: ExecutionOptions['mode'],
): LineupManagementStatus {
  if (results.some(({ status }) => status === 'execution-uncertain')) {
    return 'execution-uncertain';
  }
  if (results.some(({ status }) => status === 'failed')) {
    return 'execution-failed';
  }
  return mode === 'dry-run' ? 'dry-run' : 'executed';
}

function executionContractError(message: string): never {
  throw new LineupManagementError(message, {
    code: 'EXECUTOR_CONTRACT_VIOLATION',
    stage: 'execution',
  });
}

export {
  type AcquisitionResolution,
  type AcquisitionResolutionStatus,
  type AcquisitionVerificationIssue,
  AutonomousWaiverManager,
  WaiverManagementError,
  type AutonomousWaiverManagerOptions,
  type ImmediateAcquisitionVerification,
  type WaiverManagementOptions,
  type WaiverManagementRun,
  type WaiverManagementStatus,
  type WaiverProjectionProvider,
  type WaiverScopeIssue,
  type WaiverSnapshotCapturer,
} from './waivers.js';

export {
  WaiverReconciler,
  classifyWaiverTransaction,
  type WaiverClaimReconciliation,
  type WaiverReconciliationRun,
  type WaiverReconcilerOptions,
  type WaiverTransactionOutcome,
} from './reconciliation.js';
