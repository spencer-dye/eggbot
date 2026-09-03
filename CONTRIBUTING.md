# Contributing to EggBot

EggBot accepts focused fixes and improvements that preserve its provider-independent package boundaries. Discuss broad new capabilities before implementation; the Phase 0–11 roadmap defines the current public scope.

## Development

Use Node.js 22 or newer and the pnpm version declared in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm cli
```

Normal tests must be deterministic and must not require credentials or network access. Yahoo's live read suite is opt-in through the variables documented in `.env.example` and performs no writes. Never commit token files, `.env` files, provider payloads containing private data, or generated `dist` and coverage output.

Keep changes inside the package that owns the concern. Provider payloads belong in adapters; deterministic calculations belong in analytics; decisions remain data; policy remains independent of execution; and application composition owns environment variables, concrete vendors, and deployment infrastructure. Add a public-boundary test for every behavior or safety fix and update the relevant package README when a contract changes.

## Releases

EggBot uses semantic versioning and currently versions all publishable `@eggbot/*` packages together. Before tagging a release, update package versions consistently, run `pnpm check`, run the credential-free CLI smoke test, inspect package tarball contents, and confirm documentation matches the exported API. Live Yahoo reads are an optional operator check; live writes are never part of release validation.
