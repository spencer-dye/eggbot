# `@eggbot/analytics`

Deterministic, provider-neutral fantasy-football facts derived from an immutable league snapshot and a caller-supplied `ProjectionSet`. The canonical projection types are owned by `@eggbot/football-data` and re-exported here for compatibility. The set records its scoring period, observation time, source, and optional version; mismatched scoring periods are rejected.

`analyzeLeagueSnapshot` reports lineup totals and projection coverage, coverage-qualified matchup margins, the best projected available player at each relevant position, rostered-player value over that benchmark, available-pool scarcity, and factual roster-risk indicators. Projection inputs are validated before calculation. Missing projections remain visible instead of being silently treated as zero, and matchup margins are omitted when any relevant lineup is incomplete.

Best-available and scarcity calculations use only players present in the snapshot's captured free-agent and waiver pools. They are not traditional league-depth replacement-level or whole-league scarcity metrics. Those collections are bounded, so every analysis carries explicit pool-coverage warnings and does not claim to be exhaustive. The package does not fetch projections or choose a data provider.
