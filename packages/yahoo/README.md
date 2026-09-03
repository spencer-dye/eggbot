# `@eggbot/yahoo`

Yahoo Fantasy Sports adapter for EggBot.

Supported reads include:

- OAuth 2.0 authorization URL and code exchange
- proactive access-token refresh with refresh-token rotation
- injected token persistence and `fetch` boundaries
- authenticated Fantasy API transport
- validation of Yahoo JSON envelopes and resources
- normalized games, leagues/settings (including acquisition rules), teams (including current waiver priority/budget where supplied), rosters/lineups, standings, matchups, available/free-agent/waiver players, and transactions

Construct `YahooOAuthClient`, pass it to `YahooHttpClient`, and inject that into `YahooFantasyReader`. Configuration is explicit; the package never reads environment variables or writes tokens itself.

The adapter requests Yahoo's JSON representation and normalizes its array-of-fragments resource encoding internally. Raw Yahoo payload types and collection shapes are not exported. EggBot identifiers are namespaced separately from Yahoo resource keys. HTTP paths are constrained to the configured API origin and base path, including when callers inject a test transport.

`YahooFantasyExecutor` implements explicit dry-run and execute modes for weekly lineup changes, standalone adds/drops, add/drop transactions, and waiver claims. It validates player ownership so free-agent actions cannot silently become waiver claims and waiver actions cannot become immediate acquisitions. Execute mode additionally requires `allowWrites: true`; dry-run remains the safe default at the CLI boundary.

Action IDs are idempotency keys. The executor atomically creates a pending journal record before mutation; if another process already claimed the ID, the loser reloads the winner's state and never calls Yahoo. Ambiguous POST outcomes and journal commit failures return `execution-uncertain` and cannot automatically retry. The default journal is isolated in memory; production applications can inject `StorageYahooExecutionJournal`, backed by `OperationalStorageAdapter.create()` for cross-process no-clobber preparation. `YahooFantasyExecutor.reconcile()` can resolve a pending intent only from explicit independently verified evidence and never calls Yahoo or automatically repeats the mutation. Whole-workflow multi-replica coordination still requires a distributed lease.

Yahoo currently documents these write endpoints but does not grant write access to new applications. Dry-runs work with read credentials; live execution requires credentials Yahoo has explicitly authorized for writes.

## Live read smoke test

Normal tests use sanitized, credential-free fixtures. To exercise every supported read against Yahoo, provide the OAuth variables from `.env.example`, set `YAHOO_INTEGRATION=1` and `YAHOO_INTEGRATION_WEEK`, then run:

```sh
pnpm test:integration
```

`YAHOO_INTEGRATION_LEAGUE_KEY` and `YAHOO_INTEGRATION_TEAM_KEY` can select explicit resources. The smoke suite performs no writes.

References: [Yahoo Fantasy Sports API](https://developer.yahoo.com/fantasysports/guide/), [Yahoo authorization-code flow](https://developer.yahoo.com/oauth2/guide/flows_authcode/), and [authenticated API requests](https://developer.yahoo.com/oauth2/guide/apirequests/).
