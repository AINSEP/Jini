# R1b — Daemon extraction design (fresh Jini repo)

Builds on `r1-daemon.md`. Design-only; TS signatures are target-state, not current code. Anchored to
verified OD source: `apps/daemon/src/{server.ts, server-context.ts, route-context-contract.ts,
runtimes/*, artifacts/*}`. Signatures marked **(new)** are proposed; those quoting existing exports are
grounded in the cited file.

Package layering (fresh repo):

```
@jini/protocol         ← agent stream events, ACP/pi-rpc, RuntimeAgentDef type, error shapes (pure)
@jini/agent-runtime    ← registry + 25 defs + detection + 4 stream parsers + chat-run orchestration (ports-injected)
@jini/persistence      ← db/storage/session-store port impls (sqlite default backend)
@jini/daemon-core      ← createDaemon({ ports }) composition root + generic routes (chat/runs/terminal)
foundry/integrations/open-design ← ALL product: design-systems, brands, critique, media, deploy, plugins, prompts,
                            figma, genui, live-artifacts, research + route-registration wiring
```

---

## 1. `@jini/agent-runtime` package spec

### 1a. Harvest wholesale (product-neutral, move as-is)
- `runtimes/types.ts` → `RuntimeAgentDef` (the declarative agent contract; ~250 lines, only agent brand
  names in doc comments). Ships to `@jini/protocol` so both runtime and daemon-core depend on the type
  without a runtime cycle.
- `runtimes/registry.ts` → `BASE_AGENT_DEFS` array (25), dup-id guard, `getAgentDef(id)`.
- `runtimes/defs/*.ts` → 25 adapters (aider…vibe) + `shared.ts`. Pure literals.
- `runtimes/detection.ts` → version/auth/model probing → `DetectedAgent`. **Fix:** its
  `import { resolveAmrProfile } from '../integrations/vela.js'` becomes an injected
  `AmrProfileResolver` port (default no-op) so vela/AMR specifics live in the OD adapter.
- Stream parsers `runtimes/{claude-stream,json-event-stream,qoder-stream,plain-stream}.ts`
  (+ `copilot-stream.ts`) → normalize agent stdout to a format-neutral event union in `@jini/protocol`.
- Supporting generic files: `env.ts`, `launch.ts`, `invocation.ts`, `executables.ts`, `resolution.ts`,
  `paths.ts`, `auth.ts`, `capabilities.ts`, `metadata.ts`, `models.ts`, `prompt-budget.ts` (strip the
  "skills/design-system" copy → generic "selected context"), `prompt-file.ts`, `mcp.ts`, `diagnostics.ts`.

### 1b. The coupled chat-run trio → ports

The three files flagged in r1 import OD product modules. Replace those imports with injected ports:

**PromptAugmenter** — replaces `runtimes/chat-prompt-inputs.ts` design-system injection
(`resolveEffectiveDesignSystemSelection`, `designSystemIdFromPluginSnapshot`, `formatDesignFilesWorkspaceHint`)
and `runtimes/chat-run-context.ts` workspace-context kinds. Engine composes a base prompt and calls out:

```ts
// @jini/agent-runtime (new)
export interface WorkspaceContextItem { id: string; kind: string; label: string } // from chat-run-context.ts:14
export interface RunContextSelection { items: WorkspaceContextItem[] }             // from chat-run-context.ts:25

export interface PromptAugmenter {
  /** Which workspace-context `kind` strings this consumer recognizes (OD: design-system,
   *  design-files, live-artifact, …). Engine only knows generic kinds: file, folder, browser,
   *  terminal, project, local-code. */
  contextKinds(): readonly string[];
  /** Inject product context blocks (design-system selection, skills, brand) into the composed
   *  user request. Engine passes the base prompt + selection; adapter returns augmented text. */
  augmentUserRequest(input: {
    basePrompt: string;
    selection: RunContextSelection;
    agentId: string;
    hasPriorAssistantTurn: boolean;
  }): Promise<string> | string;
  /** Optional system-prompt overlay (OD discovery / question-form protocol lives here, NOT in engine). */
  systemOverlay?(input: { agentId: string; turnIndex: number }): string | null;
}
```

**ArtifactStore + ArtifactTaxonomy** — replaces `runtimes/run-artifacts.ts` (`isArtifactPath`,
`isDesignSystemFile`, `isPreviewModulePath`, `countNewArtifacts`, `didRunCreateDesignSystemFile`) and
`artifacts/{create,manifest,publication-guard,runtime-compat}.ts`. Engine counts/writes generic outputs;
OD injects its HTML-prototype/SVG/design-system file taxonomy:

```ts
// @jini/agent-runtime (new) — taxonomy is the product-classification seam
export interface ArtifactTaxonomy {
  /** Does this file path count as a user-facing artifact? OD: html/svg/prototype/live-artifact. */
  isArtifact(path: string): boolean;
  /** Optional finer buckets OD tracks for analytics; engine treats all as opaque. */
  classify?(path: string): string | null; // e.g. 'design-system' | 'preview-module' | 'sketch'
}

// @jini/persistence (new) — the store is a persistence port; taxonomy is injected classification
export interface ArtifactStore {
  write(input: { runId: string; path: string; bytes: Buffer; mime: string }): Promise<{ id: string }>;
  list(scope: { projectId: string }): Promise<Array<{ id: string; path: string; mime: string }>>;
  manifest(scope: { projectId: string }): Promise<unknown>;
}
```

**TelemetrySink** — replaces the OD analytics names baked into `run-artifacts.ts`
(`run_finished.artifact_count`, `runAskedUserQuestion` → `run_finished.asked_user_question`) and
`run-lifecycle-analytics.ts`. Engine emits a generic run-lifecycle stream; OD maps to its schema:

```ts
// @jini/agent-runtime (new)
export interface RunLifecycleEvent {
  type: 'run_started' | 'run_finished' | 'run_failed' | 'tool_use' | 'artifact_written';
  runId: string;
  agentId: string;
  at: number;
  data?: Record<string, unknown>; // artifactCount, askedUserQuestion, stopReason, … — opaque to engine
}
export interface TelemetrySink {
  emit(ev: RunLifecycleEvent): void;
  reportFinalizedMessage?(input: { runId: string; text: string; meta: Record<string, unknown> }): void;
}
```

### 1c. Agent-runtime-env data-root injection (de-brand OD_*)

Jini's `server/runtime-env/agent-runtime-env.ts` already parameterizes the data root
(`buildAgentRuntimeEnv(baseEnv, daemonUrl, toolTokenGrant, nodeBin, runtimeDataDir, sandboxRuntime)`).
Generalize the hardcoded `OD_DATA_DIR / OD_DAEMON_URL / OD_NODE_BIN / OD_TOOL_TOKEN / OD_BIN` names via a
namespace prefix so a non-OD consumer isn't branded:

```ts
// @jini/agent-runtime (new)
export interface RuntimeEnvConfig {
  envPrefix: string;          // 'OD' for the OD adapter → OD_DATA_DIR; 'JINI' → JINI_DATA_DIR
  runtimeDataDir: string;     // injected, never inferred from cwd/appName/port (per data-dir contract)
  daemonUrl: string;
  nodeBin: string;
  binPath: string;            // was OD_BIN
  sandboxRuntime: SandboxRuntimeConfig;
}
export function buildAgentRuntimeEnv(
  baseEnv: NodeJS.ProcessEnv, cfg: RuntimeEnvConfig, toolTokenGrant: { token?: string } | null
): NodeJS.ProcessEnv;
export function createAgentRuntimeToolPrompt(cfg: RuntimeEnvConfig, grant: { token?: string } | null): string;
```

Assessment: **~80% of `runtimes/` moves untouched**; the trio + vela import are the only real work.

---

## 2. `@jini/daemon-core` package spec — the composition root

### Problem statement
OD's `startServer` is a single ~6600-line closure (server.ts ~1995→8624, 194 imports). Its de-facto DI
container `ServerContext` (server-context.ts:101–144) has 40 fields, **most typed `any`**
(`db/design/projectStore/artifacts/deploy/media/critique/…`), mixing generic + product. Design goal:
turn `startServer` into `createDaemon({ ports })` where every collaborator is an explicit typed port and
route registration is opt-in per adapter.

### `createDaemon` factory (new)

```ts
// @jini/daemon-core
export interface DaemonPorts {
  paths: PathsPort;
  workspace: WorkspaceStorePort;
  artifacts: ArtifactStore;          // from @jini/persistence
  credentials: CredentialStorePort;
  telemetry: TelemetrySink;          // from @jini/agent-runtime
  promptAugmenter: PromptAugmenter;  // from @jini/agent-runtime
  resources: ResourceCatalogPort;
  registry: RegistryBackendPort;
  render: RenderServicePort;
  db: DatabasePort;
}
export interface DaemonOptions {
  ports: DaemonPorts;
  host?: string;
  port?: number;
  routeModules?: RouteRegistrar[];   // generic engine routes + adapter-supplied product routes
}
export interface DaemonHandle {
  url: string;
  server: import('node:http').Server;
  shutdown: () => Promise<void>;
  routeInventory: RouteRegistration[];
}
export function createDaemon(opts: DaemonOptions): Promise<DaemonHandle>;
```

### The ports (typed; each replaces an `any` field or a hardcode cited in r1)

```ts
// 1. Data-root / paths — replaces PathDeps (server-context.ts:18) hardcoding SKILLS_DIR/DESIGN_SYSTEMS_DIR/…
export interface PathsPort {
  runtimeDataDir: string;                    // the ONE truth source (OD_DATA_DIR → RUNTIME_DATA_DIR)
  projectsDir: string;
  artifactsDir: string;
  resolve(key: string): string;              // adapter maps product keys (BRANDS_DIR, DESIGN_SYSTEMS_DIR, …)
}

// 2. Project/workspace store — replaces ServerContext.{projectStore,projectFiles,conversations,messages}:any
export interface WorkspaceStorePort {
  getProject(id: string): Promise<ProjectRecord | null>;
  listProjects(): Promise<ProjectRecord[]>;
  createProject(input: { name: string; baseDir?: string }): Promise<ProjectRecord>; // baseDir = imported-folder exception
  readFile(projectId: string, rel: string): Promise<Buffer>;
  writeFile(projectId: string, rel: string, bytes: Buffer): Promise<void>;
  conversation: ConversationStorePort;       // messages/turns persistence
}

// 3. Artifact store — see @jini/persistence.ArtifactStore + ArtifactTaxonomy (section 1b)

// 4. Credential/token store — replaces ServerContext.auth:any + api-token-auth/tool-tokens/mcp-tokens/xai-tokens
export interface CredentialStorePort {
  getToken(scope: string, key: string): Promise<string | null>;
  putToken(scope: string, key: string, value: string): Promise<void>;
  mintRunToolToken(runId: string): Promise<{ token: string }>;   // was OD_TOOL_TOKEN grant
  oauthProvider?(name: string): OAuthProviderPort | null;        // OD injects xai/vela/composio
}

// 5. Telemetry — see @jini/agent-runtime.TelemetrySink (replaces TelemetryDeps server-context.ts:69)

// 6. Prompt-augmentation — see @jini/agent-runtime.PromptAugmenter (section 1b)

// 7. Resource-catalog — replaces ResourceDeps (server-context.ts:45); OD content catalogs become a provider
export interface ResourceCatalogPort {
  listSkillLikeEntries(): Promise<CatalogEntry[]>;   // OD: skills + design-templates
  listDesignSystems(): Promise<CatalogEntry[]>;
  mimeFor(path: string): string;
  firstPartyAtoms?(): CatalogEntry[];
}

// 8. Registry-backend — replaces registry/{static,github,database,versioning}; split transport from OD manifest
export interface RegistryBackendPort {
  get(id: string): Promise<RegistryEntry | null>;
  publish(req: RegistryPublishRequest): Promise<RegistryPublishOutcome>;
  yank(id: string): Promise<RegistryYankOutcome>;
  // MarketplaceManifest shape stays in the OD adapter's RegistryEntry<TManifest> specialization
}

// 9. Render-service — replaces server/core/types.ts Desktop{Pdf,Slide,Artifact} exporters (desktop-injected)
export interface RenderServicePort {
  exportPdf?(input: unknown): Promise<unknown>;
  renderSlides?(input: unknown): Promise<unknown>;
  exportArtifact?(input: unknown): Promise<unknown>;
}

// 10. Database — replaces ServerContext.db:any; @jini/persistence ships a sqlite default
export interface DatabasePort { /* prepared-statement handle; better-sqlite3 default backend */ }
```

### Port-satisfaction check (the compile-time contract, generalized)

OD's `route-context-contract.ts` intersects every `RegisterXRoutesDeps` and statically asserts
`ServerContext extends AllRegisteredRouteDeps` (via `Assert<T extends true>`). Generalize: each route module
declares the port slice it needs via `RouteDeps<K extends keyof DaemonPorts>`, and the factory asserts the
union of all registered modules' needs is covered by the supplied `DaemonPorts`:

```ts
// @jini/daemon-core (generalized from route-context-contract.ts:22-56)
export type RouteRegistrar<K extends keyof DaemonPorts = keyof DaemonPorts> =
  (app: Express, ports: Pick<DaemonPorts, K>) => void;

type NeededPorts<R> = R extends RouteRegistrar<infer K> ? K : never;
type Assert<T extends true> = T;
// createDaemon is generic over the tuple of routeModules; this line fails to compile if any
// registered module needs a port the caller did not supply — the OD adapter can't ship a route
// that reads ports the engine doesn't grant.
type PortsCoverRoutes<Mods extends RouteRegistrar[]> =
  Assert<NeededPorts<Mods[number]> extends keyof DaemonPorts ? true : false>;
```

This moves the guarantee from "container has an `any` for everything" to "the type system rejects a daemon
whose routes demand an unsupplied port."

---

## 3. Harvest plan from Jini `integrated` `server/`

Verified sizes (`wc -l`): total 1012 lines already extracted from the closure.

| slice | lines | verdict | action |
|---|---|---|---|
| `server/core/types.ts` | 53 | **generic** | Lift → `@jini/daemon-core`. Type-only (StartServerOptions/Result, exporter fn types); rename `StartServerOptions`→`DaemonOptions`, and the OD-branded `Desktop*Exporter` types become `RenderServicePort` methods. Erased at runtime — typecheck-only validation. |
| `server/core/runtime-paths.ts` | 195 | **generic mechanism, OD keys** | Lift the resolver → `PathsPort` default impl; the OD product path keys (SKILLS_DIR/BRANDS_DIR/…) move to the OD adapter's `resolve()`. |
| `server/events/{index,sinks}.ts` | 130 | **generic** | Lift → `@jini/daemon-core` SSE sink layer (`emitChatAgentEvent`, project events). `emitLiveArtifactEvent` is OD-product → route through TelemetrySink/adapter. |
| `server/runtime-env/agent-runtime-env.ts` | 113 | **generic (branded)** | Lift → `@jini/agent-runtime`; de-brand `OD_*` per §1c; **clear @ts-nocheck (below)**. |
| `server/bootstrap/{boot-reconcile,start-listener}.ts` | 364 | **generic + product seed** | `startDaemonListener` (154) → daemon-core wholesale. `runBootReconcileAndSeed` (210) splits: generic boot-reconcile stays; the *seed* content (marketplace/skills) becomes an adapter `onBoot(ports)` hook. |
| `server/marketplace/{index,seed}.ts` | 138 | **OD-PRODUCT** | Do NOT lift to engine. Move to `foundry/integrations/open-design/marketplace`. `OFFICIAL_MARKETPLACE_ID` + seed are product identity. |

### Clearing the `@ts-nocheck` debt on `agent-runtime-env.ts` (as part of the lift)
Verified header: file carries `// @ts-nocheck — carried over verbatim from server.ts's file-level @ts-nocheck`.
Per user-memory `feedback_ts_nocheck_masks_imports`, `@ts-nocheck` hides TS2307, so a moved file can typecheck
while its imports are dead. Lift procedure:
1. Remove `@ts-nocheck`; the two singleton reach-backs are already params (`runtimeDataDir`, `sandboxRuntime`) —
   type them: `runtimeDataDir: string`, `sandboxRuntime: SandboxRuntimeConfig` (import the real type from
   `sandbox-mode.ts`, which also moves/gets a port).
2. Type `baseEnv: NodeJS.ProcessEnv`, `toolTokenGrant: { token?: string } | null`, return `NodeJS.ProcessEnv`
   (signature already annotated — only the `@ts-nocheck` blanket hides the body).
3. `pnpm --filter @jini/agent-runtime typecheck` (src+tests) — MUST pass with zero TS2307, then a real-run/load
   smoke (spawn one agent) per `feedback_daemon_full_validation_gate`; typecheck alone is insufficient.
4. Grep the moved file for dynamic `await import()` before declaring done (moved-file blind spot).

---

## 4. Engine-vs-adapter route split

`routes/` has 32 files registered via ~40 uniform `register<Feature>Routes(app, ctx)` calls
(server.ts:2448–3466). Split by product-meaning:

**Generic engine routes → `@jini/daemon-core` (default `routeModules`):**
`chat.ts`, `runs.ts`, `terminal.ts`, `daemon.ts`, `telemetry.ts`, `memory.ts`, `active-context.ts`,
`static-resource.ts` — these read only engine ports (workspace, telemetry, agents, credentials).

**OD product routes → `foundry/integrations/open-design` (adapter supplies via route-registration API):**
`design-systems.ts`, `design-system-tool.ts`, `deploy.ts`, `media.ts`, `genui.ts`, `handoff.ts`,
`brand-routes.ts`, `live-artifact.ts`, `vela.ts`, `xai.ts`, `social-share.ts`, `attribution.ts`,
`open-design-public-metadata.ts`, `routine.ts`, plus mcp/plugins/import-export.

**Route-registration API (how the adapter injects product routes):**

```ts
// caller side, in foundry/integrations/open-design/daemon.ts
import { createDaemon } from '@jini/daemon-core';
import { genericRouteModules } from '@jini/daemon-core/routes';
import { odProductRoutes } from '@open-design/adapter/routes';   // design-systems, deploy, media, …

await createDaemon({
  ports: openDesignPorts,                                // OD impls of the 10 ports
  routeModules: [...genericRouteModules, ...odProductRoutes],
});
```

Each `RouteRegistrar<K>` declares its port slice; §2's `PortsCoverRoutes` assertion guarantees the OD
product routes only compile when `openDesignPorts` grants every slice they read (e.g. `design-systems.ts`
needs `resources` + `paths`, `deploy.ts` needs `credentials` + `render`). The fixed 40-entry list inside
`startServer` (the copy-and-run blocker from r1 §5.4) is replaced by this per-adapter opt-in array.

---

## 5. Dependency-ordered extraction task list (resumable)

Each task: scope + validation + which r1 §5 copy-and-run blocker it clears.

**T1 — `@jini/protocol` (contracts core).**
Scope: extract `RuntimeAgentDef` (types.ts), the normalized agent stream event union (from the 4 stream
parsers), ACP/pi-rpc message shapes (`agent-protocol/core`), error/diagnostic shapes. Rename/vendor
`@open-design/contracts` + `@open-design/registry-protocol` symbols the engine needs.
Validation: package typechecks standalone, zero `@open-design/*` imports remaining.
Clears blocker **§5.3** (`@open-design/*` package imports).

**T2 — `@jini/agent-runtime`.**
Scope: lift registry.ts + 25 defs + detection.ts (inject `AmrProfileResolver`) + 4 stream parsers +
env/launch/invocation/resolution supporting files + `agent-runtime-env.ts` (de-brand OD_*, clear
@ts-nocheck per §3). Define `PromptAugmenter`/`ArtifactTaxonomy`/`TelemetrySink` port interfaces (impls
deferred). Rewrite the chat-run trio to call ports instead of importing `../prompts`/`../media`/
`../integrations(vela)`/`../artifacts`.
Validation: `typecheck` (src+tests) zero TS2307; replay a `mocks/` trace through one stream parser
(`OD_MOCKS_TRACE`); spawn one real agent to confirm env injection. Per `feedback_daemon_full_validation_gate`.
Clears blocker **§5.5** (analytics schema — now behind TelemetrySink) and de-risks **§5.7** (question-form
moves to PromptAugmenter.systemOverlay).

**T3 — `@jini/persistence` (storage/session ports).**
Scope: lift `storage/{aws-sigv4,daemon-db,db-inspect}.ts`, `db.ts`; define `DatabasePort` +
`WorkspaceStorePort` + `ArtifactStore` with a better-sqlite3 default backend. `project-storage.ts`'s OD
project model becomes the OD adapter's `WorkspaceStorePort` impl.
Validation: default sqlite backend passes a CRUD round-trip test; `ArtifactStore` write/list/manifest test.

**T4 — `@jini/daemon-core` (composition root).**
Scope: build `createDaemon({ ports })` from Jini's harvested `server/{core,events,bootstrap}` (§3); define
all 10 port interfaces; generalize `route-context-contract.ts` → `PortsCoverRoutes` compile assertion (§2).
Extract the generic slice of `startServer` (listener, SSE, boot-reconcile, agent-runtime-env wiring) out of
the closure.
Validation: `createDaemon` boots with a stub port set (no OD content) and serves `/api/daemon` health +
a chat run against a `mocks/` agent; typecheck rejects a routeModule needing an unsupplied port (negative test).
Clears blocker **§5.1** (data-dir layout — now `PathsPort`), **§5.4** (fixed route list — now opt-in array),
**§5.6** (@ts-nocheck debt cleared during the lift).

**T5 — generic engine routes.**
Scope: move `routes/{chat,runs,terminal,daemon,telemetry,memory,active-context,static-resource}.ts` into
daemon-core `genericRouteModules`, each typed `RouteRegistrar<K>` reading only engine ports.
Validation: each generic route registers and responds under `createDaemon` with stub ports; route inventory
matches expected set.

**T6 — OD adapter wiring (`foundry/integrations/open-design`).**
Scope: implement all 10 ports with OD behavior (PathsPort product keys, WorkspaceStore=OD projects,
ArtifactTaxonomy=OD html/svg/design-system classification, PromptAugmenter=design-system+skills+discovery,
ResourceCatalog=skills/design-systems/templates, RegistryBackend=OD marketplace manifest, RenderService=
desktop exporters). Move ALL product dirs (design-systems, brands, critique, media, deploy, plugins,
prompts, figma, genui, live-artifacts, research, marketplace seed) here. Register OD product routes via the
route-registration API (§4). Re-point repo-root content dirs (`skills/`, `design-systems/`, `design-templates/`,
`craft/`) through PathsPort so they're adapter-owned, not engine-assumed.
Validation: full OD daemon boots via `createDaemon`, parity smoke against current `apps/daemon` on the
existing e2e suite (`e2e/tests/`); a fresh-repo engine boots with a NON-OD stub adapter and runs a chat —
proving the seam. Clears blocker **§5.2** (repo-root content dirs) and **§5.7** (question-form protocol now
fully adapter-owned).

Order rationale: contracts (T1) unblock everything; agent-runtime (T2) and persistence (T3) are independent
and can run in parallel after T1; daemon-core (T4) needs T2+T3 ports; generic routes (T5) need T4; OD adapter
(T6) is last because it consumes every port + the route API. Each Ti is independently typecheckable and leaves
the tree green (strangler-fig: OD's current `apps/daemon` keeps working until T6 flips the composition root).
