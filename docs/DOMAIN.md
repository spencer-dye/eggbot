# EggBot domain vocabulary

EggBot models normalized fantasy-football concepts rather than mirroring any provider payload. Structures are readonly where practical and IDs are opaque, domain-specific strings.

## Entities and values

- **League** identifies a competition for a season and owns its `LeagueSettings`.
- **LeagueSettings** describes roster slots and scoring rules without assuming a league size or scoring preset.
- **Team** is a fantasy team within a league.
- **Player** is a football player eligible for one or more positions. Provider identifiers are not player IDs.
- **Roster** is the complete set of players controlled by a fantasy team.
- **Lineup** assigns rostered players to slots for one scoring period.
- **RosterSlot** defines an active, bench, or reserve place and its eligible positions.
- **Matchup** groups participating fantasy teams and optional observed scores for a scoring period. It does not assume head-to-head play has exactly two participants.
- **Standing** records a team's rank and any standings facts the platform supplies. Win/loss records and points are optional so the model does not assume one competition format.
- **Transaction** records a completed or pending league transaction as one or more normalized player moves. It is observed platform history, not an executable `FantasyAction`.
- **FantasyAction** is inspectable intent to change platform state. It models lineup setting, standalone add and drop, add/drop, and waiver-claim actions without conflating immediate acquisitions with pending claims.
- **DecisionProposal** is untrusted decision-engine output: rationale and proposed action intents without host-owned decision/action identities or audit timestamps.
- **FantasyDecision** records a host-assigned decision identifier, timestamp, rationale, and proposed actions. It does not approve or execute them.
- **DecisionRun** associates a validated `FantasyDecision` with its engine identity/version, exact source snapshot and analytics, managed team, and execution window.
- **PolicyEvaluation** records every deterministic approval or rejection for a decision run, with structured rule attribution and conflict context.
- **PolicyApproval** is the explicitly derived, provenance-bearing subset of actions policy approved for possible execution. It is not proof that a platform will accept them.
- **LineupManagementRun** is the complete Phase 7 workflow record. It associates one snapshot and exact projection-backed analytics with its decision, policy evaluation, optional approval, platform dry-run results, execution results, post-execution lineup verification, timestamps, scope findings, and terminal status. Executor success and observed-state verification are intentionally separate facts.
- **ActionResult** records a local dry run, a durably recorded execution, an uncertain execution outcome, or a failed attempt with a code, message, and retryability signal.
- **LeagueSnapshot** is a normalized, timestamped observation window containing league-wide state for one scoring period. It groups team rosters and lineups, standings, matchups, acquisition pools, and recent transactions without claiming provider-level atomic consistency.

## Important distinctions

### Roster versus lineup

A roster answers “which players does this team control?” A lineup answers “where are rostered players assigned for this scoring period?” Bench and reserve eligibility belongs to slot configuration; weekly placement belongs to the lineup.

### Decision versus action

A decision explains why zero or more changes are proposed. An action is one structured unit of intent. Neither performs a mutation. Engines return a `DecisionProposal`; the agent runner validates its scope and assigns decision audit metadata before exposing a `FantasyDecision`.

### Transaction versus action

A transaction is historical state read from a platform. An action is EggBot's proposed intent. Similar vocabulary such as add/drop does not make an observed Yahoo transaction executable.

### Proposal versus execution

Actions inside a decision are proposed. Policy evaluation records an approved or rejected result for every action and retains all rejection issues. Orchestration explicitly derives the approved subset. Only a platform executor can attempt an approved action, producing an `ActionResult`. These stages stay distinct for audit, dry-run, replay, and safety controls.

Policy distinguishes invalid orchestration context from denied intent. A decision-run/snapshot mismatch is a `PolicyValidationError`; an unrostered drop, unavailable acquisition, illegal lineup, protected player, configured-limit violation, duplicate intent, or cross-action conflict is a structured action rejection. Policy uses snapshot state and therefore cannot replace provider-side validation against newer authoritative state.

An action ID is also its execution idempotency key. Reusing an ID for different action data is an error. Consumers that execute transaction writes must provide durable execution-journal storage. A pending journal intent or `execution-uncertain` result requires explicit provider reconciliation and must never be automatically retried. A dry run is explicitly local validation and does not claim the provider will accept the request.

### Platform data versus EggBot domain data

Platform payloads, enum values, and identifiers are external data. An adapter validates and maps them into EggBot-owned models. Core consumers never depend on Yahoo or another provider's response shape. `PlatformReference` can retain an explicit provider/value association without making it an EggBot entity ID.

### Read operation versus write operation

`FantasyPlatformReader` retrieves normalized state. `FantasyPlatformExecutor` causes side effects. Consumers can depend on the read port without receiving write authority.

### Platform state versus derived analytics

Platform state is observed source data. Analytics are deterministic values derived from that data. Keeping them separate makes snapshots reproducible and calculations independently testable.

`LeagueAnalytics` identifies its source snapshot and retains both exact normalized player projections and their provenance: scoring period, observation time, source, and optional source version. A `ProjectionSet` for a different scoring period is rejected. Player projections are caller-supplied observed inputs, while lineup totals, coverage-qualified matchup margins, best-available comparisons, acquisition-pool scarcity summaries, and roster-risk facts are deterministic derivations. Missing projection coverage remains explicit rather than silently becoming a confident zero estimate.

### Snapshot coverage and consistency

League, team, roster, lineup, standings, and matchup reads are required for a valid snapshot. When league settings provide a team count, snapshot membership must match it; every discovered team must have exactly one standing, and a rostered player can have only one owner. Free-agent, waiver, and recent-transaction collections are explicitly bounded and retain their requested limits and returned counts. A bounded collection is not represented as complete merely because it contains useful data.

Snapshot capture spans multiple provider requests. `captureStartedAt` and `capturedAt` describe that observation window, while `consistency: 'best-effort'` makes the lack of an atomic provider read explicit. A capture fails instead of returning structurally inconsistent or partially required state. State that can legitimately race across reads, such as a player appearing in both a roster and an acquisition pool, is represented by a typed `SnapshotIntegrityWarning` so downstream consumers can decide whether to proceed.
