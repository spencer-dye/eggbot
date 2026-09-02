# `@eggbot/agent-local`

Safe local implementations of the provider-neutral `DecisionEngine` contract.

`createNoActionDecisionEngine` is a concrete fail-safe engine that always proposes no changes with an inspectable rationale. `createLocalDecisionEngine` adapts an injected deterministic or human-mediated function. `createProjectedLineupDecisionEngine` is the conservative Phase 7 strategy: it preserves reserve assignments, requires complete movable-roster projections by default, maximizes projected active-slot points, and emits at most one lineup action only above a configured gain threshold.

The package performs no network requests and receives no platform credentials or execution capability. Run returned engines through `runDecisionEngine` from `@eggbot/agent` to validate scope and assign host-owned audit metadata.
