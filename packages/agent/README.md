# `@eggbot/agent`

Provider-neutral decision-engine contracts. Engines receive one normalized `LeagueSnapshot`, an explicit managed-team ID, and typed `LeagueAnalytics`. `createDecisionContext` validates the management scope, analytics provenance, scoring period, and managed-team coverage. Engines return inspectable proposals and do not receive credentials or platform executors.
