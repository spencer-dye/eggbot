# `@eggbot/cli`

The default `pnpm cli` command is a credential-free composition smoke test. Phase 1 also provides manual Yahoo read commands:

```sh
pnpm cli yahoo help
pnpm cli yahoo auth-url optional-csrf-state
pnpm cli yahoo exchange AUTHORIZATION_CODE
pnpm cli yahoo games
pnpm cli yahoo leagues
pnpm cli yahoo league 449.l.1234
pnpm cli yahoo teams 449.l.1234
pnpm cli yahoo roster 449.l.1234.t.1
pnpm cli yahoo lineup 449.l.1234.t.1 3
pnpm cli yahoo standings 449.l.1234
pnpm cli yahoo matchups 449.l.1234 3
pnpm cli yahoo players 449.l.1234 --availability waivers --positions RB,WR --limit 10
pnpm cli yahoo transactions 449.l.1234 --limit 10
```

Yahoo commands read `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, and optionally `YAHOO_REDIRECT_URI` (default `oob`). Initial tokens can be supplied through `YAHOO_ACCESS_TOKEN`, `YAHOO_REFRESH_TOKEN`, and `YAHOO_TOKEN_EXPIRES_AT` as epoch milliseconds or an ISO timestamp.

Newly exchanged and refreshed tokens are saved to `.eggbot/yahoo-tokens.json` with owner-only permissions. Override the location with `YAHOO_TOKEN_FILE`. Normal output redacts access and refresh tokens; `yahoo exchange` reveals them only with the explicit `--show-secrets` flag.

Phase 2 write commands produce the exact request preview without credentials by default:

```sh
pnpm cli yahoo lineup-change 449.l.1234 449.l.1234.t.1 3 449.p.10=QB,449.p.20=RB
pnpm cli yahoo add-drop 449.l.1234 449.l.1234.t.1 449.p.10 449.p.20
pnpm cli yahoo waiver 449.l.1234 449.l.1234.t.1 449.p.10 449.p.20 --bid 7
```

A live mutation requires all three independent signals: `--execute`, a stable `--action-id`, and `YAHOO_ENABLE_WRITES=1`. Yahoo currently does not grant write access to new applications, so execution also requires credentials Yahoo has already authorized for writes. The CLI's journal is process-local; use an injected durable journal for production transaction retries.
