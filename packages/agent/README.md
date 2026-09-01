# `@eggbot/agent`

Provider-neutral decision-engine contracts. Engines receive one normalized `LeagueSnapshot`, an explicit managed-team ID, and separately derived analytics. `createDecisionContext` validates that management scope against the snapshot. Engines return inspectable proposals and do not receive credentials or platform executors.
