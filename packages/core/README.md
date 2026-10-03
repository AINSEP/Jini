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

- **DI tokens** — `token<T>({ id }, { version? })` / `manyToken<T>({ id }, { version? })`, nominal and versioned, plus `bindings({})`
  building a typed `Bindings<BoundIds>` set (`.bind`, `.bindMany`) that tracks which ids are bound
  in its own type parameter.
- **Pack composition** — `definePack({ name, deps, services }, { tools?, http?, cli?, dispose? })`,
  the `Pack`/`PackContainer` types, and `createDaemon({ packs, bindings }, { transports? })`, which
  composes packs against bound tokens and resolves each pack's `services` against a container
  scoped to only that pack's declared `deps`.
- **Pack lifecycle helpers** — `registerPackTools` (walks composed packs' `tools()` into a shared
  `ToolRegistry`) and `disposePacks` (best-effort reverse-order teardown; one pack's `dispose`
  failure never blocks another's, recorded as `PackDisposalFailure`).
- **Tool registry** — `createToolRegistry({})` and the `ToolRegistry`/`ToolDescriptor`/`ToolPolicy`/
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
  log(required: { message: string }): void;
}

const LoggerToken = token<Logger>({ id: 'app.logger' });

const loggerPack = definePack({
  name: 'logger',
  deps: [],
  services: () => ({ logger: { log: ({ message }: { message: string }) => console.log(message) } }),
});

const consumerPack = definePack({
  name: 'consumer',
  deps: [LoggerToken],
  services: (c) => ({ logger: c.get({ token: LoggerToken }) }),
});

const bound = bindings({}).bind({ token: LoggerToken, impl: { log: ({ message }: { message: string }) => console.log(message) } });

const daemon = createDaemon({
  packs: [loggerPack, consumerPack] as const,
  bindings: bound,
});

const registry = createToolRegistry({});
registerPackTools({ registry, packs: [loggerPack, consumerPack], daemon });
```

Every callable takes a required object and, when needed, a separate optional object. Factories
with no required values take `{}`. Registry lookups use `registry.has({ toolId })` and
`registry.list({})`; registration already takes the required `{ descriptor, handler, policy }`.
Pack tools/disposal callbacks receive `{ services }`; HTTP and CLI callbacks receive
`{ app, services }` and `{ reg, services }`. A pack's services factory still receives its scoped
`PackContainer` port object directly.

Auth and origin helpers require `{ config, env }`, with `env` supplied by the host. For example,
`apiTokenFromEnv({ config, env: environmentSnapshot })`. `isLocalSameOrigin` additionally requires
`req` and `port`. Malformed-origin diagnostics go through the optional `{ logger }` port, whose
`warn({ message })` method the host supplies. No process environment or console logger is read.
Redaction takes `{ input }` and optional `{ exactSecrets, extraPatterns }`, and `ToolInputError` takes `{ message }` plus optional `{ cause }`.
Tool handlers receive required execution context first and optional `{ emitSurface }` second.

## Entry points

| subpath | what's behind it |
|---|---|
| `.` | The public surface above: tokens, packs, daemon composition, tool registry (descriptors only), principal, redact, auth primitives. |
| `./composition` | **Not part of the public contract.** Exposes `authorizeToolInvocation` (resolves a registry's tool and runs its authorization gate — a security-sensitive value export, but one that only ever hands back a handler alongside an `'allow'` decision) plus type-only `AnyPack`/`RequiredTokenIds`/`MissingTokenIds` re-derivation helpers. Its sole intended consumers are `@jini-ai/daemon`'s `ToolExecutor` and `@jini-ai/server`'s `createLocalNodeDaemon`. Node's resolver will happily let any consumer import it — the boundary is enforced by `scripts/check-engine-boundaries.ts`, not by the exports map — so external adopters should treat it as off-limits regardless. |

## What's swappable

Everything a pack declares as a `deps` token is a swap point by construction: bind any
implementation that satisfies the token's type via `bindings({}).bind(...)`, and `createDaemon`
resolves it into that pack's `PackContainer` with no other change. `ToolPolicy.authorize` is
likewise a seam you supply per tool registration. The kernel logic itself (composition ordering,
the missing-binding compile-time gate, the tool registry's append-only enforcement) is fixed and
not meant to be replaced.

## Runtime

Universal — no Node/browser-specific APIs.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See the archived provenance ledger for per-file provenance and scope decisions. Apache-2.0.

## Additional entry points

The four entries below also have named exports from the package root. Each is universal
and has no runtime dependency. Importing the root and a subpath shares the same
class and factory identities.

| Subpath | API and required ports |
|---|---|
| `./gated-mutations` | `plan`, `confirm`, `execute`, `authorizeForHooks`; authorization, clock, ID generation, complete opaque token generation, TTL, token store and mutation hooks. Includes token lifecycle and composite actor-reference helpers. |
| `./model-facing-tool-errors` | `forbiddenRule`, `reclassifyToolError`, `withModelFacingErrors`, `withModelFacingRegistrationErrors`, `callerSafeErrorMessage`; callers own ordered error allowlists and fallback wording. |
| `./contribution-registry` | `createContributionRegistry({ keyOf })`; instance-owned replacement by key, with detached array snapshots. |
| `./naming` | `deriveAvailableName`, `deriveDuplicateName`, `MAX_SUFFIX_ATTEMPTS`; required collision predicate, suffix formatter and exhaustion message policy. |

Contribution registries use `register({ contribution })`, `list({})` and `clear({})`.
Approval clock/ID ports use the shared zero-argument `Clock.nowMs()` and
`IdGenerator.newId()` getters. Token generation and `hooks.computePlan` still receive
an empty required object. `AuthorizeFn` takes `{ principalId, permission, workspaceId }` with optional
`{ entityType, entityId }` in the second object. The memory token adapter uses
`new InMemoryTokenStore({})` and `count({})`;
its persistence methods already accept named objects. Marker errors use
`new TokenExpiredError({ message }, { cause })` (and the same shape for the other
approval/actor marker errors). `ForbiddenError` also requires a `reasonCode`.
Error class identity, existing messages and authorization/redemption ordering are
preserved. The host supplies transaction/locking policy and hashes the full intent.

```ts
import { createContributionRegistry } from '@jini-ai/core/contribution-registry';
import { deriveDuplicateName } from '@jini-ai/core/naming';

const registry = createContributionRegistry({
  keyOf: ({ contribution }: { contribution: { domain: string } }) => contribution.domain,
});
registry.register({ contribution: { domain: 'example' } });
const snapshot = registry.list({});
registry.clear({});

const existing = new Set(['Example', 'Example 2']);
const duplicateName = await deriveDuplicateName({
  sourceName: 'Example',
  isTaken: async ({ candidate }) => existing.has(candidate),
  withSuffix: ({ base, suffix }) => `${base} ${suffix}`,
  exhaustionMessage: ({ base, maxAttempts }) => `No name available for ${base} after ${maxAttempts} attempts`,
}, { maxAttempts: 1000 }); // 'Example 3'
```

Naming's optional `onExhausted({ base, maxAttempts })` port must throw. Approval token
stores must insert without overwriting issuance and atomically redeem/expire tokens;
`InMemoryTokenStore` provides that contract for tests and requires host retention policy
for long-lived use. There is no application layout, environment name or storage default.

The existing kernel APIs have also changed to object arguments. Update token/binding
calls, pack contributions, handler emitters and explicit environment snapshots before
using this unreleased version; see [CHANGELOG.md](./CHANGELOG.md) for BREAKING notes.

## Design decisions

- [Confirmation checks have a fixed order and atomic redemption](docs/decisions/DR-001-gated-mutation-check-order.md).

## Shared kernel contracts

Import `Clock`, `IdGenerator`, `UUID`, `ISODateTime`, `JsonPrimitive`, `JsonValue`,
`JsonObject`, `JsonArray`, `HttpRequest`, `HttpResponse`, `RequestRedirect`, `HttpClientPort`,
`Logger` and `Result` from `@jini-ai/core/primitives`. They are canonical structural types;
UUIDs and timestamps remain unbranded strings. The HTTP contract includes binary response
bytes, redirect provenance, socket idle budgets and an optional total deadline. Platform
supplies the guarded HTTP implementation; core defines the port only.

Default adapters are `createSystemClock()`, `createRandomUuidGenerator()` and
`createConsoleLogger({ prefix })`. Clock/ID getters take no arguments. Time helpers are
`toIsoDateTime({ epochMs })` and `nowIso({ clock })`. The UUID adapter requires a host
cryptographic UUID implementation and fails if unavailable. The console adapter routes
info/warn/error with optional `{ meta, error }` to the same console severity.

Agent-tool catalogs import `AgentToolSideEffect`, `AgentToolActorClassRule` and
`AgentToolDefinition` from the core root. Delete is a separate side-effect classification;
domains may tighten the shared interface, including making `inputSchema` required.

`@jini-ai/core/text` exports `sanitizeUntrustedText({ text }, { maxLength? })` and
`SanitizeTextOptions`. This terminal-boundary policy strips C0/C1 and ANSI control
sequences, masks labeled/opaque credentials and caps the complete output at 500 characters
by default. Correlation IDs and the delegated-tool route remain visible. This sanitizer
keeps its existing policy; the telemetry redactor additionally masks PII.

`redactSecrets` and `redactSecretsWithCounts` cover the core, CLI and provider rule union.
Exact secrets are literal strings (including regex metacharacters), applied longest first;
null/undefined/empty entries are ignored. Extra patterns are `{ name, regex }` entries, cloned
and made global so caller `lastIndex` state is unchanged. `SECRET_SHAPE_PATTERNS` exports
the eleven unchanged diagnostics vendor regexes; diagnostics retains its secret-only policy.
Core's full redactor is conservative and can mask long ordinary identifiers as opaque tokens.

`timingSafeTokenMatch({ presented, expected, timingSafeEqual })` encodes UTF-8, rejects unequal
byte lengths, and calls the required native byte comparator with `{ left, right }`.
Node hosts inject `({ left, right }) => crypto.timingSafeEqual(left, right)`; this keeps the
universal root free of Node imports while preserving native timing guarantees. No JavaScript
equality fallback is provided. The root does not expose `authorizeToolInvocation`; that gate
and the pack binding derivation types live at `@jini-ai/core/composition`.

Origin classifiers implement the dev-browser LAN allow-list. They allow private addresses
for local development; use `@jini-ai/platform/net` for SSRF classification. Origin validation
uses only an injected environment snapshot and optional `Pick<Logger, 'warn'>` diagnostics.

## Agent tool registration

The root exports `AgentToolDefinition`, `AgentToolSideEffect`, `AgentToolActorClassRule` and
the shared registration kit: catalog indexing, named input readers, schema-bearing refusals,
independent risk gates, registration assembly, risk-map merging and human-confirmed handlers.
This wiring is domain-independent. A domain may require `inputSchema` through an intersection
with `AgentToolDefinition`; it must still independently classify the effects its handlers perform.

Use `indexCatalogById({ catalog })`, `requireInputRecord({ input })`,
`requireString({ input, key })`, `optionalString({ input, key })`, and
`withSchemaOnRejection({ toolId, catalog, isShapeRejection: ({ error }) => predicate(error), fn })`.
`buildDomainRegistrations(required, { unwiredToolIds })` refuses metadata/schema drift and
unclassified or accidentally unwired tools. Domain-specific authorization decisions and denial
classes remain in the domain or host; registration policy is pass-through after those gates.

## Pure path containment

`@jini-ai/core/primitives` exports `pathContains({ root, target }, { caseSensitive?, separator? })`.
Both paths must already be absolute; the host resolves cwd-relative paths and
symlinks. The helper performs lexical segment normalization without importing
Node or reading a working directory. Equality counts as contained. Directory
prefix siblings and traversal escapes are rejected; a legal `..name` segment is
allowed. Windows hosts pass `{ caseSensitive: false, separator: "\\\\" }`; POSIX hosts
retain the default slash separator so backslashes in directory names remain literal.
