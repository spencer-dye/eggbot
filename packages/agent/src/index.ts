import type { LeagueAnalytics } from '@eggbot/analytics';
import {
  actionId,
  decisionId,
  leagueId,
  playerId,
  rosterSlotId,
  teamId,
  type ActionId,
  type AddDropAction,
  type AddPlayerAction,
  type DecisionId,
  type DropPlayerAction,
  type FantasyAction,
  type FantasyDecision,
  type LeagueSnapshot,
  type SetLineupAction,
  type SnapshotId,
  type TeamId,
  type WaiverClaimAction,
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
  const id = parseIdentifier(
    decisionId,
    options.decisionIdFactory(),
    'INVALID_DECISION_ID',
    'decision',
  );
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
  return { rationale: value.rationale.trim(), proposedActions: actions };
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
  const base = {
    leagueId: parseIdentifier(
      leagueId,
      value.leagueId,
      'MALFORMED_ACTION',
      `${resource}.leagueId`,
    ),
    teamId: parseIdentifier(
      teamId,
      value.teamId,
      'MALFORMED_ACTION',
      `${resource}.teamId`,
    ),
  };
  switch (value.type) {
    case 'set-lineup': {
      if (
        typeof value.scoringPeriod !== 'string' ||
        value.scoringPeriod.trim().length === 0 ||
        !Array.isArray(value.assignments)
      ) {
        invalid('MALFORMED_ACTION', resource);
      }
      return {
        ...base,
        type: 'set-lineup',
        scoringPeriod: value.scoringPeriod.trim(),
        assignments: value.assignments.map((assignment, assignmentIndex) =>
          normalizeLineupAssignment(
            assignment,
            `${resource}.assignments[${assignmentIndex}]`,
          ),
        ),
      };
    }
    case 'add-player':
      return {
        ...base,
        type: 'add-player',
        playerId: parseIdentifier(
          playerId,
          value.playerId,
          'MALFORMED_ACTION',
          `${resource}.playerId`,
        ),
      };
    case 'drop-player':
      return {
        ...base,
        type: 'drop-player',
        playerId: parseIdentifier(
          playerId,
          value.playerId,
          'MALFORMED_ACTION',
          `${resource}.playerId`,
        ),
      };
    case 'add-drop':
      return {
        ...base,
        type: 'add-drop',
        addPlayerId: parseIdentifier(
          playerId,
          value.addPlayerId,
          'MALFORMED_ACTION',
          `${resource}.addPlayerId`,
        ),
        dropPlayerId: parseIdentifier(
          playerId,
          value.dropPlayerId,
          'MALFORMED_ACTION',
          `${resource}.dropPlayerId`,
        ),
      };
    case 'waiver-claim': {
      if (
        value.bid !== undefined &&
        (typeof value.bid !== 'number' ||
          !Number.isSafeInteger(value.bid) ||
          value.bid < 0)
      ) {
        invalid('MALFORMED_ACTION', resource);
      }
      return {
        ...base,
        type: 'waiver-claim',
        addPlayerId: parseIdentifier(
          playerId,
          value.addPlayerId,
          'MALFORMED_ACTION',
          `${resource}.addPlayerId`,
        ),
        ...(value.dropPlayerId === undefined
          ? {}
          : {
              dropPlayerId: parseIdentifier(
                playerId,
                value.dropPlayerId,
                'MALFORMED_ACTION',
                `${resource}.dropPlayerId`,
              ),
            }),
        ...(value.bid === undefined ? {} : { bid: value.bid }),
      };
    }
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
    const id = parseIdentifier(
      actionId,
      actionIdFactory(index, intent),
      'INVALID_ACTION_ID',
      `proposedActions[${index}]`,
    );
    if (ids.has(id)) invalid('DUPLICATE_ACTION_ID', id);
    ids.add(id);
    return { ...intent, id };
  });
}

function normalizeLineupAssignment(value: unknown, resource: string) {
  if (!isRecord(value)) invalid('MALFORMED_ACTION', resource);
  return {
    slotId: parseIdentifier(
      rosterSlotId,
      value.slotId,
      'MALFORMED_ACTION',
      `${resource}.slotId`,
    ),
    playerId: parseIdentifier(
      playerId,
      value.playerId,
      'MALFORMED_ACTION',
      `${resource}.playerId`,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validClockValue(value: Date, resource: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    invalid('INVALID_CLOCK_VALUE', resource);
  }
  return value;
}

function parseIdentifier<Identifier>(
  parser: (value: unknown) => Identifier,
  value: unknown,
  code: string,
  resource: string,
): Identifier {
  try {
    return parser(value);
  } catch (cause) {
    throw new DecisionValidationError(
      `Decision validation failed for ${resource}`,
      { code, resource, cause },
    );
  }
}

function invalid(code: string, resource: string): never {
  throw new DecisionValidationError(
    `Decision validation failed for ${resource}`,
    { code, resource },
  );
}
