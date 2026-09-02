import type { LeagueAnalytics } from '@eggbot/analytics';
import type {
  ActionId,
  AddDropAction,
  AddPlayerAction,
  DecisionId,
  DropPlayerAction,
  FantasyAction,
  FantasyDecision,
  LeagueSnapshot,
  SetLineupAction,
  SnapshotId,
  TeamId,
  WaiverClaimAction,
} from '@eggbot/core';

export type AnalyticsSnapshot = LeagueAnalytics;

export interface DecisionContext {
  readonly snapshot: LeagueSnapshot;
  readonly managedTeamId: TeamId;
  readonly analytics: AnalyticsSnapshot;
}

export type DecisionEngineKind =
  'deterministic' | 'human' | 'model' | 'external-service';

export interface DecisionEngineDescriptor {
  readonly id: string;
  readonly version: string;
  readonly kind: DecisionEngineKind;
}

/** Untrusted engine output before host-owned audit metadata is assigned. */
export type FantasyActionIntent =
  | Omit<SetLineupAction, 'id'>
  | Omit<AddPlayerAction, 'id'>
  | Omit<DropPlayerAction, 'id'>
  | Omit<AddDropAction, 'id'>
  | Omit<WaiverClaimAction, 'id'>;

export interface DecisionProposal {
  readonly rationale: string;
  readonly proposedActions: readonly FantasyActionIntent[];
}

/** Proposes inspectable data and has no platform execution capability. */
export interface DecisionEngine extends DecisionEngineDescriptor {
  decide(context: DecisionContext): Promise<DecisionProposal>;
}

export interface DecisionRunnerOptions {
  readonly clock: () => Date;
  readonly decisionIdFactory: () => DecisionId;
  readonly actionIdFactory: (
    index: number,
    intent: FantasyActionIntent,
  ) => ActionId;
}

export interface DecisionRun {
  readonly engine: DecisionEngineDescriptor;
  readonly sourceSnapshotId: SnapshotId;
  readonly managedTeamId: TeamId;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly analytics: AnalyticsSnapshot;
  readonly decision: FantasyDecision;
}

export class DecisionValidationError extends Error {
  readonly code: string;
  readonly resource: string | undefined;

  constructor(
    message: string,
    options: { code: string; resource?: string; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'DecisionValidationError';
    this.code = options.code;
    this.resource = options.resource;
  }
}

/** Validates that snapshot, analytics, and management scope are coherent. */
export function createDecisionContext(
  context: DecisionContext,
): DecisionContext {
  if (
    !context.snapshot.teams.some(
      ({ team }) => team.id === context.managedTeamId,
    )
  ) {
    throw new DecisionValidationError(
      'Managed team is not present in the league snapshot',
      { code: 'MANAGED_TEAM_NOT_IN_SNAPSHOT', resource: context.managedTeamId },
    );
  }
  if (context.analytics.sourceSnapshotId !== context.snapshot.id) {
    throw new DecisionValidationError(
      'Analytics were not derived from the league snapshot',
      { code: 'ANALYTICS_SNAPSHOT_MISMATCH' },
    );
  }
  if (context.analytics.scoringPeriod !== context.snapshot.scoringPeriod) {
    throw new DecisionValidationError(
      'Analytics scoring period does not match the league snapshot',
      { code: 'ANALYTICS_PERIOD_MISMATCH' },
    );
  }
  if (
    context.analytics.projectionProvenance.scoringPeriod !==
    context.analytics.scoringPeriod
  ) {
    throw new DecisionValidationError(
      'Projection scoring period does not match the analytics result',
      { code: 'PROJECTION_PERIOD_MISMATCH' },
    );
  }
  if (
    !context.analytics.lineupProjections.some(
      ({ teamId }) => teamId === context.managedTeamId,
    ) ||
    !context.analytics.rosterRisk.some(
      ({ teamId }) => teamId === context.managedTeamId,
    )
  ) {
    throw new DecisionValidationError(
      'Analytics do not cover the managed team',
      { code: 'MANAGED_TEAM_ANALYTICS_MISSING' },
    );
  }
  return context;
}

/**
 * Runs an engine without granting platform authority, validates its proposal,
 * and assigns host-owned audit identity and timestamps.
 */
export async function runDecisionEngine(
  engine: DecisionEngine,
  context: DecisionContext,
  options: DecisionRunnerOptions,
): Promise<DecisionRun> {
  const validatedContext = createDecisionContext(context);
  validateEngineDescriptor(engine);
  const started = validClockValue(options.clock(), 'startedAt');
  const proposal = validateDecisionProposal(
    await engine.decide(validatedContext),
    validatedContext,
  );
  const completed = validClockValue(options.clock(), 'completedAt');
  if (completed.getTime() < started.getTime()) {
    invalid('CLOCK_MOVED_BACKWARD', 'completedAt');
  }
  const id = options.decisionIdFactory();
  if (typeof id !== 'string' || id.trim().length === 0) {
    invalid('INVALID_DECISION_ID', String(id));
  }
  const proposedActions = assignActionIds(proposal, options.actionIdFactory);
  const completedAt = completed.toISOString();
  return {
    engine: { id: engine.id, version: engine.version, kind: engine.kind },
    sourceSnapshotId: validatedContext.snapshot.id,
    managedTeamId: validatedContext.managedTeamId,
    startedAt: started.toISOString(),
    completedAt,
    analytics: validatedContext.analytics,
    decision: {
      id,
      createdAt: completedAt,
      rationale: proposal.rationale,
      proposedActions,
    },
  };
}

export function validateDecisionProposal(
  value: unknown,
  context: DecisionContext,
): DecisionProposal {
  if (!isRecord(value)) invalid('MALFORMED_PROPOSAL', 'proposal');
  if (
    typeof value.rationale !== 'string' ||
    value.rationale.trim().length === 0
  ) {
    invalid('INVALID_RATIONALE', 'rationale');
  }
  if (!Array.isArray(value.proposedActions)) {
    invalid('MALFORMED_PROPOSAL', 'proposedActions');
  }
  const actions = value.proposedActions.map((action, index) =>
    validateAction(action, index),
  );
  for (const [index, action] of actions.entries()) {
    const resource = `proposedActions[${index}]`;
    if (action.leagueId !== context.snapshot.league.id) {
      invalid('ACTION_LEAGUE_MISMATCH', resource);
    }
    if (action.teamId !== context.managedTeamId) {
      invalid('ACTION_TEAM_MISMATCH', resource);
    }
    if (
      action.type === 'set-lineup' &&
      action.scoringPeriod !== context.snapshot.scoringPeriod
    ) {
      invalid('ACTION_PERIOD_MISMATCH', resource);
    }
  }
  return { rationale: value.rationale, proposedActions: actions };
}

function validateEngineDescriptor(engine: DecisionEngineDescriptor): void {
  if (typeof engine.id !== 'string' || engine.id.trim().length === 0) {
    invalid('INVALID_ENGINE_ID', String(engine.id));
  }
  if (
    typeof engine.version !== 'string' ||
    engine.version.trim().length === 0
  ) {
    invalid('INVALID_ENGINE_VERSION', String(engine.version));
  }
  if (
    engine.kind !== 'deterministic' &&
    engine.kind !== 'human' &&
    engine.kind !== 'model' &&
    engine.kind !== 'external-service'
  ) {
    invalid('INVALID_ENGINE_KIND', String(engine.kind));
  }
}

function validateAction(value: unknown, index: number): FantasyActionIntent {
  const resource = `proposedActions[${index}]`;
  if (!isRecord(value)) invalid('MALFORMED_ACTION', resource);
  for (const field of ['leagueId', 'teamId'] as const) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      invalid('MALFORMED_ACTION', `${resource}.${field}`);
    }
  }
  switch (value.type) {
    case 'set-lineup':
      if (
        typeof value.scoringPeriod !== 'string' ||
        value.scoringPeriod.trim().length === 0 ||
        !Array.isArray(value.assignments) ||
        !value.assignments.every(isLineupAssignment)
      ) {
        invalid('MALFORMED_ACTION', resource);
      }
      return value as unknown as FantasyActionIntent;
    case 'add-player':
    case 'drop-player':
      if (!isNonEmptyString(value.playerId)) {
        invalid('MALFORMED_ACTION', resource);
      }
      return value as unknown as FantasyActionIntent;
    case 'add-drop':
      if (
        !isNonEmptyString(value.addPlayerId) ||
        !isNonEmptyString(value.dropPlayerId)
      ) {
        invalid('MALFORMED_ACTION', resource);
      }
      return value as unknown as FantasyActionIntent;
    case 'waiver-claim':
      if (
        !isNonEmptyString(value.addPlayerId) ||
        (value.dropPlayerId !== undefined &&
          !isNonEmptyString(value.dropPlayerId)) ||
        (value.bid !== undefined &&
          (typeof value.bid !== 'number' ||
            !Number.isSafeInteger(value.bid) ||
            value.bid < 0))
      ) {
        invalid('MALFORMED_ACTION', resource);
      }
      return value as unknown as FantasyActionIntent;
    default:
      invalid('UNSUPPORTED_ACTION_TYPE', resource);
  }
}

function assignActionIds(
  proposal: DecisionProposal,
  actionIdFactory: DecisionRunnerOptions['actionIdFactory'],
): readonly FantasyAction[] {
  const ids = new Set<string>();
  return proposal.proposedActions.map((intent, index): FantasyAction => {
    const id = actionIdFactory(index, intent);
    if (typeof id !== 'string' || id.trim().length === 0) {
      invalid('INVALID_ACTION_ID', `proposedActions[${index}]`);
    }
    if (ids.has(id)) invalid('DUPLICATE_ACTION_ID', id);
    ids.add(id);
    return { ...intent, id };
  });
}

function isLineupAssignment(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.slotId) &&
    isNonEmptyString(value.playerId)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validClockValue(value: Date, resource: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    invalid('INVALID_CLOCK_VALUE', resource);
  }
  return value;
}

function invalid(code: string, resource: string): never {
  throw new DecisionValidationError(
    `Decision validation failed for ${resource}`,
    { code, resource },
  );
}
