# EggBot architecture

EggBot is a provider-independent TypeScript framework whose packages separate
observed state, deterministic facts, untrusted reasoning, approval, execution, and
operations. The dependency graph is acyclic and consumers import package roots.

## Package layout

| Package                 | Responsibility                                                       |
| ----------------------- | -------------------------------------------------------------------- |
| `@eggbot/core`          | Provider-neutral domain types, branded IDs, actions, and results     |
| `@eggbot/platform`      | Read and execution ports shared by provider adapters                 |
| `@eggbot/yahoo`         | Yahoo OAuth, validated mapping, reads, guarded writes, and journals  |
| `@eggbot/snapshot`      | Best-effort, integrity-checked league capture                        |
| `@eggbot/football-data` | Validated external football intelligence and identity resolution     |
| `@eggbot/analytics`     | Deterministic, provenance-bound league facts                         |
| `@eggbot/agent`         | Decision-engine contract, proposal normalization, and audited runs   |
| `@eggbot/agent-local`   | Safe deterministic local decision strategies                         |
| `@eggbot/policy`        | Snapshot-bound action approval and guardrails                        |
| `@eggbot/manager`       | Guarded lineup and waiver workflow orchestration and reconciliation  |
| `@eggbot/trades`        | Evaluation-only trade facts                                          |
| `@eggbot/storage`       | Operational storage, immutable audit history, and audited operations |
| `@eggbot/scheduler`     | Single-process scheduling, recovery, and explicit retry primitives   |
| `@eggbot/cli`           | Application composition and manual Yahoo exercise surface            |

The intended dependency direction is:

```text
core
  <- platform <- yahoo
  <- snapshot
  <- football-data <- analytics <- agent <- agent-local
  <- policy <- manager
  <- trades
  <- storage <- scheduler
```

Some packages depend on more than one lower boundary; arrows show architectural
direction, not every manifest edge. No provider-specific type may flow into core,
analytics, agents, policy, managers, trades, storage, or scheduler.

## Decision and mutation pipeline

```text
platform reads -> snapshot -> football data -> analytics -> decision proposal
       -> normalized decision run -> policy evaluation -> policy approval
       -> platform dry-run -> freshness recheck -> execute -> verify/reconcile
```

Each stage retains its own evidence. A proposal or `FantasyDecision` is intent, not
approval. Policy is deterministic and has no executor. Only a platform executor can
attempt a `FantasyAction`, and the caller must explicitly choose `dry-run` or
`execute`. The Yahoo adapter additionally requires write enablement. Autonomous
managers default to dry-run at the application/CLI boundary and require positive
snapshot and projection freshness limits. They validate custom policy and executor
outputs, restrict action scope, perform mandatory provider preflight, recheck both
snapshot and projection freshness immediately before a write, and read authoritative
state afterward.

Execution success and observed resolution are different facts. Immediate free-agent
mutations use final-state batch roster verification. Accepted waiver claims remain
pending until separate, evidence-driven reconciliation. An `execution-uncertain`
result poisons its durable action ID until reconciliation and is never automatically
retried.

## Provider boundaries

Adapters validate external payloads before mapping them into EggBot domain values.
Yahoo OAuth, token refresh, HTTP transport, provider identifier codecs, response
schemas, XML serialization, and execution journaling stay in `@eggbot/yahoo`.
Read operations and mutation operations use separate platform ports.

External football-data providers are application-selected. `PlayerIdentityResolver`
maps EggBot player IDs to provider-owned references before a provider read; vendor
IDs do not become core `PlayerId`s or fields on `Player`. Football-data snapshots
retain per-dataset provenance, enforce requested player/period scope, reject malformed
or future-dated input, and make their multi-read capture window explicit.

No model provider is bundled. Decision engines are isolated behind the agent contract
and receive normalized snapshots, deterministic analytics, optional validated
football intelligence, and an explicit managed-team ID—never secrets or write
authority.

## State, provenance, and validation

`LeagueSnapshot` is a best-effort observation across multiple provider requests, not
an atomic database view. Capture validates team counts when supplied, complete
standings membership, unique roster ownership, roster/lineup consistency, matchup
scope, collection coverage, and timestamps. Legitimate cross-read races such as a
rostered player also appearing in an acquisition pool become integrity warnings.

Analytics consumes a scoring-period-bound `ProjectionSet`, retains its provenance,
and exposes coverage rather than converting missing projections into confident zeroes.
Available-player comparisons describe the captured acquisition pool, not universal
replacement level or league-wide positional scarcity.

Decision proposals are untrusted. Validation rebuilds actions from explicit allowed
fields, parses branded IDs, checks management scope, and assigns host-owned decision
and action IDs. Policy then evaluates legality and configured guardrails against the
exact snapshot retained by the run. Dependent roster replacements use atomic
`add-drop`; policy does not simulate arbitrary action ordering.

## Writes and idempotency

An action ID is the durable idempotency key for its exact fingerprint. Yahoo execution
atomically prepares a pending journal record before a request. A competing process
that loses no-clobber preparation reloads the winner's record instead of issuing a
duplicate write. Confirmed responses commit execution evidence. Ambiguous transport
outcomes remain pending/uncertain until authoritative reconciliation; the same action
ID cannot be reused for different intent.

Dry-run validates locally and does not claim Yahoo will accept a future request.
Execution requires explicit mode, credentials, write enablement, current ownership
checks, and provider request validation. This library safety model does not replace
deployment access control, secret management, monitoring, or incident response.

## Operational model

`OperationalStorageAdapter` provides get, put, atomic no-clobber create, delete, and
prefix-list semantics. The file adapter is a crash-conscious, owner-only, single-host
implementation with contained hashed keys, atomic replacement, synchronization, and
corrupt-record rejection. It is not a distributed database.

Audit history uses immutable no-clobber events. Callers must normalize and redact
payloads before persistence. `AuditedOperationRunner` requires a durable start event
before invoking a workflow and records terminal evidence afterward; terminal-audit
failure exposes the completed result so callers do not lose awareness of possible side
effects.

`RecoverableScheduler` serializes job state, not executable functions. Applications
re-register functions at startup. Recovery is at-least-once, cancellation persists a
generation tombstone, and `close()` permanently stops that scheduler instance without
deleting durable scheduled state. Jobs need stable logical IDs and idempotent work.
The included scheduler prevents overlap only within one process. Multiple replicas
require application-selected leader election, external scheduling, and/or distributed
leases keyed to the logical workflow.

## Trade boundary

Trade support is strictly evaluation-only. `@eggbot/trades` validates explicit
player-transfer scenarios and league-, horizon-, source-, unit-, and time-bound value
sets. It reports coverage, raw additive package-value deltas, valuation/snapshot ages,
and roster-capacity effects. Raw delta is not a recommendation and excludes
roster-slot opportunity cost, replacement players, and strategic fit. No trade member
exists in `FantasyAction`; there is no trade policy, executor, offer, acceptance, or
autonomous manager.

## Intentional limits

- No league-specific configuration or strategy is embedded in public packages.
- No default model or football-data vendor is selected.
- Provider lock-state intelligence is not normalized; Yahoo remains authoritative at
  preflight.
- Player pools and transaction history are bounded unless a provider can prove
  completeness.
- File storage and the scheduler are single-host tools; distributed coordination is
  external.
- Deployment infrastructure, retention, alerting, secret rotation, and approval
  workflows belong to the consuming application.
- New abstractions are added only when a concrete integration exposes a deficiency.

Historical delivery context is retained in `ROADMAP.md`; it is not a plan for an
assumed next phase.
