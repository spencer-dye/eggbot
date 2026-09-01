# EggBot roadmap

Each phase builds on stable public boundaries. Phases 0 through 3 are implemented; later phases remain roadmap only.

## Phase 0 — Foundation

Establish the pnpm monorepo, strict TypeScript domain model, architecture documentation, extension interfaces, CLI composition proof, and deterministic unit tests.

## Phase 1 — Yahoo read integration

Add OAuth and normalized read-only access to leagues, teams, rosters, standings, matchups, players, and transactions. Implemented with injected token persistence and transport boundaries; live credentials remain opt-in.

## Phase 2 — Yahoo safe-write integration

Implemented lineup changes and standalone add, drop, add/drop, and waiver transactions with ownership validation, mandatory execution modes, write-ahead action-ID idempotency, poisoned uncertain outcomes, returned transaction references, explicit write enablement, and locally scoped dry-run request previews.

## Phase 3 — League snapshots

Implemented normalized, timestamped, integrity-checked league state with explicit best-effort consistency, bounded free-agent/waiver and transaction coverage, all-team roster/lineup state, and a provider-independent capture service suitable for analytics and decision engines.

## Phase 4 — Analytics

Implement deterministic fantasy-football calculations such as lineup projections, replacement value, scarcity, matchup margin, and roster risk.

## Phase 5 — Decision engines

Stabilize the provider-neutral decision interface and add the first concrete integrations in separate provider packages.

## Phase 6 — Policy engine

Expand guardrails, validation, structured rejection reasons, conflict detection, and execution approval.

## Phase 7 — Autonomous lineup management

Deliver end-to-end, low-risk autonomous lineup management with full auditability.

## Phase 8 — Waiver management

Add/drop decisions, waiver ordering, and budget or priority strategy.

## Phase 9 — External football intelligence

Integrate injuries, projections, depth charts, usage, news, and schedules behind provider-neutral ports.

## Phase 10 — Trade support

Build trade evaluation first. Consider autonomous trade behavior only after sufficient safeguards and approval controls exist.

## Phase 11 — Operational hardening

Add production scheduling, audit history, retries, reconciliation, failure recovery, persistence implementations, deployment documentation, and operational guidance.
