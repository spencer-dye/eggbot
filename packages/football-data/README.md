# `@eggbot/football-data`

Provider-neutral external football intelligence for EggBot. The package owns normalized, provenance-bearing injuries, projections, depth charts, usage, news, and professional schedules without selecting a vendor.

Concrete provider adapters implement `FootballDataProvider`. Applications also inject a `PlayerIdentityResolver`, which maps each EggBot player ID to a provider-owned reference before any provider read. Resolution must be complete, unique, and provider-scoped; vendor IDs never enter `Player`.

`FootballIntelligenceService` calls every read concurrently, strictly parses the returned data, enforces scoring-period and requested-resource scope, rejects future provenance/report/news timestamps relative to capture time, and returns a best-effort observation window. An explicit `maxFutureSkewMs` can tolerate known provider clock skew without defining freshness. Parsers reject non-finite metrics and normalize duplicate news-player references. Individual parser functions are public so adapters can validate data at their own external boundary as well.

The package performs no credential discovery, persistence, scheduling, fantasy-platform reads, decisions, policy evaluation, or roster writes. Applications inject providers and decide how captured intelligence feeds analytics and automation.
