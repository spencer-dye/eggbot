# EggBot domain vocabulary

EggBot models normalized fantasy-football concepts rather than mirroring any provider payload. Structures are readonly where practical and IDs are opaque, domain-specific strings.

## Entities and values

- **League** identifies a competition for a season and owns its `LeagueSettings`.
- **LeagueSettings** describes roster slots and scoring rules without assuming a league size or scoring preset.
- **Team** is a fantasy team within a league.
- **AcquisitionRules** describe provider-neutral waiver-system, budget, period, and acquisition-limit settings; **TeamAcquisitionState** records the currently observed priority, remaining budget, and usage where supplied.
- **Player** is a football player eligible for one or more positions. Provider identifiers are not player IDs.
- **FootballDataProvenance** identifies the source, observation time, and optional version of one external football-intelligence data set.
- **ExternalPlayerReference** explicitly maps one EggBot `PlayerId` to a provider-owned `PlatformReference`; it is resolved before external football-data reads and never stored on `Player`.
- **PlayerInjury** records a normalized availability status and optional reported detail or expected return without changing fantasy-platform roster state.
- **PlayerProjection** is a period-bound expected-points input with optional floor and ceiling. It is external evidence, not an analytic result.
- **DepthChartEntry** records a player's professional-team position and rank. Its football position label is distinct from fantasy-slot eligibility.
- **PlayerUsage** records optional count and share facts for a declared scoring period and usage window.
- **PlayerNewsItem** associates sourced, timestamped news with zero or more EggBot player IDs.
- **ProfessionalGame** records a scheduled professional matchup and state; it is distinct from a fantasy `Matchup`.
- **FootballIntelligenceSnapshot** groups validated injuries, projections, depth charts, usage, news, and schedules across an explicit best-effort capture window.
- **TradeScenario** is an evaluation-only collection of explicit player transfers between teams. It is neither a platform trade offer nor a `FantasyAction`.
- **TradeValuationSet** supplies league-bound comparable values with source, observation time, unit, and an explicit time horizon; weekly projections are not silently treated as trade values.
- **TradeEvaluation** records source ages, per-team incoming/outgoing value coverage, raw package value delta when complete, roster-capacity effects, and structured issues without recommending or approving an outcome. The raw delta excludes roster-slot opportunity cost, replacement players, and strategic fit.
- **Roster** is the complete set of players controlled by a fantasy team.
- **Lineup** assigns rostered players to slots for one scoring period.
- **RosterSlot** defines an active, bench, or reserve place and its eligible positions.
- **Matchup** groups participating fantasy teams and optional observed scores for a scoring period. It does not assume head-to-head play has exactly two participants.
- **Standing** records a team's rank and any standings facts the platform supplies. Win/loss records and points are optional so the model does not assume one competition format.
- **Transaction** records a completed or pending league transaction as one or more normalized player moves. It is observed platform history, not an executable `FantasyAction`.
- **FantasyAction** is inspectable intent to change platform state. It models lineup setting, standalone add and drop, add/drop, and waiver-claim actions without conflating immediate acquisitions with pending claims.
- **DecisionProposal** is untrusted decision-engine output: rationale and proposed action intents without host-owned decision/action identities or audit timestamps.
- **FantasyDecision** records a host-assigned decision identifier, timestamp, rationale, and proposed actions. It does not approve or execute them.
- **DecisionRun** associates a validated `FantasyDecision` with its engine identity/version, exact source snapshot and analytics, optional exact football-intelligence input, managed team, and execution window.
- **PolicyEvaluation** records every deterministic approval or rejection for a decision run, with structured rule attribution and conflict context.
- **PolicyApproval** is the explicitly derived, provenance-bearing subset of actions policy approved for possible execution. It is not proof that a platform will accept them.
- **LineupManagementRun** is the complete lineup workflow record. It associates one snapshot and exact projection-backed analytics with its decision, policy evaluation, optional approval, platform dry-run results, execution results, post-execution lineup verification, timestamps, scope findings, and terminal status. Executor success and observed-state verification are intentionally separate facts.
- **WaiverManagementRun** is the ranked-acquisition workflow record. Its top-level `status` describes platform execution, while its separate `resolutionStatus` summarizes observed evidence. Immediate free-agent mutations carry per-action final-state batch roster verification, while accepted waiver claims remain pending submissions. A run may therefore be executed but mismatched or failed at verification.
- **ActionResult** records a local dry run, a durably recorded execution, an uncertain execution outcome, or a failed attempt with a code, message, and retryability signal.
- **AuditEvent** is an immutable, timestamped, categorized operational record with a subject, outcome, and caller-redacted JSON payload. An audited operation has one stable logical ID and distinct attempt IDs across at-least-once recovery.
- **JobState** is durable scheduler evidence: trigger, lifecycle status, generation, attempts, next run, timestamps, and the most recent failure. A generation-advancing canceled tombstone prevents stale attempts from restoring canceled state. Job state does not serialize executable code.
- **WaiverReconciliationRun** records later transaction-history and final-roster evidence for previously submitted waiver claims without repeating a mutation.
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

### Trade scenario versus trade action

A `TradeScenario` is hypothetical data used to calculate facts. Its transfer legs identify which rostered player would move from one team to another, including unambiguous multi-team flows. A `TradeEvaluation` can report incomplete values or capacity problems, but cannot approve, offer, accept, reject, or execute a trade. There is deliberately no trade member in `FantasyAction`; autonomous trade behavior would require explicit future platform, policy, approval, and reconciliation contracts.

### Platform data versus EggBot domain data

Platform payloads, enum values, and identifiers are external data. An adapter validates and maps them into EggBot-owned models. Core consumers never depend on Yahoo or another provider's response shape. `PlatformReference` can retain an explicit provider/value association without making it an EggBot entity ID.

### Read operation versus write operation

`FantasyPlatformReader` retrieves normalized state. `FantasyPlatformExecutor` causes side effects. Consumers can depend on the read port without receiving write authority.

### Platform state versus derived analytics

Platform state is observed source data. Analytics are deterministic values derived from that data. Keeping them separate makes snapshots reproducible and calculations independently testable.

`LeagueAnalytics` identifies its source snapshot and retains both exact normalized player projections and their provenance: scoring period, observation time, source, and optional source version. A `ProjectionSet` for a different scoring period is rejected. Player projections are caller-supplied observed inputs, while lineup totals, coverage-qualified matchup margins, best-available comparisons, acquisition-pool scarcity summaries, and roster-risk facts are deterministic derivations. Missing projection coverage remains explicit rather than silently becoming a confident zero estimate.

### Fantasy-platform data versus football intelligence

Fantasy-platform reads describe league ownership, rules, lineups, standings, transactions, and acquisition pools. External football intelligence describes the underlying sport: injuries, expected performance, depth-chart role, usage, news, and professional games. `FootballDataProvider` cannot read or mutate a fantasy roster, and `FantasyPlatformReader` does not become an injury or projection feed. Applications join both through EggBot player IDs and preserve each source's independent observation time.

EggBot player IDs and external vendor IDs are not assumed to be interchangeable. A `PlayerIdentityResolver` maps requested EggBot IDs to provider-owned references before a football-data adapter is called. Resolution must be complete and unambiguous; provider adapters use that mapping to return normalized records keyed by the original EggBot IDs. Vendor identifiers remain outside `Player` and the core domain.

### Snapshot coverage and consistency

League, team, roster, lineup, standings, and matchup reads are required for a valid snapshot. When league settings provide a team count, snapshot membership must match it; every discovered team must have exactly one standing, and a rostered player can have only one owner. Free-agent, waiver, and recent-transaction collections are explicitly bounded and retain their requested limits and returned counts. A bounded collection is not represented as complete merely because it contains useful data.

Snapshot capture spans multiple provider requests. `captureStartedAt` and `capturedAt` describe that observation window, while `consistency: 'best-effort'` makes the lack of an atomic provider read explicit. A capture fails instead of returning structurally inconsistent or partially required state. State that can legitimately race across reads, such as a player appearing in both a roster and an acquisition pool, is represented by a typed `SnapshotIntegrityWarning` so downstream consumers can decide whether to proceed.
