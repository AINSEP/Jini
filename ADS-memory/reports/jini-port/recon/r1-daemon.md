# R1 — Daemon extraction recon (Jini engine vs Open Design adapter)

Scope: `apps/daemon/src` in OD (`refactor/web-memory-slice`, server.ts ~8635 lines) and Jini
(`integrated`, server.ts ~2631 lines + `server/` folder). All findings verified in-repo unless
tagged **(inference)**.

---

## TASK 1 — Top-level directory classification

File counts from `find <dir> -name '*.ts'`. Classification key: **GENERIC** = reusable engine,
no product meaning; **OD-PRODUCT** = design/brand/figma/deploy/media/etc.; **MIXED** = needs splitting.

### GENERIC-ENGINE (reusable, harvest wholesale)

| dir | files | justification |
|---|---|---|
| `runtimes/` | 62 | Agent-CLI runtime: registry/detection/defs/stream-parsers. Product-neutral core with a thin OD tilt (see Task 3). This is the crown jewel seam. |
| `http/` | 10 | Pure HTTP plumbing: `adapter.ts`, `api-errors.ts`, `origin-guard.ts`, `parse.ts`, `response.ts`, `tool-request-auth.ts`. No product meaning. |
| `agent-protocol/` | 17 | ACP + pi-RPC subprocess protocol adapters over a shared JSON-line-stream (`core/`). Docblock: "External daemon code imports only from this barrel." Generic agent transport. |
| `storage/` | 4 | `aws-sigv4.ts`, `daemon-db.ts`, `db-inspect.ts` generic; only `project-storage.ts` leans OD. Mostly generic. |
| `metrics/` (1), `logging/` (1) | 2 | Generic observability primitives. |
| `sidecar/` | 2 | Generic sidecar entry glue (index/server); sidecar-awareness boundary, not product. |
| top-level: `db.ts`, `agents.ts`, `sandbox-mode.ts`, `terminals.ts`, `daemon-paths.ts`, `origin-validation.ts`, `api-token-auth.ts`, `redact.ts`, `http/` | — | Generic daemon primitives. |

### OD-PRODUCT (belongs in `foundry/integrations/open-design/`)

| dir | files | justification |
|---|---|---|
| `plugins/` | 55 | OD plugin/marketplace/atom pipeline (`installer`, `marketplace-seed`, `pack`, `pipeline-runner`, `connector-gate`). Pure product. |
| `brands/` | 35 | OD brand-kit engine (`design-md`, `fonts`, `kit-render`, `logo-fallback`, `schema`). Product. |
| `critique/` | 21 | Design-critique orchestrator/scoreboard/ratchet/conformance. Product. |
| `design-systems/` | 15 | Design-system import/tokens/showcase/shadcn/swift-colors. Product. |
| `prompts/` | 9 | OD system/discovery/deck-framework/media-contract/official-system prompts. All product tone. |
| `media/` | 8 | OD media-generation (task-store, policy, models, prompt-templates). Product. |
| `connectors/` | 7 | Composio connector catalog/curation/descriptions. Product-curated (though pattern is generic). |
| `live-artifacts/` (6), `media-adapters/` (5), `genui/` (4), `design/` (4), `research/` (3), `figma/` (2), `deploy/` (1), `qa/` (2 — cta-hierarchy, deck-layout) | — | All OD design/output features. |
| top-level: `craft.ts`, `skills.ts`, `deck-export.ts`, `pdf-export.ts`, `document-preview.ts`, `orbit*.ts`, `library*.ts`, `brand-routes.ts`, `codex-pets.ts`, `community-pets-sync.ts` | — | Product surfaces. |

### MIXED (split: generic core + OD adapter)

| dir | files | split guidance |
|---|---|---|
| `routes/` | 32 | HTTP route registrars mix generic (`chat.ts`, `runs.ts`, `terminal.ts`, `daemon.ts`, `telemetry.ts`, `memory.ts`) with product (`design-systems.ts`, `deploy.ts`, `media.ts`, `genui.ts`, `handoff.ts`, `brand`, `live-artifact.ts`, `vela.ts`). Registration pattern is generic; contents are per-feature. |
| `integrations/` | 13 | LLM-provider integrations (`google-models`, `openai-chat-token-params`, `provider-models`, `xai-oauth*`, `aihubmix`, `elevenlabs-voices`) are generic agent-runtime providers; `vela*` (AMR) is a specific provider adapter. Mostly generic, some vendor-specific. |
| `registry/` | 4 | Pluggable content-registry backends (`static`/`github`/`database`/`versioning`) — generic pattern, but typed against `@open-design/registry-protocol` + `MarketplaceManifest` (OD marketplace). Split protocol from OD manifest. |
| `artifacts/` | 6 | `create/manifest/publication-guard/runtime-compat/stub-guard/text-suppression` — the *artifact store* concept is a generic engine PORT, but OD's artifact = HTML prototype / design output. Extract the store interface; keep OD's file-kind classification as adapter. |
| `services/` | 5 | `login-shell.ts` generic; `plugin-installation`, `plugin-share-tasks`, `whats-new`, `open-design-public-metadata` product. |
| `migration/` | 3 | Legacy-data migration is generic mechanism but hardcodes OD data layout (**inference**). |
| top-level: `mcp*.ts`, `automation-*.ts`/`routines.ts`, `memory*.ts` | — | MCP client wiring, automation/routine engine, and memory subsystem are generic capabilities with OD-shaped payloads. |

---

## TASK 2 — Composition root(s)

### OD (monolith)
- `startServer({...})` in `server.ts` is a **single closure spanning ~line 1995 → ~8624 (~6600 lines)**;
  194 top-level `import` statements.
- The de-facto DI container is `ServerContext` (`server-context.ts`, 148 lines): a struct assembled
  inside `startServer` and passed to every `registerXRoutes(app, ctx)`. `route-context-contract.ts`
  intersects all `RegisterXRoutesDeps` and statically asserts `ServerContext extends AllRegisteredRouteDeps`
  — a compile-time check that the container satisfies every route's needs. This is the cleanest existing
  seam and the natural place to introduce engine PORTS.
- Routes register via a uniform `register<Feature>Routes(app, ctx)` pattern — ~40 registrars enumerated
  at server.ts lines 289–3466. Good strangler boundary.

### Jini `integrated` (partially decomposed — harvest this)
- `server.ts` down to **2631 lines**; `startServer` still a large closure (line 994 → end) but ~1000
  lines already extracted into `server/` (verified `wc -l`, 1012 total):
  - `server/core/types.ts` (53) — `StartServerOptions`/`StartServerResult`, desktop exporter/renderer
    function types. Type-only, re-exported from server.ts for stable import surface.
  - `server/core/runtime-paths.ts` (195) — runtime path resolution (the `PathDeps` producers).
  - `server/events/{index,sinks}.ts` (130) — SSE event sinks (`emitChatAgentEvent`, live-artifact,
    project events) extracted out of the closure.
  - `server/marketplace/{index,seed}.ts` (138) — OD marketplace seed + `OFFICIAL_MARKETPLACE_ID`
    (product; imported back for startServer use).
  - `server/runtime-env/agent-runtime-env.ts` (113) — `buildAgentRuntimeEnv` + `createAgentRuntimeToolPrompt`:
    composes the child agent's `NodeJS.ProcessEnv` (sandbox overlay, sidecar IPC passthrough, PATH node-bin,
    `OD_TOOL_TOKEN`). Takes `runtimeDataDir`/`sandboxRuntime` as explicit params instead of reaching back
    into server.ts singletons — **already the shape an engine wants** (dependency-injected data root).
  - `server/bootstrap/{boot-reconcile,start-listener}.ts` (364) — `runBootReconcileAndSeed` + `startDaemonListener`
    (seed/recovery + HTTP listen), pulled out of the closure.
- **Harvest verdict:** Jini's `server/` slices (events, runtime-env, bootstrap, core/types) are the generic
  composition machinery already isolated — reuse directly. `server/marketplace/` is OD-product and should
  move under the OD adapter, not the engine. Caveat: `agent-runtime-env.ts` still carries the file-level
  `@ts-nocheck` inherited from server.ts — untyped JS-in-TS, must be typed before packaging.

---

## TASK 3 — Agent-runtime subsystem (`runtimes/`)

### Core files
- `types.ts` — `RuntimeAgentDef` (the central contract). **~250 lines, product-neutral.** Declarative:
  `id/name/bin/versionArgs/buildArgs/streamFormat/fallbackModels`, prompt-delivery knobs
  (`promptViaFile`/`promptViaStdin`/`promptInputFormat`), session-resume strategy flags
  (`resumesSessionViaCli`/`capturesSessionIdFromStream`/`resumesSessionViaAcpLoad`),
  `externalMcpInjection` (4 strategies), `authProbe`, `acpMcpEnvFormat`. Its only non-generic string
  literals are agent brand names in doc comments (agy/claude/codex). **Clean enough to be `@jini/agent-runtime`'s core type as-is.**
- `registry.ts` — static array `BASE_AGENT_DEFS` of 25 defs + local-profile merge; dup-id guard;
  `getAgentDef(id)`. Fully generic.
- `detection.ts` — spawns version/auth/model probes per def, builds `DetectedAgent`. Generic; one OD-ish
  edge: imports `resolveAmrProfile` from `../integrations/vela.js` (AMR/vela provider specifics leaking in).
- `capabilities.ts` — trivial (`export const agentCapabilities = new Map<...>()`); populated at runtime.
- `defs/*.ts` — **25 agent CLI adapters**: aider, amp, amr, antigravity, byok-opencode, claude, codebuddy,
  codex, copilot, cursor-agent, deepseek, devin, grok-build, hermes, kilo, kimi, kiro, mimo, opencode, pi,
  qoder, qwen, reasonix, trae-cli, vibe (+ `shared.ts`). Each is a pure `RuntimeAgentDef` literal. Generic.

### Stream parsers (all present in OD `runtimes/`; Jini moved copilot-stream out)
- `claude-stream.ts`, `json-event-stream.ts`, `qoder-stream.ts`, `plain-stream.ts` (OD also has
  `copilot-stream.ts` at src top-level; Jini relocated it under runtimes). These parse agent stdout into a
  normalized event stream. Generic parsers — the format-neutral event contract is the reusable payoff.

### OD coupling carried by `runtimes/` (verified by grep of `from '../'`)
- `chat-prompt-inputs.ts` — **design-system selection resolution** (`resolveEffectiveDesignSystemSelection`,
  `designSystemIdFromPluginSnapshot`, plugin snapshots). Product concept embedded in the chat-run path.
- `chat-run-context.ts` — enumerates `'design-system'` as a context kind.
- `run-artifacts.ts` — counts "artifacts" using OD's file-kind taxonomy (HTML prototypes / SVG / design-system
  files → `run_finished.artifact_count` analytics). OD notion of artifact.
- `prompt-budget.ts` — user-facing error copy mentions "skills/design-system context" (cosmetic only).
- Cross-dir imports out of runtimes: `../integrations` (vela) ×4, `../prompts` ×2, `../artifacts`, `../media`,
  `../projects`, `../project-root`, `../db`, `../sandbox-mode` ×3, `../app-config`, `../agents`,
  `../run-tool-bundle`, `../question-form-detect`, `../role-marker-guard`.

### Assessment for `@jini/agent-runtime`
**~80% there.** `types.ts` + `registry.ts` + `defs/*` + `detection.ts` + stream parsers are essentially a
clean product-neutral package. The blocking coupling is concentrated in the **chat-run orchestration trio**
(`chat-prompt-inputs.ts`, `chat-run-context.ts`, `run-artifacts.ts`) plus scattered `../prompts`/`../media`/
`../artifacts`/`../integrations(vela)` imports. Extraction plan: keep `types/registry/detection/defs/streams`
in the engine; lift design-system selection, artifact classification, and prompt augmentation behind PORTS
(below) so the chat-run path calls injected hooks instead of importing OD modules.

---

## TASK 4 — PORTS the engine needs (inject, don't import)

The `ServerContext` struct (`server-context.ts`) already *is* a proto-DI container — but its members are
`any`-typed and mix generic + product. Each field is a candidate port. Concrete hardcodes cited.

1. **Data-root / paths port.** `PathDeps` (server-context.ts:18–44) hardcodes OD paths: `ARTIFACTS_DIR`,
   `BRANDS_DIR`, `CRAFT_DIR`, `DESIGN_SYSTEMS_DIR`, `DESIGN_TEMPLATES_DIR`, `LIBRARY_DIR`, `PROJECTS_DIR`,
   `PROMPT_TEMPLATES_DIR`, `SKILLS_DIR`, `USER_*_DIR`, plus generic `RUNTIME_DATA_DIR`, `PROJECT_ROOT`, `OD_BIN`.
   Engine should take only `RUNTIME_DATA_DIR` + a resolver; OD adapter supplies the product subpaths. All
   derive from `OD_DATA_DIR → RUNTIME_DATA_DIR` in `server.ts` (see AGENTS.md data-dir contract).
2. **Project/workspace port.** `ServerContext.projectStore`, `projectFiles`, `conversations`, `messages`
   (server-context.ts:109–137, all `any`). OD's "project" (managed-project root + imported-folder `baseDir`)
   is a product model; engine needs a generic workspace/session store interface.
3. **Artifact store port.** `ServerContext.artifacts` + `artifacts/` dir + `runtimes/run-artifacts.ts`. Engine
   wants `write/list/manifest`; OD injects HTML/SVG/design file-kind classification.
4. **Credential / token store port.** `api-token-auth.ts`, `tool-tokens.ts`, `mcp-tokens.ts`, `library-tokens.ts`,
   `integrations/xai-tokens.ts`, `desktop-auth.ts`; `ServerContext.auth`. Engine needs a generic secret/credential
   provider; OD injects vendor OAuth (xai, vela, composio).
5. **Telemetry / analytics port.** `TelemetryDeps` (server-context.ts:69–99): `reportFinalizedMessage`,
   `reportFeedback`, `reportRunCompletionTelemetryFallback`, `resolveRunProjectKindForAnalytics`. Plus
   `analytics.ts`, `prompt-telemetry.ts`, `langfuse-*`. Currently OD-specific event names
   (`run_finished.artifact_count`, `run_finished.asked_user_question`). Engine emits generic run lifecycle;
   OD maps to its analytics schema.
6. **Prompt-augmentation port.** `runtimes/chat-prompt-inputs.ts` (design-system injection) + `prompts/` +
   `ServerContext.chat`. Engine composes base prompt; OD injects design-system/skills/brand context via a hook.
7. **Agent-runtime-env port.** Jini's `buildAgentRuntimeEnv(..., runtimeDataDir, sandboxRuntime)` already
   parameterizes the data root — generalize the `OD_*` env var names (`OD_DATA_DIR`, `OD_TOOL_TOKEN`,
   `OD_BIN`, `OD_DAEMON_URL`) behind a namespace prefix so a non-OD consumer isn't branded.
8. **Resource-catalog port.** `ResourceDeps` (server-context.ts:45+): `listAllSkills`, `listAllDesignSystems`,
   `listAllDesignTemplates`, `FIRST_PARTY_ATOMS`. Pure OD content catalogs — inject as a provider.
9. **Registry-backend port.** `registry/` backends are generic but typed against `MarketplaceManifest` /
   `@open-design/registry-protocol`. Split the transport (static/github/db) from the OD manifest schema.

---

## TASK 5 — Blockers to copying the daemon into a fresh repo and running it

1. **Hardcoded OD data-dir layout.** All product subpaths (`PathDeps`) derive from `RUNTIME_DATA_DIR` and
   assume the OD directory taxonomy (`SKILLS_DIR`, `DESIGN_SYSTEMS_DIR`, `BRANDS_DIR`, `DESIGN_TEMPLATES_DIR`,
   `LIBRARY_DIR`). Route handlers read these directly. A fresh engine boot with no OD content dirs would
   404/empty across ~half the routes. (verified in `server-context.ts` + AGENTS.md data-dir contract.)
2. **Repo-root content directories.** The daemon serves `skills/`, `design-systems/`, `design-templates/`,
   `brands`, `craft/` bundled at the OD repo root (per AGENTS.md "Workspace directories"). These are not under
   the daemon — copying only `apps/daemon` drops them. **(inference from AGENTS.md + PathDeps naming.)**
3. **`@open-design/*` package imports.** `types.ts` imports `@open-design/contracts`; `registry/*` imports
   `@open-design/registry-protocol`; `server/*` imports `@open-design/sidecar-proto`. These workspace packages
   must be vendored/renamed or the engine won't compile. (verified.)
4. **Route surface hardwired to OD features.** ~40 `registerXRoutes` calls include `registerDesignSystemRoutes`,
   `registerBrandRoutes`, `registerDeployRoutes`, `registerMediaRoutes`, `registerHandoffRoutes`,
   `registerFinalizeRoutes`, `registerGenuiRoutes`, `registerVelaRoutes` — all product. Engine must make route
   registration opt-in per adapter rather than a fixed list in `startServer`. (verified server.ts:2448–3466.)
5. **Analytics event schema.** Event names like `run_finished.artifact_count` /
   `run_finished.asked_user_question` are OD product signals wired into the run lifecycle
   (`run-artifacts.ts`, `run-analytics-observability.ts`, `question-form-detect.ts`). A fresh consumer
   inherits OD's funnel semantics unless telemetry is porticized. (verified.)
6. **`@ts-nocheck` debt.** Jini's extracted `server/` slices (e.g. `runtime-env/agent-runtime-env.ts`) carry
   file-level `@ts-nocheck` inherited from server.ts — untyped JS-in-TS. Per user memory this masks TS2307
   dead imports; a real-run/load test is mandatory after any move. (verified header comment.)
7. **`<question-form>` / discovery-prompt coupling.** The daemon's chat run path assumes OD's discovery/
   question-form artifact protocol (`question-form-detect.ts`, `prompts/discovery.ts`, `runtimes/run-artifacts.ts`
   `runAskedUserQuestion`). Generic agent runs don't have this; it must sit in the OD prompt-augmentation adapter.
   (verified names; behavior per AGENTS.md "Asking the user questions.")
