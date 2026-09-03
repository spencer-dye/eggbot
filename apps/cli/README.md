# `@eggbot/cli`

The default `pnpm cli` command is a credential-free composition smoke test. It reports the safe local decision, policy, and Phase 8 manager capabilities without invoking any platform or model provider. Phase 1 also provides manual Yahoo read commands:

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
pnpm cli yahoo snapshot 449.l.1234 3 --free-agent-limit 50 --waiver-limit 50
```

Phase 7 can run the complete autonomous lineup workflow from a caller-supplied projection JSON file. It defaults to Yahoo's non-mutating local dry run and requires complete projection coverage for movable roster players:

```sh
pnpm cli yahoo manage-lineup 449.l.1234 449.l.1234.t.1 3 \
  --projections ./projections-week-3.json --minimum-gain 0.5
```

The projection file contains `scoringPeriod`, `observedAt`, `source`, optional `version`, and a `players` array of `{ playerId, points, floor?, ceiling? }`. Snapshot age defaults to five minutes and projection age to thirty minutes; both are configurable with explicit millisecond options. Add `--execute` only after reviewing dry-run output. Execute mode repeats platform dry-run preflight, rechecks freshness, performs the mutation, and reports the subsequent Yahoo lineup read as verified, mismatched, or failed.

Phase 8 uses the same projection envelope for ranked free-agent and waiver upgrades. It defaults to one action, a one-point minimum projected gain, and dry-run mode. Budget leagues require an explicit fixed or percentage strategy; priority leagues omit bids:

```sh
pnpm cli yahoo manage-waivers 449.l.1234 449.l.1234.t.1 3 \
  --projections ./projections-week-3.json --bid-percent 0.05 \
  --max-waiver-bid 10 --max-waiver-priority 4
```

Use `--waivers-only` to exclude immediate free agents and `--max-actions` to allow a ranked claim batch. The manager rejects the whole ranked plan if any action fails policy and submits claims in deterministic rank order without claiming that this controls provider resolution order. Successful free-agent actions are verified through a roster re-read, while waiver claims remain explicitly pending.

Yahoo commands read `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, and optionally `YAHOO_REDIRECT_URI` (default `oob`). Initial tokens can be supplied through `YAHOO_ACCESS_TOKEN`, `YAHOO_REFRESH_TOKEN`, and `YAHOO_TOKEN_EXPIRES_AT` as epoch milliseconds or an ISO timestamp.

Newly exchanged and refreshed tokens are saved to `.eggbot/yahoo-tokens.json` with owner-only permissions. Override the location with `YAHOO_TOKEN_FILE`. Normal output redacts access and refresh tokens; `yahoo exchange` reveals them only with the explicit `--show-secrets` flag.

Phase 2 write commands produce the exact request preview without credentials by default:

```sh
pnpm cli yahoo lineup-change 449.l.1234 449.l.1234.t.1 3 449.p.10=QB,449.p.20=RB
pnpm cli yahoo add 449.l.1234 449.l.1234.t.1 449.p.10
pnpm cli yahoo drop 449.l.1234 449.l.1234.t.1 449.p.20
pnpm cli yahoo add-drop 449.l.1234 449.l.1234.t.1 449.p.10 449.p.20
pnpm cli yahoo waiver 449.l.1234 449.l.1234.t.1 449.p.10 449.p.20 --bid 7
```

A direct live mutation requires all three independent signals: `--execute`, a stable `--action-id`, and `YAHOO_ENABLE_WRITES=1`. Autonomous lineup and waiver execution require `--execute` and `YAHOO_ENABLE_WRITES=1`; managers create host-owned action IDs and independently enforce policy and freshness. Yahoo currently does not grant write access to new applications, so execution also requires credentials Yahoo has already authorized for writes. The CLI's journal is process-local; use an injected durable journal for production transaction retries.
