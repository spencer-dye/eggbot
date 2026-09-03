import type { PlayerId } from '@eggbot/core';

export interface FootballDataProvenance {
  readonly observedAt: string;
  readonly source: string;
  readonly version?: string;
}

export interface PlayerProjection {
  readonly playerId: PlayerId;
  readonly points: number;
  readonly floor?: number;
  readonly ceiling?: number;
}

export interface ProjectionSet extends FootballDataProvenance {
  readonly scoringPeriod: string;
  readonly players: readonly PlayerProjection[];
}

export type InjuryStatus =
  | 'healthy'
  | 'questionable'
  | 'doubtful'
  | 'out'
  | 'injured-reserve'
  | 'physically-unable-to-perform'
  | 'suspended'
  | 'unknown';

export interface PlayerInjury {
  readonly playerId: PlayerId;
  readonly status: InjuryStatus;
  readonly detail?: string;
  readonly reportedAt?: string;
  readonly expectedReturn?: string;
}

export interface InjuryReportSet extends FootballDataProvenance {
  readonly reports: readonly PlayerInjury[];
}

export interface DepthChartEntry {
  readonly playerId: PlayerId;
  readonly professionalTeam: string;
  /** Provider-neutral football position label, not fantasy-slot eligibility. */
  readonly position: string;
  readonly rank: number;
  readonly role?: string;
}

export interface DepthChartSet extends FootballDataProvenance {
  readonly entries: readonly DepthChartEntry[];
}

export type UsageWindow = 'scoring-period' | 'season-to-date' | 'rolling';

export interface PlayerUsage {
  readonly playerId: PlayerId;
  readonly scoringPeriod: string;
  readonly window: UsageWindow;
  readonly games?: number;
  readonly snaps?: number;
  readonly snapShare?: number;
  readonly routesRun?: number;
  readonly routeParticipation?: number;
  readonly targets?: number;
  readonly targetShare?: number;
  readonly carries?: number;
  readonly rushingAttemptShare?: number;
  readonly touches?: number;
}

export interface UsageSet extends FootballDataProvenance {
  readonly scoringPeriod: string;
  readonly players: readonly PlayerUsage[];
}

export interface PlayerNewsItem {
  readonly id: string;
  readonly playerIds: readonly PlayerId[];
  readonly headline: string;
  readonly summary?: string;
  readonly url?: string;
  readonly publishedAt: string;
}

export interface PlayerNewsSet extends FootballDataProvenance {
  readonly items: readonly PlayerNewsItem[];
}

export type ProfessionalGameStatus =
  'scheduled' | 'in-progress' | 'final' | 'postponed' | 'canceled';

export interface ProfessionalGame {
  readonly id: string;
  readonly scoringPeriod: string;
  readonly startsAt: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly status: ProfessionalGameStatus;
  readonly homeScore?: number;
  readonly awayScore?: number;
}

export interface ScheduleSet extends FootballDataProvenance {
  readonly scoringPeriod: string;
  readonly games: readonly ProfessionalGame[];
}

export interface FootballDataRequest {
  readonly scoringPeriod: string;
  readonly playerIds?: readonly PlayerId[];
  readonly professionalTeams?: readonly string[];
}

export interface FootballDataProvider {
  readonly id: string;
  readonly version: string;
  readonly getInjuries: (
    request: FootballDataRequest,
  ) => Promise<InjuryReportSet>;
  readonly getProjections: (
    request: FootballDataRequest,
  ) => Promise<ProjectionSet>;
  readonly getDepthCharts: (
    request: FootballDataRequest,
  ) => Promise<DepthChartSet>;
  readonly getUsage: (request: FootballDataRequest) => Promise<UsageSet>;
  readonly getNews: (request: FootballDataRequest) => Promise<PlayerNewsSet>;
  readonly getSchedule: (request: FootballDataRequest) => Promise<ScheduleSet>;
}

/** Multi-request external observation window; providers need not be atomic. */
export interface FootballIntelligenceSnapshot {
  readonly captureStartedAt: string;
  readonly capturedAt: string;
  readonly consistency: 'best-effort';
  readonly scoringPeriod: string;
  readonly provider: { readonly id: string; readonly version: string };
  readonly injuries: InjuryReportSet;
  readonly projections: ProjectionSet;
  readonly depthCharts: DepthChartSet;
  readonly usage: UsageSet;
  readonly news: PlayerNewsSet;
  readonly schedule: ScheduleSet;
}

export class FootballDataValidationError extends Error {
  readonly code: string;
  readonly resource: string | undefined;

  constructor(
    message: string,
    options: {
      readonly code: string;
      readonly resource?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'FootballDataValidationError';
    this.code = options.code;
    this.resource = options.resource;
  }
}
