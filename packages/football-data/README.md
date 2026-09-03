# `@eggbot/football-data`

Provider-neutral external football intelligence for EggBot. The package owns normalized, provenance-bearing injuries, projections, depth charts, usage, news, and professional schedules without selecting a vendor.

Concrete provider adapters implement `FootballDataProvider`. `FootballIntelligenceService` calls every read concurrently, strictly parses the returned data, enforces scoring-period and requested-resource scope, and returns a best-effort observation window. Individual parser functions are public so adapters can validate data at their own external boundary as well.

The package performs no credential discovery, persistence, scheduling, fantasy-platform reads, decisions, policy evaluation, or roster writes. Applications inject providers and decide how captured intelligence feeds analytics and automation.
