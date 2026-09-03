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

## Getting started

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm cli
```

`pnpm check` builds every package, typechecks library and test sources, runs
credential-free tests, lints, and checks formatting. `pnpm cli` is a credential-free
smoke test. Next, use `pnpm cli yahoo help` and the
[Yahoo adapter guide](packages/yahoo/README.md) for OAuth and optional live-read
setup. Exercise autonomous workflows in their default dry-run mode before considering
`--execute`; execution also requires the documented Yahoo write gates. For production
composition, recovery, durable state, and multi-replica limitations, read the
[operations guide](docs/OPERATIONS.md).

The CLI stores Yahoo tokens in a gitignored, owner-only file by default. Live Yahoo
reads are opt-in, and normal tests require neither network access nor credentials.

See [the architecture](docs/ARCHITECTURE.md), [domain vocabulary](docs/DOMAIN.md), [operational and deployment guide](docs/OPERATIONS.md), [roadmap](docs/ROADMAP.md), [contribution guide](CONTRIBUTING.md), and [security policy](SECURITY.md).

## License

EggBot is available under the [MIT License](LICENSE).
