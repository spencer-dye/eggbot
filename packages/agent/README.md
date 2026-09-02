# `@eggbot/agent`

Provider-neutral decision-engine contracts. Engines receive one normalized `LeagueSnapshot`, an explicit managed-team ID, and typed `LeagueAnalytics`. They return a `DecisionProposal`, not host audit metadata, and never receive credentials or platform executors.

`runDecisionEngine` validates context coherence, engine identity, proposal structure, league/team scope, and lineup scoring period. The application injects the clock plus decision- and action-ID factories; generated action IDs must be unique. A successful run returns a `DecisionRun` associating the resulting `FantasyDecision` with its source snapshot, exact analytics, managed team, engine identity/version, and execution window.
