# `@eggbot/yahoo`

Yahoo Fantasy Sports adapter for EggBot.

Phase 1 reads include:

- OAuth 2.0 authorization URL and code exchange
- proactive access-token refresh with refresh-token rotation
- injected token persistence and `fetch` boundaries
- authenticated Fantasy API transport
- validation of Yahoo JSON envelopes and resources
- normalized games, leagues/settings, teams, rosters/lineups, standings, matchups, available/free-agent/waiver players, and transactions

Construct `YahooOAuthClient`, pass it to `YahooHttpClient`, and inject that into `YahooFantasyReader`. Configuration is explicit; the package never reads environment variables or writes tokens itself.

The adapter requests Yahoo's JSON representation and normalizes its array-of-fragments resource encoding internally. Raw Yahoo payload types and collection shapes are not exported. EggBot identifiers are namespaced separately from Yahoo resource keys.

`YahooFantasyExecutor` implements explicit dry-run and execute modes for weekly lineup changes, standalone adds/drops, add/drop transactions, and waiver claims. It validates player ownership so free-agent actions cannot silently become waiver claims and waiver actions cannot become immediate acquisitions. Execute mode additionally requires `allowWrites: true`; dry-run remains the safe default at the CLI boundary.

Action IDs are idempotency keys. The executor writes a pending journal record before mutation. Ambiguous POST outcomes and journal commit failures return `execution-uncertain` and cannot automatically retry. The default journal is in-memory, so production consumers must inject a durable `YahooExecutionJournal` and provide an explicit reconciliation workflow.

Yahoo currently documents these write endpoints but does not grant write access to new applications. Dry-runs work with read credentials; live execution requires credentials Yahoo has explicitly authorized for writes.

## Live read smoke test

Normal tests use sanitized, credential-free fixtures. To exercise every Phase 1 read against Yahoo, provide the OAuth variables from `.env.example`, set `YAHOO_INTEGRATION=1` and `YAHOO_INTEGRATION_WEEK`, then run:

```sh
pnpm test:integration
```

`YAHOO_INTEGRATION_LEAGUE_KEY` and `YAHOO_INTEGRATION_TEAM_KEY` can select explicit resources. The smoke suite performs no writes.

References: [Yahoo Fantasy Sports API](https://developer.yahoo.com/fantasysports/guide/), [Yahoo authorization-code flow](https://developer.yahoo.com/oauth2/guide/flows_authcode/), and [authenticated API requests](https://developer.yahoo.com/oauth2/guide/apirequests/).
