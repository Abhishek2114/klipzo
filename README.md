# Klipzo

Hindi-first video editor for Indian creators. One codebase ships as a web app and a desktop app (Windows + macOS).

- Design and decisions: [docs/architecture.md](docs/architecture.md)
- Project file format: [packages/schema/project.schema.json](packages/schema/project.schema.json)
- Transcription API (paid tier): [docs/api/transcribe.openapi.yaml](docs/api/transcribe.openapi.yaml)
- First working prototype (single HTML file): [prototype/](prototype/)

## Develop

Needs Node 22+ and pnpm 10. The desktop app also needs [Rust](https://rustup.rs) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm dev                                  # web app on http://localhost:5173
pnpm --filter @klipzo/desktop dev         # desktop app (needs Rust)
pnpm check                                # lint, typecheck, unit tests, build, e2e
```

After editing `packages/schema/project.schema.json`, run `pnpm schema:types` to regenerate the TypeScript types (CI fails if they are stale). Every schema change also needs a migration in `packages/schema/src/index.ts` and a fixture test.

## Layout

```
apps/web          React + Vite app (also the desktop frontend)
apps/desktop      Tauri 2 shell
packages/schema   Project schema, types, loading, validation, migrations
docs/             Architecture, API spec
prototype/        Reference prototype
```
