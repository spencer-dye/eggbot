# `@eggbot/analytics`

Deterministic, provider-neutral fantasy-football facts derived from an immutable league snapshot and caller-supplied player projections.

`analyzeLeagueSnapshot` reports lineup totals and projection coverage, matchup margins, replacement levels, rostered-player value over replacement, positional scarcity, and factual roster-risk indicators. Projection inputs are validated before calculation. Missing projections remain visible instead of being silently treated as zero.

Replacement and scarcity calculations use only players present in the snapshot's captured free-agent and waiver pools. Those collections are bounded, so every analysis carries explicit pool-coverage warnings and does not claim to be exhaustive. The package does not fetch projections or choose a data provider.
