# EggBot

EggBot is a provider-independent TypeScript framework for building safe, inspectable fantasy-football automation. The initial `v0.1.0` scope includes the core domain, Yahoo reads and guarded writes, normalized league snapshots, deterministic analytics, audited decision and policy boundaries, autonomous lineup and waiver management, validated external football-intelligence ports, evaluation-only trade analysis, and provider-neutral operational hardening.

The framework contains no league-specific rules, real model integration, or selected football-data vendor. Applications compose those choices through public package entry points.

## Safety model

- Decision engines receive normalized data and never credentials or platform write authority.
- Policy approval and provider dry-run preflight remain separate from execution.
- Writes require an explicit execute mode and adapter-level enablement.
- An uncertain write is never safe to retry blindly; reconcile provider state first.
- Trade support calculates inspectable facts only and cannot construct or execute a trade.
- Included storage and scheduling support one host. Multiple replicas require external distributed coordination.

## Requirements

- Node.js 22 or newer
- pnpm 10

## Development

```sh
pnpm install
pnpm check
pnpm cli
```

`pnpm check` builds every package, typechecks library and test sources, runs credential-free tests, lints, and checks formatting. Use `pnpm cli yahoo help` to list opt-in Yahoo OAuth, read, snapshot, autonomous lineup, and guarded write commands. The CLI stores Yahoo tokens in a gitignored, owner-only file by default. Autonomous management is a dry run unless `--execute` and the documented write gates are supplied.

See [the architecture](docs/ARCHITECTURE.md), [domain vocabulary](docs/DOMAIN.md), [operational and deployment guide](docs/OPERATIONS.md), [roadmap](docs/ROADMAP.md), [contribution guide](CONTRIBUTING.md), and [security policy](SECURITY.md).
