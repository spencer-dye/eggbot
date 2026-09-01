# EggBot

EggBot is a provider-independent TypeScript framework for building safe, inspectable fantasy-football automation. Phases 0 through 3 provide the core domain, Yahoo reads and guarded writes, and normalized league snapshots for analytics and decision engines.

## Requirements

- Node.js 22 or newer
- pnpm 10

## Development

```sh
pnpm install
pnpm check
pnpm cli
```

Use `pnpm cli yahoo help` to list opt-in Yahoo OAuth, read, snapshot, and guarded write commands. The CLI stores Yahoo tokens in a gitignored, owner-only file by default. Write previews are non-mutating; execution requires all explicit safety gates documented by the CLI.

See [the architecture](docs/ARCHITECTURE.md), [domain vocabulary](docs/DOMAIN.md), and [roadmap](docs/ROADMAP.md).
