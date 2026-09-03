# `@eggbot/scheduler`

Application-orchestration scheduling and recovery primitives. Fantasy logic does not belong here.

`RecoverableScheduler` runs one-time and interval jobs with durable `JobState`, in-process overlap prevention, cancellation, and recovery of jobs interrupted while marked `running`. Job functions are deliberately not serialized; applications re-register them at startup and must make them idempotent because crash recovery is at-least-once. `StorageJobStateStore` persists state through `@eggbot/storage`.

`runWithRetry` provides bounded exponential backoff, requires an explicit error classifier, supports cancellation, and reports every failed attempt. Never classify an `execution-uncertain` mutation as retryable: reconcile provider state first. The included scheduler coordinates only one process. Multi-replica deployments must provide leader election or use an external scheduler and distributed lease system.
