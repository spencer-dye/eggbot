import type {
  DecisionContext,
  DecisionEngine,
  FantasyActionIntent,
} from '@eggbot/agent';
import type { Player, PlayerId, TeamSnapshot } from '@eggbot/core';

export type WaiverBidStrategy =
  | { readonly kind: 'fixed'; readonly amount: number }
  | {
      readonly kind: 'percentage-of-remaining';
      readonly percentage: number;
      readonly minimum?: number;
      readonly maximum?: number;
    };

export interface ProjectedWaiverDecisionEngineOptions {
  readonly id?: string;
  readonly version?: string;
  readonly maximumActions?: number;
  readonly minimumProjectedPointGain?: number;
  readonly requireCompleteProjectionCoverage?: boolean;
  readonly includeFreeAgents?: boolean;
  readonly bidStrategy?: WaiverBidStrategy;
  readonly maximumWaiverPriorityRank?: number;
}

interface Upgrade {
  readonly kind: 'free-agent' | 'waiver';
  readonly add: Player;
  readonly drop?: Player;
  readonly gain: number;
}

export function createProjectedWaiverDecisionEngine(
  options: ProjectedWaiverDecisionEngineOptions = {},
): DecisionEngine {
  const maximumActions = options.maximumActions ?? 1;
  const minimumGain = options.minimumProjectedPointGain ?? 1;
  if (!Number.isSafeInteger(maximumActions) || maximumActions < 1) {
    throw new RangeError('maximumActions must be a positive integer');
  }
  if (!Number.isFinite(minimumGain) || minimumGain < 0) {
    throw new RangeError(
      'minimumProjectedPointGain must be a finite non-negative number',
    );
  }
  validateBidStrategy(options.bidStrategy);
  if (
    options.maximumWaiverPriorityRank !== undefined &&
    (!Number.isSafeInteger(options.maximumWaiverPriorityRank) ||
      options.maximumWaiverPriorityRank < 1)
  ) {
    throw new RangeError(
      'maximumWaiverPriorityRank must be a positive integer',
    );
  }
  return {
    id: options.id ?? 'eggbot-projected-waivers',
    version: options.version ?? '1.0.0',
    kind: 'deterministic',
    decide: (context) =>
      Promise.resolve(
        decideWaivers(context, {
          maximumActions,
          minimumGain,
          requireComplete: options.requireCompleteProjectionCoverage ?? true,
          includeFreeAgents: options.includeFreeAgents ?? true,
          ...(options.bidStrategy === undefined
            ? {}
            : { bidStrategy: options.bidStrategy }),
          ...(options.maximumWaiverPriorityRank === undefined
            ? {}
            : {
                maximumWaiverPriorityRank: options.maximumWaiverPriorityRank,
              }),
        }),
      ),
  };
}

function decideWaivers(
  context: DecisionContext,
  options: {
    readonly maximumActions: number;
    readonly minimumGain: number;
    readonly requireComplete: boolean;
    readonly includeFreeAgents: boolean;
    readonly bidStrategy?: WaiverBidStrategy;
    readonly maximumWaiverPriorityRank?: number;
  },
) {
  const team = context.snapshot.teams.find(
    ({ team }) => team.id === context.managedTeamId,
  );
  if (team === undefined) return noAction('Managed team is absent.');
  if (
    context.snapshot.integrityWarnings.some((warning) =>
      team.roster.entries.some(({ player }) => player.id === warning.playerId),
    )
  ) {
    return noAction(
      'Acquisitions unchanged because the managed roster has source-integrity warnings.',
    );
  }
  const limitResult = acquisitionLimit(context, team, options.maximumActions);
  if (typeof limitResult === 'string') return noAction(limitResult);
  if (limitResult === 0) {
    return noAction('No acquisitions remain under the league limits.');
  }

  const projections = new Map(
    context.analytics.playerProjections.map((projection) => [
      projection.playerId,
      projection.points,
    ]),
  );
  const waiverRules = context.snapshot.league.settings.acquisitionRules;
  const waiverState = team.team.acquisitionState;
  const waiversSupported =
    waiverRules !== undefined &&
    waiverRules.waiverSystem !== 'unknown' &&
    (waiverRules.waiverSystem === 'budget'
      ? options.bidStrategy !== undefined &&
        waiverState?.waiverBudgetRemaining !== undefined
      : waiverState?.waiverPriority !== undefined &&
        (options.maximumWaiverPriorityRank === undefined ||
          waiverState.waiverPriority <= options.maximumWaiverPriorityRank));
  const available = [
    ...(options.includeFreeAgents
      ? context.snapshot.playerPool.freeAgents.items.map((player) => ({
          kind: 'free-agent' as const,
          player,
        }))
      : []),
    ...(waiversSupported
      ? context.snapshot.playerPool.waivers.items.map((player) => ({
          kind: 'waiver' as const,
          player,
        }))
      : []),
  ];
  if (
    available.length === 0 &&
    context.snapshot.playerPool.waivers.items.length > 0
  ) {
    return noAction(
      'No safe claim can be formed from the available waiver rules, priority, and budget state.',
    );
  }
  const dropCandidates = movableDropCandidates(context, team);
  if (
    options.requireComplete &&
    [...available.map(({ player }) => player), ...dropCandidates].some(
      ({ id }) => !projections.has(id),
    )
  ) {
    return noAction(
      'Acquisitions unchanged because candidate projection coverage is incomplete.',
    );
  }

  const capacity = context.snapshot.league.settings.rosterSlots.length;
  let openSpots = Math.max(0, capacity - team.roster.entries.length);
  const upgrades: Upgrade[] = [];
  const usedDrops = new Set<PlayerId>();
  const remaining = [...available];
  while (upgrades.length < limitResult) {
    const choices = remaining.flatMap((candidate): readonly Upgrade[] => {
      const addPoints = projections.get(candidate.player.id);
      if (addPoints === undefined) return [];
      if (openSpots > 0) {
        return [
          { kind: candidate.kind, add: candidate.player, gain: addPoints },
        ];
      }
      const drop = dropCandidates
        .filter(
          (player) =>
            !usedDrops.has(player.id) &&
            sharesPosition(player, candidate.player) &&
            projections.has(player.id),
        )
        .sort(
          (left, right) =>
            (projections.get(left.id) ?? Infinity) -
              (projections.get(right.id) ?? Infinity) ||
            String(left.id).localeCompare(String(right.id)),
        )[0];
      return drop === undefined
        ? []
        : [
            {
              kind: candidate.kind,
              add: candidate.player,
              drop,
              gain: addPoints - (projections.get(drop.id) ?? 0),
            },
          ];
    });
    choices.sort(
      (left, right) =>
        right.gain - left.gain ||
        String(left.add.id).localeCompare(String(right.add.id)),
    );
    const best = choices[0];
    if (best === undefined || best.gain < options.minimumGain) break;
    upgrades.push(best);
    const candidateIndex = remaining.findIndex(
      ({ player }) => player.id === best.add.id,
    );
    remaining.splice(candidateIndex, 1);
    if (best.drop === undefined) openSpots -= 1;
    else usedDrops.add(best.drop.id);
  }
  if (upgrades.length === 0) {
    return noAction('No captured acquisition improves the roster enough.');
  }

  const actions = buildActions(context, team, upgrades, options.bidStrategy);
  if (actions.length === 0) {
    return noAction(
      'No safe claim can be formed from the available waiver rules and budget state.',
    );
  }
  return {
    rationale: `Ranked ${actions.length} acquisition${actions.length === 1 ? '' : 's'} by projected roster gain; highest-priority gain is ${formatPoints(upgrades[0]!.gain)}.`,
    proposedActions: actions,
  };
}

function movableDropCandidates(
  context: DecisionContext,
  team: TeamSnapshot,
): readonly Player[] {
  const slotKind = new Map(
    context.snapshot.league.settings.rosterSlots.map(({ id, kind }) => [
      id,
      kind,
    ]),
  );
  const protectedByPlacement = new Set(
    team.lineup.assignments.flatMap(({ slotId, playerId }) =>
      slotKind.get(slotId) === 'active' || slotKind.get(slotId) === 'reserve'
        ? [playerId]
        : [],
    ),
  );
  return team.roster.entries
    .map(({ player }) => player)
    .filter(({ id }) => !protectedByPlacement.has(id));
}

function acquisitionLimit(
  context: DecisionContext,
  team: TeamSnapshot,
  configured: number,
): number | string {
  const rules = context.snapshot.league.settings.acquisitionRules;
  const state = team.team.acquisitionState;
  let limit = configured;
  if (rules?.maxSeasonAcquisitions !== undefined) {
    if (state?.seasonAcquisitions === undefined) {
      return 'Acquisitions unchanged because season-limit usage is unavailable.';
    }
    limit = Math.min(
      limit,
      Math.max(0, rules.maxSeasonAcquisitions - state.seasonAcquisitions),
    );
  }
  if (rules?.maxWeeklyAcquisitions !== undefined) {
    if (state?.weeklyAcquisitions === undefined) {
      return 'Acquisitions unchanged because weekly-limit usage is unavailable.';
    }
    limit = Math.min(
      limit,
      Math.max(0, rules.maxWeeklyAcquisitions - state.weeklyAcquisitions),
    );
  }
  return limit;
}

function buildActions(
  context: DecisionContext,
  team: TeamSnapshot,
  upgrades: readonly Upgrade[],
  bidStrategy: WaiverBidStrategy | undefined,
): readonly FantasyActionIntent[] {
  const actions: FantasyActionIntent[] = [];
  const rules = context.snapshot.league.settings.acquisitionRules;
  let remainingBudget = team.team.acquisitionState?.waiverBudgetRemaining;
  for (const upgrade of upgrades) {
    if (upgrade.kind === 'free-agent') {
      actions.push(
        upgrade.drop === undefined
          ? {
              type: 'add-player',
              leagueId: context.snapshot.league.id,
              teamId: context.managedTeamId,
              playerId: upgrade.add.id,
            }
          : {
              type: 'add-drop',
              leagueId: context.snapshot.league.id,
              teamId: context.managedTeamId,
              addPlayerId: upgrade.add.id,
              dropPlayerId: upgrade.drop.id,
            },
      );
      continue;
    }
    if (rules === undefined || rules.waiverSystem === 'unknown') continue;
    let bid: number | undefined;
    if (rules.waiverSystem === 'budget') {
      if (remainingBudget === undefined || bidStrategy === undefined) continue;
      bid = calculateBid(bidStrategy, remainingBudget);
      if (bid > remainingBudget) continue;
      remainingBudget -= bid;
    }
    actions.push({
      type: 'waiver-claim',
      leagueId: context.snapshot.league.id,
      teamId: context.managedTeamId,
      addPlayerId: upgrade.add.id,
      ...(upgrade.drop === undefined ? {} : { dropPlayerId: upgrade.drop.id }),
      ...(bid === undefined ? {} : { bid }),
    });
  }
  return actions;
}

function calculateBid(strategy: WaiverBidStrategy, remaining: number): number {
  if (strategy.kind === 'fixed') return strategy.amount;
  const raw = Math.ceil(remaining * strategy.percentage);
  return Math.min(
    strategy.maximum ?? Infinity,
    Math.max(strategy.minimum ?? 0, raw),
  );
}

function validateBidStrategy(strategy: WaiverBidStrategy | undefined): void {
  if (strategy === undefined) return;
  if (strategy.kind === 'fixed') {
    if (!Number.isFinite(strategy.amount) || strategy.amount < 0) {
      throw new RangeError('fixed waiver bid must be finite and non-negative');
    }
    return;
  }
  if (
    !Number.isFinite(strategy.percentage) ||
    strategy.percentage < 0 ||
    strategy.percentage > 1
  ) {
    throw new RangeError('waiver bid percentage must be between zero and one');
  }
  for (const value of [strategy.minimum, strategy.maximum]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new RangeError('waiver bid bounds must be finite and non-negative');
    }
  }
  if (
    strategy.minimum !== undefined &&
    strategy.maximum !== undefined &&
    strategy.minimum > strategy.maximum
  ) {
    throw new RangeError('waiver bid minimum cannot exceed maximum');
  }
}

function sharesPosition(left: Player, right: Player): boolean {
  return left.eligiblePositions.some((position) =>
    right.eligiblePositions.includes(position),
  );
}

function noAction(rationale: string) {
  return { rationale, proposedActions: [] };
}

function formatPoints(value: number): string {
  return `${Math.round(value * 100) / 100} points`;
}
