# Changelog

## 0.6.12

### Patch Changes

- @jini-ai/core@0.6.12

## 0.6.11

### Patch Changes

- `probeCredentialConnection`: a GET-only credential probe on `credentialed-http`.
- Updated dependencies
- Updated dependencies
  - @jini-ai/core@0.6.11

## 0.6.10

### Patch Changes

- 39b3f97: Name the update operation when refusing edits to a disabled (deleted) webhook subscription.
- 9b30143: Add `@jini-ai/integrations/saved-requests`: a declarative fixed-target HTTPS interpreter
  with closed bounded input schemas, query/JSON-body value bindings, host-resolved credential
  IDs and revision/origin binding, and typed positive output selection marked as untrusted.
  Reuse credentialed HTTP authentication, redaction and audit over platform guarded egress
  with no redirects, private-address denial, 64 KiB response/decompression caps and a 10s
  deadline. Requires the existing optional platform and JSON-schema peers for this subpath.

  Add the opt-in `makeCredentialedRequest` option `responseFormat: "json"` for decoded JSON
  secret redaction, including refusal of credential-bearing keys/numbers and incomplete JSON.

- dc6efe5: Composio and the media-provider gateway collapse from two sibling packages under
  `packages/integrations/` into subpaths of one package: `@jini-ai/integrations/composio` and
  `@jini-ai/integrations/media-providers`. An npm package name allows only one slash, so the literal
  import paths the repo owner wants require exactly this shape — one package with two subpath
  exports, not two packages grouped under a shared directory.

  This closes out two moves that happened earlier the same day. Composio was folded into
  `@jini-ai/admin` as `./server` on 2026-08-01, then un-folded back into its own package under its
  original published name, `@jini-ai/composio` (see the now-superseded
  `composio-un-retirement.md`) — that un-retirement was never itself published, so no registry
  version exists under that name beyond the pre-fold `0.2.1`. `@jini-ai/media` was separately renamed
  and relocated to `@jini-ai/integrations-media-providers` (see the now-superseded
  `media-providers-rename.md`); that rename was likewise never published — its own text notes the
  version stays at `0.1.2` on disk pending a real release. Both collapse directly into this package's
  two subpaths without ever taking an independent consumer-facing release under either intermediate
  name.

  **Breaking: `better-sqlite3` becomes an optional peer dependency of `./media-providers`, not a
  regular dependency.** The concern that originally kept these as two separate packages — a
  composio-only consumer being forced to install `better-sqlite3`, a native compiled addon — no
  longer applies once both integrations share one package, because `better-sqlite3` is only ever
  reached through a dynamic `await import('better-sqlite3')` inside `createSqliteMediaTaskStore`;
  every other `./media-providers` export (the dispatch engine, capability registry, in-memory task
  store, `renderStub`) never touches it. A consumer who calls `createSqliteMediaTaskStore` must now
  `npm install better-sqlite3` themselves; everyone else installs nothing extra. This mirrors
  `@jini-ai/admin`'s `react`/`react-dom` optional-peer convention.

  No production logic changed — every file moved as-is from
  `packages/integrations/{composio,media-providers}/src/**` into
  `packages/integrations/src/{composio,media-providers}/**`. `examples/reference-web`, the one real
  consumer of `./media-providers` in this workspace, is updated to the new import specifier.

  **The standalone published names `@jini-ai/media` (`0.1.2`) and `@jini-ai/composio`
  (`0.1.0`, `0.2.0`, `0.2.1`) are retired for good** — neither is versioned forward under its own
  identity again. `@jini-ai/composio`'s deprecation was already flagged as a release
  follow-up in `fold-composio-into-admin.md` (from the 2026-08-01 fold) and, as far as this workspace
  shows, never acted on; it is restated here since it is still outstanding. `@jini-ai/media`'s
  deprecation was not previously flagged anywhere. Whoever runs the next release should run both:

  ```
  npm deprecate @jini-ai/media "Renamed and merged into @jini-ai/integrations; import from '@jini-ai/integrations/media-providers' instead."
  npm deprecate @jini-ai/composio "Merged into @jini-ai/integrations; import from '@jini-ai/integrations/composio' instead."
  ```

- dc6efe5: Add `@jini-ai/integrations/media-providers/catalog` — a browser-safe entry exporting only the
  vendor catalogue (`providers.ts`) and its types (`types.ts`).

  The existing `./media-providers` entry is `jini.runtime: "node"` and its barrel statically pulls in
  `node:crypto`/`node:fs`/`node:path` (`staging.ts`), `node:dns` (`dispatch/ssrf-guard.ts`), and
  `undici` (`dispatch/providers/openai.ts`). A browser consumer that only needs the provider list to
  render a credentials screen — Tovu's admin SPA is the first — previously had no way to get it
  without dragging the whole dispatch engine into its bundle.

  `providers.ts` imports only types from `types.ts`, and `types.ts` imports nothing, so the pair is
  genuinely dependency-free; the new entry is marked `"universal"` in `jini.entries`. Verified by
  importing the built subpath from a directory containing nothing but this package's `dist/` and
  `package.json` — 11 exports, 25 vendors, no dispatch symbols reachable — while
  `./media-providers` fails with `ERR_MODULE_NOT_FOUND` on `@jini-ai/core` in the same environment.

  `__tests__/catalog.test.ts` walks the transitive source graph and asserts it contains exactly
  `catalog.ts`/`providers.ts`/`types.ts` with zero bare import specifiers, so re-exporting anything
  node-bound from this entry fails a test rather than a downstream bundle.

  Additive only — no existing entry, export, or type changed.

- ea8d883: Refuse subscription updates after soft deletion, before target validation or repository writes.
- Updated dependencies [22f0619]
- Updated dependencies [82ed2d3]
- Updated dependencies [5a3de86]
  - @jini-ai/core@0.6.10

## 0.4.3 — 2026-10-22

- 2026-10-22: Webhook delivery deadlines, leases and fencing; media-provider model-id collision refusal; provider contributions.

### Minor Changes

- media-providers: vendors are one-unit provider contributions (`{ provider, models, adapters }`) on the
  shared `@jini-ai/core/provider-registry` (contract `media`). `createMediaProviderRegistry()` (built-ins
  are the default contribution set; plugins `contribute`, refused not thrown) implements both
  `VendorAdapterLookup` and the new `MediaModelCatalog`. `createMediaDispatchEngine` takes an optional
  `catalog`, so plugin models validate; omitted, behaviour is unchanged. Registry keys map `-` to `_`;
  public provider ids are unchanged.

## 0.4.1

### Patch Changes

- Tovu clean-up release (2026-10-08): code Tovu moved into Jini, plus the Jini clean-up (see the commit log since 0.4.0).

## Unreleased — compilation repairs

### BREAKING

- `CredentialedRequestDeps.clock` now takes core `Clock.nowMs()`. Verification and request audit timestamps use `nowIso({ clock })` at the existing sampling points; request, audit and response behavior are unchanged.

### Fixed

- Media-provider DI tokens and browser catalog tests use the current object argument contracts.
- Policy/generation test fixtures retain literal types; SVG tests supply the full render context.
- Async video tests inject the existing HTTP client fixture instead of the removed raw fetch option.
- Restore native WAV header writes at offsets 0, 8, 12 and 36; preserve the original PCM bytes and add header regression assertions.

## 0.4.0 — 2026-10-02

### BREAKING

- HTTP, clocks, IDs and JSON types use core contracts; filesystem locks and SSRF classifiers use platform. Composio error protection and host messages no longer couple domain packages.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased — integration removal

### BREAKING

- Composio integration removed: delete the connector source/tests, the public subpath,
  legacy type resolution and associated catalog/persistence messages. Future support
  belongs in an Agent Plugin bundle with a manifest and hosted MCP endpoint.

## Unreleased — canonical contracts

### BREAKING

- Remove `./http-ports`, the credentialed-http/webhooks HTTP type re-exports and the local DTO declarations; import core primitives directly and use `HttpClientPort.send({ request }, { redirect? })`, with body inside request.
- Webhook clock/ID/JSON/time types and Composio JSON types come from core; webhook clocks expose `nowMs()`.
- Composio prose takes optional `messages`, exported as `defaultIntegrationsMessages`, instead of required `productName`.
- Remove local Composio lock and media hostname classifiers; import shared platform locks/network classifiers.

### Changed

- Composio retains 2000ms timeout, 10ms polling and no age/dead-owner stealing. Shared locking adds owned-create cleanup and inode/device snapshot checks.
- Native fetch ABIs and media egress paths remain unchanged; provider-host policy retains existing loopback allowance.

## Unreleased

- Add `./credentialed-http`: resolver, HTTP, scheme-registry and audit ports; origin binding,
  Basic/Bearer/self-describing schemes, redacted responses and injectable auth diagnostics.
- Add `./webhooks`: subscription lifecycle, envelope/repository ports, delivery retries and
  HMAC signing with required wire vocabulary and caller-supplied time.
- Existing subpaths and versions are unchanged. No default plugin loading or new dependencies.

### Integration merge and API convention

- New independent subpaths: `./credentialed-http` and `./webhooks`; transport contracts
  come from core primitives. Retain Composio and media-provider/catalog entries.
- Export structural `ComposioConnectorProviderPort`, `ConnectorStatusServicePort`
  and `ConnectorObjectOutputProtectionResult` through the Composio barrel.
- **BREAKING:** Composio public functions, provider/service constructors, service
  methods, configuration/credential stores and errors use required and optional
  argument objects; positional overloads are absent. Hosts can supply catalog `messages`.
  Credential guards narrow the required object's `value`. Error constructors take
  `{ code, message, status }`, then optional `{ details, options }`.
- **BREAKING:** Media catalog/video helpers, renderers, policies, staging, dispatch
  factories/registries/adapters/parsers, DNS lookup ports and async-operation stores
  use required and optional argument objects. Runtime entry points carry ports and
  operation fields in object one; `clock` is the optional callback and recovery
  keeps numeric `now`. Environment credential resolution requires `providerId` and `env`.
  The protected task-store/SQLite factory conversion remains with its active owner.
- **BREAKING:** Shared HTTP sends take `{ request }` with optional body inside the request;
  redirect controls occupy object two. Webhook `markFailed` puts optional `{ deadAtIso }`
  in object two. Credential-store setters take
  `{ credentialStore }`. Extracted credential/webhook error constructors take
  `{ message }` and optional `{ options }` without changing messages or error identity.
- Correct the Composio output overload so only object inputs promise object results;
  preserve scalar, array and null outputs. Immediate connections commit validated
  credentials/account labels without reassigning constant caller options.
- Write merge regression and package-surface tests; strengthen the whole-source
  neutrality guard to reject product names in comments as well as imports/defaults.
  Verification deferred by owner directive. No version bump or dependency changes.

- **BREAKING:** Credentialed-request audit sinks take `{ entry }`; the injected console
  logger takes `{ line }`. Stored entries and emitted diagnostic lines retain their formats.
