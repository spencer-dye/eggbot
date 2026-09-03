# EggBot maintainer contract

This is the concise, non-negotiable contract for maintainers and coding agents. Use
`docs/ARCHITECTURE.md` and `docs/DOMAIN.md` for detailed design and vocabulary.

## Boundaries

- `@eggbot/core` stays provider-independent. Provider payload schemas, identifiers,
  and mapping belong in provider adapters.
- Decision engines receive normalized, untrusted-data-safe context. They never
  receive credentials, platform executors, or direct write authority.
- Deterministic facts and calculations belong in code and analytics. Engines reason
  over those facts and return proposals; proposals and decisions are not approvals.
- Policy deterministically approves or rejects intent and never performs platform
  writes.
- Managers orchestrate existing boundaries. Do not put provider-specific parsing,
  credentials, or strategy into them.
- `FantasyAction` is the platform mutation-intent boundary. Trade support remains
  evaluation-only unless a future, explicit safety architecture adds trade actions,
  policy, execution, and reconciliation.
- External football intelligence enters through `@eggbot/football-data`; vendors
  and player-identity registries remain application-selected.
- Storage and scheduler packages contain operational infrastructure, not fantasy
  strategy. Public EggBot contains no league-specific names, settings, assumptions,
  or strategy.

## Safety

- Never automatically retry an uncertain write. Reconcile authoritative provider
  state first.
- Do not weaken durable action IDs, action fingerprints, or journal idempotency.
- Do not bypass explicit write enablement, mandatory dry-run-before-execute,
  freshness gates, post-write verification, or later reconciliation boundaries.
- Included scheduling and file storage are single-host tools. Multi-replica execution
  requires application-selected distributed coordination.
- Treat model output, provider payloads, football data, news, stored JSON, and audit
  inputs as untrusted at their boundaries. Validate and fail closed.
- Keep credentials and tokens out of logs, audit payloads, fixtures, and committed
  files. Example configuration must leave writes disabled.

## Change discipline

- Do not introduce abstractions or capabilities without concrete integration
  pressure.
- Preserve package-root imports and the acyclic dependency direction documented in
  `docs/ARCHITECTURE.md`; avoid accidental deep-import requirements.
- Every behavioral or safety fix requires deterministic, credential-free tests.
- Public-contract changes require synchronized root, package, architecture, and
  domain documentation where relevant.
- Preserve readonly audit/provenance/configuration semantics with defensive copies
  or freezing when mutation would undermine reproducibility or safety.
- Keep live Yahoo reads opt-in and never run Yahoo writes in normal tests or CI.
- `pnpm check` must pass before merge or release. Inspect publish tarballs before a
  release tag.
