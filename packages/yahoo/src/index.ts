import type { PlatformAdapterMetadata } from '@eggbot/platform';

export {
  YahooFantasyReader,
  type YahooFantasyReaderOptions,
} from './adapter.js';
export {
  YahooApiError,
  YahooAuthenticationError,
  YahooResponseValidationError,
} from './errors.js';
export {
  YahooHttpClient,
  type YahooAccessTokenProvider,
  type YahooHttpClientOptions,
} from './http.js';
export {
  yahooLeagueId,
  yahooLeagueKey,
  yahooPlayerId,
  yahooTeamId,
  yahooTeamKey,
  yahooTransactionId,
} from './identifiers.js';
export {
  YahooOAuthClient,
  type YahooOAuthClientOptions,
  type YahooOAuthConfig,
  type YahooTokenSet,
  type YahooTokenStore,
} from './oauth.js';

export const yahooAdapterMetadata: PlatformAdapterMetadata = Object.freeze({
  id: 'yahoo',
  displayName: 'Yahoo Fantasy Sports',
  capabilities: Object.freeze({
    read: true,
    execute: false,
  }),
});
