# `@eggbot/snapshot`

Provider-independent orchestration for normalized league snapshots.

`LeagueSnapshotService` composes a `FantasyPlatformReader` across league, team, roster, lineup, standings, matchup, player-pool, and transaction reads. It validates cross-resource identities and returns no partial snapshot. Because platform APIs do not expose an atomic league read, every snapshot records an observation window and `consistency: 'best-effort'`.

Free-agent, waiver, and recent-transaction collections are explicitly bounded. Callers choose their limits and can inspect coverage metadata instead of assuming those collections are complete.

This package does not select a database or persist snapshots. Applications decide whether and where a completed snapshot is stored.
