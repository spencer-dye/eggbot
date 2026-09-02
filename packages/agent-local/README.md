# `@eggbot/agent-local`

Safe local implementations of the provider-neutral `DecisionEngine` contract.

`createNoActionDecisionEngine` is a concrete fail-safe engine that always proposes no changes with an inspectable rationale. `createLocalDecisionEngine` adapts an injected deterministic or human-mediated function. `createProjectedLineupDecisionEngine` is the conservative Phase 7 strategy: it preserves reserve assignments, requires complete movable-roster projections by default, maximizes projected active-slot points, and emits at most one lineup action only above a configured gain threshold.

`createProjectedWaiverDecisionEngine` is the Phase 8 strategy. It protects active and reserve players from automatic drops, ranks captured free-agent and waiver upgrades by net projected gain, preserves claim ordering, respects observed acquisition limits, can conserve low waiver priority through a maximum-rank threshold, and supports fixed or percentage-of-remaining budget bids. It abstains when projection, waiver-system, budget/priority, or configured-limit usage required for a safe claim is unavailable.

The package performs no network requests and receives no platform credentials or execution capability. Run returned engines through `runDecisionEngine` from `@eggbot/agent` to validate scope and assign host-owned audit metadata.
