# EggBot

EggBot is a provider-independent TypeScript framework for building safe, inspectable fantasy-football automation. This repository currently contains the Phase 0 domain model, extension contracts, and workspace tooling only.

## Requirements

- Node.js 22 or newer
- pnpm 10

## Development

```sh
pnpm install
pnpm check
pnpm cli
```

Use `pnpm cli yahoo help` to list the opt-in Yahoo OAuth and read-only commands. The CLI does not persist credentials or expose any write operation.

See [the architecture](docs/ARCHITECTURE.md), [domain vocabulary](docs/DOMAIN.md), and [roadmap](docs/ROADMAP.md).
