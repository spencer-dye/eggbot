import type {
  LeagueSnapshot,
  PlayerId,
  TeamId,
  TeamSnapshot,
} from '@eggbot/core';

import { parseTradeScenario, parseTradeValuationSet } from './parsers.js';
import {
  TradeValidationError,
  type PlayerTradeTransfer,
  type PlayerTradeValue,
  type TradeEvaluation,
  type TradeEvaluationIssue,
  type TradePackageValue,
  type TradeScenario,
  type TradeTeamEvaluation,
  type TradeValuationSet,
} from './types.js';

export interface TradeEvaluationOptions {
  readonly evaluatedAt: string;
  /** Optional application-specific upper bound; no framework default. */
  readonly maxValuationAgeMs?: number;
  /** Optional application-specific upper bound; no framework default. */
  readonly maxSnapshotAgeMs?: number;
}

export function evaluateTrade(
  snapshot: LeagueSnapshot,
  scenarioValue: TradeScenario,
  valuationValue: TradeValuationSet,
  options: TradeEvaluationOptions,
): TradeEvaluation {
  const scenario = parseTradeScenario(scenarioValue);
  const valuations = parseTradeValuationSet(valuationValue);
  const evaluatedAt = validateEvaluationTime(options.evaluatedAt, snapshot);
  const snapshotAgeMs =
    Date.parse(evaluatedAt) - Date.parse(snapshot.capturedAt);
  const valuationAgeMs =
    Date.parse(evaluatedAt) - Date.parse(valuations.observedAt);
  validateAgeLimit('maxSnapshotAgeMs', options.maxSnapshotAgeMs);
  validateAgeLimit('maxValuationAgeMs', options.maxValuationAgeMs);
  validateProvenance(
    snapshot,
    scenario,
    valuations,
    evaluatedAt,
    snapshotAgeMs,
    valuationAgeMs,
    options,
  );
  const teamById = new Map(
    snapshot.teams.map((team) => [team.team.id, team] as const),
  );
  const playerOwner = new Map<PlayerId, TeamId>();
  for (const team of snapshot.teams) {
    for (const { player } of team.roster.entries) {
      const existing = playerOwner.get(player.id);
      if (existing !== undefined)
        invalid('DUPLICATE_ROSTER_OWNERSHIP', player.id);
      playerOwner.set(player.id, team.team.id);
    }
  }
  validateTransfers(scenario.transfers, teamById, playerOwner);
  const values = new Map(
    valuations.players.map(
      (valuation) => [valuation.playerId, valuation] as const,
    ),
  );
  const participantIds = new Set<TeamId>();
  for (const transfer of scenario.transfers) {
    participantIds.add(transfer.fromTeamId);
    participantIds.add(transfer.toTeamId);
  }
  const teams = snapshot.teams.flatMap((team) =>
    participantIds.has(team.team.id)
      ? [
          evaluateTeam(
            team,
            scenario.transfers,
            values,
            snapshot.league.settings.rosterSlots.length,
          ),
        ]
      : [],
  );
  const issues = evaluationIssues(snapshot, teams);
  return {
    sourceSnapshotId: snapshot.id,
    leagueId: snapshot.league.id,
    evaluatedAt,
    snapshotAgeMs,
    valuationAgeMs,
    scenario,
    valuationProvenance: {
      leagueId: valuations.leagueId,
      observedAt: valuations.observedAt,
      source: valuations.source,
      ...(valuations.version === undefined
        ? {}
        : { version: valuations.version }),
      unit: valuations.unit,
      horizon: valuations.horizon,
    },
    playerValues: valuations.players.map((valuation) => ({
      playerId: valuation.playerId,
      value: valuation.value,
    })),
    valuationCoverage: teams.every(
      ({ incomingValue, outgoingValue }) =>
        incomingValue.coverage.ratio === 1 &&
        outgoingValue.coverage.ratio === 1,
    )
      ? 'complete'
      : 'partial',
    teams,
    issues,
  };
}

function evaluateTeam(
  team: TeamSnapshot,
  transfers: readonly PlayerTradeTransfer[],
  values: ReadonlyMap<PlayerId, PlayerTradeValue>,
  rosterCapacity: number,
): TradeTeamEvaluation {
  const outgoingPlayerIds = transfers.flatMap((transfer) =>
    transfer.fromTeamId === team.team.id ? [transfer.playerId] : [],
  );
  const incomingPlayerIds = transfers.flatMap((transfer) =>
    transfer.toTeamId === team.team.id ? [transfer.playerId] : [],
  );
  const outgoingValue = packageValue(outgoingPlayerIds, values);
  const incomingValue = packageValue(incomingPlayerIds, values);
  const rosterSizeBefore = team.roster.entries.length;
  const rosterSizeAfter =
    rosterSizeBefore - outgoingPlayerIds.length + incomingPlayerIds.length;
  const complete =
    outgoingValue.coverage.ratio === 1 && incomingValue.coverage.ratio === 1;
  return {
    teamId: team.team.id,
    outgoingPlayerIds,
    incomingPlayerIds,
    outgoingValue,
    incomingValue,
    ...(complete
      ? {
          rawPackageValueDelta:
            incomingValue.knownValue - outgoingValue.knownValue,
        }
      : {}),
    rosterSizeBefore,
    rosterSizeAfter,
    rosterCapacity,
    capacityStatus:
      rosterSizeAfter <= rosterCapacity ? 'within-capacity' : 'exceeded',
  };
}

function packageValue(
  playerIds: readonly PlayerId[],
  values: ReadonlyMap<PlayerId, PlayerTradeValue>,
): TradePackageValue {
  const missingPlayerIds: PlayerId[] = [];
  let knownValue = 0;
  let valuedCount = 0;
  for (const id of playerIds) {
    const valuation = values.get(id);
    if (valuation === undefined) {
      missingPlayerIds.push(id);
    } else {
      knownValue += valuation.value;
      valuedCount += 1;
    }
  }
  return {
    knownValue,
    coverage: {
      valuedCount,
      totalCount: playerIds.length,
      ratio: playerIds.length === 0 ? 1 : valuedCount / playerIds.length,
      missingPlayerIds,
    },
  };
}

function validateTransfers(
  transfers: readonly PlayerTradeTransfer[],
  teams: ReadonlyMap<TeamId, TeamSnapshot>,
  owners: ReadonlyMap<PlayerId, TeamId>,
): void {
  for (const transfer of transfers) {
    if (!teams.has(transfer.fromTeamId))
      invalid('UNKNOWN_SOURCE_TEAM', transfer.fromTeamId);
    if (!teams.has(transfer.toTeamId))
      invalid('UNKNOWN_DESTINATION_TEAM', transfer.toTeamId);
    const owner = owners.get(transfer.playerId);
    if (owner === undefined)
      invalid('TRADE_PLAYER_NOT_ROSTERED', transfer.playerId);
    if (owner !== transfer.fromTeamId)
      invalid('TRADE_PLAYER_OWNERSHIP_MISMATCH', transfer.playerId);
  }
}

function validateProvenance(
  snapshot: LeagueSnapshot,
  scenario: TradeScenario,
  valuations: TradeValuationSet,
  evaluatedAt: string,
  snapshotAgeMs: number,
  valuationAgeMs: number,
  options: TradeEvaluationOptions,
): void {
  if (scenario.leagueId !== snapshot.league.id) {
    invalid('TRADE_SCENARIO_LEAGUE_MISMATCH', scenario.leagueId);
  }
  if (valuations.leagueId !== snapshot.league.id) {
    invalid('TRADE_VALUATION_LEAGUE_MISMATCH', valuations.leagueId);
  }
  if (Date.parse(valuations.observedAt) > Date.parse(evaluatedAt)) {
    invalid('FUTURE_TRADE_VALUATION', valuations.observedAt);
  }
  if (
    options.maxSnapshotAgeMs !== undefined &&
    snapshotAgeMs > options.maxSnapshotAgeMs
  ) {
    invalid('STALE_TRADE_SNAPSHOT', snapshot.capturedAt);
  }
  if (
    options.maxValuationAgeMs !== undefined &&
    valuationAgeMs > options.maxValuationAgeMs
  ) {
    invalid('STALE_TRADE_VALUATION', valuations.observedAt);
  }
  const horizonSeason =
    valuations.horizon.kind === 'rest-of-season'
      ? valuations.horizon.season
      : valuations.horizon.kind === 'dynasty'
        ? valuations.horizon.asOfSeason
        : undefined;
  if (horizonSeason !== undefined && horizonSeason !== snapshot.league.season) {
    invalid('TRADE_VALUATION_SEASON_MISMATCH', String(horizonSeason));
  }
}

function validateAgeLimit(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0) {
    invalid('INVALID_TRADE_AGE_LIMIT', name);
  }
}

function validateEvaluationTime(
  value: string,
  snapshot: LeagueSnapshot,
): string {
  const evaluated = Date.parse(value);
  if (Number.isNaN(evaluated)) invalid('INVALID_EVALUATION_TIMESTAMP', value);
  if (evaluated < Date.parse(snapshot.capturedAt)) {
    invalid('EVALUATION_BEFORE_SNAPSHOT', value);
  }
  return new Date(evaluated).toISOString();
}

function evaluationIssues(
  snapshot: LeagueSnapshot,
  teams: readonly TradeTeamEvaluation[],
): readonly TradeEvaluationIssue[] {
  const tradedPlayers = new Set(
    teams.flatMap(({ incomingPlayerIds }) => incomingPlayerIds),
  );
  return [
    ...teams.flatMap((team): readonly TradeEvaluationIssue[] => [
      ...(team.incomingValue.coverage.missingPlayerIds.length === 0
        ? []
        : [
            {
              code: 'INCOMPLETE_TRADE_VALUATION' as const,
              teamId: team.teamId,
              direction: 'incoming' as const,
              missingPlayerIds: team.incomingValue.coverage.missingPlayerIds,
            },
          ]),
      ...(team.outgoingValue.coverage.missingPlayerIds.length === 0
        ? []
        : [
            {
              code: 'INCOMPLETE_TRADE_VALUATION' as const,
              teamId: team.teamId,
              direction: 'outgoing' as const,
              missingPlayerIds: team.outgoingValue.coverage.missingPlayerIds,
            },
          ]),
      ...(team.capacityStatus === 'within-capacity'
        ? []
        : [
            {
              code: 'ROSTER_CAPACITY_EXCEEDED' as const,
              teamId: team.teamId,
              rosterSizeAfter: team.rosterSizeAfter,
              rosterCapacity: team.rosterCapacity,
            },
          ]),
    ]),
    ...snapshot.integrityWarnings.flatMap(
      (warning): readonly TradeEvaluationIssue[] =>
        tradedPlayers.has(warning.playerId)
          ? [
              {
                code: 'SOURCE_SNAPSHOT_INTEGRITY_WARNING',
                playerId: warning.playerId,
                sourceCode: warning.code,
              },
            ]
          : [],
    ),
  ];
}

function invalid(code: string, resource: string): never {
  throw new TradeValidationError(`Trade evaluation failed for ${resource}`, {
    code,
    resource,
  });
}
