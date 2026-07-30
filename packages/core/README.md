# `@jini-ai/core`

The Jini kernel: typed DI tokens, pack composition and lifecycle, the tool registry, redaction,
and origin/API-token auth primitives. It has zero runtime dependencies and is not lifted from
Open Design — it's a from-scratch implementation of the typed composition contract described in
the extraction plan (a deliberate rejection of the "structural dependency bag" pattern, e.g. OD's
`ServerContext`, that decays into dozens of `any` fields). A `Pack` is the one composition unit:
a named bundle of `services`, plus the optional `tools`/`http`/`cli` transports and `dispose`
teardown that belong to those services. `createDaemon` composes a set of packs against a bound
set of tokens, and fails to typecheck if any pack's declared dependency is left unbound.

## Install

```sh
npm install @jini-ai/core
```

No peer dependencies — this package is pure TypeScript with no runtime dependencies at all.

## What you get

- **DI tokens** — `token<T>(id)` / `manyToken<T>(id)`, nominal and versioned, plus `bindings()`
  building a typed `Bindings<BoundIds>` set (`.bind`, `.bindMany`) that tracks which ids are bound
  in its own type parameter.
- **Pack composition** — `definePack({ name, deps, services, tools?, http?, cli?, dispose? })`,
  the `Pack`/`PackContainer` types, and `createDaemon({ packs, bindings, transports? })`, which
  composes packs against bound tokens and resolves each pack's `services` against a container
  scoped to only that pack's declared `deps`.
- **Pack lifecycle helpers** — `registerPackTools` (walks composed packs' `tools()` into a shared
  `ToolRegistry`) and `disposePacks` (best-effort reverse-order teardown; one pack's `dispose`
  failure never blocks another's, recorded as `PackDisposalFailure`).
- **Tool registry** — `createToolRegistry()` and the `ToolRegistry`/`ToolDescriptor`/`ToolPolicy`/
  `ToolHandler`/`ToolRegistration`/`ToolAuthorizationContext`/`AuthorizationDecision` types. The
  registry's public surface (`register`/`has`/`list`) exposes descriptors only — handlers and
  policies are never publicly retrievable, so holding a `ToolRegistry` reference lets you enumerate
  what's available but never run a tool yourself; only `@jini-ai/daemon`'s `ToolExecutor` can.
- **Principal** — the minimal `Principal` interface (`id` + optional `roles`) a tool call or run is
  performed on behalf of.
- **Security/auth primitives** — `redact` (PII/secret redaction, including Luhn-checked card
  numbers), `api-token-auth`, and `origin-validation` (same-origin decision tree, private-IP/
  loopback classification), each genericized to take env-var names as config rather than hardcoded
  product constants.

## Usage

```ts
import { bindings, definePack, createDaemon, token, createToolRegistry, registerPackTools } from '@jini-ai/core';

interface Logger {
  log(msg: string): void;
}

const LoggerToken = token<Logger>('app.logger');

const loggerPack = definePack({
  name: 'logger',
  deps: [],
  services: () => ({ logger: { log: (m: string) => console.log(m) } }),
});

const consumerPack = definePack({
  name: 'consumer',
  deps: [LoggerToken],
  services: (c) => ({ logger: c.get(LoggerToken) }),
});

const bound = bindings().bind(LoggerToken, { log: (m: string) => console.log(m) });

const daemon = createDaemon({
  packs: [loggerPack, consumerPack] as const,
  bindings: bound,
});

const registry = createToolRegistry();
registerPackTools([loggerPack, consumerPack], daemon.services, registry);
```

## Entry points

| subpath | what's behind it |
|---|---|
| `.` | The public surface above: tokens, packs, daemon composition, tool registry (descriptors only), principal, redact, auth primitives. |
| `./internal` | **Not part of the public contract.** Exposes `authorizeToolInvocation` (resolves a registry's tool and runs its authorization gate — a security-sensitive value export, but one that only ever hands back a handler alongside an `'allow'` decision) plus type-only `AnyPack`/`RequiredTokenIds`/`MissingTokenIds` re-derivation helpers. Its sole intended consumers are `@jini-ai/daemon`'s `ToolExecutor` and `@jini-ai/server`'s `createLocalNodeDaemon`. Node's resolver will happily let any consumer import it — the boundary is enforced by `scripts/check-engine-boundaries.ts`, not by the exports map — so external adopters should treat it as off-limits regardless. |

## What's swappable

Everything a pack declares as a `deps` token is a swap point by construction: bind any
implementation that satisfies the token's type via `bindings().bind(...)`, and `createDaemon`
resolves it into that pack's `PackContainer` with no other change. `ToolPolicy.authorize` is
likewise a seam you supply per tool registration. The kernel logic itself (composition ordering,
the missing-binding compile-time gate, the tool registry's append-only enforcement) is fixed and
not meant to be replaced.

## Runtime

Universal — no Node/browser-specific APIs.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and scope decisions. Apache-2.0.
