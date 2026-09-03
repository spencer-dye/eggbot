export {
  parseDepthChartSet,
  parseInjuryReportSet,
  parsePlayerNewsSet,
  parseProjectionSet,
  parseScheduleSet,
  parseUsageSet,
} from './parsers.js';
export {
  FootballIntelligenceService,
  type FootballIntelligenceServiceOptions,
} from './service.js';
export {
  FootballDataValidationError,
  type DepthChartEntry,
  type DepthChartSet,
  type FootballDataProvenance,
  type FootballDataProvider,
  type FootballDataRequest,
  type FootballIntelligenceSnapshot,
  type InjuryReportSet,
  type InjuryStatus,
  type PlayerInjury,
  type PlayerNewsItem,
  type PlayerNewsSet,
  type PlayerProjection,
  type PlayerUsage,
  type ProfessionalGame,
  type ProfessionalGameStatus,
  type ProjectionSet,
  type ScheduleSet,
  type UsageSet,
  type UsageWindow,
} from './types.js';

export const footballDataCapabilities = [
  'injuries',
  'projections',
  'depth-charts',
  'usage',
  'news',
  'schedules',
] as const;
