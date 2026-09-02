# EggBot

EggBot is a provider-independent TypeScript framework for building safe, inspectable fantasy-football automation. Phases 0 through 7 provide the core domain, Yahoo reads and guarded writes, normalized league snapshots, deterministic analytics, audited decision and policy boundaries, and end-to-end autonomous lineup management.

## Requirements

- Node.js 22 or newer
- pnpm 10

## Development

```sh
pnpm install
pnpm check
pnpm cli
```

Use `pnpm cli yahoo help` to list opt-in Yahoo OAuth, read, snapshot, autonomous lineup, and guarded write commands. The CLI stores Yahoo tokens in a gitignored, owner-only file by default. Autonomous lineup management is a dry run unless `--execute` and the documented write gates are supplied.

See [the architecture](docs/ARCHITECTURE.md), [domain vocabulary](docs/DOMAIN.md), and [roadmap](docs/ROADMAP.md).
