# Jini

Jini is a reusable, product-neutral engine for running coding agents, exposing tools and
providers, and streaming durable run events over HTTP, CLI, MCP, and sidecar transports.
It was extracted from Open Design, but Open Design is only one consumer: publishable engine
code under `packages/` must remain free of product-specific behavior and identity.

## Repository map

- `packages/` — publishable `@jini-ai/*` engine packages.
- [`examples/`](examples/README.md) — the public starting point for runnable browser and
  desktop hosts, disposable sample projects, and the release/neutrality proof.
- `foundry/` — the internal workshop around the engine: automation, architecture
  documentation, and product integrations. It is not part of the engine and must never be
  imported by `packages/@jini-ai/**`; see
  [`foundry/README.md`](foundry/README.md).
- `ADS-memory/` — durable project decisions, reports, evidence, and curated memory.
- `AI-Dev-Shop/` — the vendored development-pipeline toolkit.
- `scripts/` — repository guards and maintenance tools.

Start with [`ADS-memory/reports/jini-port/START-HERE.md`](ADS-memory/reports/jini-port/START-HERE.md),
then read
[`ADS-memory/reports/jini-port/extraction-plan.md`](ADS-memory/reports/jini-port/extraction-plan.md)
for the locked architecture and dependency-ordered work.

## Development

Requirements: Node.js 24 and pnpm 10.

```sh
pnpm install
pnpm -r --if-present build
pnpm guard
pnpm typecheck
```

The headless acceptance fixture is:

```sh
pnpm --dir examples/minimal-host start
```

The user-facing sample host is **Jini Playground**. Its default runtime is deterministic
and key-free, but still uses a real local daemon, durable run events, and SSE. The full
command opens the shared renderer in both Google Chrome and an Electron desktop shell:

```sh
pnpm playground
```

Use `pnpm playground:web` for Chrome only, or `pnpm playground:desktop` when the web host is
already running. The disposable workspaces live in
[`examples/sample-projects/`](examples/sample-projects/README.md).

## License

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
