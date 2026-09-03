# `@eggbot/manager`

Provider-neutral application orchestration for EggBot automation.

`AutonomousLineupManager` implements the Phase 7 one-shot workflow: capture one league snapshot, load caller-supplied projections, calculate analytics, run an isolated decision engine, evaluate policy, and pass only an approved lineup action to the platform executor. Execute mode must first pass platform dry-run preflight, then pass a second snapshot-freshness check before mutation. Confirmed executions are re-read through the injected lineup reader and compared with the intended assignments.

The manager also requires an explicit execution mode, positive snapshot and projection age limits, rejects all non-lineup proposals, validates policy and executor contracts, and prevents overlapping runs on one manager instance.

Every completed workflow returns an inspectable `LineupManagementRun` containing exact inputs and outputs across the snapshot, analytics, decision, policy, approval, platform preflight, execution, and verification stages. Verification records `verified`, `mismatch`, or `failed` separately from executor success. The manager remains independent of persistence, distributed locking, scheduling, platform credentials, and external projection acquisition; Phase 11 operational packages compose around it.

`AutonomousWaiverManager` adds the Phase 8 one-shot acquisition workflow with the same mandatory freshness, policy, executor-contract, and platform-preflight gates. It accepts only adds, atomic add/drops, and waiver claims, and keeps the ranked batch all-or-nothing at policy time. Immediate free-agent mutations are verified through one injected roster re-read and record verified, mismatched, or failed evidence per action. This is final-state batch verification, not proof of each intermediate roster transition. Verification read failures retain available provider cause code, retryability, and HTTP status evidence. Accepted waiver claims record pending submission and any external reference.

The run's top-level `status` describes platform execution only; `resolutionStatus` separately summarizes verification and pending-claim evidence. Mixed batches report `executed-and-submitted` plus a compound resolution such as `verified-and-pending`, `mismatch-and-pending`, or `failed-and-pending`. Consumers must inspect both fields because an `executed` run can have a `mismatch` or `failed` resolution.

`WaiverReconciler` implements the later-resolution boundary. It matches only explicit external transaction references, classifies provider statuses conservatively, and verifies successful claims against one final roster read. Missing history, unknown statuses, mismatches, and retryable read failures remain explicit rather than being guessed as success.
