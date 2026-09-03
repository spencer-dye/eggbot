# Operations and deployment

Phase 11 supplies operational building blocks, not a prescribed hosting stack. Applications own composition, credentials, retention, alerting, and infrastructure. Start with one process and one durable volume; move to external storage, scheduling, and leases before running multiple replicas.

## Single-host reference topology

Compose the platform reader/executor, managers, `FileStorageAdapter`, `StorageAuditHistory`, `StorageYahooExecutionJournal`, and `RecoverableScheduler` in the application entry point. Place the storage directory and Yahoo token file on a persistent, backed-up volume outside the application image. Run under a dedicated unprivileged operating-system identity. The file adapter creates directories and files with owner-only modes, but deployment configuration must also restrict the parent volume and backup access.

Register every scheduled job on each startup using stable job IDs and unchanged triggers. Functions are not persisted. A one-time job already marked `completed` will not run again; a job found in `running` state runs at least once after registration. Interval jobs continue from their persisted next-run time. Make every scheduled job idempotent and keep the platform action ID stable across recovery.

The included scheduler prevents overlap within one process only. A deployment with multiple replicas must use exactly one active scheduler, external leader election, or a scheduler implementation backed by a distributed lease. Shared filesystems do not turn the in-process lock into a distributed lock.

## Startup and shutdown

Startup order:

1. Load and validate configuration without logging secrets.
2. Open durable storage and verify a write/read/delete health probe under a dedicated health prefix.
3. Construct token storage, the Yahoo execution journal, audit history, platform clients, and managers.
4. Reconcile any durable Yahoo journal entries left `pending`; do not schedule new mutations for the same team until they are resolved.
5. Reconcile submitted waiver claims whose provider outcome is still pending.
6. Register stable scheduled jobs and begin accepting work.

On shutdown, stop accepting work, call `RecoverableScheduler.close()`, abort in-flight reads where supported, and allow active manager operations to finish within a bounded grace period. Never delete a pending execution-journal record during shutdown.

## Retry policy

Retries require an explicit classifier. Safe candidates include transient read failures, idempotent analytics, audit reads, and provider requests documented as idempotent. Use bounded attempts, exponential backoff, a maximum delay, cancellation, and attempt-level logging.

Do not retry:

- an `execution-uncertain` result;
- an action with a pending write-ahead journal record;
- a non-idempotent provider call without a durable provider idempotency guarantee;
- validation, policy, ownership, or credential failures.

When a scheduled callback exhausts retries, the scheduler records its failure and calls `onError`. The application should alert with the job ID, attempt count, last error, and next interval run if any.

## Reconciliation runbooks

### Uncertain Yahoo write

1. Stop automated mutations for the affected league/team.
2. Read Yahoo roster, lineup, and transaction history directly.
3. Match the original action ID/fingerprint and intended state. Never infer success only from a transport response.
4. Call `YahooFantasyExecutor.reconcile()` with a non-empty evidence description and either a confirmed executed outcome or a confirmed failed outcome.
5. Append a redacted audit event containing the action ID, operator or automated evidence source, conclusion, and resulting journal state.
6. Resume automation only after the durable pending record is resolved.

### Submitted waiver claim

Run `WaiverReconciler` with a transaction-history limit large enough to include the original external reference. A successful transaction is verified against one final roster read. `pending`, `transaction-not-found`, `unknown`, `mismatch`, and `verification-failed` are not success and should remain scheduled for later inspection according to application policy. A missing external reference is never matched heuristically by player name or timing.

## Audit history

Append one immutable event for each completed manager run, scheduler failure, reconciliation attempt, configuration change, and operator intervention. Useful subject IDs include manager run IDs, action IDs, and stable job IDs. Preserve the original workflow run as a redacted JSON payload or an application-defined normalized summary.

Never persist access tokens, refresh tokens, client secrets, raw authorization headers, or unreviewed model prompts/responses in audit payloads. Define retention and deletion policies appropriate to the deployment, monitor volume capacity, and test backup restoration. `StorageAuditHistory` is append-only by contract, but administrators can still remove underlying files; protect the storage boundary with operating-system and backup controls.

## Health and alerts

At minimum monitor:

- scheduler jobs left `running` beyond their expected duration;
- failed jobs and exhausted retry attempts;
- Yahoo journal records left `pending`;
- `execution-uncertain` action results;
- waiver reconciliations that remain pending or incomplete;
- lineup/acquisition verification mismatches;
- storage validation errors, write failures, disk capacity, and backup age;
- OAuth refresh failures and credential expiry;
- snapshot/projection/valuation freshness rejections.

Treat a storage write failure before a provider mutation as a stopped operation. Treat a storage commit failure after a provider response as uncertain until reconciled.

## Scaling and migration

`FileStorageAdapter` is intended for a single host. Before horizontal scaling, implement `OperationalStorageAdapter`, `AuditHistory`, `JobStateStore`, and scheduling/lease behavior using infrastructure with atomic create or compare-and-set semantics. Migrate and verify execution-journal records before enabling writes in the new environment. Run old and new schedulers mutually exclusively, preserve stable job and action IDs, and keep the Yahoo write kill switch disabled until recovery scans and dry runs pass.

No Dockerfile, Kubernetes manifest, cloud template, database schema, or vendor-specific queue is included because the repository contract requires provider and deployment independence. Those belong in the consuming application once its availability, compliance, cost, and scale requirements are known.
