# `@eggbot/manager`

Provider-neutral application orchestration for EggBot automation.

`AutonomousLineupManager` implements the Phase 7 one-shot workflow: capture one league snapshot, load caller-supplied projections, calculate analytics, run an isolated decision engine, evaluate policy, and pass only an approved lineup action to the platform executor. It requires an explicit execution mode, positive snapshot and projection age limits, rechecks snapshot freshness immediately before execution, rejects all non-lineup proposals, and prevents overlapping runs on one manager instance.

Every completed workflow returns an inspectable `LineupManagementRun` containing exact inputs and outputs across the snapshot, analytics, decision, policy, approval, and execution stages. The package does not provide persistence, distributed locking, retries, reconciliation, production scheduling, platform credentials, or external projection acquisition.
