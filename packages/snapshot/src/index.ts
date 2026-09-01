import { randomUUID } from 'node:crypto';

import {
  snapshotId,
  type LeagueId,
  type LeagueSnapshot,
  type SnapshotId,
  type TeamSnapshot,
} from '@eggbot/core';
import type { FantasyPlatformReader } from '@eggbot/platform';

export interface LeagueSnapshotCaptureOptions {
  readonly leagueId: LeagueId;
  readonly scoringPeriod: string;
  readonly freeAgentLimit: number;
  readonly waiverLimit: number;
  readonly transactionLimit: number;
  readonly teamReadConcurrency?: number;
}

export interface LeagueSnapshotServiceOptions {
  readonly reader: FantasyPlatformReader;
  readonly now?: () => string;
  readonly idFactory?: () => SnapshotId;
}

export class LeagueSnapshotCaptureError extends Error {
  readonly code: string;
  readonly resource: string | undefined;

  constructor(
    message: string,
    options: { code: string; resource?: string; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'LeagueSnapshotCaptureError';
    this.code = options.code;
    this.resource = options.resource;
  }
}

export class LeagueSnapshotService {
  readonly #reader: FantasyPlatformReader;
  readonly #now: () => string;
  readonly #idFactory: () => SnapshotId;

  constructor(options: LeagueSnapshotServiceOptions) {
    this.#reader = options.reader;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? (() => snapshotId(randomUUID()));
  }

  async capture(
    options: LeagueSnapshotCaptureOptions,
  ): Promise<LeagueSnapshot> {
    validateOptions(options);
    const captureStartedAt = this.#timestamp('captureStartedAt');
    const [
      league,
      teams,
      standings,
      matchups,
      freeAgents,
      waivers,
      transactions,
    ] = await Promise.all([
      read('LEAGUE_READ_FAILED', String(options.leagueId), () =>
        this.#reader.getLeague(options.leagueId),
      ),
      read('TEAMS_READ_FAILED', String(options.leagueId), () =>
        this.#reader.getTeams(options.leagueId),
      ),
      read('STANDINGS_READ_FAILED', String(options.leagueId), () =>
        this.#reader.getStandings(options.leagueId),
      ),
      read('MATCHUPS_READ_FAILED', options.scoringPeriod, () =>
        this.#reader.getMatchups(options.leagueId, options.scoringPeriod),
      ),
      read('FREE_AGENTS_READ_FAILED', String(options.leagueId), () =>
        this.#reader.getAvailablePlayers(options.leagueId, {
          availability: 'free-agent',
          limit: options.freeAgentLimit,
        }),
      ),
      read('WAIVERS_READ_FAILED', String(options.leagueId), () =>
        this.#reader.getAvailablePlayers(options.leagueId, {
          availability: 'waivers',
          limit: options.waiverLimit,
        }),
      ),
      read('TRANSACTIONS_READ_FAILED', String(options.leagueId), () =>
        this.#reader.getTransactions(options.leagueId, {
          limit: options.transactionLimit,
        }),
      ),
    ]);

    const teamSnapshots = await mapWithConcurrency(
      teams,
      options.teamReadConcurrency ?? 4,
      async (team): Promise<TeamSnapshot> => {
        const [roster, lineup] = await Promise.all([
          read('ROSTER_READ_FAILED', String(team.id), () =>
            this.#reader.getRoster(team.id),
          ),
          read('LINEUP_READ_FAILED', String(team.id), () =>
            this.#reader.getLineup(team.id, options.scoringPeriod),
          ),
        ]);
        return { team, roster, lineup };
      },
    );
    const capturedAt = this.#timestamp('capturedAt');
    const result: LeagueSnapshot = {
      id: this.#idFactory(),
      captureStartedAt,
      capturedAt,
      consistency: 'best-effort',
      scoringPeriod: options.scoringPeriod,
      league,
      teams: teamSnapshots,
      standings,
      matchups,
      playerPool: {
        freeAgents: bounded(freeAgents, options.freeAgentLimit),
        waivers: bounded(waivers, options.waiverLimit),
      },
      recentTransactions: bounded(transactions, options.transactionLimit),
    };
    validateSnapshot(result, options.leagueId);
    return result;
  }

  #timestamp(resource: string): string {
    const value = this.#now();
    if (Number.isNaN(Date.parse(value))) {
      throw new LeagueSnapshotCaptureError(
        `Snapshot clock returned an invalid timestamp for ${resource}`,
        { code: 'INVALID_CAPTURE_TIMESTAMP', resource },
      );
    }
    return value;
  }
}

function bounded<Value>(items: readonly Value[], requestedLimit: number) {
  return {
    items,
    coverage: {
      kind: 'bounded' as const,
      requestedLimit,
      returnedCount: items.length,
    },
  };
}

async function read<Value>(
  code: string,
  resource: string,
  operation: () => Promise<Value>,
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    throw new LeagueSnapshotCaptureError(
      `Snapshot capture failed while reading ${resource}`,
      { code, resource, cause: error },
    );
  }
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  mapper: (input: Input) => Promise<Output>,
): Promise<readonly Output[]> {
  const output: ({ readonly value: Output } | undefined)[] = Array.from(
    { length: inputs.length },
    () => undefined,
  );
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const input = inputs[index] as Input;
      output[index] = { value: await mapper(input) };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, worker),
  );
  return output.map((entry) => {
    if (entry === undefined) {
      throw new LeagueSnapshotCaptureError(
        'Snapshot concurrency worker did not produce an expected result',
        { code: 'CAPTURE_WORKER_INCOMPLETE' },
      );
    }
    return entry.value;
  });
}

function validateOptions(options: LeagueSnapshotCaptureOptions): void {
  if (options.scoringPeriod.trim().length === 0) {
    invalid('INVALID_SCORING_PERIOD', 'scoringPeriod');
  }
  for (const [name, value] of [
    ['freeAgentLimit', options.freeAgentLimit],
    ['waiverLimit', options.waiverLimit],
    ['transactionLimit', options.transactionLimit],
    ['teamReadConcurrency', options.teamReadConcurrency ?? 4],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      invalid('INVALID_CAPTURE_LIMIT', name);
    }
  }
}

function validateSnapshot(snapshot: LeagueSnapshot, leagueId: LeagueId): void {
  if (snapshot.league.id !== leagueId) invalid('LEAGUE_ID_MISMATCH', 'league');
  if (Date.parse(snapshot.capturedAt) < Date.parse(snapshot.captureStartedAt)) {
    invalid('CAPTURE_TIME_REVERSED', 'capturedAt');
  }
  const teamIds = unique(
    snapshot.teams.map(({ team }) => team.id),
    'DUPLICATE_TEAM',
    'teams',
  );
  for (const { team, roster, lineup } of snapshot.teams) {
    if (team.leagueId !== leagueId) invalid('TEAM_LEAGUE_MISMATCH', team.id);
    if (roster.teamId !== team.id) invalid('ROSTER_TEAM_MISMATCH', team.id);
    if (lineup.teamId !== team.id) invalid('LINEUP_TEAM_MISMATCH', team.id);
    if (lineup.scoringPeriod !== snapshot.scoringPeriod) {
      invalid('LINEUP_PERIOD_MISMATCH', team.id);
    }
    const rostered = unique(
      roster.entries.map(({ player }) => player.id),
      'DUPLICATE_ROSTER_PLAYER',
      team.id,
    );
    unique(
      lineup.assignments.map(({ slotId }) => slotId),
      'DUPLICATE_LINEUP_SLOT',
      team.id,
    );
    for (const assignment of lineup.assignments) {
      if (!rostered.has(assignment.playerId)) {
        invalid('LINEUP_PLAYER_NOT_ROSTERED', team.id);
      }
    }
  }
  unique(
    snapshot.standings.map(({ teamId }) => teamId),
    'DUPLICATE_STANDING',
    'standings',
  );
  for (const standing of snapshot.standings) {
    if (!teamIds.has(standing.teamId)) {
      invalid('UNKNOWN_STANDING_TEAM', standing.teamId);
    }
  }
  for (const matchup of snapshot.matchups) {
    if (matchup.scoringPeriod !== snapshot.scoringPeriod) {
      invalid('MATCHUP_PERIOD_MISMATCH', matchup.scoringPeriod);
    }
    unique(
      matchup.participants.map(({ teamId }) => teamId),
      'DUPLICATE_MATCHUP_TEAM',
      matchup.scoringPeriod,
    );
    for (const participant of matchup.participants) {
      if (!teamIds.has(participant.teamId)) {
        invalid('UNKNOWN_MATCHUP_TEAM', participant.teamId);
      }
    }
  }
  for (const transaction of snapshot.recentTransactions.items) {
    if (transaction.leagueId !== leagueId) {
      invalid('TRANSACTION_LEAGUE_MISMATCH', transaction.id);
    }
  }
  const freeAgentIds = unique(
    snapshot.playerPool.freeAgents.items.map(({ id }) => id),
    'DUPLICATE_FREE_AGENT',
    'freeAgents',
  );
  const waiverIds = unique(
    snapshot.playerPool.waivers.items.map(({ id }) => id),
    'DUPLICATE_WAIVER_PLAYER',
    'waivers',
  );
  for (const playerId of freeAgentIds) {
    if (waiverIds.has(playerId)) {
      invalid('PLAYER_POOL_OVERLAP', playerId);
    }
  }
  validateBound(snapshot.playerPool.freeAgents.coverage);
  validateBound(snapshot.playerPool.waivers.coverage);
  validateBound(snapshot.recentTransactions.coverage);
}

function validateBound(coverage: {
  readonly requestedLimit: number;
  readonly returnedCount: number;
}): void {
  if (coverage.returnedCount > coverage.requestedLimit) {
    invalid('COLLECTION_LIMIT_EXCEEDED', String(coverage.requestedLimit));
  }
}

function unique<Value>(
  values: readonly Value[],
  code: string,
  resource: string,
): ReadonlySet<Value> {
  const set = new Set(values);
  if (set.size !== values.length) invalid(code, resource);
  return set;
}

function invalid(code: string, resource: string): never {
  throw new LeagueSnapshotCaptureError(
    `Snapshot integrity validation failed for ${resource}`,
    { code, resource },
  );
}
