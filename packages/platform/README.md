# `@eggbot/platform`

Provider-neutral discovery, read, and execution contracts for fantasy-platform adapters. Read access and side-effecting execution are intentionally separate capabilities. The read port includes normalized games/leagues, standings, transaction history, and explicit player availability (`available`, `free-agent`, or `waivers`) without exposing provider resource keys or payloads.

`getStandings` guarantees exactly one normalized standing for every team returned by `getTeams`, allowing snapshot consumers to treat missing coverage as an adapter failure rather than silently incomplete state.

Execution always requires an explicit `dry-run` or `execute` mode. There is no mutation default.
