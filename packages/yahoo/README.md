# `@eggbot/yahoo`

Read-only Yahoo Fantasy Sports adapter for EggBot.

Phase 1 includes:

- OAuth 2.0 authorization URL and code exchange
- proactive access-token refresh with refresh-token rotation
- injected token persistence and `fetch` boundaries
- authenticated GET-only Fantasy API transport
- validation of Yahoo JSON envelopes and resources
- normalized games, leagues/settings, teams, rosters/lineups, standings, matchups, free agents, and transactions

Construct `YahooOAuthClient`, pass it to `YahooHttpClient`, and inject that into `YahooFantasyReader`. Configuration is explicit; the package never reads environment variables or writes tokens itself.

The adapter requests Yahoo's JSON representation and normalizes its array-of-fragments resource encoding internally. Raw Yahoo payload types and collection shapes are not exported. EggBot identifiers are namespaced separately from Yahoo resource keys.

There is intentionally no `FantasyPlatformExecutor` implementation and adapter metadata reports `execute: false`.

References: [Yahoo Fantasy Sports API](https://developer.yahoo.com/fantasysports/guide/), [Yahoo authorization-code flow](https://developer.yahoo.com/oauth2/guide/flows_authcode/), and [authenticated API requests](https://developer.yahoo.com/oauth2/guide/apirequests/).
