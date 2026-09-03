# EggBot architecture

## Goals

EggBot is a reusable, provider-independent framework for safe fantasy-football automation. Its public boundaries make dependencies explicit, keep decisions inspectable, and reserve side effects for concrete platform adapters. Phases 0 through 8 establish the shared boundaries, Yahoo adapter, guarded execution, normalized snapshots, deterministic analytics, audited decision and policy boundaries, and autonomous lineup and waiver orchestration without choosing a league format, model provider, database, scheduler, or deployment environment.

## Workspace layout

| Workspace             | Responsibility                                             | Direct workspace dependencies                                  |
| --------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| `@eggbot/core`        | Stable domain vocabulary, opaque IDs, actions, and results | None                                                           |
| `@eggbot/platform`    | Provider-neutral read and execution ports                  | `core`                                                         |
| `@eggbot/yahoo`       | Yahoo OAuth, read transport, validation, and mapping       | `core`, `platform`                                             |
| `@eggbot/snapshot`    | Normalized multi-read league snapshot capture              | `core`, `platform`                                             |
| `@eggbot/agent`       | Provider-neutral decision-engine port                      | `core`, `analytics`                                            |
| `@eggbot/agent-local` | Safe local decision-engine implementations                 | `core`, `agent`                                                |
| `@eggbot/policy`      | Deterministic approval/rejection boundary                  | `core`, `agent`                                                |
| `@eggbot/manager`     | Guarded autonomous application workflows                   | `core`, `platform`, `snapshot`, `analytics`, `agent`, `policy` |
| `@eggbot/analytics`   | Deterministic calculations and analytics port              | `core`                                                         |
| `@eggbot/storage`     | Persistence port, with no implementation                   | None                                                           |
| `@eggbot/scheduler`   | Scheduling port, with no implementation                    | None                                                           |
| `@eggbot/cli`         | Application composition proof                              | Public APIs of all packages                                    |

Packages expose a single explicit root entry point. Deep imports are not part of the public API. TypeScript project references and pnpm workspace links enforce an acyclic build graph.

```mermaid
flowchart TD
  CLI[Application composition] --> A[agent]
  CLI --> M[manager]
  CLI --> P[policy]
  CLI --> N[analytics]
  CLI --> FP[platform ports]
  CLI --> S[storage port]
  CLI --> J[scheduler port]
  Y[Yahoo adapter] --> FP
  AL[local agent implementations] --> A
  M --> LS
  M --> N
  M --> A
  M --> P
  M --> FP
  LS[snapshot capture] --> FP
  LS --> C
  A --> N
  A --> C[core]
  P --> A
  P --> C
  N --> C
  FP --> C
```

## Phase 8 public API changes

The original domain could express a waiver claim and optional bid, but the snapshot could not say which waiver system governed the league, how much budget or priority the managed team held, or whether acquisition limits were exhausted. Autonomous waiver behavior could therefore construct syntactically valid actions without the state required to judge them. Phase 8 additively introduces `AcquisitionRules` on `LeagueSettings` and `TeamAcquisitionState` on `Team`. Both are optional because platforms and league formats expose different subsets; absence stays explicit and causes conservative abstention or policy rejection where the missing fact is required. Yahoo maps its waiver type, FAAB, priority, and move metadata at the adapter boundary.

`createProjectedWaiverDecisionEngine` is a deterministic acquisition strategy. It considers captured free agents and waiver players, protects active and reserve placements from automatic drops, requires complete candidate projections by default, ranks actions by net projected roster gain, and preserves that ranking through submission. Submission order does not claim control over provider-side waiver resolution order. It supports fixed and remaining-budget-percentage bids. Budget amounts are non-negative safe-integer units throughout the domain and runtime boundaries. Budget claims require observed remaining budget, all selected bids fit within that balance in the worst case, and configured league limits reduce or block the proposal. Bounded player pools remain visible; the engine does not claim it found the globally optimal player outside the capture.

`AutonomousWaiverManager` composes the same snapshot, projection, decision, policy, freshness, contract-validation, and mandatory provider-preflight boundaries used by lineup automation. It permits only add, atomic add/drop, and waiver-claim actions, and rejects the entire ranked plan when any action fails policy so a lower-ranked claim is not silently promoted. Resolution is action-scoped: accepted free-agent adds and add/drops are verified through one authoritative roster re-read, while accepted waiver claims retain their external transaction reference as pending submissions. The re-read is final-state batch verification: it proves the resulting roster contains the expected additions and removals, not every intermediate transition in a multi-action batch. Provider read failures retain available cause code, retryability, and HTTP status evidence.

`WaiverManagementRun.status` describes platform execution only, including `executed-and-submitted` for a mixed immediate-and-waiver batch. Consumers must inspect the separate aggregate `resolutionStatus` and per-action `resolutions` before treating immediate mutations as verified. An execution can therefore be `executed` while its observed resolution is `mismatch` or `failed`; compound resolution statuses retain pending-waiver evidence in mixed batches. Waiver resolution still occurs later and durable reconciliation remains Phase 11 work.

Policy independently validates known waiver-system semantics, required and supported bids, individual and batch remaining budget, and weekly/season acquisition limits. This makes the strategy replaceable without making it a safety boundary.

## Phase 7 public API changes

Phase 7 needs to compare every managed roster player when constructing a lineup, but the Phase 4 `LeagueAnalytics` contract retained only projection provenance and aggregates for the current lineup. A decision engine could not inspect bench alternatives, and a `DecisionRun` did not contain enough input data to reproduce an autonomous lineup choice. Phase 7 therefore additively retains a normalized copy of the exact `playerProjections` on `LeagueAnalytics`. Projection acquisition remains caller-supplied; no external football-data provider is selected.

`@eggbot/manager` is the reusable application-service boundary for the end-to-end lineup workflow. It composes snapshot capture, deterministic analytics, a decision engine, policy, and a platform executor without giving write authority to analytics or the agent. Its Phase 7 surface accepts only one lineup action, requires explicit dry-run or execute mode plus positive snapshot and projection age limits, rechecks snapshot freshness immediately before execution, validates custom policy/executor outputs against their inputs, and allows only one in-process run per manager instance. A completed run returns the exact snapshot, analytics, decision run, policy evaluation and approval, execution results, timestamps, and terminal status. Persistence, distributed locking, retries, reconciliation, and production scheduling remain Phase 11 concerns.

Execute mode never calls a platform mutation directly after policy. The manager first invokes the injected executor in `dry-run` mode and requires every result to be a successful dry run, rechecks snapshot freshness after preflight, and only then invokes `execute`. When execution results are all confirmed, the manager re-reads the scoring-period lineup through an injected platform reader and records verification independently as `verified`, `mismatch`, or `failed`; an executor's success report is not silently treated as observed state convergence. Dry-run results, mutation results, and verification evidence remain separate fields in the workflow audit record.

The first autonomous strategy remains in `@eggbot/agent-local`: a deterministic projection-based lineup engine. It requires complete projection coverage for every movable active/bench player by default, abstains on managed-roster integrity warnings, preserves reserve assignments, computes a maximum-projection legal active lineup, and proposes at most one `set-lineup` action only when the configured minimum gain is exceeded. It never proposes acquisitions, waivers, trades, or direct writes.

## Phase 6 public API changes

The original `PolicyContext` contained an independently supplied `League` and `Roster`, while `PolicyEngine.evaluate` accepted a bare `FantasyDecision`. That surface could not prove the decision, analytics, roster, lineup, acquisition pools, and scoring period came from the same observation. Phase 5 also initially retained exact analytics but only a snapshot ID on `DecisionRun`, allowing a different snapshot object to be supplied under the same ID. It also evaluated each action in isolation, so duplicate or mutually conflicting actions could each be approved.

Phase 6 makes `DecisionRun` retain the exact immutable `LeagueSnapshot` alongside its analytics. Policy accepts only the run plus an evaluation timestamp, eliminating independently supplied state. Run provenance mismatches and invalid policy configuration are programmer errors represented by `PolicyValidationError`. Action legality remains a normal, typed rejection. Mandatory built-in rules check action scope, current roster ownership, captured free-agent versus waiver availability, lineup slots/players/eligibility/resulting completeness, roster capacity, same-player add/drop, duplicate identities and intents, and cross-action player or lineup conflicts. Actions are deliberately validated against the snapshot rather than simulated in decision order; dependent replacements must use the atomic `add-drop` shape. A second pass calculates the resulting roster size of actions that survived every other rule and rejects all standalone acquisitions if that approved batch would exceed capacity.

Applications can configure protected players, decision and roster-mutation limits, maximum waiver bids, and snapshot age. Snapshot age intentionally has no framework-wide default, but Phase 7 autonomous applications must configure `maxSnapshotAgeMs` as an operational invariant before granting execution authority. Custom deterministic rules return issue data without controlling action IDs or rule attribution; the engine produces normalized `PolicyIssue` records with rule IDs, resource references, and related conflicting actions. Evaluations retain a runtime-frozen policy identity/version, effective guardrails, and every configured custom-rule ID for reproducibility. `createPolicyApproval` derives a provenance-bearing batch containing only approved actions. Policy never receives a platform executor and never performs writes; provider preflight remains an independent final safeguard against state changes after snapshot capture.

## Phase 5 public API changes

The original `DecisionEngine.decide()` returned a complete `FantasyDecision`. That allowed an engine—including a future external model adapter—to choose audit timestamps, decision identifiers, and action idempotency keys, and there was no standard boundary validating rationale, league/team scope, or lineup scoring period. Calling the engine also produced no record connecting its identity and version to the source snapshot and exact analytics.

Phase 5 changes engine output to a `DecisionProposal`: rationale plus inspectable action intents, but no decision or action identities and no audit timestamps. `runDecisionEngine` validates the context and proposal, assigns decision and action IDs plus timestamps through injected application-owned functions, and returns a `DecisionRun` that records engine identity, the exact source snapshot and analytics, managed team, timing, and the resulting `FantasyDecision`. Proposal validation rebuilds every action and lineup assignment from an explicit field allowlist and passes every identifier through the core branded-ID parsers; unknown model-supplied fields cannot flow into policy, fingerprints, audit records, or executors. Generated action IDs must be non-empty and unique within the decision. Invalid output fails closed with a typed `DecisionValidationError`; provider failures remain provider failures rather than being mislabeled as validation errors.

`@eggbot/agent-local` is the first separate implementation package. It provides a safe no-action engine and an injected-function adapter for deterministic, human-mediated, or test-local decision logic. It has no platform reader, executor, credentials, network client, or model SDK. Concrete model-provider packages remain deferred until a provider is deliberately selected; they can implement the same `DecisionEngine` port without changing core or receiving write authority.

## Domain and platform separation

`@eggbot/core` owns EggBot's vocabulary. Platform payloads and identifiers must be validated and mapped at adapter boundaries; they must not become the core model. Opaque EggBot IDs prevent accidental interchange of league, team, player, slot, decision, action, and transaction identifiers. `PlatformReference` exists only to explicitly associate an external identity when a boundary needs one.

The platform contract separates `FantasyPlatformReader` from `FantasyPlatformExecutor`. Read-only applications therefore need no write authority. Concrete adapters return core types and translate `FantasyAction` data into provider operations internally.

The Yahoo package implements read capability and the Phase 2 write boundary. OAuth, token refresh, HTTP transport, response validation, Yahoo identifier codecs, mappings, XML serialization, state validation, and idempotency remain inside the adapter.

## Phase 3 public API changes

The original `DecisionContext` independently selected league, roster, lineup, matchup, and player fields. It could not prove that two consumers received the same observed state, represent all teams, retain standings or transactions, or distinguish bounded free-agent and waiver pools. Phase 3 replaces that ad hoc state with one normalized `LeagueSnapshot`, an explicit `managedTeamId`, and a separate analytics record. `createDecisionContext` rejects management scope that is absent from the snapshot.

`@eggbot/core` owns the provider-neutral snapshot vocabulary and opaque `SnapshotId`. A snapshot contains its league and scoring period, every discovered team's roster and lineup, standings, matchups, separate free-agent and waiver pools, and recent transactions. Potentially large player and transaction collections carry explicit bounded-coverage metadata; a consumer cannot mistake the first N results for a complete collection.

`@eggbot/snapshot` orchestrates a `FantasyPlatformReader` to capture this state and validates cross-resource identity invariants before returning it. Capture is fail-closed for configured team count, complete standings coverage, global roster ownership, and required read failures. Provider APIs do not offer an atomic read across all resources, so pool/roster overlap is retained as an `observation-race` integrity warning rather than rejecting an otherwise useful snapshot. Snapshots record both `captureStartedAt` and `capturedAt` and explicitly declare `consistency: 'best-effort'`. The service starts roster and lineup reads as soon as team discovery completes, bounds their concurrency, and accepts injected clocks and ID factories for deterministic tests.

No snapshot persistence implementation is selected in Phase 3. Applications may pass returned snapshots to analytics and decision engines or persist them through a future database-neutral repository once access patterns are established.

## Phase 4 public API changes

The Phase 3 `DecisionContext.analytics` field was an untyped record, so decision engines could not rely on stable metric names, units, provenance, or coverage. Phase 4 replaces it with the provider-neutral `LeagueAnalytics` result exported by `@eggbot/analytics`; `@eggbot/agent` therefore adds a type-only dependency on that package. Context construction rejects analytics from another snapshot or scoring period, or analytics that omit the managed team.

`analyzeLeagueSnapshot` deterministically combines a normalized `LeagueSnapshot` with a caller-supplied `ProjectionSet`. The projection envelope records scoring period, observation time, source, and optional source version. Analysis fails closed when its scoring period differs from the snapshot, preventing results from being labeled with the wrong period. It also validates missing provenance and duplicate, non-finite, or internally inconsistent player projections. No projection vendor, network call, model, or mutable global configuration is selected.

Analytics produce per-team lineup projections, coverage-qualified matchup margins, the best projected available player by position, rostered-player value over that available benchmark, captured-pool positional scarcity, and factual roster-risk metrics. A matchup margin is omitted unless the participant and every opponent have complete starter projection coverage; `marginCoverage` distinguishes complete and partial inputs.

The original Phase 4 names `replacementLevels`, `playerValues`, and `positionalScarcity` overstated their methodology. The calculations use only the captured free-agent and waiver pools, not a league-depth replacement threshold or the distribution of all league players. The corrected API therefore uses `bestAvailablePlayers`, `playerValuesOverBestAvailable`, and `availablePositionScarcity`. Because acquisition pools are bounded, analytics retain explicit warnings and do not claim exhaustive league-wide estimates. The unused magic-string `AnalyticsMetric` and `AnalyticsProvider` contracts were removed so the typed `LeagueAnalytics` surface remains the single analytics model.

Risk output deliberately avoids a subjective composite score. It reports observable missing slots and projections, starter concentration, projected downside where floor estimates exist, and relevant source-snapshot integrity warnings.

## Phase 2 public API changes

The Phase 0 executor signature could not express whether a call was a dry run or a mutation. Before any concrete executor existed, Phase 2 makes the mode mandatory: `execute(actions, { mode: 'dry-run' | 'execute' })`. There is deliberately no default. Core `ActionResult` adds `dry-run` and `execution-uncertain` variants so local validation, confirmed execution, and an ambiguous mutation outcome cannot be confused.

Action IDs are execution idempotency keys. The Yahoo executor fingerprints the full action, deduplicates concurrent calls, reuses prior successful results through an injected execution journal, and rejects reuse of an ID with different action data. Before sending a mutation it durably records a `pending` intent. If a transaction POST has an ambiguous transport outcome, or Yahoo accepts it but the executed result cannot be committed, the action becomes `execution-uncertain`. It is poisoned in memory and its durable pending record blocks automatic execution after restart. Reconciliation with Yahoo is required before an operator resolves that journal entry.

Yahoo write support follows its documented roster `PUT` and league-transactions `POST` XML formats. Runtime writes additionally require an explicit `allowWrites` kill-switch. Yahoo's current developer access portal states that write access is not presently available for new applications, so credentials must independently have a Yahoo write grant. Dry-run performs local state validation and request serialization without sending PUT or POST. Its result is explicitly labeled `validation: 'local'`: Yahoo remains authoritative for locks, acquisition limits, complete roster legality, waiver rules, and FAAB balance.

Phase 2 exposed a concrete deficiency in the original action vocabulary. Yahoo uses the same POST shape for an immediate free-agent acquisition and a pending waiver claim, based on current ownership state; `WaiverClaimAction` therefore cannot safely double as a no-drop add. Core adds explicit `AddPlayerAction` and `DropPlayerAction`. The Yahoo executor reads the target player's league ownership and requires free-agent state for add/add-drop actions and waiver state for waiver claims. Yahoo transaction keys returned in XML, JSON, or `Location` are normalized into `externalReference`.

## Phase 1 public API additions

Yahoo read integration exposed concrete omissions in the Phase 0 contracts. These are additive changes; no existing method or type is removed or reinterpreted.

- Core adds `Standing`, `Transaction`, `TransactionMove`, and `TransactionId`. Standings and transaction history are provider-independent league facts explicitly required by Phase 1, but Phase 0 had no normalized vocabulary for them.
- Platform adds `FantasyGame`, `LeagueSummary`, `TransactionQuery`, explicit player availability, and reader methods for authenticated game/league discovery, standings, and transactions. Yahoo cannot implement the required reads through the original six reader methods.
- `getRoster` remains the current roster read. Yahoo's week-specific roster representation is used by the existing `getLineup(teamId, scoringPeriod)` method, so no Yahoo week selector leaks into the general platform API.

Yahoo's irregular JSON collection encoding, resource keys, pagination limits, OAuth token shape, and week endpoint syntax remain adapter-local.

## Yahoo OAuth and read transport

`YahooOAuthClient` implements Yahoo's authorization-code exchange and proactive access-token refresh. Callers inject an optional `YahooTokenStore`; this keeps token persistence out of the adapter while ensuring refresh-token rotation can be saved. Concurrent callers share one refresh request. Client credentials and tokens never enter domain objects.

`YahooHttpClient` accepts only relative Fantasy API paths, adds Bearer authentication, and retries once after a 401 using a forced refresh. Reads request JSON and require Yahoo's `fantasy_content` envelope before reaching resource mappers. Writes expose only the adapter's required XML `PUT` and `POST` methods; arbitrary HTTP methods and absolute URLs remain unavailable.

`YahooFantasyReader` builds Yahoo-specific resource and collection URLs, performs pagination, and maps the validated boundary data into public EggBot types. Player availability maps explicitly to Yahoo's available, free-agent, or waiver filters. Multi-position queries fan out into provider-specific calls and deduplicate normalized players rather than silently ignoring requested positions.

The CLI is the only code that reads Yahoo environment variables. For developer use, it stores tokens in a gitignored local file with owner-only permissions. Library token persistence remains injected. Normal CLI output always redacts OAuth secrets unless the user explicitly requests `--show-secrets` during code exchange.

Unit tests inject `fetch`, a clock, and token stores. Normal tests use representative JSON fixtures and never require Yahoo credentials or network access.

Policy evaluation is action-scoped: every proposed action has its own approved/rejected result and complete issue list. A mixed decision has no ambiguous aggregate status. Orchestration explicitly derives approved actions before any future executor receives them.

## Deferred hardening decisions

- Before production game-window automation, add provider-independent scoring-period lineup editability or player-lock state. Phase 7 cannot predict already-started-player locks because neither the normalized snapshot nor the platform read port currently exposes them; Yahoo remains authoritative during mandatory preflight. Distributed leases keyed by league, team, and scoring period remain Phase 11 operational hardening.
- Before autonomous waiver management, add provider-independent waiver system, FAAB balance, priority, and acquisition-limit state based on Phase 3 snapshots; do not mirror Yahoo's full settings payload. Phase 2 deliberately labels dry-runs as local validation until that state exists.
- Extend lineup preflight with provider lock state when Phase 3 establishes a normalized representation. Phase 2 validates the resulting slot allocation and filled starters but Yahoo remains authoritative for locks.
- Keep `PlatformReference` and `FantasyGame.platformReference` until a second adapter provides evidence for a shared `GameId` design.
- Keep Yahoo's recursive collection traversal while sanitized fixtures and the opt-in live suite validate actual responses. Replace it with context-specific traversal if real payloads reveal duplicates or ambiguous nesting.
- Further constrain injectable Yahoo base URLs if transports become consumer-configurable outside tests. Current API paths are generated internally and explicit absolute paths are rejected.
- Extend `CollectionCoverage` with a complete variant only when a platform can authoritatively provide a total or `hasMore: false`; a short page alone is not proof of completeness.

## Decision and execution separation

State flows inward as normalized data; intent flows outward as inspectable actions:

```text
platform reads -> EggBot domain -> deterministic analytics -> decision proposal
decision proposal -> policy evaluation -> approved actions -> platform executor
```

A `DecisionEngine` receives domain context and analytics, not credentials or an executor. It returns a `DecisionProposal` containing rationale and action intents. The host runner validates that proposal and creates the `FantasyDecision`; neither operation has platform side effects. The policy engine evaluates every proposed action and returns an explicit approved or rejected result. Only an application composition root may pass approved actions to an executor.

`ActionResult` records successful execution metadata, an actionable failure, or an explicitly uncertain outcome without collapsing proposal, approval, and execution into one operation.

## Analytics philosophy

Deterministic facts belong in code. Decision engines may reason over those facts, but should not be asked to reproduce calculations that can be tested directly. Phase 4 implements typed, reproducible league analytics from an immutable snapshot and projection set. External projection acquisition remains a separate Phase 9 concern.

## Configuration and extension points

Applications are composition roots. They will construct and inject:

- fantasy-platform readers and executors
- decision engines
- policy rules or engines
- analytics providers
- storage adapters
- schedulers

Library code does not read environment variables, create singleton clients, or select concrete providers. Future platform and model integrations should use separate packages that implement these public ports.

## Error and validation philosophy

External values are validated at system boundaries; Phase 0 ID constructors use Zod for this purpose. Adapters should retain provider context while translating authentication, validation, transport, and API failures into actionable errors. Policy rejection remains a normal typed result, not an exception. A larger custom error hierarchy is intentionally deferred until real integrations demonstrate the distinctions needed.

## Eventual open-source considerations

Public exports are intentionally small and package-scoped for eventual semantic versioning. Provider payloads and implementation helpers remain internal. Normal tests require no credentials or live services. Future provider integration tests must be opt-in and separated from deterministic unit tests. Package READMEs document responsibility so contributors can extend the system without introducing circular dependencies or leaking concrete providers into stable abstractions.

## Phase 0 deviations

The instructed package boundaries are retained. The only interpretation choices are conservative: no build orchestrator is added for this small workspace; ESLint uses its current flat configuration; Yahoo exposes metadata rather than a throwing adapter; and storage, scheduler, and most analytics capabilities remain ports instead of placeholder implementations. These choices reduce speculative code while preserving every planned extension seam.
