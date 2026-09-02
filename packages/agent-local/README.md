# `@eggbot/agent-local`

Safe local implementations of the provider-neutral `DecisionEngine` contract.

`createNoActionDecisionEngine` is a concrete fail-safe engine that always proposes no changes with an inspectable rationale. `createLocalDecisionEngine` adapts an injected deterministic or human-mediated function without granting it platform credentials or execution capability.

The package performs no network requests and contains no autonomous roster strategy. Run returned engines through `runDecisionEngine` from `@eggbot/agent` to validate scope and assign host-owned audit metadata.
