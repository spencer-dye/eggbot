# EggBot — Initial Repository Instructions

We are building **EggBot**, a modular framework for autonomous fantasy football management.

EggBot should be designed from the beginning as a reusable library and eventual open-source project.

It must not assume any specific fantasy league, league size, scoring format, commissioner rules, team identity, deployment environment, or LLM provider.

The goal is to create a clean framework that other applications can consume.

---

# Core architectural goal

EggBot should provide reusable building blocks for:

- fantasy platform integrations
- normalized fantasy-football domain models
- analytics
- autonomous decision engines
- policy validation
- scheduling
- persistence
- safe execution of roster operations

The framework should be composable.

A consumer should eventually be able to assemble an application approximately like:

```ts
const bot = createEggBot({
  platform,
  decisionEngine,
  policy,
  analytics,
  storage,
  scheduler,
});
```

Do not treat this exact API as mandatory. Refine it as the domain becomes clearer.

The important properties are:

- explicit dependencies
- dependency inversion
- provider independence
- inspectable decisions
- separation between reasoning and side effects
- strong public boundaries

---

# Technology

Use:

- Node.js 22+
- TypeScript
- strict TypeScript configuration
- pnpm
- pnpm workspaces
- Vitest
- ESLint
- Prettier
- Zod for runtime validation at external boundaries

Prefer standard libraries and small dependencies.

Do not introduce a large agent framework unless there is a demonstrated technical need.

For this initial milestone, do not add:

- a database implementation
- deployment infrastructure
- a web UI
- an LLM provider integration
- production scheduling infrastructure

---

# Repository architecture

Set EggBot up as a monorepo.

Start with approximately:

```text
eggbot/
  apps/
    cli/

  packages/
    core/
    platform/
    yahoo/
    agent/
    policy/
    analytics/
    storage/
    scheduler/

  docs/
    ARCHITECTURE.md
    DOMAIN.md
    ROADMAP.md

  examples/

  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
```

Use package names along the lines of:

```text
@eggbot/core
@eggbot/platform
@eggbot/yahoo
@eggbot/agent
@eggbot/policy
@eggbot/analytics
@eggbot/storage
@eggbot/scheduler
```

These package boundaries are intentional, but avoid filling packages with unnecessary abstraction solely to match the directory structure.

If a package is mostly interfaces or placeholders during the first milestone, keep it minimal.

---

# Architectural boundaries

## `@eggbot/core`

Contains platform-independent fantasy-football concepts.

Examples may include:

- League
- LeagueSettings
- Team
- Player
- PlayerId
- TeamId
- Roster
- Lineup
- RosterSlot
- Position
- Matchup
- Transaction
- WaiverClaim
- FantasyAction
- FantasyDecision
- ActionResult
- scoring configuration

This package must not depend on:

- Yahoo
- another fantasy platform
- an LLM provider
- a database
- HTTP clients
- deployment infrastructure

Do not model the core domain as a thin copy of Yahoo API payloads.

EggBot should own its own domain vocabulary.

---

## `@eggbot/platform`

Defines abstractions for fantasy-platform integrations.

A conceptual interface might resemble:

```ts
export interface FantasyPlatform {
  getLeague(leagueId: LeagueId): Promise<League>;
  getTeams(leagueId: LeagueId): Promise<readonly Team[]>;
  getRoster(teamId: TeamId): Promise<Roster>;
  getAvailablePlayers(
    leagueId: LeagueId,
    query?: PlayerQuery
  ): Promise<readonly Player[]>;

  execute(actions: readonly FantasyAction[]): Promise<readonly ActionResult[]>;
}
```

Do not treat this exact interface as final.

Refine it based on actual use cases.

Important constraints:

- platform implementations return EggBot domain types
- platform-specific payloads do not leak into consumers
- read concerns and write concerns should remain distinguishable
- side effects should stay at platform boundaries

The architecture should make it possible to add other platform adapters later without redesigning the core framework.

---

## `@eggbot/yahoo`

Contains the Yahoo Fantasy Sports platform adapter.

Yahoo-specific concerns belong here:

- OAuth
- access and refresh tokens
- endpoint construction
- HTTP transport
- XML/JSON parsing
- Yahoo identifiers
- Yahoo validation
- Yahoo-specific API errors
- mapping Yahoo data into EggBot domain models
- mapping EggBot actions into Yahoo requests

Yahoo-specific types should remain internal wherever possible.

Do not implement the Yahoo API integration during the initial milestone unless a very small type or interface placeholder materially improves the architecture.

---

## `@eggbot/agent`

Defines interfaces and shared types for decision-making systems.

The framework must not depend on a specific LLM provider.

A conceptual interface might be:

```ts
export interface DecisionEngine {
  decide(context: DecisionContext): Promise<FantasyDecision>;
}
```

A decision engine might eventually be:

- an LLM
- deterministic logic
- a hybrid system
- a human approval workflow
- another external service

Do not implement a concrete model provider yet.

Potential future packages may include:

```text
@eggbot/agent-openai
@eggbot/agent-anthropic
@eggbot/agent-local
```

Those should remain outside the core agent abstraction.

---

## `@eggbot/policy`

Responsible for validating proposed actions before they reach a fantasy platform.

The intended architecture is:

```text
Platform state
    ↓
EggBot domain model
    ↓
analytics
    ↓
decision engine
    ↓
FantasyDecision
    ↓
policy validation
    ↓
approved FantasyActions
    ↓
platform execution
```

This separation is fundamental.

A decision engine must never receive credentials or directly invoke platform write APIs.

A bad model response must not be sufficient to mutate a roster.

Examples of future policy concerns:

- illegal roster states
- invalid player ownership
- excessive waiver churn
- protected assets
- transaction limits
- malformed actions
- conflicting actions
- risky trades
- duplicate operations

Do not implement an extensive rule engine yet.

Define clean abstractions.

---

## `@eggbot/analytics`

Contains deterministic fantasy-football calculations.

Potential future capabilities include:

- projected lineup points
- value over replacement
- positional scarcity
- matchup margin
- bye-week conflicts
- roster strength
- replacement-level estimates
- add/drop value deltas
- rest-of-season value calculations
- risk metrics

Guiding principle:

> Code calculates facts. Decision engines reason about facts.

Do not delegate deterministic calculations to an LLM when straightforward code can calculate them reliably.

---

## `@eggbot/storage`

Defines persistence abstractions.

Do not choose a production database yet.

Potential persisted concepts include:

- OAuth credentials
- league snapshots
- decision history
- audit events
- proposed actions
- policy results
- transaction outcomes
- scheduler state

Storage abstractions should not force consumers into a particular database.

---

## `@eggbot/scheduler`

Defines scheduling and job concepts.

Do not introduce production scheduling infrastructure yet.

Potential future jobs include:

- waiver analysis
- injury review
- lineup optimization
- pregame checks
- transaction reconciliation
- recurring snapshots

Scheduling should orchestrate application behavior rather than contain fantasy logic itself.

---

# Domain design principles

Strongly distinguish these concepts:

```text
platform identifier
EggBot identifier

roster
lineup

decision
action

proposed action
approved action
executed action

platform state
derived analytics

read operation
write operation
```

Avoid using generic `string` identifiers everywhere where branded or opaque domain identifiers improve correctness.

Prefer immutable or readonly structures where practical.

Avoid inheritance-heavy domain models.

Prefer discriminated unions for actions and result types where appropriate.

---

# Action model

Autonomous actions should be representable as inspectable data.

A future action model might resemble:

```ts
export type FantasyAction =
  | SetLineupAction
  | AddPlayerAction
  | DropPlayerAction
  | AddDropAction
  | WaiverClaimAction;
```

Possible future actions may also include:

- trade proposals
- trade acceptance
- IR moves

Do not implement every possible action yet.

The architecture should support:

- validation
- logging
- testing
- dry runs
- replay
- policy evaluation
- execution

without requiring the action's creator to perform the side effect itself.

---

# Action lifecycle

Design toward an explicit action lifecycle.

For example:

```text
PROPOSED
VALIDATING
APPROVED
REJECTED
EXECUTING
EXECUTED
FAILED
```

The exact names may change.

The important point is that a decision is not equivalent to an executed transaction.

---

# League snapshots

Design the architecture so that the system can eventually produce a normalized `LeagueSnapshot` or equivalent.

A snapshot should provide a decision engine with the relevant state of a fantasy league at a specific point in time.

Potential snapshot contents:

- league settings
- scoring
- teams
- standings
- current roster
- matchups
- available players
- waiver state
- recent transactions
- injuries
- derived analytics

Do not implement the complete snapshot system during this milestone.

Avoid architectural choices that would make it difficult later.

---

# External football data

Fantasy-platform data and football-intelligence data should remain separate concerns.

Future external sources may provide:

- injuries
- projections
- snap counts
- targets
- depth charts
- betting lines
- player news
- schedules

Design toward an interface such as:

```ts
export interface FootballDataProvider {
  // intentionally unspecified for now
}
```

Do not choose or implement a provider yet unless needed for an architectural placeholder.

---

# Observability and auditability

Autonomous behavior must eventually be traceable.

Design so a future audit record can associate:

- timestamp
- state snapshot
- decision engine
- decision-engine version
- model/provider metadata when applicable
- proposed actions
- analytics used
- policy results
- approved actions
- execution attempts
- platform responses
- errors

Do not build a full observability system yet.

Ensure the architecture preserves enough separation to add it cleanly.

---

# Public API philosophy

EggBot is intended to be consumed by external applications.

Treat exported APIs intentionally.

Guidelines:

- keep implementation details internal
- avoid accidental exports
- minimize platform-specific leakage
- favor stable domain types
- use explicit package entry points
- avoid deep imports into package internals
- design with eventual semantic versioning in mind
- document extension points

Consumers should compose EggBot through public APIs rather than subclass or patch internal implementations.

---

# Dependency direction

Keep dependencies flowing inward toward stable abstractions.

A rough conceptual dependency graph:

```text
              applications
                   |
        +----------+----------+
        |                     |
     scheduler               agent
        |                     |
        +----------+----------+
                   |
                 policy
                   |
               analytics
                   |
             platform API
                   |
          platform adapters
                   |
                 core
```

Do not follow this diagram mechanically if another dependency direction is cleaner.

The important restrictions are:

- `core` remains highly stable and dependency-light
- concrete platform adapters do not infect core types
- agent implementations do not perform platform writes
- policy does not depend on concrete model providers
- applications perform composition

Document the final dependency graph in `ARCHITECTURE.md`.

Avoid circular workspace dependencies.

---

# Configuration philosophy

Prefer explicit configuration and dependency injection.

Avoid:

- global mutable configuration
- hidden singleton clients
- environment-variable reads scattered throughout libraries
- modules that instantiate concrete dependencies internally

Environment variables should generally be interpreted by applications or concrete adapters at system boundaries.

Library packages should prefer constructor/function arguments and typed configuration.

---

# Error handling

Establish a coherent error philosophy.

Differentiate where useful between:

- configuration errors
- validation errors
- platform/API errors
- authentication errors
- policy rejections
- execution failures
- unexpected internal errors

Do not create an excessively elaborate custom error hierarchy during the first milestone.

Ensure errors retain actionable context.

---

# Testing philosophy

Favor tests around:

- domain invariants
- validation
- serialization/deserialization boundaries
- policy behavior
- platform mappings
- deterministic analytics

Keep external APIs mockable.

Do not require live Yahoo access to run the normal test suite.

Later integration tests requiring credentials should be clearly separated from unit tests.

---

# First milestone

For this task, do **not** build the autonomous fantasy manager.

Implement only the foundation.

## Required work

1. Inspect the repository and understand what currently exists.

2. Establish the pnpm monorepo.

3. Configure:
   - TypeScript
   - strict mode
   - workspace build/typechecking
   - Vitest
   - ESLint
   - Prettier

4. Create the package structure.

5. Implement an initial platform-independent domain model in `@eggbot/core`.

6. Define initial fantasy-platform abstractions in `@eggbot/platform`.

7. Define minimal interfaces/types for:
   - decision engines
   - policy evaluation
   - analytics
   - persistence
   - scheduling

8. Create the Yahoo package as a clean adapter boundary, but do not implement full Yahoo connectivity yet.

9. Build a small CLI proving that workspace package imports and composition work correctly.

10. Add useful unit tests.

11. Add package-level READMEs where useful.

12. Create:
    - `docs/ARCHITECTURE.md`
    - `docs/DOMAIN.md`
    - `docs/ROADMAP.md`

13. Run:
    - build
    - typecheck
    - tests
    - lint

14. Resolve failures before finishing.

The repository should finish in a clean working state.

---

# Documentation requirements

## `docs/ARCHITECTURE.md`

Document:

- system goals
- package responsibilities
- dependency direction
- domain/platform separation
- platform adapter model
- decision/execution separation
- policy boundary
- analytics philosophy
- extension points
- application composition
- eventual OSS considerations

Include a Mermaid diagram if helpful.

---

## `docs/DOMAIN.md`

Document the initial vocabulary.

At minimum explain:

- League
- LeagueSettings
- Team
- Player
- Roster
- Lineup
- RosterSlot
- Matchup
- FantasyAction
- FantasyDecision
- ActionResult

Also explain conceptual distinctions such as:

```text
roster vs lineup
decision vs action
proposal vs execution
platform data vs EggBot domain data
```

---

## `docs/ROADMAP.md`

Create a phased roadmap.

### Phase 0 — Foundation

Monorepo, domain model, architecture, extension interfaces.

### Phase 1 — Yahoo read integration

OAuth and normalized read-only access to leagues, teams, rosters, standings, matchups, players, and transactions.

### Phase 2 — Yahoo safe-write integration

Lineup changes and supported transactions with dry-run capability.

### Phase 3 — League snapshots

Normalized state suitable for analytics and decision engines.

### Phase 4 — Analytics

Deterministic fantasy-football calculations.

### Phase 5 — Decision engines

Provider-neutral decision interface and first concrete integrations.

### Phase 6 — Policy engine

Guardrails, validation, rejection reasons, and execution approval.

### Phase 7 — Autonomous lineup management

End-to-end low-risk autonomous management.

### Phase 8 — Waiver management

Add/drop decisions, waiver ordering, budget/priority strategy.

### Phase 9 — External football intelligence

Injuries, projections, depth charts, usage, news, schedules.

### Phase 10 — Trade support

Trade evaluation first, autonomous trade behavior only after sufficient safeguards.

### Phase 11 — Operational hardening

Scheduling, audit history, retries, reconciliation, failure recovery, deployment documentation.

Do not implement later phases during this task.

---

# Engineering principles

Follow these throughout the project:

1. Keep the core domain platform-independent.
2. Prefer dependency inversion.
3. Keep side effects at system edges.
4. Validate external data.
5. Represent autonomous operations as inspectable data.
6. Separate decisions from execution.
7. Make dry-run behavior easy.
8. Make deterministic behavior deterministic.
9. Keep secrets outside source control.
10. Prefer simple TypeScript over framework-heavy solutions.
11. Avoid premature abstraction inside otherwise-correct major boundaries.
12. Keep public APIs intentional.
13. Avoid global mutable state.
14. Favor composition over inheritance.
15. Preserve testability.
16. Avoid circular package dependencies.
17. Design for eventual semantic versioning.
18. Do not assume a specific league format unless the domain itself requires it.
19. Do not assume a specific model provider.
20. Do not assume Yahoo will remain the only supported fantasy platform.

---

# Scope discipline

Do not turn this milestone into a full product.

Specifically, do not yet implement:

- autonomous roster management
- actual LLM calls
- Yahoo OAuth
- Yahoo mutations
- trade logic
- a database
- a web dashboard
- Docker/Kubernetes/cloud deployment
- production cron infrastructure
- external sports-data providers

When uncertain, prefer establishing a clean interface and documenting the future requirement rather than implementing future phases prematurely.

---

# Before coding

First inspect the repository and briefly state:

1. What currently exists.
2. The concrete workspace and package layout you intend to create.
3. Any deviations you recommend from these instructions and why.

Then proceed with implementation.

Do not request confirmation unless there is a genuine blocker.

Make reasonable engineering decisions, document them, and complete the milestone.
