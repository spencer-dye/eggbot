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
pnpm cli yahoo players 449.l.1234 --search Smith --limit 10
pnpm cli yahoo transactions 449.l.1234 --limit 10
```

Yahoo commands read `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, and optionally `YAHOO_REDIRECT_URI` (default `oob`). Read commands also use `YAHOO_ACCESS_TOKEN`, optional `YAHOO_REFRESH_TOKEN`, and optional `YAHOO_TOKEN_EXPIRES_AT` as epoch milliseconds or an ISO timestamp.

The CLI deliberately does not persist secrets. Newly exchanged or refreshed tokens are printed for caller-managed storage. No command performs a Yahoo write.
