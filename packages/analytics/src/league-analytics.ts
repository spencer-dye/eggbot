import type {
  LeagueSettings,
  LeagueSnapshot,
  Lineup,
  Player,
  PlayerId,
  Position,
  TeamId,
  TeamSnapshot,
} from '@eggbot/core';

import {
  AnalyticsValidationError,
  type AnalyticsWarning,
  type LeagueAnalytics,
  type LineupProjection,
  type MatchupProjection,
  type PlayerProjection,
  type PlayerValueOverReplacement,
  type PositionReplacementLevel,
  type PositionScarcity,
  type ProjectionCoverage,
  type RosterRiskMetrics,
} from './types.js';

const positionOrder: readonly Position[] = [
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DEF',
  'DL',
  'LB',
  'DB',
  'FLEX',
  'SUPER_FLEX',
];

export function analyzeLeagueSnapshot(
  snapshot: LeagueSnapshot,
  projections: readonly PlayerProjection[],
): LeagueAnalytics {
  const projectionByPlayer = validateProjections(projections);
  const relevantPositions = positionsFor(snapshot);
  const availablePlayers = uniquePlayers([
    ...snapshot.playerPool.freeAgents.items,
    ...snapshot.playerPool.waivers.items,
  ]);
  const replacementLevels = relevantPositions.map((position) =>
    replacementLevel(position, availablePlayers, projectionByPlayer),
  );
  const replacementByPosition = new Map(
    replacementLevels.map((level) => [level.position, level]),
  );
  const lineupProjections = snapshot.teams.map(({ lineup }) =>
    projectLineup(lineup, snapshot.league.settings, projectionByPlayer),
  );
  const lineupByTeam = new Map(
    lineupProjections.map((lineup) => [lineup.teamId, lineup]),
  );
  const matchupProjections = snapshot.matchups.map((matchup) =>
    projectMatchup(matchup, lineupByTeam),
  );
  const playerValues = snapshot.teams.flatMap((team) =>
    valuesOverReplacement(
      team,
      relevantPositions,
      replacementByPosition,
      projectionByPlayer,
    ),
  );
  const positionalScarcity = relevantPositions.map((position) =>
    scarcity(position, availablePlayers, projectionByPlayer),
  );
  const rosterRisk = snapshot.teams.map((team) =>
    riskMetrics(
      team,
      requireLineupProjection(lineupByTeam, team.team.id),
      snapshot,
      projectionByPlayer,
    ),
  );
  return {
    sourceSnapshotId: snapshot.id,
    scoringPeriod: snapshot.scoringPeriod,
    lineupProjections,
    matchupProjections,
    replacementLevels,
    playerValues,
    positionalScarcity,
    rosterRisk,
    warnings: analyticsWarnings(snapshot, replacementLevels),
  };
}

/** Sums known projections for assignments occupying active league slots. */
export function sumProjectedStartingLineupPoints(
  lineup: Lineup,
  leagueSettings: LeagueSettings,
  projections: readonly PlayerProjection[],
): number {
  return projectLineup(lineup, leagueSettings, validateProjections(projections))
    .projectedPoints;
}

function projectLineup(
  lineup: Lineup,
  settings: LeagueSettings,
  projections: ReadonlyMap<PlayerId, PlayerProjection>,
): LineupProjection {
  const knownSlots = new Set(settings.rosterSlots.map(({ id }) => id));
  const activeSlotIds = new Set(
    settings.rosterSlots
      .filter(({ kind }) => kind === 'active')
      .map(({ id }) => id),
  );
  for (const assignment of lineup.assignments) {
    if (!knownSlots.has(assignment.slotId)) {
      invalid('UNKNOWN_LINEUP_SLOT', assignment.slotId);
    }
  }
  const activeAssignments = lineup.assignments.filter(({ slotId }) =>
    activeSlotIds.has(slotId),
  );
  const occupiedActiveSlots = new Set(
    activeAssignments.map(({ slotId }) => slotId),
  );
  const missingProjectionPlayerIds: PlayerId[] = [];
  let projectedPoints = 0;
  let projectedCount = 0;
  let projectedFloorPoints = 0;
  let floorCount = 0;
  let projectedCeilingPoints = 0;
  let ceilingCount = 0;
  for (const assignment of activeAssignments) {
    const projection = projections.get(assignment.playerId);
    if (projection === undefined) {
      missingProjectionPlayerIds.push(assignment.playerId);
      continue;
    }
    projectedPoints += projection.points;
    projectedCount += 1;
    if (projection.floor !== undefined) {
      projectedFloorPoints += projection.floor;
      floorCount += 1;
    }
    if (projection.ceiling !== undefined) {
      projectedCeilingPoints += projection.ceiling;
      ceilingCount += 1;
    }
  }
  const totalCount = activeAssignments.length;
  return {
    teamId: lineup.teamId,
    scoringPeriod: lineup.scoringPeriod,
    projectedPoints,
    projectionCoverage: coverage(projectedCount, totalCount),
    missingProjectionPlayerIds,
    unfilledActiveSlotIds: [...activeSlotIds].filter(
      (slotId) => !occupiedActiveSlots.has(slotId),
    ),
    ...(floorCount === 0 ? {} : { projectedFloorPoints }),
    floorCoverage: coverage(floorCount, totalCount),
    ...(ceilingCount === 0 ? {} : { projectedCeilingPoints }),
    ceilingCoverage: coverage(ceilingCount, totalCount),
  };
}

function projectMatchup(
  matchup: LeagueSnapshot['matchups'][number],
  lineups: ReadonlyMap<TeamId, LineupProjection>,
): MatchupProjection {
  const participantLineups = matchup.participants.map(({ teamId }) =>
    requireLineupProjection(lineups, teamId),
  );
  return {
    scoringPeriod: matchup.scoringPeriod,
    participants: participantLineups.map((lineup, index) => {
      const opponents = participantLineups.filter(
        (_opponent, opponentIndex) => opponentIndex !== index,
      );
      const bestOpponent = opponents.reduce<number | undefined>(
        (best, opponent) =>
          best === undefined || opponent.projectedPoints > best
            ? opponent.projectedPoints
            : best,
        undefined,
      );
      return {
        teamId: lineup.teamId,
        projectedPoints: lineup.projectedPoints,
        projectionCoverage: lineup.projectionCoverage,
        ...(bestOpponent === undefined
          ? {}
          : { marginToBestOpponent: lineup.projectedPoints - bestOpponent }),
      };
    }),
  };
}

function replacementLevel(
  position: Position,
  players: readonly Player[],
  projections: ReadonlyMap<PlayerId, PlayerProjection>,
): PositionReplacementLevel {
  const eligible = players.filter(({ eligiblePositions }) =>
    eligiblePositions.includes(position),
  );
  const projected = projectedPlayers(eligible, projections);
  const replacement = projected[0];
  return {
    position,
    availablePlayerCount: eligible.length,
    projectedPlayerCount: projected.length,
    ...(replacement === undefined
      ? {}
      : {
          replacementPlayerId: replacement.player.id,
          replacementPoints: replacement.projection.points,
        }),
  };
}

function valuesOverReplacement(
  team: TeamSnapshot,
  positions: readonly Position[],
  replacements: ReadonlyMap<Position, PositionReplacementLevel>,
  projections: ReadonlyMap<PlayerId, PlayerProjection>,
): readonly PlayerValueOverReplacement[] {
  return team.roster.entries.flatMap(({ player }) => {
    const projection = projections.get(player.id);
    if (projection === undefined) return [];
    return positions.flatMap((position) => {
      if (!player.eligiblePositions.includes(position)) return [];
      const replacement = replacements.get(position)?.replacementPoints;
      if (replacement === undefined) return [];
      return [
        {
          playerId: player.id,
          teamId: team.team.id,
          position,
          projectedPoints: projection.points,
          replacementPoints: replacement,
          valueOverReplacement: projection.points - replacement,
        },
      ];
    });
  });
}

function scarcity(
  position: Position,
  players: readonly Player[],
  projections: ReadonlyMap<PlayerId, PlayerProjection>,
): PositionScarcity {
  const eligible = players.filter(({ eligiblePositions }) =>
    eligiblePositions.includes(position),
  );
  const points = projectedPlayers(eligible, projections).map(
    ({ projection }) => projection.points,
  );
  if (points.length === 0) {
    return {
      position,
      availablePlayerCount: eligible.length,
      projectedPlayerCount: 0,
    };
  }
  const top = points[0] as number;
  const median = medianOfDescending(points);
  return {
    position,
    availablePlayerCount: eligible.length,
    projectedPlayerCount: points.length,
    topAvailablePoints: top,
    medianAvailablePoints: median,
    topToMedianDrop: top - median,
  };
}

function riskMetrics(
  team: TeamSnapshot,
  lineup: LineupProjection,
  snapshot: LeagueSnapshot,
  projections: ReadonlyMap<PlayerId, PlayerProjection>,
): RosterRiskMetrics {
  const activeSlotIds = new Set(
    snapshot.league.settings.rosterSlots
      .filter(({ kind }) => kind === 'active')
      .map(({ id }) => id),
  );
  const activePlayerIds = team.lineup.assignments
    .filter(({ slotId }) => activeSlotIds.has(slotId))
    .map(({ playerId }) => playerId);
  const known = activePlayerIds.flatMap((playerId) => {
    const projection = projections.get(playerId);
    return projection === undefined ? [] : [projection];
  });
  const topPoints = known.reduce<number | undefined>(
    (top, projection) =>
      top === undefined || projection.points > top ? projection.points : top,
    undefined,
  );
  const withFloor = known.filter(
    (projection) => projection.floor !== undefined,
  );
  const rosteredPlayerIds = new Set(
    team.roster.entries.map(({ player }) => player.id),
  );
  return {
    teamId: team.team.id,
    unfilledActiveSlotCount: lineup.unfilledActiveSlotIds.length,
    missingStarterProjectionCount: lineup.missingProjectionPlayerIds.length,
    starterProjectionCoverage: lineup.projectionCoverage,
    ...(topPoints === undefined || lineup.projectedPoints <= 0
      ? {}
      : { topStarterPointShare: topPoints / lineup.projectedPoints }),
    ...(withFloor.length === 0
      ? {}
      : {
          projectedDownsidePoints: withFloor.reduce(
            (total, projection) =>
              total + Math.max(0, projection.points - (projection.floor ?? 0)),
            0,
          ),
        }),
    floorProjectionCoverage: coverage(withFloor.length, activePlayerIds.length),
    sourceIntegrityWarningCount: snapshot.integrityWarnings.filter((warning) =>
      rosteredPlayerIds.has(warning.playerId),
    ).length,
  };
}

function positionsFor(snapshot: LeagueSnapshot): readonly Position[] {
  const positions = new Set(
    snapshot.league.settings.rosterSlots
      .filter(({ kind }) => kind === 'active')
      .flatMap(({ eligiblePositions }) => eligiblePositions),
  );
  return positionOrder.filter((position) => positions.has(position));
}

function projectedPlayers(
  players: readonly Player[],
  projections: ReadonlyMap<PlayerId, PlayerProjection>,
) {
  return players
    .flatMap((player) => {
      const projection = projections.get(player.id);
      return projection === undefined ? [] : [{ player, projection }];
    })
    .sort(
      (left, right) =>
        right.projection.points - left.projection.points ||
        String(left.player.id).localeCompare(String(right.player.id)),
    );
}

function uniquePlayers(players: readonly Player[]): readonly Player[] {
  const unique = new Map<PlayerId, Player>();
  for (const player of players) unique.set(player.id, player);
  return [...unique.values()];
}

function validateProjections(
  projections: readonly PlayerProjection[],
): ReadonlyMap<PlayerId, PlayerProjection> {
  const result = new Map<PlayerId, PlayerProjection>();
  for (const projection of projections) {
    if (result.has(projection.playerId)) {
      invalid('DUPLICATE_PLAYER_PROJECTION', projection.playerId);
    }
    for (const [name, value] of [
      ['points', projection.points],
      ['floor', projection.floor],
      ['ceiling', projection.ceiling],
    ] as const) {
      if (value !== undefined && !Number.isFinite(value)) {
        invalid('NON_FINITE_PROJECTION', `${projection.playerId}:${name}`);
      }
    }
    if (
      projection.floor !== undefined &&
      projection.floor > projection.points
    ) {
      invalid('INVALID_PROJECTION_RANGE', projection.playerId);
    }
    if (
      projection.ceiling !== undefined &&
      projection.ceiling < projection.points
    ) {
      invalid('INVALID_PROJECTION_RANGE', projection.playerId);
    }
    result.set(projection.playerId, projection);
  }
  return result;
}

function analyticsWarnings(
  snapshot: LeagueSnapshot,
  replacements: readonly PositionReplacementLevel[],
): readonly AnalyticsWarning[] {
  return [
    {
      code: 'BOUNDED_PLAYER_POOL',
      pool: 'free-agent',
      requestedLimit: snapshot.playerPool.freeAgents.coverage.requestedLimit,
      returnedCount: snapshot.playerPool.freeAgents.coverage.returnedCount,
    },
    {
      code: 'BOUNDED_PLAYER_POOL',
      pool: 'waivers',
      requestedLimit: snapshot.playerPool.waivers.coverage.requestedLimit,
      returnedCount: snapshot.playerPool.waivers.coverage.returnedCount,
    },
    ...replacements.flatMap((replacement): readonly AnalyticsWarning[] =>
      replacement.replacementPoints === undefined
        ? [{ code: 'NO_PROJECTED_REPLACEMENT', position: replacement.position }]
        : [],
    ),
    ...snapshot.integrityWarnings.map((warning): AnalyticsWarning => ({
      code: 'SOURCE_SNAPSHOT_INTEGRITY_WARNING',
      playerId: warning.playerId,
      sourceCode: warning.code,
    })),
  ];
}

function coverage(
  projectedCount: number,
  totalCount: number,
): ProjectionCoverage {
  return {
    projectedCount,
    totalCount,
    ratio: totalCount === 0 ? 1 : projectedCount / totalCount,
  };
}

function medianOfDescending(values: readonly number[]): number {
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle] as number;
  return ((values[middle - 1] as number) + (values[middle] as number)) / 2;
}

function requireLineupProjection(
  lineups: ReadonlyMap<TeamId, LineupProjection>,
  teamId: TeamId,
): LineupProjection {
  const lineup = lineups.get(teamId);
  if (lineup === undefined) invalid('MISSING_TEAM_LINEUP', teamId);
  return lineup;
}

function invalid(code: string, resource: string): never {
  throw new AnalyticsValidationError(
    `Analytics input validation failed for ${resource}`,
    { code, resource },
  );
}
