import type { DecisionContext, DecisionEngine } from '@eggbot/agent';
import type {
  LineupAssignment,
  Player,
  PlayerId,
  RosterSlot,
} from '@eggbot/core';

export interface ProjectedLineupDecisionEngineOptions {
  readonly id?: string;
  readonly version?: string;
  readonly minimumProjectedPointGain?: number;
  readonly requireCompleteProjectionCoverage?: boolean;
}

export function createProjectedLineupDecisionEngine(
  options: ProjectedLineupDecisionEngineOptions = {},
): DecisionEngine {
  const minimumGain = options.minimumProjectedPointGain ?? 0.1;
  if (!Number.isFinite(minimumGain) || minimumGain < 0) {
    throw new RangeError(
      'minimumProjectedPointGain must be a finite non-negative number',
    );
  }
  const requireComplete = options.requireCompleteProjectionCoverage ?? true;
  return {
    id: options.id ?? 'eggbot-projected-lineup',
    version: options.version ?? '1.0.0',
    kind: 'deterministic',
    decide: (context) =>
      Promise.resolve(decideLineup(context, minimumGain, requireComplete)),
  };
}

function decideLineup(
  context: DecisionContext,
  minimumGain: number,
  requireComplete: boolean,
) {
  const team = context.snapshot.teams.find(
    ({ team }) => team.id === context.managedTeamId,
  );
  if (team === undefined) return noAction('Managed team is absent.');
  const rosterRisk = context.analytics.rosterRisk.find(
    ({ teamId }) => teamId === context.managedTeamId,
  );
  if ((rosterRisk?.sourceIntegrityWarningCount ?? 0) > 0) {
    return noAction(
      'Lineup unchanged because the managed roster has source-integrity warnings.',
    );
  }

  const slots = context.snapshot.league.settings.rosterSlots;
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const activeSlots = slots.filter(({ kind }) => kind === 'active');
  const benchSlots = slots.filter(({ kind }) => kind === 'bench');
  const reservePlayerIds = new Set(
    team.lineup.assignments.flatMap(({ slotId, playerId }) =>
      slotById.get(slotId)?.kind === 'reserve' ? [playerId] : [],
    ),
  );
  const candidates = team.roster.entries
    .map(({ player }) => player)
    .filter(({ id }) => !reservePlayerIds.has(id));
  const projections = new Map(
    context.analytics.playerProjections.map((projection) => [
      projection.playerId,
      projection.points,
    ]),
  );
  if (
    requireComplete &&
    candidates.some(({ id }) => projections.get(id) === undefined)
  ) {
    return noAction(
      'Lineup unchanged because movable roster projection coverage is incomplete.',
    );
  }
  const projectedCandidates = candidates.filter(({ id }) =>
    projections.has(id),
  );
  const optimized = maximizeActiveAssignments(
    activeSlots,
    projectedCandidates,
    projections,
  );
  if (optimized === undefined) {
    return noAction('Lineup unchanged because active slots cannot be filled.');
  }

  const activePlayerIds = new Set(
    optimized.assignments.map(({ playerId }) => playerId),
  );
  const remaining = candidates.filter(({ id }) => !activePlayerIds.has(id));
  if (remaining.length > benchSlots.length) {
    return noAction(
      'Lineup unchanged because movable players exceed active and bench capacity.',
    );
  }
  const benchAssignments = assignBenchPlayers(
    benchSlots,
    remaining,
    team.lineup.assignments,
  );
  const assignments = [...optimized.assignments, ...benchAssignments];
  const currentBySlot = new Map(
    team.lineup.assignments.map(({ slotId, playerId }) => [slotId, playerId]),
  );
  const currentPoints = activeSlots.reduce((total, slot) => {
    const playerId = currentBySlot.get(slot.id);
    return (
      total + (playerId === undefined ? 0 : (projections.get(playerId) ?? 0))
    );
  }, 0);
  const gain = optimized.points - currentPoints;
  const changed = assignments.some(
    ({ slotId, playerId }) => currentBySlot.get(slotId) !== playerId,
  );
  if (!changed || gain < minimumGain) {
    return noAction(
      `Lineup unchanged; best projected gain ${formatPoints(gain)} is below ${formatPoints(minimumGain)}.`,
    );
  }
  return {
    rationale: `Set the highest projected legal lineup for a ${formatPoints(gain)} point gain.`,
    proposedActions: [
      {
        type: 'set-lineup' as const,
        leagueId: context.snapshot.league.id,
        teamId: context.managedTeamId,
        scoringPeriod: context.snapshot.scoringPeriod,
        assignments,
      },
    ],
  };
}

function maximizeActiveAssignments(
  slots: readonly RosterSlot[],
  players: readonly Player[],
  projections: ReadonlyMap<PlayerId, number>,
):
  | {
      readonly assignments: readonly LineupAssignment[];
      readonly points: number;
    }
  | undefined {
  const sortedPlayers = [...players].sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  );
  const sortedSlots = [...slots].sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  );
  const source = 0;
  const firstPlayer = 1;
  const firstSlot = firstPlayer + sortedPlayers.length;
  const sink = firstSlot + sortedSlots.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const assignmentEdges: {
    readonly player: Player;
    readonly slot: RosterSlot;
    readonly edge: Edge;
  }[] = [];
  sortedPlayers.forEach((player, playerIndex) => {
    addEdge(graph, source, firstPlayer + playerIndex, 1, 0);
    sortedSlots.forEach((slot, slotIndex) => {
      if (!eligible(player, slot)) return;
      const edge = addEdge(
        graph,
        firstPlayer + playerIndex,
        firstSlot + slotIndex,
        1,
        -(projections.get(player.id) ?? 0),
      );
      assignmentEdges.push({ player, slot, edge });
    });
  });
  sortedSlots.forEach((_slot, slotIndex) =>
    addEdge(graph, firstSlot + slotIndex, sink, 1, 0),
  );
  for (let flow = 0; flow < sortedSlots.length; flow += 1) {
    if (!augment(graph, source, sink)) return undefined;
  }
  const assignments = assignmentEdges
    .filter(({ edge }) => edge.capacity === 0)
    .map(({ player, slot }) => ({ slotId: slot.id, playerId: player.id }))
    .sort((left, right) =>
      String(left.slotId).localeCompare(String(right.slotId)),
    );
  return {
    assignments,
    points: assignments.reduce(
      (total, { playerId }) => total + (projections.get(playerId) ?? 0),
      0,
    ),
  };
}

interface Edge {
  readonly to: number;
  readonly reverseIndex: number;
  capacity: number;
  readonly cost: number;
}

function addEdge(
  graph: Edge[][],
  from: number,
  to: number,
  capacity: number,
  cost: number,
): Edge {
  const forward: Edge = {
    to,
    reverseIndex: graph[to]!.length,
    capacity,
    cost,
  };
  const reverse: Edge = {
    to: from,
    reverseIndex: graph[from]!.length,
    capacity: 0,
    cost: -cost,
  };
  graph[from]!.push(forward);
  graph[to]!.push(reverse);
  return forward;
}

function augment(graph: Edge[][], source: number, sink: number): boolean {
  const distance = Array.from({ length: graph.length }, () => Infinity);
  const previous: (
    { readonly node: number; readonly edgeIndex: number } | undefined
  )[] = Array.from({ length: graph.length }, () => undefined);
  distance[source] = 0;
  for (let iteration = 0; iteration < graph.length - 1; iteration += 1) {
    let changed = false;
    graph.forEach((edges, node) => {
      if (!Number.isFinite(distance[node])) return;
      edges.forEach((edge, edgeIndex) => {
        const next = distance[node]! + edge.cost;
        if (edge.capacity < 1 || next >= distance[edge.to]!) return;
        distance[edge.to] = next;
        previous[edge.to] = { node, edgeIndex };
        changed = true;
      });
    });
    if (!changed) break;
  }
  if (previous[sink] === undefined) return false;
  for (let node = sink; node !== source;) {
    const step = previous[node];
    if (step === undefined) return false;
    const edge = graph[step.node]![step.edgeIndex]!;
    edge.capacity -= 1;
    graph[node]![edge.reverseIndex]!.capacity += 1;
    node = step.node;
  }
  return true;
}

function assignBenchPlayers(
  slots: readonly RosterSlot[],
  players: readonly Player[],
  current: readonly LineupAssignment[],
): readonly LineupAssignment[] {
  const remaining = new Map(players.map((player) => [player.id, player]));
  const currentBySlot = new Map(
    current.map(({ slotId, playerId }) => [slotId, playerId]),
  );
  const assignments: LineupAssignment[] = [];
  const openSlots: RosterSlot[] = [];
  for (const slot of [...slots].sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  )) {
    const playerId = currentBySlot.get(slot.id);
    if (playerId !== undefined && remaining.delete(playerId)) {
      assignments.push({ slotId: slot.id, playerId });
    } else {
      openSlots.push(slot);
    }
  }
  const unassigned = [...remaining.values()].sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  );
  openSlots.forEach((slot, index) => {
    const player = unassigned[index];
    if (player !== undefined) {
      assignments.push({ slotId: slot.id, playerId: player.id });
    }
  });
  return assignments;
}

function eligible(player: Player, slot: RosterSlot): boolean {
  return slot.eligiblePositions.some((position) =>
    player.eligiblePositions.includes(position),
  );
}

function noAction(rationale: string) {
  return { rationale, proposedActions: [] };
}

function formatPoints(value: number): string {
  return value.toFixed(2);
}
