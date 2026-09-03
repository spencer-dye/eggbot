export { evaluateTrade, type TradeEvaluationOptions } from './evaluator.js';
export { parseTradeScenario, parseTradeValuationSet } from './parsers.js';
export {
  TradeValidationError,
  type PlayerTradeTransfer,
  type PlayerTradeValue,
  type TradeEvaluation,
  type TradeEvaluationIssue,
  type TradePackageValue,
  type TradeScenario,
  type TradeTeamEvaluation,
  type TradeValuationProvenance,
  type TradeValuationSet,
  type TradeValueCoverage,
  type TradeValueHorizon,
} from './types.js';

export const tradeCapabilities = Object.freeze([
  'evaluation-only',
  'explicit-player-transfers',
  'horizon-bound-valuations',
  'coverage-aware-value-deltas',
  'roster-capacity-effects',
] as const);
