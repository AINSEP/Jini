# `@jini/platform` — provenance

Origin: `nexu-io/open-design` (fork `leonaburime-ucla/open-design`), branch `main`,
commit `951fa5f1541c3b7af23ccb07e3e60b294def56b1` (2026-07-12), local reference
clone `/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic`.

Per extraction-plan.md §8 task 4: "`@jini/platform` + `@jini/sidecar` verbatim,
path-mirrored + patch-router." This package is the low-risk mechanical half of
that task — OS/process/file/http/proxy/toolchain primitives with no OD domain
nouns to strip, unlike `@jini/protocol` (task 2), which needed heavy content
stripping.

| Jini file | Origin file | Transform |
|---|---|---|
| `src/command.ts` | `packages/platform/src/command.ts` | Verbatim. Cross-platform command-invocation construction (Windows `.bat`/`.cmd` shim quoting, package-manager re-entry). No OD nouns; only relative import paths preserved as-is (no sibling imports in this file). |
| `src/process.ts` | `packages/platform/src/process.ts` | Verbatim. Process stamp encode/decode, spawn/stop helpers, process-tree walk, POSIX/Windows snapshot enumeration. Imports `./command.js` unchanged (same relative path, now resolving inside `@jini/platform`). |
| `src/proxy-env.ts` | `packages/platform/src/proxy-env.ts` | Ported with 3 minimal type-strictness edits only (no behavior change) — see "Strictness-only edits" below. System proxy discovery (macOS `scutil`, Windows registry) and proxy-aware env merging; no OD nouns. |
| `src/fs.ts` | `packages/platform/src/fs.ts` | Verbatim. Path containment, atomic copy, best-effort removal, log-tail reads. No OD nouns. |
| `src/http.ts` | `packages/platform/src/http.ts` | Verbatim. HTTP readiness polling (`waitForHttpOk`). No OD nouns. |
| `src/toolchain.ts` | `packages/platform/src/toolchain.ts` | Ported with 1 identity-strip (comment only) + 1 type-strictness edit — see below. User-level toolchain bin discovery (npm/pnpm/bun/cargo/deno/go/pyenv prefixes, asdf/volta/mise/nvm/fnm shims, per-version Node roots). Business logic (which dirs to search) kept verbatim — it is generic to any GUI-launched Node daemon, not OD-specific. |
| `src/index.ts` | `packages/platform/src/index.ts` | Ported with 1 identity-strip (module doc comment) — see below. Root barrel; re-exports the same public surface under the same names. |

## Identity strips (per root `AGENTS.md` hard boundary: no `Open Design`/`OD_`/`--od-stamp`/`/tmp/open-design` in `packages/@jini/**`)

| File | Origin | Change | Reason |
|---|---|---|---|
| `src/index.ts` | `@module @open-design/platform` | → `@module @jini/platform` | Module doc comment named the OD package; renamed to the Jini package, no behavior change. |
| `src/toolchain.ts` | comment: `"...they resolve cleanly from the user's shell. See open-design issue #442."` | Dropped the `See open-design issue #442` sentence; kept the rest of the rationale comment. | Named the origin product and a product-specific issue tracker reference. The underlying rationale (why `~/.npm-global`/`~/.npm-packages` are searched) is generic and was kept. |

## Strictness-only edits (Jini's stricter `tsconfig.base.json`, no behavior change)

Jini's root `tsconfig.base.json` sets `noUncheckedIndexedAccess: true`, which OD's
own `tsconfig.json` does not set. This surfaces `string | undefined` on regex
match-group and fixed-length-tuple index access that OD's compiler didn't flag.
Fixed with non-null assertions at call sites where the surrounding logic already
guarantees the value is present (a successful regex match with a mandatory
capture group; a tuple index bounded by the tuple's own `.length`):

- `src/proxy-env.ts`: `parseMacosScutilProxyOutput`'s exception-list/scalar regex
  captures (`match[1]!`, `match[2]!`) and `parseRegistryValue`'s capture
  (`match[1]!`).
- `src/toolchain.ts`: `compareVersionLikeDirNames`'s tuple index comparison
  (`rightSemver[index]!`, `leftSemver[index]!`).

No other files needed strictness edits.

## Flat daemon primitives (2026-07-18, port continuation task — Part 2)

Four of the seven top-level files identified in `apps/daemon/src/` as
"generic daemon primitives, not yet ported" (`agents.ts`, `sandbox-mode.ts`,
`terminals.ts`, `daemon-paths.ts`, `origin-validation.ts`,
`api-token-auth.ts`, `redact.ts`) landed here: the ones that do real
filesystem/OS-process work, matching this package's existing
command/process/fs/toolchain scope. The three pure security/auth/telemetry
primitives (`redact.ts`, `api-token-auth.ts`, `origin-validation.ts`)
landed in `@jini/core` instead, and `agents.ts` was deliberately not
ported at all — see `@jini/core`'s own `source-map.md` for both.

| Jini file | Origin file | Home rationale + transform |
|---|---|---|
| `src/home-expansion.ts` | `apps/daemon/src/home-expansion.ts` | Verbatim port (already product-neutral — no `OD_`-prefixed names or product strings in the origin). A new file, not present in the pre-2026-07-18 `@jini/platform`; added because both `sandbox-mode.ts` and `daemon-paths.ts` depend on it and it's a pure path-expansion primitive, the same kind of thing `fs.ts` already hosts here. |
| `src/sandbox-env.ts` | `apps/daemon/src/sandbox-mode.ts` | Genericized: the origin hardcoded its host product's sandbox-mode/import-allowed-roots/data-dir/agent-home env-var names and a literal product-branded config sub-directory name. All are now fields on `SandboxEnvConfig`, threaded through every function — the same "config object carries the product's env-var names" pattern `agent-runtime-env.ts`'s `RuntimeEnvConfig.envPrefix` (per `r1b-daemon-design.md` §1c) already established for this codebase. Renamed `sandbox-mode.ts` → `sandbox-env.ts` since the file is about the sandboxed *environment* (directory tree + env-var overlay) more than a boolean "mode." Home: `@jini/platform`, not `@jini/core` — it does real `fs.mkdirSync`/`fs.realpathSync` work and builds a `NodeJS.ProcessEnv` overlay for a spawned process, the same OS-primitive shape as `process.ts`'s env/spawn helpers. |
| `src/resource-paths.ts` | `apps/daemon/src/daemon-paths.ts` | Genericized: the origin hardcoded its host CLI's env-var names, its own npm package specifier (`require.resolve('<package>/package.json')`), a `.` + product-name default data-dir name, and a product-name path segment in the Windows packaged-resources marker. All are now fields on `ResourcePathsConfig`. One API-shape change beyond de-branding: `resolveProcessResourcesPath` takes an injected `{ resourcesPath?, execPath }` parameter instead of reading the global `process` object directly, so the macOS/Windows marker-matching logic is unit-testable without mutating `process.execPath` in-process. Renamed `daemon-paths.ts` → `resource-paths.ts` to describe what the file actually resolves (CLI path, packaged-resources root, plugin-previews dir, data dir) now that "daemon" isn't an implicit product noun here. Home: `@jini/platform` — real `fs`/`path`/packaged-app-layout resolution, the same shape as `toolchain.ts`'s bin-discovery primitives. |
| `src/terminal.ts` | `apps/daemon/src/terminals.ts` | The one file in this batch with **zero** product-identity strings in the origin — but two real couplings were replaced with injectable ports rather than ported verbatim, per the task brief's own framing ("this file is especially relevant — this project's consumer research (Zana + Open-Marketing both independently need a terminal/PTY port) means this file may directly inform that future port; design its generic interface accordingly"): (1) the origin statically `import type * as NodePty from 'node-pty'` and dynamically `await import('node-pty')` — `@jini/platform` does not depend on `node-pty` (a native addon this sandboxed build environment can't install/compile), so the port instead defines a minimal `PtyProcess`/`PtySpawn` port interface and takes a `loadSpawnPty: () => Promise<PtySpawn>` factory from the caller; a real Node host wires a thin `node-pty` adapter, a test wires a fake. `spawnHelperCandidatePaths`'s `require.resolve('node-pty')` call is a *runtime* string lookup (not a static import), so it still typechecks and still resolves for real once a consumer has `node-pty` installed — it just isn't a hard dependency of this package. (2) the origin's `stream(session, req, res, createSseResponse)` took an Express `req`/`res` pair directly; the port replaces it with a transport-neutral `attach(id, lastEventId, sink: TerminalSseSink)` / `detach(id, sink)` pair (`TerminalSseSink` = `{ send, end }`, no Express/HTTP types), so a future terminal port for a non-Express host isn't stuck re-deriving this from OD's routes. Beyond those two seams, the ring-buffer/coalescing/exit-tail-trim/TTL-cleanup logic is behaviorally the same as the origin, retyped away from `any` (this package's public surface bans `no-explicit-any` per `extraction-plan.md` §7) — sessions are looked up by `id: string` rather than the caller holding and re-passing the mutable internal session object, and `write`/`resize`/`kill`/`attach`/`detach` all take `id` for that reason. One dead-branch removal surfaced during the coverage-driven pass (Phase 6.5): the `pty.onExit` handler's `exitCode ?? null` fallback is unreachable given `PtyProcess.onExit`'s own callback type declares `exitCode: number` (non-nullable, matching both the origin's own type annotation and node-pty's real exit-event shape) — removed, documented inline at the call site, same classification and precedent as the agent-protocol port's dead-branch removals. |

## Dependencies

No runtime dependencies in the origin package (devDependencies only: `@types/node`,
`esbuild`, `typescript`, `vitest` — all build/test tooling). `@types/node` was added
to the Jini repo root `package.json` devDependencies (not previously present) since
`@jini/protocol` is pure-TypeScript and never needed Node type declarations; this is
the first engine package that touches `node:*` builtins.

## Addendum: `asset-cache.ts` (2026-07-17)

Sourced from the OD fork's unmerged `arch/plugins-fold-decouple` branch (not
part of the original task-4 batch above), commit `c1ee358` on
`leonaburime-ucla/open-design`, file `apps/daemon/src/plugins/plugin-asset-cache.ts`
(the branch's own commit renamed it from the pre-refactor
`apps/daemon/src/plugin-asset-cache.ts`).

Verification context: this branch was one of several old capability-barrel
refactor branches audited to see whether they held reusable engine substrate
vs. genuinely OD-product logic. Two sibling files in the same branch
(`plugin-preview-bakes.ts` — bakes a plugin marketplace's hover-preview video
clips, `OD_PLUGIN_PREVIEWS_DIR`/R2 CDN specific — and the branch's `design/`
trio ported separately, if ever — see god-components-extraction-plan.md) were
judged genuinely OD-specific and NOT ported. `plugin-asset-cache.ts` was the
one exception: despite its "plugin preview" framing in comments, the
implementation itself has zero OD domain nouns — it is a generic, SSRF-hardened
same-origin disk cache/proxy for external media any sandboxed-content renderer
(iframe preview, embedded document, etc.) would need.

| Jini file | Origin file | Transform |
|---|---|---|
| `src/asset-cache.ts` | `apps/daemon/src/plugins/plugin-asset-cache.ts` | Logic verbatim (SSRF guard chain: `assertSafePublicUrl` up-front rejection + `createValidatingLookup` DNS-rebinding/TOCTOU guard installed on the undici `Agent`, content-addressable disk cache with in-flight de-dup, capped streaming read). Renamed `createPluginAssetCache`/`PluginAssetCache`/`PluginAssetCacheOptions` → `createAssetCache`/`AssetCache`/`AssetCacheOptions` (the "plugin" framing wasn't load-bearing — this is generic media-proxy infra). `assetCacheRewriteUrl` gained a second `routePath` param (was hardcoded `/api/asset-cache`) since the mount path is a host-application concern, not this package's. Header comment reworded to drop "plugin preview HTML (example.html)" / "marketplace card" framing while keeping the CSP/latency/SSRF rationale. |
| `src/asset-cache.test.ts` | `apps/daemon/tests/plugin-asset-cache.test.ts` | Same coverage (cacheable-URL predicate, IPv4/IPv6 private-range classification incl. IPv4-mapped literals, up-front + connection-time SSRF rejection, disk persistence/replay, concurrent de-dup, oversized-asset rejection with and without Content-Length, non-cacheable/private-IP short-circuits before any fetch) renamed to match the `createAssetCache` API; added one test for the new `routePath` param. Test fixture CDN hostnames (`images.higgs.ai`) swapped for `images.example.com` — a real third-party company name, not OD's own, but still not a stable fixture to depend on. |

Dependency: `undici@^7.25.0` added to `package.json` (previously none) — needed
for the `Agent`/connection-time `lookup` SSRF guard. Same major version OD's
own daemon pins.

## Not ported (out of scope for this task)

Nothing was left out — every file in the origin `packages/platform/src/` ported
(verbatim or with the identity/strictness edits above). The origin `tests/`
directory (`tests/index.test.ts`, `tests/process-tree.test.ts`,
`tests/stamp-read.test.ts`, ~1216+41+78 lines) was not ported verbatim; `src/index.test.ts`
here is a fresh vitest suite exercising the same real exported surface (command
invocation, process stamp round-trip/match, process-tree collection, fs atomic
copy/removal/log-tail, http polling, proxy-env parse/merge, toolchain bin
discovery) rather than a line-for-line port of OD's larger fixture suite.

## Explicitly deferred (task 1 dependency)

The "patch-router" half of task 4's gate ("a real historical `packages/platform`
patch routes cleanly") depends on task 1 (harnesses + sync-ownership manifest),
which has not been done yet. Not attempted here — see the Programmer handoff
report for this task.

## Addendum: `download.ts` (2026-07-17)

Sourced from `leonaburime-ucla/open-design`'s `packages/download` on `main`
(cloned fresh to `/tmp/od-source`; `src/index.ts`, one file, 1051 LOC), per
`ADS-memory/reports/jini-port/recon/r2-packages.md` §11: "a generic download store... only
sentinel/kind string constants... Classification: GENERIC-RUNTIME. Portable;
rename the sentinel strings. Small." Its only workspace dependency is
`@open-design/platform` — already ported here as this package.

**Recon file-count discrepancy:** the task brief (echoing r2-packages.md's
header count) describes this as "16 files, ~1651 LOC." The actual origin
package on `open-design`'s current `main` has exactly one `src` file
(`src/index.ts`, 1051 LOC) plus one test file (442 LOC) — 1493 LOC total
across both, still in the same ballpark as the cited total but as a single
cohesive module, not 16 files. Verified directly (`find packages/download -type
f`) before starting the port; treated the real directory contents as ground
truth over the stale recon count, same situation as `@jini/http`'s
`tool-request-auth.ts` discrepancy in this same porting session.

| Jini file | Origin file(s) | Transform |
|---|---|---|
| `src/download.ts` | `packages/download/src/index.ts` | Logic verbatim (target normalization, atomic-copy-then-rename downloads with HTTP Range resume, sha256/sha512 checksum verification, cross-process advisory locking with stale-lock/pid-reuse detection, a durable JSON manifest per target, retention pruning, same-process in-flight dedup with progress fan-out and per-caller abort, and the `downloadCopyAndClear` one-shot copy-then-clear-if-unreferenced helper). Import source for `atomicCopyFile`/`pathContains`/`removePathBestEffort`/`isProcessAlive` switched from the `@open-design/platform` package import to relative sibling imports (`./fs.js`, `./process.js`), since this now lives inside the same package as those primitives rather than depending on it as a separate workspace package — all four call signatures matched exactly, so no adapter code was needed. Dropped one dead unused import (`relative` from `node:path`, unused in the origin file too — verified by grep). **Identity-stripped** three sentinel/kind string constants (the task brief cited two; a third of the same kind was found during the port and stripped for the same reason): `STORE_SENTINEL = ".open-design-download-root.json"` → `".jini-download-root.json"`, `STORE_KIND = "open-design-managed-download-root"` → `"jini-managed-download-root"`, and `MANIFEST_KIND = "open-design-managed-download"` (not explicitly named in r2-packages.md's two-string summary, but the same category of cosmetic identity string) → `"jini-managed-download"`. These three strings are the only OD-identity content in the entire file — every other line is generic download-store logic with zero product coupling, matching recon's "Classification: GENERIC-RUNTIME" call. |
| `src/download.test.ts` | `packages/download/tests/index.test.ts` | Ported near-verbatim (all 13 tests: copy-and-clear, Range resume, Range-unsupported fallback, checksum-mismatch fast-fail, same-process dedup + progress fan-out, per-caller abort without killing the shared transfer, stale-pid-lock clearing, Windows pid-reuse lock clearing, alive-lock fast-fail, output-conflict refusal, explicit remove, default-window pruning, tampered-file suspicious-reset-and-redownload) — only the temp-dir prefix (`od-download-` → `jini-download-`) and the import path (package import → sibling `./download.js`) changed. Placed beside `download.ts` per this package's per-file test convention (see `asset-cache.test.ts`), not folded into the barrel-completeness `index.test.ts`. |

Folded into the **existing** `@jini/platform` package (a new `src/download.ts`
file, plus the barrel `index.ts` re-exporting its public surface) rather than
a new package, per the task brief: its only workspace dependency is this
package, and it sits alongside the existing `fs.ts` file-primitives module
(same "generic OS/file primitives" charter, no new build/publish surface
needed).

**Strictness-only edits** (same category as the ones already documented
above for `proxy-env.ts`/`toolchain.ts`, no behavior change): Jini's
`tsconfig.base.json` sets `exactOptionalPropertyTypes: true`, which OD's own
`tsconfig.json` does not. This surfaced eight sites where an optional field
was explicitly assigned a possibly-`undefined` value (`DownloadManifest.
totalBytes`/`.validators`, `DownloadAttemptResult.totalBytes`,
`writeResponseBodyToPartial`'s and `downloadWithRetries`'s/`runManagedDownload`'s
options `totalBytes?`/`requestHeaders?`, and the test file's `sendBody`
helper's `delayMs?`) — every one fixed by widening the field's declared type
to explicitly include `| undefined` (`T | undefined` instead of bare `T` on
an already-optional `?:` field), which is behaviorally identical at runtime.
One site (`downloadFromZero`'s `fetchImpl(target.url, { headers:
requestHeaders })`) couldn't be fixed by widening because `RequestInit` is a
library-defined type this package doesn't own; that call site was changed to
a conditional spread (`...(requestHeaders == null ? {} : { headers:
requestHeaders })`) instead of always including the `headers` key, matching
the conditional-spread pattern already used throughout this same file for
the identical reason (e.g. `cleanupWarning`).

## Dependencies

No new dependency — `download.ts` uses only `node:crypto`/`node:fs`/
`node:fs/promises`/`node:path`/`node:stream`/`node:stream/promises` builtins
plus this package's own `fs.ts`/`process.ts` exports.

## Addendum: `shell.ts` (2026-07-18)

Sourced from `leonaburime-ucla/open-design`'s `refactor/web-memory-slice`
branch (cloned fresh to `/tmp/od-source`), `apps/daemon/src/services/
login-shell.ts` (72 LOC). Per `ADS-memory/reports/jini-port/recon/r1-daemon.md` TASK 1's
`services/` row: `login-shell.ts` was called out as the one generic file in
that directory (the sibling `plugin-installation`/`plugin-share-tasks`/
`whats-new`/`open-design-public-metadata` files are OD-product and were not
ported). Confirmed on read: the file has zero OD imports/nouns — it is a
pure `child_process.execFile` buffering helper plus a login-shell PATH
re-entry wrapper, with `gh` (GitHub CLI) as its only domain-flavored mention,
and `gh` is a generic third-party tool name, not an OD product noun.

| Jini file | Origin | Transform |
|---|---|---|
| `src/shell.ts` | `apps/daemon/src/services/login-shell.ts` | `execFileBuffered` and `execCommandViaLoginShell` ported near-verbatim (renamed `execCommandViaLoginShell`'s field order/style to match this package's conventions; no behavior change). **Not ported:** `execGhBuffered` — it was a 3-line specialization (`execCommandViaLoginShell('gh', args, opts)`); folding it into the generic function removes a redundant single-callsite wrapper rather than hardcoding a specific CLI name into the engine. Callers that need the old behavior call `execCommandViaLoginShell('gh', args, opts)` directly. **Default shell changed:** the origin hardcoded `/bin/zsh` as the fallback when `$SHELL` is unset/blank (a macOS-specific assumption — zsh is the default login shell on macOS since Catalina). A product-neutral engine can't assume a macOS host, and `/bin/zsh` is not guaranteed to exist on Linux; `/bin/sh` is POSIX-guaranteed present on any POSIX host, so the fallback was changed to `/bin/sh`. This is a deliberate, documented behavior change (not a byte-identical move) — the common case (`$SHELL` set) is unaffected. |

## Dependencies

No new dependency — `shell.ts` uses only the `node:child_process` builtin.
## 2026-07-18 addition — `aws-sigv4.ts` + `blob-storage.ts`

Task brief: port `apps/daemon/src/storage/aws-sigv4.ts` (per
`ADS-memory/reports/jini-port/recon/r1-daemon.md`'s TASK 1: "generic") and resolve
`project-storage.ts`'s "leans OD" flag (verify and either drop or extract a
generic core). Origin: real `leonaburime-ucla/open-design` fork clone
(`/tmp/od-source`), `apps/daemon/src/storage/{aws-sigv4,project-storage}.ts`
on `main`.

| Jini file | Origin file | Transform |
|---|---|---|
| `src/aws-sigv4.ts` | `apps/daemon/src/storage/aws-sigv4.ts` | `signSigV4`/`encodeS3PathSegment` + types, logic verbatim (pure `node:crypto` SigV4 signer, zero OD nouns in the implementation). **Identity-stripped**: one comment ("the OD daemon ships without an extra 60+ MB of SDK code") reworded to "a host daemon ships without" — prose only. |
| `src/blob-storage.ts` | `apps/daemon/src/storage/project-storage.ts` | See "Design decision" below — the generic ~90% of the file (interface + both backends), renamed and with `projectId` generalized to `namespace` throughout. `resolveProjectStorage()` (the OD-env-var factory) was **not ported** — see below. |

## Design decision: `project-storage.ts` was split, not ported wholesale or dropped

The task brief asked to verify the recon's "leans OD" flag on
`project-storage.ts` firsthand and either drop it or extract a generic core
with OD's project-specific parts as an adapter, "depending on what you
actually find." Read in full: the `ProjectStorage` interface,
`LocalProjectStorage`, and `S3ProjectStorage` classes carry no OD nouns in
their own logic — they're a backend-agnostic blob CRUD port (read/write/
list/delete/stat under a scoping key) plus a local-disk and an
S3-compatible implementation, both traversal-guarded. The **only** OD
coupling in the file is the bottom `resolveProjectStorage()` factory
function, which reads `OD_PROJECT_STORAGE`/`OD_S3_BUCKET`/`OD_S3_REGION`/
`OD_S3_PREFIX`/`OD_S3_ENDPOINT`/`OD_S3_ACCESS_KEY_ID`/
`OD_S3_SECRET_ACCESS_KEY`/`OD_S3_SESSION_TOKEN` directly from `process.env`.

**Extracted, not dropped:** the interface + both implementations, ported to
`src/blob-storage.ts` as `BlobStorage`/`BlobFileMeta`/`LocalBlobStorage`/
`S3BlobStorage`/`S3BlobStorageOptions`/`StorageError`, with every
`projectId: string` parameter renamed to `namespace: string` — per
extraction-plan.md's Task-4 Port-2 finding ("OD's 'project' is a product
model; engine needs a generic workspace/session store interface") and §2.1's
"Runs key on an opaque `contextRef`, never `projectId`" convention, "project"
specifically is flagged elsewhere in this porting effort as OD's noun, not
the engine's — `namespace` carries no domain meaning here beyond "a
top-level grouping/scoping key," which is what the parameter actually is
structurally (nothing in `LocalBlobStorage`/`S3BlobStorage`'s logic assumes
it means a design project).

**Dropped, not ported:** `resolveProjectStorage()`. This is OD adapter
wiring — a specific env-var-naming convention and the choice to read
`process.env` directly inside the engine layer — not generic engine
behavior. It has no equivalent anywhere else in this porting session's
established pattern (`createSqliteEventLog`, `LocalBlobStorage`,
`S3BlobStorage` are all called with explicit constructor arguments; none of
`@jini/*`'s existing adapters read `process.env` inside their own
constructors). A Jini host application composes its own equivalent
(`new LocalBlobStorage(root)` or `new S3BlobStorage({ bucket, region,
credentials, ... })` called directly, with whatever env-var convention that
host prefers) rather than inheriting OD's `OD_S3_*` names or its
env-selection shape.

Landed in `@jini/platform`, not `@jini/sqlite`: this is a filesystem/network
blob-storage primitive with no SQL involvement, parallel to this package's
existing `fs.ts` (path containment / atomic copy) and `http.ts` (readiness
polling) roles — `@jini/sqlite` is reserved for the `EventLog` port adapter
and `better-sqlite3`-specific helpers (`db-inspect.ts`,
`backend-config.ts`), none of which this needs. `aws-sigv4.ts` lives
alongside it in the same package since it's `S3BlobStorage`'s only
dependency and has no other consumer yet.

## Tests

`src/aws-sigv4.test.ts` and `src/blob-storage.test.ts`, written fresh for
this port (OD's `project-storage.ts`/`aws-sigv4.ts` had no co-located test
files in the source tree to port from) — canonical-request/signature-shape
assertions with a fixed clock for `aws-sigv4.ts`; real-filesystem
(`mkdtempSync`) round-trip + traversal-guard + non-ENOENT-failure coverage
for `LocalBlobStorage`; a stubbed `fetchFn` (mocked `Response`-shaped
objects, including pagination, malformed/missing-field list-XML, and a
`text()`-throws case) for `S3BlobStorage`.

## Dependencies

No new dependency — `aws-sigv4.ts` uses only `node:crypto`; `blob-storage.ts`
uses only `node:path`/`node:fs/promises` plus `aws-sigv4.ts` and the global
`fetch` (Node 18+ built-in, matching the origin's `globalThis.fetch` default).

## 2026-07-22 addition — genuine 100%-minus-3-provably-unreachable-branches coverage (audit fix, coverage pass)

Per this task's standing "check every other package with a source-map.md for
coverage gaps beyond the named list" rule: `packages/platform` and
`packages/sidecar` were discovered mid-sweep, not in the original named list.
A prior step in this same task added `isRoot`-guarded `it.skipIf` around
this package's `chmod(0o000)`-based permission-denial tests (root's
CAP_DAC_OVERRIDE bypasses directory/file permission bits, so those tests
cannot work under root) in `download.test.ts` (2 tests) and `index.test.ts`
(2 tests) — see each file's own `isRoot` comment. That removed the *only*
coverage those specific branches had. This entry documents closing those
gaps for real, plus the large pool of separate, pre-existing gaps the
`vitest.config.ts` comment this replaces had explicitly deferred
(asset-cache.ts's ~36 branches, download.ts's ~52 branches).

**Method used for every chmod-regression gap**: `vi.mock("node:fs/promises",
...)` at the top of the test file, wrapping the specific functions needed
(`stat`/`writeFile`/`rename`/`rm`/`lstat`/`mkdir`/`copyFile`/`readFile`) in
`vi.fn(actual.fn)` (default: real behavior), then
`.mockImplementationOnce`/`.mockImplementation` per test to inject a
real-shaped error (`Object.assign(new Error(...), { code: 'EACCES' })` etc.)
or a deterministic race. **Verified empirically this session, twice, before
settling on this**: `vi.spyOn` on an imported `node:fs/promises` namespace
object fails outright (`Cannot redefine property` — its named exports are
frozen ESM module-namespace bindings); `vi.spyOn`/direct-mutation on
`node:fs`'s own `.promises` object (this repo's `packages/memory/
note-store.test.ts` precedent) does NOT reach a *different* file's plain
`import { stat } from "node:fs/promises"` destructured call sites under this
repo's actual vitest/esbuild transform (confirmed by a failing test before
switching to `vi.mock`) — that precedent only works when the *same* file
that's mocked also does the property-access call (`fsp.lstat(...)`), which
`fs.ts`/`download.ts` don't. `vi.mock` replacing the whole module for every
importer in the test file's graph is what actually works here, and is now
this package's own documented precedent for it.

**`index.test.ts`** (fs.ts's `atomicCopyFile`/`removePathBestEffort`):
- The `isRoot`-skipped "propagates a non-ENOENT error from the destination
  existence check" and "reports the failure message when a best-effort
  removal itself fails" tests were each duplicated as a real, always-run
  `vi.mock`-based test reaching the identical code path.
- `fs.ts`'s own private `errorCode`/`errorMessage` helpers had two further
  gaps *not* caused by the chmod regression (pre-existing, just never
  flagged because the file was otherwise thin on tests): `errorCode`'s
  "no `code` property at all" branch and "`code` present but null" branch
  (real Node fs errors never hit either — a thrown value can lack `.code`
  entirely, or carry an explicit `null`), and `errorMessage`'s non-`Error`
  branch. All three closed with `vi.mock`-injected synthetic errors.
- `fs.ts`: **100/100/100/100**.

**`download.test.ts`** (55 pre-existing branch gaps + the 2 chmod-regression
ones, all closed):
- The 2 `isRoot`-skipped tests ("gives up when the download state keeps
  resetting", "records a warning when a prunable entry cannot be removed")
  each got a `vi.mock`-based always-run twin.
- **Found a third, previously-undetected instance of the same root bug**,
  *not* already marked skip: "propagates a non-lock-contention error while
  acquiring the download lock" used `chmodSync(locksDir, 0o000)` and asserted
  only `.rejects.toThrow()` — under root the lock write actually *succeeds*
  (verified: a direct `fs.writeFileSync(..., {flag:'wx'})` into a `0o000`
  directory succeeds as root), so the test was passing for the wrong reason
  entirely (the subsequent fetch to a bogus host throws instead), never
  exercising `acquireLock`'s non-EEXIST `throw error;` passthrough at all.
  Renamed the original to `.skipIf(isRoot)` (kept for non-root environments)
  and added a `vi.mock`-based twin that reaches the real line.
- Two `noUncheckedIndexedAccess`-driven dead `?? `/re-validation branches
  removed via real refactors, matching this file's own pre-existing
  "Strictness-only edits" precedent above: `isPrivateAddress`'s fam-4 octet
  re-validation (`net.isIP(addr) === 4` already guarantees a valid 4-octet
  0-255 dotted-quad — empirically fuzz-verified 650k+ candidate strings,
  zero divergences, across both packages) collapsed to non-null assertions;
  `downloadCopyAndClear`'s redundant `isAbsolute(outputPath)` check after
  `resolve()` removed (same "`resolve()` always returns absolute" guarantee
  `normalizeBasePath` above already documents); `lockBelongsToCurrentProcess`'s
  `lock.pid !== process.pid` re-check removed (its only caller,
  `isLockProcessAlive`, already gates the call behind that exact condition);
  `releaseCopyLease`'s `state == null` guard converted to a non-null
  assertion with a comment (both `acquireCopyLease`/`releaseCopyLease` are
  fully synchronous — no `await` inside either — so there is no interleaving
  window in which the map entry could be missing at release time).
- `emitExistingProgress`'s `totalBytes: number | undefined` parameter made
  required (`number`) — its only call site always resolves a definite number
  through a `??` chain ending in arithmetic, never `undefined` — removing a
  dead spread branch instead of forcing a synthetic caller.
- One *new* real bug/gap discovered in `targetFromOptions`'s SSRF-adjacent
  path-escape guard while investigating whether it was dead code (initial
  hypothesis, later disproven by a 300k-segment fuzz — see below): it is
  genuinely reachable. `normalizeSegment` only rejects a segment that is
  *exactly* `.`/`..`, not one that merely *starts* with `..` (e.g. `"..evil"`
  is a syntactically ordinary filename); `pathContains`'s own
  `!rel.startsWith("..")` check (`fs.ts`) is a naive string-prefix test, not
  path-component-aware, so it (correctly, for its own deliberately paranoid
  design) flags such a segment. Added a real test (`bucket: "..evil"`) and a
  corrected inline comment (an earlier draft of this comment wrongly
  documented this as dead code before the fuzz disproved it).
- ~45 further real branch-gaps (resume/retry math, `parseContentRange`
  edge cases, `validatorsFromResponse`/`validatorsConflict` combinations,
  `contentLength`'s malformed/missing-header cases, lock-file shape/type
  guards, `loadReusableState`'s artifact-without-manifest / complete-without-
  file / hash-matches-but-stat-fails races, the post-reset "kept resetting"
  and "found a result immediately" branches, the post-promotion
  vanished-file race, `downloadCopyAndClear`'s fresh-copy checksum mismatch
  and cleanup-failure-warning branches) closed with real tests — either
  through the real HTTP fixture/injected-`fetch` seam already used
  throughout this file, or (where no seam reaches a genuine race window)
  `vi.mock`-based deterministic reproductions of that exact race, matching
  this file's own pre-existing "vanishing partial" precedent
  (`fails the download when the freshly-written partial file disappears...`).
- **One branch confirmed genuinely unreachable** (`acquireLock`'s `for(;;)`
  loop-tail — V8 instruments the closing brace even though every path out of
  the loop body is a `return`/`throw`, per the pre-existing code comment
  right above the loop, now cross-referenced from both places).
- `download.ts`: **99.87/98.92/100/99.87** (1 branch: the loop-tail above).

**`asset-cache.test.ts`** (the 1 chmod-regression pair — `download.test.ts`
above — plus ~36 pre-existing branch gaps in this file, all closed):
- `expandIpv6` exported (previously module-private) for direct unit testing
  — its only real caller (`isPrivateAddress`) gates every call behind
  `net.isIP(addr) === 6`, and Node's `isIP` already fully validates IPv6
  syntax (including embedded-IPv4-tail octet ranges) before returning 6 —
  empirically re-verified this session by fuzzing ~10k `isIP`-accepted v6
  literals through `expandIpv6`'s guards with zero hits — so none of its
  parse-failure guards are reachable through that real path. Exported and
  directly tested instead, matching this file's own `readBodyCapped`
  abort-parameter precedent (a real, useful function contract worth testing
  on its own terms, independent of what today's one caller happens to
  exercise).
- A cluster of `noUncheckedIndexedAccess`-driven dead `?? `/regex-capture-
  group fallbacks inside `expandIpv6`/`isPrivateAddress`/`resolveContentType`
  collapsed to non-null assertions (all provably safe: `String#split` always
  returns a non-empty array; a successful regex match's mandatory capture
  group is always defined; array indices already bounds-checked by the
  immediately-preceding validation) — same "Strictness-only edits" pattern
  as above, applied here for the first time to this (Jini-native, not
  OD-ported) file.
- `createValidatingLookup`'s 2-arg `dns.lookup` call form (`lookup(hostname,
  callback)`, `options` position doubling as the callback), the
  `options===null`/`undefined` `?? {}` fallback, a raw lookup error
  passthrough, and an `all:true` result whose entries are bare address
  strings rather than `{address}` objects — all real behavior with no prior
  test — closed with new tests against the existing `run()` harness.
- `createAssetCache`'s default (un-injected) `fetchImpl`, a corrupted/
  non-string on-disk `contentType` sidecar, a response with no
  `content-type` header at all, a `!value` (falsy, non-empty-array) stream
  chunk (via a duck-typed fake `body.getReader()`), a non-`Error` fetch
  rejection, and a genuinely reachable 415 (a URL whose *query string* ends
  in a recognized extension passes the up-front cacheability check even
  though its actual pathname extension doesn't) — all closed with new tests.
- **One branch confirmed genuinely unreachable**: `isPrivateAddress`'s
  `if (!groups) return true;` fallback for a `expandIpv6(addr)` that returns
  `null` for an `addr` that `net.isIP` already classified as family 6 — kept
  as real defense-in-depth (fail-closed against a future divergence between
  Node's parser and this file's own) rather than asserted away, backed by
  the same ~10k-literal fuzz above.
- `asset-cache.ts`: **100/99.43/100/100** (1 branch: the `!groups` fallback
  above).

**`proxy-env.ts`** (no chmod involvement — 5 purely pre-existing gaps,
found during the sweep, unrelated to the root regression):
- `defaultSystemProxyCommandRunner` (the real, un-injected `execFileSync`
  default) had zero coverage: the one test aimed at it silently no-op'd on
  any non-darwin host (`if (process.platform !== 'darwin') return;`) instead
  of using `it.skipIf` — fixed by forcing `platform: 'darwin'` explicitly
  (the real default runner still executes for real; `scutil` failing on a
  non-darwin CI host is caught by `tryRun`, which is the behavior under
  test, not an obstacle to it) and adding a second test for the
  `options.platform ?? process.platform` fallback itself.
  `resolveSystemProxyEnv`: was untested past its injected-`runCommand`
  seam; now genuinely exercises the default.
- `normalizeProxyUrl`/`normalizeAuthorityProxyUrl`'s own empty-input guards
  removed (real refactor, not padding): each function's only real call
  site(s) already guarantee a non-empty, trimmed input before calling them
  (`normalizeHostPortProxyUrl`'s own `!trimmedHost || !trimmedPort` check;
  `parseWindowsInternetSettingsProxyOutput`'s `!kind || !value` /
  `!proxyServer.trim()` checks) — both return types narrowed from
  `string | null` to `string` accordingly.
- The "value already has a scheme" side of `normalizeProxyUrl`'s ternary
  (reachable via a malformed-but-real scutil `HTTPProxy`/`HTTPPort` pair
  that composes into an already-schemed string) — closed with a new test.
- **One branch confirmed genuinely unreachable**:
  `resolveSystemProxyEnv`'s outer `catch`. `tryRun` already swallows every
  `runCommand` failure, and neither parse function (nor anything either
  calls) performs any operation that can throw for a string input — no
  `new URL`, no `JSON.parse`, no untrusted-input `RegExp` construction.
  Empirically verified this session: 200k fuzzed `stdout`/registry-value
  strings (control characters, null bytes, huge lengths) through both parse
  functions via a throwaway `tsx` script, zero throws.
- `proxy-env.ts`: **99.35/99.3/100/99.35** (2 lines: the outer catch above).

**Package-wide, verified personally this session**: `pnpm --dir
packages/platform exec tsc --noEmit`: clean. `pnpm --dir packages/platform
run test:coverage`: **429 tests (424 passed, 5 skipped — the 4
already-`isRoot`-skipped chmod tests plus the 1 newly-discovered
false-positive-under-root one described above, each with a real,
always-run `vi.mock`-based twin providing the actual coverage), genuine
99.89/99.54/100/99.89 package-wide** — every uncovered branch remaining is
one of the 3 documented above, each independently, empirically verified
unreachable this session (not inherited from an earlier claim). `pnpm --dir
packages/platform run build`: clean. `vitest.config.ts`'s committed
threshold raised from 98/91/98/98 to 99/99/100/99 (a small margin under the
real numbers, matching `packages/registry/vitest.config.ts`'s own
just-under-measured convention, to leave room for the 3 permanently-
unreachable branches without the threshold silently sliding if a future
change reduces real coverage elsewhere).
