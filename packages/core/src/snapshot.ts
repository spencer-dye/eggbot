import type {
  League,
  Lineup,
  Matchup,
  Player,
  Roster,
  Standing,
  Team,
  Transaction,
} from './domain.js';
import type { SnapshotId } from './identifiers.js';

export interface BoundedCollectionCoverage {
  readonly kind: 'bounded';
  readonly requestedLimit: number;
  readonly returnedCount: number;
}

export interface BoundedSnapshotCollection<Value> {
  readonly items: readonly Value[];
  readonly coverage: BoundedCollectionCoverage;
}

export interface TeamSnapshot {
  readonly team: Team;
  readonly roster: Roster;
  readonly lineup: Lineup;
}

export interface PlayerPoolSnapshot {
  readonly freeAgents: BoundedSnapshotCollection<Player>;
  readonly waivers: BoundedSnapshotCollection<Player>;
}

/** A validated observation window, not an atomic provider transaction. */
export interface LeagueSnapshot {
  readonly id: SnapshotId;
  readonly captureStartedAt: string;
  readonly capturedAt: string;
  readonly consistency: 'best-effort';
  readonly scoringPeriod: string;
  readonly league: League;
  readonly teams: readonly TeamSnapshot[];
  readonly standings: readonly Standing[];
  readonly matchups: readonly Matchup[];
  readonly playerPool: PlayerPoolSnapshot;
  readonly recentTransactions: BoundedSnapshotCollection<Transaction>;
}
