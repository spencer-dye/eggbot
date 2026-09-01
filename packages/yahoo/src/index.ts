import type { PlatformAdapterMetadata } from '@eggbot/platform';

export {
  YahooFantasyReader,
  type YahooFantasyReaderOptions,
} from './adapter.js';
export {
  YahooActionValidationError,
  YahooApiError,
  YahooAuthenticationError,
  YahooResponseValidationError,
} from './errors.js';
export {
  InMemoryYahooExecutionJournal,
  YahooFantasyExecutor,
  type YahooExecutionJournal,
  type YahooExecutionRecord,
  type YahooFantasyExecutorOptions,
} from './executor.js';
export {
  YahooHttpClient,
  type YahooAccessTokenProvider,
  type YahooHttpClientOptions,
  type YahooWriteResponse,
} from './http.js';
export {
  yahooLeagueId,
  yahooLeagueKey,
  yahooPlayerKey,
  yahooPlayerId,
  yahooRosterSlotId,
  yahooRosterSlotReference,
  yahooTeamId,
  yahooTeamKey,
  yahooTransactionId,
  type YahooRosterSlotReference,
} from './identifiers.js';
export {
  YahooOAuthClient,
  type YahooOAuthClientOptions,
  type YahooOAuthConfig,
  type YahooTokenSet,
  type YahooTokenStore,
} from './oauth.js';
export {
  buildYahooWriteRequest,
  type YahooWriteRequest,
} from './write-requests.js';

export const yahooAdapterMetadata: PlatformAdapterMetadata = Object.freeze({
  id: 'yahoo',
  displayName: 'Yahoo Fantasy Sports',
  capabilities: Object.freeze({
    read: true,
    execute: true,
  }),
});
