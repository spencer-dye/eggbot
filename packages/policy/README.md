# `@eggbot/policy`

The mandatory deterministic boundary between a validated `DecisionRun` and actions eligible for execution. Evaluation is bound to the run's source snapshot and managed team, reports approval independently for every action, and retains every structured violation.

Mandatory rules validate scope, roster ownership, captured acquisition-pool availability, lineup legality, roster capacity, duplicate intent, and cross-action conflicts. Applications can add protected-player, action-count, roster-mutation, waiver-bid, and snapshot-age guardrails plus custom deterministic rules.

`createPolicyApproval` explicitly derives the approved subset with decision, snapshot, team, and evaluation-time provenance. Policy has no platform executor and performs no writes. Provider-side preflight remains authoritative for changes after snapshot capture.
