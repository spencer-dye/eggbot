# `@eggbot/storage`

Database-neutral persistence and audit-history boundaries.

`StorageAdapter` remains the minimal key/value port. `OperationalStorageAdapter` adds no-clobber creation and prefix scans for append-only history and recovery. `InMemoryStorageAdapter` is intended for tests. `FileStorageAdapter` is a concrete single-host implementation with hashed filenames, owner-only files, atomic replacement, durable file/directory synchronization, corrupt-record validation, and no-clobber create semantics. It is not a distributed database or coordination mechanism.

`StorageAuditHistory` writes immutable, queryable `AuditEvent` records. Payloads are caller-normalized JSON: applications must redact credentials, OAuth tokens, provider payload secrets, and model-sensitive data before appending them. Production deployments should apply retention, backup, capacity, and access-control policies described in `docs/OPERATIONS.md`.
