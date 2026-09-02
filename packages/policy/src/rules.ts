import type {
  ActionId,
  FantasyAction,
  LeagueSnapshot,
  Player,
  PlayerId,
  RosterSlot,
  TeamSnapshot,
} from '@eggbot/core';
import type { DecisionRun } from '@eggbot/agent';

import type {
  PolicyContext,
  PolicyGuardrails,
  PolicyIssueResource,
  PolicyRuleIssue,
} from './types.js';

export interface PolicyIssueDraft extends PolicyRuleIssue {
  readonly ruleId: string;
}

export interface BuiltInPolicyState {
  readonly context: PolicyContext;
  readonly snapshot: LeagueSnapshot;
  readonly team: TeamSnapshot;
  readonly rosteredPlayers: ReadonlyMap<PlayerId, Player>;
  readonly freeAgentIds: ReadonlySet<PlayerId>;
  readonly waiverIds: ReadonlySet<PlayerId>;
  readonly slots: ReadonlyMap<string, RosterSlot>;
  readonly protectedPlayerIds: ReadonlySet<PlayerId>;
}

export function createBuiltInPolicyState(
  context: PolicyContext,
  run: DecisionRun,
  guardrails: PolicyGuardrails,
): BuiltInPolicyState {
  const team = run.snapshot.teams.find(
    ({ team }) => team.id === run.managedTeamId,
  );
  if (team === undefined) {
    throw new Error('Validated policy context did not contain managed team');
  }
  return {
    context,
    snapshot: run.snapshot,
    team,
    rosteredPlayers: new Map(
      team.roster.entries.map(({ player }) => [player.id, player]),
    ),
    freeAgentIds: new Set(
      run.snapshot.playerPool.freeAgents.items.map(({ id }) => id),
    ),
    waiverIds: new Set(
      run.snapshot.playerPool.waivers.items.map(({ id }) => id),
    ),
    slots: new Map(
      run.snapshot.league.settings.rosterSlots.map((slot) => [slot.id, slot]),
    ),
    protectedPlayerIds: new Set(guardrails.protectedPlayerIds ?? []),
  };
}

export function evaluateBuiltInAction(
  action: FantasyAction,
  state: BuiltInPolicyState,
  guardrails: PolicyGuardrails,
): readonly PolicyIssueDraft[] {
  const issues: PolicyIssueDraft[] = [];
  if (action.leagueId !== state.snapshot.league.id) {
    issues.push(
      issue(
        'eggbot.scope',
        'ACTION_LEAGUE_MISMATCH',
        'Action targets another league',
        {
          kind: 'action',
          id: action.id,
        },
      ),
    );
  }
  if (action.teamId !== state.team.team.id) {
    issues.push(
      issue(
        'eggbot.scope',
        'ACTION_TEAM_MISMATCH',
        'Action targets another team',
        {
          kind: 'action',
          id: action.id,
        },
      ),
    );
  }
  if (action.type === 'set-lineup') {
    issues.push(...evaluateLineup(action, state));
  } else {
    issues.push(...evaluateRosterMutation(action, state, guardrails));
  }
  return issues;
}

export function evaluateGlobalGuardrails(
  actions: readonly FantasyAction[],
  snapshot: LeagueSnapshot,
  context: PolicyContext,
  guardrails: PolicyGuardrails,
): ReadonlyMap<FantasyAction, readonly PolicyIssueDraft[]> {
  const issues = actionIssueMap(actions);
  if (
    guardrails.maxActionsPerDecision !== undefined &&
    actions.length > guardrails.maxActionsPerDecision
  ) {
    addToActions(
      issues,
      actions,
      issue(
        'eggbot.guardrail',
        'DECISION_ACTION_LIMIT_EXCEEDED',
        `Decision proposes ${actions.length} actions; limit is ${guardrails.maxActionsPerDecision}`,
        { kind: 'decision', id: 'action-count' },
      ),
    );
  }
  const mutations = actions.filter(({ type }) => type !== 'set-lineup');
  if (
    guardrails.maxRosterMutationActions !== undefined &&
    mutations.length > guardrails.maxRosterMutationActions
  ) {
    addToActions(
      issues,
      mutations,
      issue(
        'eggbot.guardrail',
        'ROSTER_MUTATION_LIMIT_EXCEEDED',
        `Decision proposes ${mutations.length} roster mutations; limit is ${guardrails.maxRosterMutationActions}`,
        { kind: 'decision', id: 'roster-mutation-count' },
      ),
    );
  }
  if (guardrails.maxSnapshotAgeMs !== undefined) {
    const age =
      Date.parse(context.evaluatedAt) - Date.parse(snapshot.capturedAt);
    if (age > guardrails.maxSnapshotAgeMs) {
      addToActions(
        issues,
        actions,
        issue(
          'eggbot.guardrail',
          'SNAPSHOT_TOO_OLD',
          `Snapshot age ${age}ms exceeds limit ${guardrails.maxSnapshotAgeMs}ms`,
          { kind: 'snapshot', id: snapshot.id },
        ),
      );
    }
  }
  return issues;
}

export function detectActionConflicts(
  actions: readonly FantasyAction[],
): ReadonlyMap<FantasyAction, readonly PolicyIssueDraft[]> {
  const issues = actionIssueMap(actions);
  rejectGroups(
    groupBy(actions, ({ id }) => id),
    issues,
    'DUPLICATE_ACTION_ID',
    'Decision contains a duplicate action ID',
  );
  rejectGroups(
    groupBy(actions, actionFingerprint),
    issues,
    'DUPLICATE_ACTION',
    'Decision contains the same action intent more than once',
  );
  rejectGroups(
    groupBy(
      actions.filter(({ type }) => type === 'set-lineup'),
      () => 'set-lineup',
    ),
    issues,
    'MULTIPLE_LINEUP_ACTIONS',
    'Decision contains multiple lineup actions for one scoring period',
  );

  const transactionReferences = actions.flatMap((action) =>
    action.type === 'set-lineup' ? [] : transactionPlayerReferences(action),
  );
  for (const references of groupBy(
    transactionReferences,
    ({ playerId }) => playerId,
  ).values()) {
    const distinctActions = uniqueActions(
      references.map(({ action }) => action),
    );
    if (distinctActions.length < 2) continue;
    const roles = new Set(references.map(({ role }) => role));
    const message =
      roles.size > 1
        ? 'Player is both added and dropped across proposed actions'
        : `Player is ${roles.has('add') ? 'added' : 'dropped'} by multiple proposed actions`;
    addConflictIssues(
      issues,
      distinctActions,
      'PLAYER_ACTION_CONFLICT',
      message,
      { kind: 'player', id: references[0]?.playerId ?? 'unknown' },
    );
  }

  const dropped = new Map<PlayerId, FantasyAction[]>();
  for (const reference of transactionReferences) {
    if (reference.role !== 'drop') continue;
    const existing = dropped.get(reference.playerId) ?? [];
    existing.push(reference.action);
    dropped.set(reference.playerId, existing);
  }
  for (const lineup of actions.filter(
    (action): action is Extract<FantasyAction, { type: 'set-lineup' }> =>
      action.type === 'set-lineup',
  )) {
    for (const { playerId } of lineup.assignments) {
      const drops = dropped.get(playerId);
      if (drops === undefined) continue;
      addConflictIssues(
        issues,
        uniqueActions([lineup, ...drops]),
        'LINEUP_DROP_CONFLICT',
        'Player is assigned in a lineup and dropped in the same decision',
        { kind: 'player', id: playerId },
      );
    }
  }
  return issues;
}

function evaluateLineup(
  action: Extract<FantasyAction, { type: 'set-lineup' }>,
  state: BuiltInPolicyState,
): readonly PolicyIssueDraft[] {
  const issues: PolicyIssueDraft[] = [];
  if (action.scoringPeriod !== state.snapshot.scoringPeriod) {
    issues.push(
      issue(
        'eggbot.scope',
        'ACTION_PERIOD_MISMATCH',
        'Lineup action targets another scoring period',
        { kind: 'scoring-period', id: action.scoringPeriod },
      ),
    );
  }
  if (action.assignments.length === 0) {
    issues.push(
      issue(
        'eggbot.lineup',
        'EMPTY_LINEUP',
        'Lineup action has no assignments',
        {
          kind: 'action',
          id: action.id,
        },
      ),
    );
  }
  addDuplicateAssignmentIssue(
    issues,
    action.assignments.map(({ playerId }) => playerId),
    'DUPLICATE_LINEUP_PLAYER',
    'A player is assigned more than once',
    'player',
  );
  addDuplicateAssignmentIssue(
    issues,
    action.assignments.map(({ slotId }) => slotId),
    'DUPLICATE_LINEUP_SLOT',
    'A roster slot is assigned more than once',
    'roster-slot',
  );

  for (const assignment of action.assignments) {
    const slot = state.slots.get(assignment.slotId);
    const player = state.rosteredPlayers.get(assignment.playerId);
    if (slot === undefined) {
      issues.push(
        issue(
          'eggbot.lineup',
          'UNKNOWN_ROSTER_SLOT',
          'Roster slot does not exist',
          {
            kind: 'roster-slot',
            id: assignment.slotId,
          },
        ),
      );
    }
    if (player === undefined) {
      issues.push(
        issue(
          'eggbot.lineup',
          'PLAYER_NOT_ROSTERED',
          'Lineup player is not rostered',
          {
            kind: 'player',
            id: assignment.playerId,
          },
        ),
      );
    }
    if (
      slot?.kind === 'active' &&
      player !== undefined &&
      !slot.eligiblePositions.some((position) =>
        player.eligiblePositions.includes(position),
      )
    ) {
      issues.push(
        issue(
          'eggbot.lineup',
          'PLAYER_INELIGIBLE_FOR_SLOT',
          `${player.fullName} is not eligible for ${slot.name}`,
          { kind: 'player', id: player.id },
        ),
      );
    }
  }

  const movedPlayers = new Set(
    action.assignments.map(({ playerId }) => playerId),
  );
  const resultingSlots = new Map(
    state.team.lineup.assignments
      .filter(({ playerId }) => !movedPlayers.has(playerId))
      .map(({ slotId, playerId }) => [slotId, playerId]),
  );
  for (const assignment of action.assignments) {
    if (resultingSlots.has(assignment.slotId)) {
      issues.push(
        issue(
          'eggbot.lineup',
          'LINEUP_SLOT_OCCUPIED',
          'Roster slot remains occupied by an untouched player',
          { kind: 'roster-slot', id: assignment.slotId },
        ),
      );
    }
    resultingSlots.set(assignment.slotId, assignment.playerId);
  }
  for (const slot of state.slots.values()) {
    if (slot.kind === 'active' && !resultingSlots.has(slot.id)) {
      issues.push(
        issue(
          'eggbot.lineup',
          'INCOMPLETE_STARTING_LINEUP',
          `Resulting lineup leaves ${slot.name} empty`,
          { kind: 'roster-slot', id: slot.id },
        ),
      );
    }
  }
  return issues;
}

function evaluateRosterMutation(
  action: Exclude<FantasyAction, { type: 'set-lineup' }>,
  state: BuiltInPolicyState,
  guardrails: PolicyGuardrails,
): readonly PolicyIssueDraft[] {
  const issues: PolicyIssueDraft[] = [];
  const addPlayerId = addedPlayerId(action);
  const dropPlayerId = droppedPlayerId(action);
  if (addPlayerId !== undefined && addPlayerId === dropPlayerId) {
    issues.push(
      issue(
        'eggbot.roster',
        'SAME_ADD_DROP_PLAYER',
        'Add and drop players must differ',
        { kind: 'player', id: addPlayerId },
      ),
    );
  }
  if (addPlayerId !== undefined && state.rosteredPlayers.has(addPlayerId)) {
    issues.push(
      issue(
        'eggbot.roster',
        'PLAYER_ALREADY_ROSTERED',
        'Added player is already rostered',
        { kind: 'player', id: addPlayerId },
      ),
    );
  }
  if (dropPlayerId !== undefined && !state.rosteredPlayers.has(dropPlayerId)) {
    issues.push(
      issue(
        'eggbot.roster',
        'DROP_PLAYER_NOT_ROSTERED',
        'Dropped player is not rostered',
        { kind: 'player', id: dropPlayerId },
      ),
    );
  }
  if (
    dropPlayerId !== undefined &&
    state.team.lineup.assignments.some(
      ({ playerId, slotId }) =>
        playerId === dropPlayerId && state.slots.get(slotId)?.kind === 'active',
    )
  ) {
    issues.push(
      issue(
        'eggbot.roster',
        'DROP_PLAYER_IN_ACTIVE_LINEUP',
        'Player cannot be dropped while assigned to an active lineup slot',
        { kind: 'player', id: dropPlayerId },
      ),
    );
  }
  if (
    dropPlayerId !== undefined &&
    state.protectedPlayerIds.has(dropPlayerId)
  ) {
    issues.push(
      issue(
        'eggbot.guardrail',
        'PROTECTED_PLAYER',
        'Protected player cannot be dropped',
        { kind: 'player', id: dropPlayerId },
      ),
    );
  }
  if (addPlayerId !== undefined) {
    issues.push(...evaluateAcquisition(action, addPlayerId, state));
  }
  if (
    addPlayerId !== undefined &&
    dropPlayerId === undefined &&
    state.team.roster.entries.length >= state.slots.size
  ) {
    issues.push(
      issue(
        'eggbot.roster',
        'ROSTER_CAPACITY_EXCEEDED',
        'Acquisition has no open roster slot and does not drop a player',
        { kind: 'player', id: addPlayerId },
      ),
    );
  }
  if (
    action.type === 'waiver-claim' &&
    action.bid !== undefined &&
    guardrails.maxWaiverBid !== undefined &&
    action.bid > guardrails.maxWaiverBid
  ) {
    issues.push(
      issue(
        'eggbot.guardrail',
        'WAIVER_BID_LIMIT_EXCEEDED',
        `Waiver bid ${action.bid} exceeds limit ${guardrails.maxWaiverBid}`,
        { kind: 'action', id: action.id },
      ),
    );
  }
  return issues;
}

function evaluateAcquisition(
  action: Exclude<FantasyAction, { type: 'set-lineup' }>,
  playerId: PlayerId,
  state: BuiltInPolicyState,
): readonly PolicyIssueDraft[] {
  if (action.type === 'waiver-claim') {
    if (state.waiverIds.has(playerId)) return [];
    return [
      issue(
        'eggbot.acquisition',
        state.freeAgentIds.has(playerId)
          ? 'WAIVER_TARGET_IS_FREE_AGENT'
          : 'PLAYER_NOT_IN_CAPTURED_WAIVER_POOL',
        state.freeAgentIds.has(playerId)
          ? 'Waiver claim target is currently a free agent'
          : 'Waiver claim target is absent from the captured waiver pool',
        { kind: 'player', id: playerId },
      ),
    ];
  }
  if (state.freeAgentIds.has(playerId)) return [];
  return [
    issue(
      'eggbot.acquisition',
      state.waiverIds.has(playerId)
        ? 'FREE_AGENT_ACTION_REQUIRES_WAIVER'
        : 'PLAYER_NOT_IN_CAPTURED_FREE_AGENT_POOL',
      state.waiverIds.has(playerId)
        ? 'Immediate acquisition target requires a waiver claim'
        : 'Acquisition target is absent from the captured free-agent pool',
      { kind: 'player', id: playerId },
    ),
  ];
}

function addDuplicateAssignmentIssue(
  issues: PolicyIssueDraft[],
  values: readonly string[],
  code: string,
  message: string,
  kind: 'player' | 'roster-slot',
): void {
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const value of values) {
    if (seen.has(value) && !reported.has(value)) {
      issues.push(issue('eggbot.lineup', code, message, { kind, id: value }));
      reported.add(value);
    }
    seen.add(value);
  }
}

function rejectGroups(
  groups: ReadonlyMap<string, readonly FantasyAction[]>,
  issues: Map<FantasyAction, PolicyIssueDraft[]>,
  code: string,
  message: string,
): void {
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    addConflictIssues(issues, group, code, message, {
      kind: 'action',
      id: group[0]?.id ?? 'unknown',
    });
  }
}

function addConflictIssues(
  issues: Map<FantasyAction, PolicyIssueDraft[]>,
  actions: readonly FantasyAction[],
  code: string,
  message: string,
  resource: PolicyIssueResource,
): void {
  for (const action of actions) {
    const relatedActionIds = actions
      .filter((candidate) => candidate !== action)
      .map(({ id }) => id);
    issues
      .get(action)
      ?.push(
        issue('eggbot.conflict', code, message, resource, relatedActionIds),
      );
  }
}

function addToActions(
  issues: Map<FantasyAction, PolicyIssueDraft[]>,
  actions: readonly FantasyAction[],
  draft: PolicyIssueDraft,
): void {
  for (const action of actions) issues.get(action)?.push(draft);
}

function actionIssueMap(
  actions: readonly FantasyAction[],
): Map<FantasyAction, PolicyIssueDraft[]> {
  return new Map(actions.map((action) => [action, []]));
}

function groupBy<Value>(
  values: readonly Value[],
  key: (value: Value) => string,
): Map<string, Value[]> {
  const groups = new Map<string, Value[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey) ?? [];
    group.push(value);
    groups.set(groupKey, group);
  }
  return groups;
}

function uniqueActions(actions: readonly FantasyAction[]): FantasyAction[] {
  return [...new Set(actions)];
}

function transactionPlayerReferences(
  action: Exclude<FantasyAction, { type: 'set-lineup' }>,
): readonly {
  action: FantasyAction;
  playerId: PlayerId;
  role: 'add' | 'drop';
}[] {
  const added = addedPlayerId(action);
  const dropped = droppedPlayerId(action);
  return [
    ...(added === undefined
      ? []
      : [{ action, playerId: added, role: 'add' as const }]),
    ...(dropped === undefined
      ? []
      : [{ action, playerId: dropped, role: 'drop' as const }]),
  ];
}

function addedPlayerId(
  action: Exclude<FantasyAction, { type: 'set-lineup' }>,
): PlayerId | undefined {
  if (action.type === 'add-player') return action.playerId;
  if (action.type === 'drop-player') return undefined;
  return action.addPlayerId;
}

function droppedPlayerId(
  action: Exclude<FantasyAction, { type: 'set-lineup' }>,
): PlayerId | undefined {
  if (action.type === 'drop-player') return action.playerId;
  if (action.type === 'add-player') return undefined;
  return action.dropPlayerId;
}

function actionFingerprint(action: FantasyAction): string {
  switch (action.type) {
    case 'set-lineup':
      return JSON.stringify({
        type: action.type,
        leagueId: action.leagueId,
        teamId: action.teamId,
        scoringPeriod: action.scoringPeriod,
        assignments: [...action.assignments]
          .map(({ slotId, playerId }) => ({ slotId, playerId }))
          .sort(
            (left, right) =>
              String(left.slotId).localeCompare(String(right.slotId)) ||
              String(left.playerId).localeCompare(String(right.playerId)),
          ),
      });
    case 'add-player':
    case 'drop-player':
      return JSON.stringify({
        type: action.type,
        leagueId: action.leagueId,
        teamId: action.teamId,
        playerId: action.playerId,
      });
    case 'add-drop':
      return JSON.stringify({
        type: action.type,
        leagueId: action.leagueId,
        teamId: action.teamId,
        addPlayerId: action.addPlayerId,
        dropPlayerId: action.dropPlayerId,
      });
    case 'waiver-claim':
      return JSON.stringify({
        type: action.type,
        leagueId: action.leagueId,
        teamId: action.teamId,
        addPlayerId: action.addPlayerId,
        dropPlayerId: action.dropPlayerId,
        bid: action.bid,
      });
  }
}

function issue(
  ruleId: string,
  code: string,
  message: string,
  resource?: PolicyIssueResource,
  relatedActionIds?: readonly ActionId[],
): PolicyIssueDraft {
  return {
    ruleId,
    code,
    message,
    ...(resource === undefined ? {} : { resource }),
    ...(relatedActionIds === undefined ? {} : { relatedActionIds }),
  };
}
