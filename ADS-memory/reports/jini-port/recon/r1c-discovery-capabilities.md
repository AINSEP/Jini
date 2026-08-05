# R1c — Engine agent/CLI discovery + capability negotiation subsystem

Design for a core engine capability (`@jini/agent-runtime` discovery layer) that OD / Zana /
Open-Marketing / Tovu-Runner all consume. Grounded in OD's verified source; **(current)** = as-built in
OD, **(proposed)** = new engine design that OD doesn't do yet. Cited files:
`runtimes/{detection,capabilities,models,auth,executables,registry,types}.ts`, `defs/*`,
`routes/static-resource.ts`, `agents.ts`.

Two honest baselines to state up front:
- OD discovery is **(current)** *stateless recompute*: `detectAgents()` runs the full probe fan-out on every
  `/api/agents` call (`routes/static-resource.ts:111`), with a fire-and-forget **warm-cache prefetch** at
  daemon boot (`server.ts:2429` — "so a later call hits a populated cache"). There is **no disk record** under
  the data root today.
- OD's model cache is **(current)** an **in-memory `Map`** (`models.ts:13` `liveModelCache`/`liveModelOrder`),
  and `agentCapabilities` is an in-memory `Map` too (`capabilities.ts:3`). Nothing is persisted.

The engine design below *adds* a daemon-owned persisted source-of-truth, keeping the probe logic OD already
has. This is the main upgrade discovery gets in the extraction.

---

## 1. Discovery source-of-truth

### Location (daemon-owned, under resolved data root — not web, not committed) **(proposed)**
A single JSON store the daemon writes and reads:

```
<RUNTIME_DATA_DIR>/agents/discovery.json          # the agent-availability record set
<RUNTIME_DATA_DIR>/agents/models/<agentId>.json   # per-agent model catalog (longer TTL, see §2)
```

`RUNTIME_DATA_DIR` is the one truth source (`OD_DATA_DIR → RUNTIME_DATA_DIR`, per the daemon data-dir
contract). Discovery is daemon data → it MUST live under the resolved root, never web-side, never in git.
It is a **cache/derived artifact**, so it's safe to delete (rebuilt by a scan) and must be `.gitignore`d.
Consumers never read the files directly — they go through the API (§1c).

### Record schema per agent **(proposed schema, fields grounded in `DetectedAgent`/`AgentAuthProbeResult`)**

```ts
// @jini/agent-runtime — the persisted discovery record
export interface AgentDiscoveryRecord {
  id: string;                       // def id (registry.ts) — 'claude','codex',…
  binPath: string | null;           // resolved launch path (detection.ts: launch.selectedPath); null ⇒ unavailable
  version: string | null;           // parsed --version line (detection.ts:135); null = invocable, version unread
  available: boolean;               // version probe spawned OK (detection.ts:253)
  authState: 'ok' | 'missing' | 'unknown';   // AgentAuthProbeResult.status (auth.ts:5) — NEVER the credential
  authMessage?: string;             // human guidance only (auth.ts) — no secrets
  capabilities: AgentCapabilities;  // the discriminated-union descriptor (§3), derived from def + --help probe
  models: RuntimeModelOption[];     // surfaced list (detection.ts:251)
  modelsSource: 'live' | 'fallback';// did listModels/fetchModels succeed, or static fallback (detection.ts:252)
  discoveredAt: number;             // epoch ms of this probe
  probeSource: 'startup-scan' | 'ttl-revalidate' | 'explicit-rescan' | 'spawn-failure-invalidate';
  diagnostics?: AgentDiagnostic[];  // not-invocable/auth diagnostics (detection.ts) for Settings UX
  probeFingerprint: string;         // hash of {PATH dirs, *_BIN env, def.version} → change detection (§2)
}
export interface AgentDiscoverySnapshot {
  records: AgentDiscoveryRecord[];
  scannedAt: number;
  schemaVersion: number;            // bump invalidates the whole file on engine upgrade
}
```

This is the `DetectedAgent` shape (verified `types.ts:252`) plus persistence metadata (`discoveredAt`,
`probeSource`, `probeFingerprint`, `schemaVersion`). `DetectedAgent` already `Omit`s the function-valued
def fields (`buildArgs`/`listModels`/`fetchModels`) so the record is JSON-serializable by construction.

### One API, both consumers (UI + CLI) **(current endpoint, extended)**
- `GET /api/agents` — returns the snapshot (`routes/static-resource.ts:111`). **(current)**
- `GET /api/agents` with `Accept: text/event-stream` → `detectAgentsStream` yields records as each probe
  resolves (`static-resource.ts:148`) so the UI paints incrementally. **(current)**
- Web UI Settings consumes `/api/agents`; the `od` CLI (`od agents --json`) hits the *same* endpoint — the
  dual-track rule (both surfaces call the same `/api/*`, DTO in `packages/contracts`). Verified a third
  consumer already reads it (`mcp.ts:1035` `${baseUrl}/api/agents`). **(current)**
- `POST /api/agents/rescan` — force a fresh scan, write the record, return it (§2). **(proposed)**

The daemon is the sole producer; every consumer is a reader of one JSON contract → no divergent shapes.

---

## 2. Refresh / invalidation policy **(proposed, extends OD's warm-prefetch)**

Split freshness into **two clocks** because availability and model catalogs change on very different cadences:

| clock | subject | TTL | rationale |
|---|---|---|---|
| **availability freshness** | binPath / version / authState / available | **short (~60s)** | user installs/uninstalls/logs-in mid-session; must feel live |
| **model-catalog freshness** | models / modelsSource | **long (~24h)** | `listModels`/`fetchModels` are expensive (8MB buffers, network) and models rarely change; OD already caches these separately (`models.ts`, `amr-model-cache.ts`) |

Triggers:
1. **Startup scan.** Daemon boot kicks a full `detectAgents()` into the store (`probeSource:'startup-scan'`) —
   this is OD's existing warm-prefetch (`server.ts:2429`), now persisted instead of in-memory-only.
2. **TTL revalidation.** On `GET /api/agents`, if `now - discoveredAt > availabilityTTL`, re-probe
   version+auth (cheap) but reuse cached models if within model TTL. Serve stale-while-revalidate: return the
   last snapshot immediately, refresh in the background, push updates over SSE.
3. **Explicit rescan.** `POST /api/agents/rescan` (all) or `?agentId=` (one) → full probe, bypass TTL.
   Settings "Re-scan agents" button and `od agents rescan` both hit it.
4. **ENOENT / spawn-failure invalidation.** When a *real chat run* spawn fails with `ENOENT`/`EACCES`/exit
   126/127 (the exact codes `probeVersionAtPath` classifies, detection.ts:139–150), the daemon marks that
   record `available:false, probeSource:'spawn-failure-invalidate'` and schedules a re-probe — so a binary
   deleted after discovery doesn't keep showing as installed.
5. **PATH / config-hash change detection.** `probeFingerprint = hash(agentSearchDirs() + <agentId>_BIN env +
   def.version)`. `agentSearchDirs()` is already exported for exactly this (executables.ts:118). On each read,
   if the live fingerprint ≠ the stored one, the availability cache is stale regardless of TTL → re-probe.
   Catches "user edited PATH" / "set CODEX_BIN" without waiting for TTL.
6. **Schema-version bump** invalidates the whole file on engine upgrade (record shape changed).

Probe is still `max(help, models, auth)` concurrent per agent (detection.ts:239 `Promise.all`), gated behind
the version probe that determines availability — keep that structure; it's already optimal.

---

## 3. Capability model — discriminated unions (preserve richness, don't flatten)

OD encodes capabilities as **flat optional flags** on `RuntimeAgentDef` (`promptViaStdin?`,
`promptInputFormat?`, `resumesSessionViaCli?`, `capturesSessionIdFromStream?`, `resumesSessionViaAcpLoad?`,
`externalMcpInjection?`, `streamFormat`, `eventParser?`). **(current)** This works but a generic consumer has
to know every flag. The engine should **project those flags into a discriminated descriptor** so each axis is
one tagged union a consumer can `switch` on and fall through the `default` for kinds it doesn't understand:

```ts
// @jini/agent-runtime — derived from the def; the negotiated capability surface
export interface AgentCapabilities {
  promptTransport:
    | { kind: 'argv'; maxBytes?: number }              // def.maxPromptArgBytes
    | { kind: 'stdin-text' }                            // promptViaStdin, promptInputFormat 'text'
    | { kind: 'stdin-jsonl' }                           // promptViaStdin + promptInputFormat 'stream-json'
    | { kind: 'file' };                                 // promptViaFile
  events:
    | { kind: 'plain' }                                 // plain-stream
    | { kind: 'jsonl' }                                 // json-event-stream (eventParser)
    | { kind: 'claude-stream' }                         // claude-stream.ts
    | { kind: 'acp-json-rpc' };                         // ACP (agent-protocol/acp) / pi-rpc
  resume:
    | { kind: 'none' }
    | { kind: 'specified-id' }                          // daemon mints newSessionId (claude --session-id)
    | { kind: 'captured-id'; from: 'stream-status' }    // capturesSessionIdFromStream (codex thread_id)
    | { kind: 'acp-load' };                             // resumesSessionViaAcpLoad (AMR/vela session/load)
  midTurnInput:
    | { kind: 'none' }
    | { kind: 'stdin-jsonl' };                          // stream-json keeps stdin open for follow-up user msgs
  models:
    | { kind: 'static'; options: RuntimeModelOption[] } // fallbackModels only
    | { kind: 'command'; args: string[] }               // def.listModels
    | { kind: 'remote' };                               // def.fetchModels (network)
  mcp:
    | { kind: 'none' }
    | { kind: 'claude-mcp-json' }                       // externalMcpInjection variants (types.ts:165)
    | { kind: 'acp-merge'; envFormat: 'array' | 'map' } // acpMcpEnvFormat (types.ts:249)
    | { kind: 'opencode-env-content' }
    | { kind: 'mimo-env-content' };
  cancellation:
    | { kind: 'signal' }                                // SIGTERM the child (default)
    | { kind: 'acp-cancel' };                           // ACP session/cancel RPC
  supportsImages: boolean;                              // def.supportsImagePaths
  supportsCustomModel: boolean;                         // def.supportsCustomModel (default true)
  authProbe: boolean;                                   // def.authProbe present
}
```

### Graceful degradation for a generic consumer
Every axis is a tagged union with a stable `kind` string, so a consumer that predates a new variant does:

```ts
switch (cap.events.kind) {
  case 'plain': case 'jsonl': return parseKnown(cap.events.kind);
  default: return parseAsPlainText();   // unknown parser ⇒ treat stdout as opaque text, don't crash
}
```

Degradation rules the engine documents per axis:
- **promptTransport** unknown → fall back to `argv` (universal); if `maxBytes` unknown, assume conservative.
- **events** unknown → `plain` (render raw stdout; lose structured tool events but stay functional).
- **resume** unknown → `none` (spawn fresh each turn; re-inject transcript — always correct, just less efficient).
- **models** unknown → treat as `static` with whatever `options`/fallback are present.
- **mcp / midTurnInput / cancellation** unknown → the safe baseline (`none` / `none` / `signal`).

This is the key contract: **new richness is additive**; a `default` arm keeps old consumers correct, never
flattening a rich agent to a lowest-common-denominator string. The projection lives in ONE place
(`deriveCapabilities(def): AgentCapabilities`), so the flat def flags remain the authoring surface and the
union is the consumption surface.

---

## 4. Extensibility — new agent CLI, zero switchboard edits **(verified in `registry.ts`)**

The pattern already exists and is the standard to preserve. Adding an agent is:
1. Create `runtimes/defs/<agent>.ts` exporting a `RuntimeAgentDef` literal (bin, versionArgs, buildArgs,
   fallbackModels, streamFormat, and whichever capability flags apply).
2. If it needs a novel stream shape, add a parser and reference it via `eventParser`/`streamFormat`; the four
   existing parsers (plain/jsonl/claude-stream/qoder + acp) cover most.
3. Register by adding the import + array entry in `registry.ts` (`BASE_AGENT_DEFS`, lines 29–55).

That is the **only** central touch, and it's a declarative array append, not a `switch`/`if` ladder. Verified:
- `registry.ts` iterates `AGENT_DEFS` generically (`getAgentDef` is `.find(a => a.id === id)`, line 76) — no
  per-agent branching.
- `detection.ts` `probe(def)` is fully generic over any `RuntimeAgentDef` — version/help/models/auth probes
  read only def fields (`def.versionArgs`, `def.helpArgs`+`def.capabilityFlags`, `def.listModels`/`fetchModels`,
  `def.authProbe`). A new def is auto-probed with no detection edit.
- Capabilities come from `def.capabilityFlags` × `--help` output (detection.ts:188) — data-driven, no switch.
- Model handling reads `def.listModels`/`def.fetchModels`/`def.fallbackModels` — no per-agent code.

Engine hardening to make it *truly* zero-central-edit **(proposed, small upgrade over `registry.ts`)**:
replace the hand-maintained import list with a **def auto-registration barrel** — a `defs/index.ts` that
`registry` consumes, or a `registerAgentDef()` call each def file makes on import — so a new agent is a single
new file with no edit to a shared array. The dup-id guard (`registry.ts:68`) stays as the integrity check.
Local-profile defs already extend the set at runtime without core edits (`readLocalAgentProfileDefs`,
registry.ts:57) — proving the array is not a closed switchboard.

---

## 5. Security boundary **(current behavior, verified)**

1. **Probes are daemon-side only.** `detectAgents`/`detectAgentsStream` run in the daemon process
   (`agents.ts:7` re-exports from `runtimes/detection.js`; invoked from the daemon route
   `static-resource.ts`). The browser never spawns anything. `apps/web/**` importing `apps/daemon/src/**` is
   forbidden by the repo boundary — the web only sees the `/api/agents` JSON.
2. **Never trust a browser-supplied executable path.** Binary resolution is fully daemon-computed:
   `resolveAgentLaunch(def, configuredEnv)` (detection.ts:211) walks `agentSearchDirs()` (executables.ts) and
   honors ONLY server-side env overrides (`<AGENT>_BIN`, `agentBinEnvKey`, executables.ts:125). There is no
   request field for a client to pass a path to spawn. **The engine must keep this invariant: `binPath` is an
   output of discovery, never an input from the API.** A client asking to run agent `X` selects by `id`; the
   daemon maps id→path from its own record.
3. **Credentials stay server-side; only `authState` surfaces.** The auth probe runs a cheap declarative
   status/whoami command (`def.authProbe`, detection.ts:242 → `probeAgentAuthStatus`, auth.ts:357) and reduces
   the result to `{ status: 'ok'|'missing'|'unknown', message? }` (`AgentAuthProbeResult`, auth.ts:5). API keys
   / tokens (`CURSOR_API_KEY`, `DEEPSEEK_API_KEY`, OAuth tokens) live in the daemon process env / credential
   store and are **never** placed in the record — only the boolean-ish `authState` and human guidance copy
   (`authMessage`) cross to the client. The model-validation allow-list (`models.ts:11` "so a stale or hostile
   value can't smuggle arbitrary flags") is the parallel guard on the model axis: a client-supplied model id
   is rejected unless it's in the discovered live set or static fallback.
4. **Probe output is sanitized.** stdout/stderr from `--version`/`--help`/auth probes is parsed into typed
   fields (version string, capability booleans, auth status), never streamed raw to the client, so a hostile
   CLI can't inject arbitrary payload into the record. `redact.ts` (daemon) is the pattern for scrubbing any
   text that does surface (authMessage).

Engine port note: discovery reads the **CredentialStorePort** (`authState` derivation) and **PathsPort**
(`RUNTIME_DATA_DIR` for the store) from r1b — it must not reach for `process.env.OD_*` or a cwd fallback
directly, keeping the data-root injection contract intact.
