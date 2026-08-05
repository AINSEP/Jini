# R2 — packages/ recon for the "Jini" engine extraction

Repo: `/Users/la/Desktop/Programming/OSS-Repos/open-design` (READ-ONLY). Branch `refactor/web-memory-slice`.
Scope: all 14 `packages/*`. Evidence = package.json deps + grep over each `src/`. "Verified" = read/grepped directly; "Inferred" = judgment from naming/comments.

Legend for classification:
- **PURE-TS** — no runtime deps beyond zod/workspace-type-only; no Node/browser/React; portable as source.
- **GENERIC-RUNTIME** — uses Node builtins or generic infra (fs/net/crypto/zip), but the logic is domain-neutral; portable.
- **OD-COUPLED** — encodes Open Design product assumptions (constants, env var names, product DTOs) that a generic engine would not want verbatim.

Note: "PURE-TS" (technical portability) is orthogonal to "OD-domain coupling" (semantic reuse). `contracts` is technically pure TS yet the single most OD-coupled package by domain. Both axes are called out per package.

---

## Per-package findings

### 1. `@open-design/contracts`  — the app contract layer
- **Purpose (verified):** web/daemon shared DTOs, SSE event unions, error shapes, task shapes, analytics event schemas, prompt strings, plugin/design-system/agent-tool contracts. 95 files, ~18,100 LOC — by far the largest.
- **Deps:** `zod@3.25.76` (runtime), `@open-design/release` (workspace). Verified `release` is used in **exactly one file as a type-only import** (`src/analytics/events/result-events.ts:6` `import type { ReleaseChannel }`) — trivially severable.
- **Runtime surfaces:** No Node/browser/React/Next imports. The earlier grep "browser=22 / sqlite=2 / express=3" is **all false positives** — verified they are: (a) prose comments, (b) *string literal payloads* of browser JS the AI is instructed to emit (`src/prompts/deck-framework.ts`, `official-system.ts` contain `window`/`document`/`localStorage` inside template strings), and (c) DTO field names (`document:` project kind, `colorExpressions`). No actual DOM/SQLite/Express runtime use. Only non-relative runtime imports are `zod` and the one `release` type. → **technically PURE-TS.**
- **OD coupling: HIGH (81/95 files touch OD product concepts).** This is the product's ontology: `api/` folder has 40 endpoint DTO files (see below), plus `design-systems/`, `plugins/`, `agent-tools/`, `prompts/` (full OD system prompts), `analytics/events/` (OD-specific event names). Not a generic engine surface.
- **Classification: PURE-TS but OD-COUPLED by domain.** A Jini engine would keep the *pattern* (a pure zod DTO package) but rewrite most content. Only a thin generic core (SSE envelope shapes in `sse/common.ts`, `common.ts`, `errors.ts`, `tasks.ts`, generic `agent-tools/` registry port) is reusable near-verbatim.

#### contracts `src/` subdirs (verified)
- `api/` (40 files): agent-sessions, amrWallet, app-config, artifacts, attribution, automations, brands, chat, comments, community, connectionTest, connectors, context, export, figma, files, finalize, github, handoff, host-tools, library, live-artifacts, mcp, media, memory, orbit, plugin-candidates, projects, providerModels, proxy, reasoningExecution, registry, research, routines, run-completeness, social-share, terminals, version, whats-new, workspaces. → Almost all are **OD product endpoints** (figma, brands, orbit, amrWallet, media, whats-new are product-specific). Generic-ish: `chat`, `files`, `mcp`, `context`, `proxy`.
- `analytics/` (events/, observability, public-params, artifact-id): OD event taxonomy — OD-coupled.
- `sse/` (chat, common, proxy): stream envelopes — `common.ts` is the most reusable generic piece.
- `agent-tools/` (actions, descriptor, manifest, registry, task): agent-tool registry port — **generic-ish**, docblock explicitly says "MUST NOT import apps/*". Good engine candidate.
- `plugins/`, `design-systems/`, `prompts/`, `artifacts/`, `runtime/`, plus root `common.ts`, `errors.ts`, `critique.ts`, `examples.ts`, `execution-profile.ts`, `tasks.ts`, `index.ts`. `prompts/` and `design-systems/` are pure OD product content.
- **Files flagged (encode OD-only shapes / non-generic):** all of `prompts/*` (OD system prompts), `design-systems/*`, `analytics/events/*` (OD event names), `api/{figma,brands,orbit,amrWallet,media,whats-new,community,social-share}.ts`. None import anything non-pure; the coupling is semantic, not technical.

### 2. `@open-design/platform` — generic OS process primitives
- **Purpose (verified):** stamp serialization, command parsing, process matching/search, atomic file copy (`atomicCopyFile`), `pathContains`, `isProcessAlive`, user-toolchain bin discovery (`toolchain.ts`).
- **Deps:** none (zero runtime deps). Node builtins: `fs`, `fs/promises`, `os`, `path`, `timers/promises` (6 files).
- **OD coupling: MINIMAL.** Grep found only **doc-comment** references ("GUI-launched daemon", "See open-design issue"). No `OD_`/`--od-stamp` string constants live here (AGENTS.md confirms it *consumes* the sidecar-proto descriptor rather than hard-coding stamp details). `@module @open-design/platform` in the barrel is just the package name.
- **Classification: GENERIC-RUNTIME.** Drop-in portable; only rename the package + scrub doc comments.

### 3. `@open-design/sidecar` — generic sidecar runtime
- **Purpose (verified):** bootstrap, JSON-IPC transport (`json-ipc.ts`, unix `node:net` sockets), path/runtime resolution (`paths.ts`), launch env, JSON runtime files. 9 files.
- **Deps:** none. Node builtins: `fs/promises`, `net`, `path`.
- **OD coupling: LOW-MODERATE.** `paths.ts` header admits "Open Design-specific strings are hardcoded here" and builds `/tmp/open-design/ipc/<namespace>/<app>.sock` layout; trace env var `OD_JSON_IPC_TRACE`; log tag `[open-design sidecar]`. These are string constants, not structural.
- **Classification: GENERIC-RUNTIME (with a thin OD string layer).** The IPC transport + runtime-file mechanics are fully generic; a handful of hardcoded path/env strings need parameterizing. Small de-coupling.

### 4. `@open-design/sidecar-proto` — OD sidecar business protocol
- **Purpose (verified):** app/mode/source constants, namespace validation, stamp descriptor (5 fields), IPC message schema, status shapes, default product path constants. 1 file, 933 LOC.
- **Deps:** `@open-design/release` (workspace). No Node builtins.
- **OD coupling: HIGH by design.** Verified constants: `OD_SIDECAR_*` / `OD_PORT` env keys, `--od-stamp-{app,ipc,mode,namespace,source}` flags, `ipcBase: "/tmp/open-design/ipc"`, `windowsPipePrefix: "open-design"`, `OPEN_DESIGN_PRODUCT_NAME = "Open Design"`, `OD_REQUIRE_DESKTOP_AUTH`. This package *is* the OD naming layer that keeps `sidecar`/`platform` generic.
- **Classification: OD-COUPLED (intentionally).** Portable as *shape/template* but every constant is product identity → in Jini it becomes `@jini/sidecar-proto` with renamed constants. Technically pure TS, small mechanical rename, but it is the OD-identity chokepoint.

### 5. `@open-design/host` — renderer host-bridge protocol
- **Purpose (verified):** `window.__od__` host-bridge wire protocol + types, bridge detection/validation, adapter-result normalizers, renderer action wrappers, test mock (`testing.ts`). 6 files, ~1030 LOC.
- **Deps:** `@open-design/release` (workspace). No Node; `browser=3` = references `globalThis`/global scope for the bridge (expected for a renderer bridge), no DOM API dependence.
- **OD coupling: HIGH.** Everything is named `OpenDesignHost*` (`OPEN_DESIGN_HOST_GLOBAL`, `OpenDesignHostBridge`, updater/capture/project/pdf/pet/shell namespaces). Models OD-desktop-specific capabilities (project import, PDF print, screen capture, updater, "pet").
- **Classification: OD-COUPLED.** Pure TS, but the entire surface is OD desktop-shell capabilities. Medium de-coupling if Jini wants a host bridge; otherwise drop.

### 6. `@open-design/components` — shared React UI primitives
- **Purpose (verified):** `Button`, `Dialog`(+sub-parts), `Input`/`Select`/`Textarea`, `VisuallyHidden`, `class-names` util, CSS Modules. 8 src files (+ .module.css), ~244 LOC.
- **Deps:** none runtime; `react@18.3.1` peer dep only.
- **OD coupling: COSMETIC ONLY.** No product concepts; the sole hits are `.od-select*` CSS class names in `styles.css` (namespace prefix). No `__od__`, no daemon, no product logic.
- **Classification: GENERIC-RUNTIME (React primitives).** Near drop-in; only rename `.od-*` CSS classes. Smallest-effort React package.

### 7. `@open-design/plugin-runtime` — plugin/skill resolution engine
- **Purpose (verified):** pure plugin/skill manifest parsing (frontmatter, manifest, marketplace), digest, merge, resolve, validate, adapters for `agent-skill` and `claude-plugin`, pipeline fallback. 11 files, ~1055 LOC. Header: "This module is pure — no fs, no SQLite, no network."
- **Deps:** `@open-design/contracts` (workspace, for `PluginManifest`/`PluginPipeline` types), `zod`. Node builtin: `crypto` in 1 file (digest hashing).
- **OD coupling: MODERATE.** Logic is generic plugin-resolution, but it speaks OD's skill/design-system/craft vocabulary and imports OD contract types (`resolve.ts` references `od.design_system.requires`, active-project design system). The sqlite=1/express=1 grep hits were comments only.
- **Classification: GENERIC-RUNTIME, moderately OD-coupled via contracts types.** Portable engine core but drags a `contracts` type slice; medium de-coupling (define engine-local plugin types).

### 8. `@open-design/agui-adapter` — AG-UI ↔ OD event adapter
- **Purpose (verified):** projects OD native event union onto the AG-UI canonical wire shape. 3 files, 312 LOC.
- **Deps:** `@open-design/contracts` (workspace). No Node/browser.
- **OD coupling: MODERATE (adapter by nature).** One side is the OD native event union (from contracts), the other is the standard AG-UI protocol. Value is in the AG-UI mapping.
- **Classification: PURE-TS, OD-coupled on the input side.** Portable pattern; the OD-event half must be re-pointed at Jini's event union. Medium.

### 9. `@open-design/release` — release-domain primitives
- **Purpose (verified):** channel names, version parse/format, platform enum, app-identity data. 1 file, 236 LOC. No files/network.
- **Deps:** none. No Node builtins.
- **OD coupling: HIGH (identity data).** Hardcodes `PRODUCT_NAME = "Open Design"`, `DEFAULT_NAMESPACE = "open-design"`, `appId: "io.open-design.desktop.*"`, channel identity.
- **Classification: PURE-TS but OD-COUPLED.** The channel/version *algorithms* are generic; the identity constants are product data. Small rename if Jini ships releases; otherwise not an engine concern.

### 10. `@open-design/launcher-proto` — packaged-launcher protocol
- **Purpose (verified):** launcher schema version, `--od-launcher-*` flags, channel mapping, path resolution. 1 file, 492 LOC.
- **Deps:** `@open-design/release` + `@open-design/sidecar-proto` (workspace). Node builtin: `path`.
- **OD coupling: HIGH.** `--od-launcher-after-quit` flags, depends on the two most OD-identity packages.
- **Classification: OD-COUPLED (packaged-app plumbing).** Not an engine candidate — it's desktop-packaging glue.

### 11. `@open-design/download` — managed-download engine
- **Purpose (verified):** managed download store with atomic copy, lock, prune, remove, manifest, registry, transfer. 16 files, ~1651 LOC.
- **Deps:** `@open-design/platform` (workspace). Node builtins: `crypto`, `fs`, `fs/promises`, `path`, `stream`, `stream/promises` (10 files).
- **OD coupling: COSMETIC.** Only sentinel/kind string constants: `.open-design-download-root.json`, `open-design-managed-download-root`. Otherwise a generic download store.
- **Classification: GENERIC-RUNTIME.** Portable; rename the sentinel strings. Small.

### 12. `@open-design/diagnostics` — diagnostics zip/redaction
- **Purpose (verified):** diagnostics contract (HTTP endpoint constants), JSON/text redaction, sources, manifest, zip builder, agent-logs. 7 files, ~679 LOC.
- **Deps:** `jszip@3.10.1` (runtime). Node builtins: `fs/promises`, `os`, `path` (3 files).
- **OD coupling: LOW.** `DIAGNOSTICS_FILENAME_PREFIX = "open-design-diagnostics"`, daemon-endpoint comments. Redaction/zip logic is generic.
- **Classification: GENERIC-RUNTIME.** Portable; rename prefix. Small.

### 13. `@open-design/metatool` — build-metadata helpers
- **Purpose (verified):** hash/check/write mechanics for repo-local tool build outputs (`meta.json`). 2 files, 195 LOC.
- **Deps:** `zod`. Node builtins: `crypto`, `fs/promises`, `path`, `url`.
- **OD coupling: NONE (grep: 0 od-concept files).** Fully generic build-metadata tooling.
- **Classification: GENERIC-RUNTIME.** Drop-in; likely not needed by an engine (it's repo build tooling), but zero coupling.

### 14. `@open-design/registry-protocol` — registry schemas
- **Purpose (verified):** backend + zod schemas for a registry protocol. 3 files, 199 LOC.
- **Deps:** `zod`. No Node/browser.
- **OD coupling: NONE (grep: 0 od-concept files).**
- **Classification: PURE-TS.** Drop-in. (Inferred: generic marketplace/registry protocol; confirm its schema semantics before assuming Jini needs it.)

---

## Dependency graph (workspace edges, verified from package.json)

```
release            <- (no workspace deps)  [leaf]
platform           <- (no workspace deps)  [leaf]
sidecar            <- (no workspace deps)  [leaf]
components         <- (no workspace deps)  [leaf, react peer]
metatool           <- (no workspace deps)  [leaf]
registry-protocol  <- (no workspace deps)  [leaf]

sidecar-proto      -> release
host               -> release
launcher-proto     -> release, sidecar-proto
download           -> platform
contracts          -> release (type-only, 1 file)
plugin-runtime     -> contracts
agui-adapter       -> contracts
```

Key observations:
- `release` and `contracts` are the two most-depended-on internal roots. `release` is a tiny leaf pulled in by `sidecar-proto`, `host`, `launcher-proto`, `contracts`. Renaming its identity constants ripples widely but mechanically.
- `contracts` is the semantic hub for the agent/event layer (`plugin-runtime`, `agui-adapter` depend on it). Extracting a Jini event/plugin engine means first carving a generic core out of `contracts`.
- `platform` and `sidecar` are clean leaves — the highest-value drop-in engine primitives.

---

## Reuse-readiness ranking (drop-in → needs work)

**Tier A — drop-in / trivial (rename strings only):**
1. `platform` — GENERIC-RUNTIME, only doc comments mention OD. **Effort: small.**
2. `metatool` — zero OD coupling. **Effort: small** (may be unneeded).
3. `registry-protocol` — PURE-TS, zero coupling. **Effort: small.**
4. `components` — React primitives, only `.od-*` CSS class names. **Effort: small.**
5. `download` — generic store, 2 sentinel strings. **Effort: small.**
6. `diagnostics` — generic zip/redaction, 1 prefix string. **Effort: small.**

**Tier B — portable with a thin de-coupling layer:**
7. `sidecar` — generic IPC/runtime; parameterize hardcoded `/tmp/open-design` paths + `OD_*` trace env. **Effort: small–medium.**
8. `plugin-runtime` — pure resolution engine, but imports OD skill/design-system contract types. Define engine-local plugin types. **Effort: medium.**
9. `agui-adapter` — clean AG-UI mapping; re-point the OD-event input side. **Effort: medium.**

**Tier C — OD identity/product chokepoints (rename campaign, still pure TS):**
10. `sidecar-proto` — every constant is OD identity (`OD_*`, `--od-stamp-*`, "Open Design"). Mechanical rename but it's the identity source. **Effort: medium.**
11. `release` — channel/version algorithms generic; app-identity constants are product data. **Effort: small–medium.**
12. `host` — entire surface is `OpenDesignHost*` desktop-shell capabilities. **Effort: medium** (or drop if Jini has no desktop host).

**Tier D — product-semantic, not an engine surface as-is:**
13. `contracts` — technically PURE-TS but the OD product ontology (40 api DTOs, OD prompts, OD analytics, OD design-systems). Reusable *pattern*; only a thin generic core (`sse/common`, `common`, `errors`, `tasks`, `agent-tools/` registry) lifts cleanly. **Effort: large** (carve generic core out; rewrite the rest).
14. `launcher-proto` — packaged desktop-launcher glue (`--od-launcher-*`), depends on the two most OD-identity packages. **Effort: large / likely out of engine scope.**

Verified vs inferred: All classifications, deps, Node/React/browser usage, and OD-string evidence are **verified** by direct grep/read. "Effort" estimates and "likely unneeded / out of scope" judgments are **inferred** from purpose + coupling. The precise generic-vs-OD split *inside* `contracts` was sampled (api/ list + prompts/design-systems/analytics confirmed OD) but not exhaustively file-by-file across all 95 files.
