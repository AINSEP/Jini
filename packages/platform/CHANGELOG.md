# @jini-ai/platform

## 0.5.9 — 2026-10-16

- `fs`: best-effort directory fsync, so Windows site creation stops failing with EPERM (87720117).
- `./web` fetch default window is 20,000 characters so one result fits an MCP budget (939300e3).

## 0.5.8 — 2026-10-15

- SECURITY: the guarded HTTP client forwards only `accept`, `accept-language` and `user-agent` on a cross-origin redirect (4de69b67). It used to strip only Authorization/Cookie, so custom credential headers (`x-api-key`, `X-Shopify-Access-Token`, …) followed a redirect to another origin. Same-origin hops keep all headers.
- `./web` page fetch applies `maxChars` to the readable text, not the raw HTML (0625844e): raw HTML uses the fixed 1,000,000-char parser ceiling, and the result says `truncated: true` when cut. A page with a large script/style head no longer returns almost no text.

## 0.5.7 — 2026-10-14

- The asset cache's optional `undici` load moves behind `asset-cache.adapter.ts` (64eafe35); injected dispatchers, DNS validation and the MODULE_NOT_FOUND message are unchanged. No API change.

## 0.5.6 — 2026-10-13

- `undici` and `hast-util-from-parse5`, `hast-util-to-mdast`, `mdast-util-to-markdown`, `mdast-util-gfm-table` (with `parse5`) are now optional peers instead of dependencies. Only `./web` needs the HTML/Markdown set; only the default `createAssetCacheDispatcher` needs undici, loaded lazily (a missing peer throws `AssetCacheError` 500; a host-supplied dispatcher needs none). Hosts using those must list the packages themselves.
- New `./asset-cache` subpath (node) exporting the asset cache without the root barrel.
- New universal `./secrets/credential-sets/contracts` leaf (vault contracts without the vault runtime); `@jini-ai/db` 0.3.4's SQL vault repo imports it.

## 0.5.5 — 2026-10-13

- New narrow subpaths for the existing OS helpers: `./command`, `./process`, `./toolchain`, `./proxy-env`, `./shell`, `./child-environment`. Importing one loads 1-2 modules instead of the root barrel's 181 (incl. undici). The root still exports everything; no signature change.

## 0.5.4 — 2026-10-12

- Removed unused exports: `SecretsVaultService.commitPrepared`, `VaultCommitPreparedInput`, `VaultCopyInput.targetRevisions`, the pre-vault `InMemoryVendorCredentialSetRepo` and `buildVendorCredentialAad`. No known consumer; prepared records are committed through the vault repository's `put`/`applyBatch`.

## 0.5.2

### Patch Changes

- Tovu clean-up release (2026-10-08): code Tovu moved into Jini, plus the Jini clean-up (see the commit log since 0.5.1).

## 0.5.1 — 2026-10-04

- `./secrets` exports the canonical site-key names (`SiteKeyHandle`, `FixedSiteKeyKeyring`, `UnusableSiteKeyError`, `SiteKeyFileAlreadyExistsError`, `parseSiteKeyHex`, `fingerprintSiteKeyHex`, `inspectSiteKeyMaterial`, `revealSiteKeyMaterial`, `generateFileSiteKey`, `deriveFromSiteKey`, `deriveSigningSecretFromSiteKey` and the matching types). Every `RootKey*` name stays exported as a `@deprecated` alias of the same binding, to be removed on or after 2026-11-01. Additive: no behavior or signature change.

## 0.5.0 — 2026-10-02

### BREAKING

- Use canonical core ports and platform ./net and ./fs/file-lock. Analytics and trash moved to their domain packages; credential scope and durable filesystem contracts changed.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

### Compilation fixes

- Omit an absent guarded HTTP abort signal to satisfy the canonical request contract.
- Import the mail adapter's HTTP port from core primitives and type the key-rotation test
  fake against `KeyringPort`, preserving its assertions and behavior.

### Breaking domain extraction

- Remove `./analytics` and the analytics root namespace; import the standalone `@jini-ai/analytics` package.
- Remove `./trash` and the trash root namespace; import `@jini-ai/cms/trash`.
- Move both capabilities' behavior tests with their source; platform retains only generic OS/transport capabilities.


### Shared platform primitives

- BREAKING: HTTP primitive types now come from `@jini-ai/core/primitives`; guarded HTTP exports
  `GuardedClock` with `nowMs()` and `timeoutSignal({ timeoutMs })`. Mail uses the kernel clock.
  Analytics primitive declarations also come from core. Add core as a regular dependency.
- BREAKING: address classifiers move from asset-cache.ts to `./net`; `isPrivateAddress` and
  `expandIpv6` take `{ address }`. The root IP-classifier export points to the canonical module.
- Add `./fs/file-lock` async/sync token-and-inode-owned locks sharing one stale decision.
  Durable JSON retains its lock budgets, user copy, read/quarantine behavior and JSON bytes.
- BREAKING: the synchronous atomic filesystem seam owns descriptors and exposes open/sync/close/
  lstat as well as existing mode/rename/remove effects. Add file and directory fsync and owned-temp
  failure cleanup; move `tempName` into argument two as an optional token factory with the native pid.UUID default. Add async file/JSON
  writers, secret-mode verification, optional symlink refusal, and sidecar newline/parent support.
  Durable JSON delegates to the canonical writer, retains its temp layout/new-file mode, and gains
  exclusive temp creation, cleanup on failure, and directory fsync.
- Add exported `defaultPlatformMessages` with host replacement seams. Egress refusal and invalid
  root-key recovery warnings use neutral defaults. Keyring source-permission flags and derivation
  formats are unchanged. Tests and builds are deferred by the owner.

- Security defaults: purpose-gated mail validates runtime modes at composition; only explicit local mode bypasses readiness. Root-key adapters require an injected environment reader and explicit fallback/generation booleans. Fresh inspection/reveal also require that reader. Existing wire derivation is unchanged.

- Guarded HTTP restores per-socket inactivity timeouts. Requests accept explicit
  `idleTimeoutMs`, with `timeoutMs` retained as its legacy alias and the historical
  `connectTimeoutMs` policy ceiling applied per socket. Optional `totalDeadlineMs`
  bounds DNS, all redirects and decoded body reads independently; it is off by default.
  Idle failures retain `Error("request timed out after …ms")`; explicit deadline failures
  use `FetchTimeoutError`. Slow but progressing transfers are no longer cut off by
  an implicit total deadline. Verification is deferred by owner directive.

### Integration finish pass

- Complete Node runtime metadata for every export, the filesystem barrel, and additive root
  namespaces for `./http/guarded`, `./mail`, `./mail/smtp`, `./fs`, `./fs/guarded-reader`,
  `./fs/durable-json`, `./analytics`, `./trash`, `./secrets`, `./secrets/credential-sets`,
  and `./secrets/testing`. No version change or dependency addition.
- BREAKING (new extraction APIs): native factories and transport/memory constructors take `{}`;
  keyring `activeKey`, mailer `capabilities`, clock/random methods and durable JSON `read` take
  `{}`. SMTP transport `sendMail` takes `{ mail }`; the native nodemailer payload remains
  behind `NativeSmtpTransport`. Analytics/trash policy errors take `{ message }` and optional
  `{ cause }`. Existing legacy root functions retain their compatibility signatures.
- Reconcile the export-map contract test and remove application names from analytics fixtures.
  Verification of this finish pass is deferred by owner directive.

- Add privacy analytics ingest with required HKDF context and privacy policy, injectable hash/hook seams, and a recent-hit memory sink.
- Add trash write/sweep orchestration with required retention/entity policy, reentrant transaction ports, host scheduler, record-store adapter, and optional follow-ups in arg 2.
- Add `./fs` with mode-preserving atomic file/JSON writes, narrow env-text transforms, and strict lexical containment; keep all existing filesystem exports unchanged.

- Add guarded outbound HTTP with injected DNS, pinned transport, clock, policy, and required user agent. Reuse existing address validation and timeout errors. Preserve redirect refusal and response-byte contracts.
- Add mail contracts, a purpose/readiness gate, delivery capability checks, and an optional SMTP subpath over a host-supplied transport/module; no new dependency.
- Add contained and bounded file readers with caller-owned deny rules/limits, and durable JSON file operations with injectable filesystem, time, liveness, sleep, randomness, and notices.
- Convert the unpublished secrets surface to required-object/optional-object signatures; preserve pinned derivation, AAD, ciphertext, and envelope bytes.

## 0.4.0

### Minor Changes

- Add `./secrets` with AES-256-GCM sealing, root-key ports, explicit env/file and fixed-key
  adapters, HKDF helpers, and root-key validation, status, reveal, and exclusive generation.
  Env names, key paths, and HKDF salts are caller-supplied, with no defaults. New seals require
  AAD; opening historical ciphertext without AAD remains supported. The ciphertext envelope
  and derivation labels are preserved and covered by pinned vectors.
- Add `./secrets/credential-sets` with generic vendor credential records, repository contracts,
  the stable v1 AAD builder, and a memory repository. Add `./secrets/testing` with ephemeral and
  fixed root-key adapters and the memory repository. Existing exports and dependencies are unchanged.

## 0.1.2

### Patch Changes

- Add top-level `main`/`types` fields alongside the existing `exports` map. A consumer on
  TypeScript's classic `moduleResolution: "node"` (node10) — which ignores `package.json#exports`
  entirely — could not resolve this package's types at all (`TS2307: Cannot find module`) even
  after the previous exports-map fix restored `require()` at runtime; type resolution and runtime
  resolution are separate algorithms. Verified against a real external consumer (whose
  tsconfig uses this legacy resolution mode): adding these two fields, with its tsconfig completely
  unchanged, made the error disappear. Also fixes absolute-path `require()` (distinct from a bare
  specifier, which already worked) for the same reason — `main` was previously absent.

  Purely additive: every modern resolver (Node's own runtime `exports` resolution, TypeScript's
  `bundler`/`node16`/`nodenext`) prefers `exports` over `main`/`types` when both are present, so
  this changes nothing for a consumer already on a modern resolver.

## 0.1.1

### Patch Changes

- Add a `"default"` export condition to every published package's `exports` map — every one of
  them lacked it, which meant `require()` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` for any
  CommonJS consumer (found via a real external integration attempt; Node needs `require(esm)`
  support, i.e. Node >=22.12, for this to resolve).

  `@jini-ai/agent-runtime`:

  - **New**: `RuntimeBuildOptions.permissionMode` (`'bypass' | 'restricted'`) lets a caller opt a
    run OUT of the auto-approve-every-permission-prompt flag every def with one
    (`bypassPermissions` / `--yolo` / `--dangerously-skip-permissions`) previously pushed
    unconditionally, with no way to turn it off. Omitting it keeps today's default (bypass)
    behavior unchanged.
  - **New**: `ClaudeStreamEvent`, `CopilotStreamEvent`, and `QoderEvent` are now real exported
    discriminated unions instead of `Record<string, unknown>` — a real external consumer guessed a
    nonexistent field name (`event.text` instead of the actual `event.delta`) against the old
    untyped sink and silently lost every streamed token with no compile or runtime error.
  - Fixed a doc/implementation mismatch in `claude-stream.ts`: the module doc claimed `tool_result`
    events carry `{ tool_use_id, content, is_error }`; the actual emitted shape is
    `{ toolUseId, content, isError }`.

  `@jini-ai/daemon`: `AgentExecutorRunInput.permissionMode` forwards the new
  `RuntimeBuildOptions.permissionMode` through to `buildArgs`, so a host can actually reach the new
  opt-out from the daemon's real run-input surface, not just from `@jini-ai/agent-runtime` in
  isolation.

  `@jini-ai/agentic`: `setAtPointer` no longer throws on a malformed (e.g. missing leading `/`)
  `updateDataModel` path — degrades to a no-op like its sibling `getAtPointer`, matching this
  package's own "a bad binding must not crash the renderer" contract. That path is agent-authored
  wire data with no error boundary above it in any host, so the uncaught throw could unmount an
  entire chat UI from ~40 bytes of malformed input.

  `@jini-ai/chat-react`: a local (client-resolved) A2UI button action is no longer a silent no-op —
  `A2uiSurfaceCard` now surfaces the resolved value. New `ExtEventErrorBoundary` confines a
  `kind: 'ext'` event group's renderer to its own card instead of letting a render/effect-phase
  throw from agent-controlled content unmount the whole chat root (there was no error boundary
  anywhere in this package or its hosts before this).
