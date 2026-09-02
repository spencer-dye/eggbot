# `@eggbot/manager`

Provider-neutral application orchestration for EggBot automation.

`AutonomousLineupManager` implements the Phase 7 one-shot workflow: capture one league snapshot, load caller-supplied projections, calculate analytics, run an isolated decision engine, evaluate policy, and pass only an approved lineup action to the platform executor. Execute mode must first pass platform dry-run preflight, then pass a second snapshot-freshness check before mutation. Confirmed executions are re-read through the injected lineup reader and compared with the intended assignments.

The manager also requires an explicit execution mode, positive snapshot and projection age limits, rejects all non-lineup proposals, validates policy and executor contracts, and prevents overlapping runs on one manager instance.

Every completed workflow returns an inspectable `LineupManagementRun` containing exact inputs and outputs across the snapshot, analytics, decision, policy, approval, platform preflight, execution, and verification stages. Verification records `verified`, `mismatch`, or `failed` separately from executor success. The package does not provide persistence, lineup lock-state intelligence, distributed locking, retries, reconciliation, production scheduling, platform credentials, or external projection acquisition.
