# `@eggbot/policy`

The mandatory deterministic boundary between a validated `DecisionRun` and actions eligible for execution. Evaluation is bound to the run's source snapshot and managed team, reports approval independently for every action, and retains every structured violation.

Mandatory rules validate scope, roster ownership, captured acquisition-pool availability, lineup legality, roster capacity, waiver-system/bid compatibility, remaining individual and batch waiver budget, league acquisition limits, duplicate intent, and cross-action conflicts. Individual actions remain snapshot-relative: policy does not infer execution ordering or let a standalone drop make a standalone acquisition legal against a full snapshot roster. After per-action checks, policy also validates the resulting size of the otherwise-approved mutation batch and rejects standalone acquisitions that would collectively exceed capacity. Use `add-drop` or a waiver claim with `dropPlayerId` when a replacement must be represented atomically.

Applications can add protected-player, action-count, roster-mutation, waiver-bid, and snapshot-age guardrails plus custom deterministic rules. Freshness has no universal default because acceptable age depends on the application, but any autonomous application must configure `maxSnapshotAgeMs` before execution. Policy descriptors and copied configuration arrays are runtime-frozen so their audit metadata cannot drift after construction.

`createPolicyApproval` explicitly derives the approved subset with decision, snapshot, team, and evaluation-time provenance. Policy has no platform executor and performs no writes. Provider-side preflight remains authoritative for changes after snapshot capture.
