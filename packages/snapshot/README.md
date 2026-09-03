# `@eggbot/snapshot`

Provider-independent orchestration for normalized league snapshots.

`LeagueSnapshotService` composes a `FantasyPlatformReader` across league, team, roster, lineup, standings, matchup, player-pool, and transaction reads. It validates configured team count, complete standings coverage, cross-resource identities, and globally unique roster ownership, returning no partial required state. Because platform APIs do not expose an atomic league read, every snapshot records an observation window and `consistency: 'best-effort'`; pool/roster races become typed integrity warnings.

Free-agent, waiver, and recent-transaction collections are explicitly bounded. Callers choose their limits and can inspect coverage metadata instead of assuming those collections are complete.

Snapshots also retain optional normalized league acquisition rules and team-relative waiver state carried by the platform reads. Integrity validation rejects negative or non-finite acquisition values; unavailable provider facts remain absent rather than inferred. Injected snapshot IDs are parsed at runtime before a result is returned.

This package does not select a database or persist snapshots. Applications decide whether and where a completed snapshot is stored.
