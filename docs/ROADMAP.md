# EggBot roadmap

Each phase builds on stable public boundaries. Phases 0 through 9 are implemented; later phases remain roadmap only.

## Phase 0 — Foundation

Establish the pnpm monorepo, strict TypeScript domain model, architecture documentation, extension interfaces, CLI composition proof, and deterministic unit tests.

## Phase 1 — Yahoo read integration

Add OAuth and normalized read-only access to leagues, teams, rosters, standings, matchups, players, and transactions. Implemented with injected token persistence and transport boundaries; live credentials remain opt-in.

## Phase 2 — Yahoo safe-write integration

Implemented lineup changes and standalone add, drop, add/drop, and waiver transactions with ownership validation, mandatory execution modes, write-ahead action-ID idempotency, poisoned uncertain outcomes, returned transaction references, explicit write enablement, and locally scoped dry-run request previews.

## Phase 3 — League snapshots

Implemented normalized, timestamped, integrity-checked league state with explicit best-effort consistency, bounded free-agent/waiver and transaction coverage, all-team roster/lineup state, and a provider-independent capture service suitable for analytics and decision engines.

## Phase 4 — Analytics

Implemented provenance-bound, deterministic lineup projections, coverage-qualified matchup margins, best-available player comparisons, available-pool scarcity, and factual roster-risk metrics with explicit projection and bounded-player-pool coverage.

## Phase 5 — Decision engines

Implemented a provider-neutral proposal and audited-run boundary with context/output validation, host-owned decision identity and timing, and separate safe local implementations. Live model-provider integrations remain deliberately unselected.

## Phase 6 — Policy engine

Implemented snapshot-bound validation, mandatory legality rules, approved-batch roster-capacity validation, configurable guardrails, structured rejection reasons, cross-action conflict detection, custom-rule composition, runtime-frozen audit configuration, and explicit provenance-bearing execution approval. Phase 7 must configure snapshot freshness before autonomous execution.

## Phase 7 — Autonomous lineup management

Implemented deterministic maximum-projection lineup selection with complete-coverage and integrity-warning abstention, reserve preservation, minimum-gain control, exact projection retention, and a provider-neutral one-shot manager. The workflow composes snapshot capture through guarded execution, enforces snapshot/projection freshness and lineup-only scope, mandates successful platform dry-run before mutation, rechecks freshness after preflight, validates policy/executor contracts, verifies confirmed execution through a lineup re-read, prevents overlapping local runs, and returns a complete audit record. Production lock-state intelligence, scheduling, persistence, and distributed coordination remain deferred.

## Phase 8 — Waiver management

Implemented provider-neutral waiver rules and team state, Yahoo boundary mapping, projected-gain add/drop selection, ranked claim submission, priority and integer-budget bidding strategies, policy enforcement for acquisition limits and batch budget, and guarded autonomous orchestration with immediate-roster verification versus pending-claim resolution. Pending-claim outcome reconciliation remains Phase 11 work.

## Phase 9 — External football intelligence

Implemented provider-neutral, provenance-bearing injuries, projections, depth charts, usage, news, and professional schedules in `@eggbot/football-data`. Strict public parsers validate adapter output, and a scoped multi-read capture service preserves the best-effort observation window. Projection types moved to their correct owning boundary while `@eggbot/analytics` re-exports them for compatibility. Concrete commercial data providers remain application-selected adapters rather than framework defaults.

## Phase 10 — Trade support

Build trade evaluation first. Consider autonomous trade behavior only after sufficient safeguards and approval controls exist.

## Phase 11 — Operational hardening

Add production scheduling, audit history, retries, reconciliation, failure recovery, persistence implementations, deployment documentation, and operational guidance.
