# R2b — `@jini/*` engine package design (extraction blueprint)

Builds on `r2-packages.md`. All partition/edge claims verified by grep over `packages/contracts/src`; effort/verdicts are inferred judgment. Read-only; no edits made.

Fresh-repo layout assumption:
- `packages/@jini/*` — the reusable engine (generic, product-neutral).
- `foundry/integrations/open-design/*` — OD-specific product contracts + identity adapters that consume `@jini/*`.

---

## 1. Final `@jini/*` package list

| `@jini/*` name | OD origin | One-line responsibility | Allowed deps | Forbidden | Stays in `foundry/integrations/open-design`? |
|---|---|---|---|---|---|
| `@jini/platform` | `platform` | Generic OS process/file primitives: stamp serialization, cmd parse, process match, atomic copy, toolchain bin discovery | Node builtins only | react, next, product constants | no (pure lift) |
| `@jini/components` | `components` | Headless React UI primitives (Button/Dialog/Input/Select/Textarea/VisuallyHidden) | react (peer) | Node, product logic, `.od-*` names | no |
| `@jini/metatool` | `metatool` | Build-metadata hash/check/write for tool dist outputs | zod, Node builtins | product constants | no (may be optional) |
| `@jini/registry-protocol` | `registry-protocol` | Zod schemas + backend types for a marketplace/registry protocol | zod | Node, product | no |
| `@jini/download` | `download` | Managed download store (atomic copy/lock/prune/manifest) | `@jini/platform`, Node builtins | product constants | no (rename sentinels) |
| `@jini/diagnostics` | `diagnostics` | Diagnostics bundle: JSON/text redaction + zip builder | jszip, Node builtins | product endpoints | no (rename prefix) |
| `@jini/sidecar` | `sidecar` | Generic sidecar runtime: JSON-IPC transport, path/runtime resolution, launch env | Node builtins | hardcoded product paths/env | no (parameterize paths) |
| `@jini/sidecar-proto` | `sidecar-proto` | **Neutral** sidecar business protocol: stamp descriptor (5 fields), namespace validation, IPC message schema, status shapes — with injectable product identity | `@jini/release` | hardcoded OD identity strings | identity values injected by OD adapter |
| `@jini/release` | `release` | Channel/version parse+format algorithms; app-identity via injected config | none | hardcoded product name/appId | identity data supplied by OD adapter |
| `@jini/protocol` | `contracts` (generic core) | Product-neutral wire core: JSON value types, error taxonomy, SSE transport envelope, task shapes, agent-tool registry | zod | `api/*` OD DTOs, prompts, analytics | no — this is the extraction prize |
| `@jini/plugin-runtime` | `plugin-runtime` | Pure plugin/skill manifest parse/merge/resolve/validate + adapters | `@jini/protocol` (plugin types), zod, `node:crypto` | fs, network, sqlite | no (retype off protocol, not OD contracts) |
| `@jini/host` (optional) | `host` | Neutral renderer host-bridge protocol (`window.__host__`) | `@jini/release` | OD capability names | rename `OpenDesignHost*`; drop if no desktop host |
| `@jini/agui-adapter` (optional) | `agui-adapter` | Map a native event union onto AG-UI canonical wire | `@jini/protocol` event union | OD-only event names | re-point input to engine events |

**Stays entirely in `foundry/integrations/open-design` (NOT `@jini/*`):**
| OD package | Reason |
|---|---|
| `@open-design/contracts` OD half (40 `api/*` DTOs, `prompts/*`, `design-systems/*`, `analytics/*`) | OD product ontology; consumes `@jini/protocol` |
| `launcher-proto` | Packaged desktop-launcher glue (`--od-launcher-*`); pure OD packaging |
| OD identity config for `release`/`sidecar-proto`/`host` | Product name, appIds, `OD_*` keys injected here |

---

## 2. THE CONTRACTS SPLIT (the prerequisite)

Verified internal import graph of the generic-core candidates:
- `common.ts` — **zero imports** (defines `JsonValue` etc.). Pure root.
- `errors.ts` — imports only `type JsonValue from './common'`. Generic.
- `tasks.ts` — zero imports. Generic.
- `execution-profile.ts` — zero imports. Generic.
- `sse/common.ts` — zero imports; defines `SseTransportEvent` envelope. Generic root.
- `agent-tools/*` — internal only + `type JsonValue from '../common'`; `registry.ts` docblock says "MUST NOT import apps/*". Generic cluster.
- `critique.ts` — imports `zod`; deliberately **re-mirrors** `SseTransportEvent` locally instead of importing it (comment confirms). Generic, self-contained.
- **`sse/chat.ts` / `sse/proxy.ts`** — import `SseTransportEvent` (generic) BUT ALSO `../api/chat`, `../api/proxy`, `../api/live-artifacts`. → **OD-bound**: the transport envelope is generic, the concrete chat/proxy unions are OD.
- **`examples.ts`** — imports ~9 `api/*` modules. → OD.

### Partition — file by file

**→ `@jini/protocol` (generic core, moves to engine):**
- `src/common.ts` (JsonValue + shared scalars) — root, no edges.
- `src/errors.ts` (error taxonomy) — depends on `common` only.
- `src/tasks.ts` (task shapes) — no edges.
- `src/execution-profile.ts` — no edges.
- `src/critique.ts` — self-contained (local SSE mirror), zod only.
- `src/sse/common.ts` (`SseTransportEvent` transport envelope) — no edges.
- `src/agent-tools/` **entire dir** (`actions, descriptor, manifest, registry, task, index`) — internal + `common` only. High-value: the agent-tool registry port.
- `src/index.ts` — split into a generic barrel (engine) + an OD barrel (product).

**→ stays OD (`foundry/integrations/open-design`, becomes `@od/contracts` consuming `@jini/protocol`):**
- `src/api/` — **all 40 files** (agent-sessions, amrWallet, app-config, artifacts, attribution, automations, brands, chat, comments, community, connectionTest, connectors, context, export, figma, files, finalize, github, handoff, host-tools, library, live-artifacts, mcp, media, memory, orbit, plugin-candidates, projects, providerModels, proxy, reasoningExecution, registry, research, routines, run-completeness, social-share, terminals, version, whats-new, workspaces).
- `src/prompts/` — all (OD system prompts, deck-framework, discovery, official-system, media-contract, directions, atom/plugin blocks).
- `src/design-systems/` — all (components-manifest, token-schema, derived-token-outputs).
- `src/analytics/` — all (OD event names/taxonomy, observability, public-params, artifact-id).
- `src/plugins/` — all (OD plugin/marketplace DTOs).
- `src/artifacts/od-card.ts`, `src/runtime/deck-stage-fallback.ts`.
- `src/sse/chat.ts`, `src/sse/proxy.ts` — OD-specific SSE unions (import `api/*`).
- `src/examples.ts` — OD example payloads (imports 9 `api/*`).

### Forced dependency edges (the split's contract)
- `@od/contracts` **→ depends on `@jini/protocol`**: `sse/chat.ts`/`sse/proxy.ts` need `SseTransportEvent`; `errors` `SseErrorPayload` is referenced by SSE unions; `agent-tools` `JsonValue`. This is the intended single downward edge (product → engine).
- No engine file imports any `api/*` — verified: the generic-core files import only `common`, `zod`, or nothing. **The core is cleanly severable.**
- Watch item: `SseErrorPayload` lives in `errors.ts` (generic) and is consumed by both OD SSE unions and generic `critique.ts` (via its local mirror) — keep it in `@jini/protocol` so both sides depend downward, never sideways.

**Verdict:** ~8 files/1 dir (`common, errors, tasks, execution-profile, critique, sse/common, agent-tools/*`) lift cleanly into `@jini/protocol`; the other ~85 files stay as OD product contracts. The core has zero inbound edges from OD DTOs, so it can be extracted first without touching the 40 api files.

---

## 3. De-OD-identity rename campaign

Verified constants by package, with disposition:

### `sidecar-proto` (the OD-identity chokepoint)
| Constant (verified) | Disposition |
|---|---|
| `OD_SIDECAR_BASE / IPC_BASE / IPC_PATH / NAMESPACE / SOURCE`, `OD_PORT`, `OD_DAEMON_CLI_PATH`, `OD_WEB_PORT/DIST_DIR/TSCONFIG_PATH`, `OD_TOOLS_DEV_PARENT_PID` env keys | **(a) parameterize** — make env-key prefix a config the OD adapter supplies (`JINI_*` default, OD passes `OD_*`). |
| `--od-stamp-{app,ipc,mode,namespace,source}` flags | **(a) parameterize** flag prefix (default `--jini-stamp-*`; OD adapter overrides to `--od-stamp-*`). |
| `ipcBase: "/tmp/open-design/ipc"`, `windowsPipePrefix: "open-design"` | **(a) inject** as product path config, not a hardcoded default. |
| `OPEN_DESIGN_PRODUCT_NAME = "Open Design"`, `OD_REQUIRE_DESKTOP_AUTH` | **(c) keep in OD adapter** — pure product identity. |

### `sidecar`
| `/tmp/open-design/ipc/<ns>/<app>.sock` path layout (`paths.ts`), `OD_JSON_IPC_TRACE` env, `[open-design sidecar]` log tag | **(a) parameterize** — path builder + trace-env + log-tag become injected config. `paths.ts` header already flags "Open Design-specific strings hardcoded here" → the exact seam. |

### `release`
| `PRODUCT_NAME = "Open Design"`, `DEFAULT_NAMESPACE = "open-design"`, `appId: "io.open-design.desktop.*"`, channel identity | **(c) keep in OD adapter** as an identity-config object; `@jini/release` keeps only channel/version *algorithms* and takes identity as input. Channel enum names (beta/prerelease/preview/stable) → **(b) neutral** (generic release vocabulary, keep). |

### `host`
| `OPEN_DESIGN_HOST_GLOBAL`, `OPEN_DESIGN_HOST_VERSION`, `OpenDesignHostBridge` + all `OpenDesignHost*` types, `window.__od__` | **(b) rename** to `@jini/host` neutral (`JINI_HOST_GLOBAL`, `JiniHostBridge`, `window.__host__`) IF Jini ships a desktop host; capability namespaces (project/pdf/capture/updater/pet/shell) that are OD-specific → **(c) OD adapter**. Otherwise **drop** the package. |

### `download` / `diagnostics` (cosmetic)
| `.open-design-download-root.json`, `open-design-managed-download-root`, `open-design-managed-download` | **(b) neutral** (`.jini-download-root.json`, etc.). |
| `DIAGNOSTICS_FILENAME_PREFIX = "open-design-diagnostics"` | **(b) neutral** (`jini-diagnostics`). |

### `contracts` generic core
| `analytics` event names, `prompts` product strings | **(c) stay OD** — not in `@jini/protocol` at all. Generic core carries no OD identity. |

Principle: **(a) parameterize** anything that is a runtime path/env/flag prefix (so one engine binary serves any product); **(b) rename** cosmetic sentinel/type names; **(c) keep in OD adapter** anything that is product identity data (name, appId, capability set).

---

## 4. Dependency-ordered extraction sequence

Roots = `release`, `contracts`(→`@jini/protocol` core). Clean leaves = platform/components/metatool/registry-protocol.

1. **`@jini/platform`** — zero deps, cleanest leaf. Unblocks download.
2. **`@jini/components`** — zero deps (react peer). Independent.
3. **`@jini/metatool`** — zero deps. Independent (build tooling).
4. **`@jini/registry-protocol`** — zero deps (zod). Independent.
5. **`@jini/release`** — zero deps once identity is injected; needed by sidecar-proto/host. Extract early.
6. **`@jini/protocol`** — the generic core carved from contracts (`common, errors, tasks, execution-profile, critique, sse/common, agent-tools/`). Depends on nothing but zod. Unblocks plugin-runtime, agui-adapter, and the OD contract layer.
7. **`@jini/download`** — needs (1) `@jini/platform`.
8. **`@jini/sidecar-proto`** — needs (5) `@jini/release`.
9. **`@jini/sidecar`** — zero workspace deps, but do after (8) so the neutral proto/config seam exists to inject paths.
10. **`@jini/diagnostics`** — zero workspace deps; any time after leaves. (jszip only.)
11. **`@jini/plugin-runtime`** — needs (6) `@jini/protocol` (retype plugin types off it).
12. **`@jini/agui-adapter`** (optional) — needs (6) `@jini/protocol` event union.
13. **`@jini/host`** (optional) — needs (5) `@jini/release`; do only if desktop host is in scope.
14. **`foundry/integrations/open-design/contracts`** — the OD half (40 api DTOs + prompts + analytics + design-systems + OD SSE unions); depends on (6) `@jini/protocol`. Last, since it consumes the engine.

Nothing blocked: steps 1–6 have no cross-`@jini` edges; 7–14 each depend only on earlier-numbered packages.

---

## 5. Per-package effort + single riskiest de-coupling

| `@jini/*` | Effort | Riskiest de-coupling |
|---|---|---|
| `@jini/platform` | **S** | Almost none; only scrub doc-comment OD references. Risk: toolchain bin-list may encode OD agent CLIs — verify `toolchain.ts` search list is product-neutral. |
| `@jini/components` | **S** | Renaming `.od-*` CSS classes without breaking consumers' selectors. |
| `@jini/metatool` | **S** | None (0 coupling); risk is it's simply unneeded, adding surface for nothing. |
| `@jini/registry-protocol` | **S** | Confirm its schemas aren't secretly OD-marketplace-shaped before assuming Jini reuses them. |
| `@jini/download` | **S** | Sentinel-string rename is a data migration risk for existing stores (breaks discovery of old roots) — but greenfield Jini has none. |
| `@jini/diagnostics` | **S** | Prefix rename only; redaction rules may be tuned to OD secret shapes — audit `redaction.ts` patterns. |
| `@jini/release` | **S–M** | Cleanly separating channel/version *algorithm* from the interleaved identity constants in a single 236-LOC file. |
| `@jini/sidecar` | **S–M** | `paths.ts` hardcodes the `/tmp/open-design` socket layout as defaults — injecting a path/env config without breaking the IPC socket contract (both ends must agree). |
| `@jini/sidecar-proto` | **M** | Turning ~a dozen `OD_*`/`--od-stamp-*`/product-path constants into injectable config while keeping the 5-field stamp invariant and namespace validation intact; every downstream launcher reads these. |
| `@jini/protocol` | **M** | Splitting `contracts/src/index.ts` barrel cleanly so `SseErrorPayload`/`SseTransportEvent`/`JsonValue` stay in the engine while OD SSE unions (`sse/chat`,`sse/proxy`) re-import downward — a mis-split creates a sideways engine→OD edge. (Core files themselves are edge-free, so risk is barrel hygiene, not logic.) |
| `@jini/plugin-runtime` | **M** | It imports OD `PluginManifest`/`PluginPipeline` from contracts and speaks skill/design-system/craft vocabulary; re-typing against `@jini/protocol` without smuggling OD semantics into the engine. |
| `@jini/agui-adapter` | **M** | The OD-native event union is the mapping's whole input; defining a neutral engine event union it can map from without losing OD-specific event coverage. |
| `@jini/host` | **M** | Deciding which of project/pdf/capture/updater/pet/shell namespaces are generic host capabilities vs OD-desktop-only (likely most are OD → package may not be worth extracting). |

Riskiest overall: **`@jini/protocol` barrel split** (correctness of the downward-only edge) and **`@jini/sidecar-proto` parameterization** (identity invariants + many downstream readers). Both are the load-bearing seams.
