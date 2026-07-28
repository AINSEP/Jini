# Jini AI Control Plane and Capability MCP

Date: 2026-07-19
Status: **Proposed debate seed — not an approved architecture decision**
Scope: Jini's agent-facing control plane, product capability discovery, MCP exposure, backend access, plugin-contributed tools, frontend actions, and authorization boundaries.

This document captures a design direction discovered while exercising Jini's new local run path. It is deliberately detailed so it can serve as the starting packet for an architecture debate. It extends the locked Jini kernel architecture; it does not replace or silently amend `foundry/docs/jini-port/extraction-plan.md`.

## 1. Executive summary

Jini needs an agent-facing control plane through which any supported agent can discover and use the capabilities of the product hosting Jini. Open Design is the first host, but the infrastructure must remain product-neutral so Open-Marketing, Tovu-Runner, Zana, and future consumers can expose their own capabilities without adding product concepts to the Jini kernel.

The central product principle is:

> If a user can cause a meaningful product outcome through the frontend, an authorized agent should usually be able to request the same outcome through a controlled product service.

This means outcome parity, not UI-click parity and not blind route parity. An agent should be able to request “export this project as PowerPoint,” not simulate every menu click or call an unrestricted HTTP-request tool. Frontend, HTTP, CLI, and MCP transports should converge on the same application service whenever the outcome is fundamentally a backend operation.

The complete product capability catalog may eventually contain hundreds or thousands of entries contributed by core features and plugins. Sending all of those definitions to every model would waste context, lower tool-selection accuracy, expose irrelevant privileged operations, and make versioning difficult. The proposed answer is a two-level model:

1. Maintain a broad, searchable `CapabilityCatalog` containing metadata for every installed capability.
2. Give each run a small, contextual, least-privilege set of activated capabilities.

The initial agent surface remains small:

```text
capabilities.search
capabilities.describe
capabilities.request_activation
capabilities.execute       # compatibility fallback, not the preferred path
```

The agent searches the catalog, requests the capabilities relevant to its task, and receives strongly typed native MCP tools when the client supports refreshing its tool list. A generic `capabilities.execute({ capabilityId, input })` path remains available for clients that cannot accept dynamic tools; it still validates input and executes through Jini's existing authorization boundary.

SQLite is a good storage and search adapter for the catalog, activation records, and durable audit data. SQLite must not become a bag of executable functions or a raw database surface. Capability metadata can live in SQLite; handlers remain in a private runtime registry or a separately authenticated out-of-process provider. Product data remains behind product application services.

## 2. Why this surfaced now

On 2026-07-19, the current Jini HTTP/run/agent path was exercised against a real locally installed Codex CLI:

```text
local HTTP POST /api/runs
  -> host-owned run-start callback
  -> Jini AgentExecutor
  -> local Codex CLI
  -> canonical events over SSE
  -> terminal succeeded run
```

A first prompt asked Codex to return a fixed marker. The marker was received through SSE and the run finished successfully. A second prompt was exactly:

```text
What time is it right now?
```

Codex answered successfully, but the structured stream showed that it independently invoked its own web-search facility. Jini observed the event after it happened. Jini did not authorize or deny it before execution.

That test established two separate facts:

1. The local daemon shape works: an HTTP request can start a local agent and stream the result.
2. Launching an autonomous CLI and reading its output does not make Jini the authority over the CLI's native tools.

This is the control-plane gap. Jini needs a deliberate way for agents to ask the product to perform backend actions through Jini's policy boundary. At the same time, agents must be sandboxed so direct file access, raw database access, ambient credentials, shell access, and native web tools cannot silently replace that controlled path.

The live exercise used temporary directories and a temporary host callback. It did not establish that the current `minimal-host` is a finished user-facing daemon. In particular:

- `POST /api/runs` currently accepts `contextRef`, optional `agentId`, and optional `idempotencyKey`; it does not yet define a real prompt/history/runtime-profile request.
- The temporary test used `contextRef` as the prompt solely to prove the end-to-end path. That is not the proposed wire contract.
- `createLocalNodeDaemon()` binds a real `AgentExecutor`, but a host must still supply `onRunStarted` to map an accepted run to an agent, prompt, working directory, environment, and authority policy.
- The current `agents?: unknown[]` node-host option is documented as forward-compatible but is not wired into execution.

## 3. Existing Jini pieces

This proposal should build on the working pieces rather than create a parallel execution system.

### 3.1 Tool registry

`packages/core/src/tool-registry.ts` already establishes a critical invariant:

- public callers can register and list tool descriptors;
- handlers and policies are not publicly retrievable;
- only the internal execution boundary can resolve the full registration.

The current descriptor includes an ID, description, confirmation flag, timeout, and output limit. A capability control plane will likely need additional metadata such as input/output schemas, risk classification, tags, version, provider identity, availability, and scope requirements. Whether those fields extend `ToolDescriptor` or live in a feature-owned `CapabilityDescriptor` is a debate question; the kernel should not absorb feature metadata casually.

### 3.2 Tool executor

`packages/daemon/src/tool-executor.ts` already provides:

- authorization policy evaluation;
- an optional transport-owned authorization delegate;
- confirmation;
- timeout and cancellation;
- output truncation;
- execution audit phases.

This is the authority boundary. MCP handlers, HTTP handlers, CLI commands, plugins, and agents must not retrieve or invoke backend handlers directly. They should enter through this executor or a generalized capability executor preserving the same invariants.

The current audit and pending-confirmation maps are in memory. A production control plane will need to decide which activation, confirmation, and audit state must survive restart.

### 3.3 Delegated tool bridge

`packages/daemon/src/delegated-tool-bridge.ts` already translates an agent/protocol request into:

```text
canonical tool_use event
  -> ToolExecutor.execute()
  -> canonical tool_result event
```

It also combines transport cancellation with run cancellation. This is the correct transport-neutral seam for a future MCP server or another delegated-execution protocol.

### 3.4 MCP package

`packages/mcp/` currently contains product-neutral MCP configuration, OAuth/token handling, install-payload planning, and per-agent installation planning. It intentionally does **not** contain the Open Design MCP stdio server that existed upstream.

The upstream server was dropped because it hardcoded Open Design routes and nouns such as projects, design systems, artifacts, skills, plugins, and studio URLs. Porting that server into the neutral package would have tilted Jini toward its first consumer.

The missing generic MCP runtime is therefore a real gap, not an accidental rename:

- Jini can describe/install MCP server configurations.
- Jini cannot yet act as the generic capability MCP server proposed here.
- Open Design-specific capabilities must remain in an Open Design integration/consumer pack.

### 3.5 Agent protocols

Jini currently supports multiple agent stream families, including JSON-stream CLIs and ACP-based agents. ACP permission requests can be intercepted before an ACP agent selects a native action, but ACP native permission is not the same thing as executing a Jini-registered backend capability.

The control plane needs two distinct concepts:

- **Native-agent action:** a shell/file/web/tool operation the autonomous agent owns.
- **Jini delegated capability:** an operation the agent asks Jini to execute through Jini's registry and policy gate.

Conflating them would create false security claims.

### 3.6 External prior art: a sibling repo already shipped this pattern

`/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic` (a separate repository, not a Jini package — its code must not be imported into `@jini/*`) already designed and partly shipped the same problem for Open Design directly, via an umbrella RFC (`docs/rfc-drafts/agent-ready.md`) and a companion cross-project RFC (`docs/rfc-drafts/agent-ready-cross-project.md`). This is shipped code, not just prior prose:

- `packages/contracts/src/agent-tools/{descriptor,manifest,registry,actions,task}.ts` — pure-type contracts for a tool descriptor discriminated on `surface: 'browser' | 'api'`, a manifest (the `tools/list` analog), and a paged search query/result (the `tools/search` analog).
- `packages/agent-tools/src/sqlite-registry.ts` — a working SQLite-backed `AgentToolRegistry`, structurally forbidden from importing `apps/*`.
- `apps/daemon/src/browser-actions/tools.ts` — five shipped browser tools (`navigation.goto`, `ui.click`, `ui.fill`, `ui.waitFor`, `ui.observe`).

Decisions this prior art already validated in running code, which this proposal should adopt rather than re-derive:

1. **Two distinct call paths, not one universal envelope.** An `api` tool is a normal route call (the daemon invokes its declared `/api/*` route directly); a `browser` tool is a dispatch-and-await round trip (`BrowserActionRequest` → live session → `BrowserActionResult`), because only the browser surface runs in a remote context the daemon must wait on. This concretizes §15's UI-session-action category with an actual wire shape.
2. **A dual-track litmus test, enforced structurally.** A tool may skip an `od` CLI form and ship as `surface: 'browser'` (`viewStateOnly: true`) *only if* "could it be meaningfully invoked with no browser attached?" fails — navigate/scroll/focus/panel-visibility pass (exempt); "export the deck" does not (must be `surface: 'api'` with both a route and a CLI subcommand). Recommend adopting this litmus test verbatim as the read/write vs. UI-session-only boundary test for §15.
3. **Explicit allowlist attributes, never raw selectors.** `ui.click` / `ui.fill` only ever resolve `data-agent-target=` / `data-agent-field=` values — an author-controlled, explicit opt-in — never `document.querySelector(<model-supplied selector>)`. This is a concrete, already-working answer to §24's "no generic `evalJavaScript`" anti-pattern for the Stage 6 frontend bridge.
4. **PUSH vs. PULL as the actual reason for two discovery paths, not an incidental split.** `browser`-surface availability is PUSH-advertised per session (the daemon cannot know what's mounted without the tab telling it); the persistent `api` catalog is PULL-discovered via search. This independently validates this proposal's activation-vs-search split (§10, §13).
5. **A daemon-minted `invocationId` as the sole action identity** — never a provider `tool_call_id` or MCP request id, which are absent on the MCP-bridge path and scoped per-provider-turn. Directly reusable for the audit/execution identity in §19.6.
6. **SQLite under the resolved data root, FTS5 named as the next step for search** — the same conclusion this proposal reaches independently in §9, already shipped (today as `LIKE`, matching this proposal's Option A default).
7. **A dedicated, GenUI-patterned return endpoint** (`POST /api/runs/:runId/actions/:invocationId/result`, a pending→responded lifecycle) rather than overloading an existing HITL table — a concrete precedent for the "structured result" transport §15.2 leaves undefined.
8. **Contracts-first, runtime-guarded slicing.** Slice 1 shipped types only; slice 2's runtime package is structurally forbidden from importing product-specific code, enforced by a `check-cross-app-imports.ts`-style guard wired into `pnpm guard` — the same discipline `scripts/check-engine-boundaries.ts` already enforces in this repo. Validates the staged rollout in §22.

Open naming mismatch to resolve in debate: the OD RFC calls the top-level noun a "tool" (`AgentToolDescriptor`, `AgentToolRegistry`); this proposal calls it a "capability" (`CapabilityDescriptor`, `CapabilityCatalog`) and reserves "tool" for the invocable subset. Both cannot be canonical — see debate question 29.

## 4. Goals

The proposed control plane should:

1. Let any supported agent discover product capabilities using product language.
2. Let frontend users and agents find capabilities through the same searchable catalog.
3. Keep the model's initial tool surface small and relevant.
4. Route every backend effect through a typed application service and authorization boundary.
5. Support product features and plugin-contributed capabilities.
6. Express read, write, destructive, external, UI-session, and human-only risk classes.
7. Scope capabilities to the current principal, run, workspace/context, host, and connected frontend session.
8. Provide confirmation, cancellation, timeouts, idempotency, validation, redaction, and audit records.
9. Preserve product neutrality in `@jini/*` while allowing rich product-specific capability packs.
10. Support local stdio MCP first and authenticated external transports later.
11. Allow capability metadata and search to survive daemon restart.
12. Keep agent-native tools from bypassing the intended backend path through sandboxing and minimal authority.

## 5. Non-goals

The proposal should not:

1. Put all Open Design routes or database tables into the Jini kernel.
2. Generate one MCP tool for every HTTP endpoint.
3. Give agents raw SQLite file paths, unrestricted SQL, arbitrary filesystem roots, or a generic unrestricted HTTP client.
4. Treat omission from the model's visible tool list as authorization.
5. Let agents activate their own privileged capabilities without host policy.
6. Make every visual frontend interaction a backend tool.
7. Expose secrets, OAuth tokens, passwords, recovery operations, or account-security controls to a model.
8. Claim control over autonomous CLI-native tools that Jini only observes after execution.
9. Load untrusted third-party plugin code in-process and call that a secure sandbox.
10. Make SQLite the storage format for JavaScript functions or other executable handler bodies.

## 6. Terminology

### Capability

A discoverable thing a product can provide to an agent or user. A capability may be:

- a backend tool/action;
- a read-only resource;
- a frontend-session action;
- a workflow composed of lower-level actions;
- an external integration action.

### Tool

An invocable capability with a typed input and output. Tools can have side effects.

### Resource

Read-only contextual information, such as a project summary, schema description, design-token catalog, or capability guide. Resources should carry information without multiplying action tools.

### Capability catalog

The searchable metadata index of all installed and known capabilities. Catalog membership does not imply runtime availability or authorization.

### Runtime registry

The private resolution layer mapping an exact capability ID/version/schema hash to an executable handler and policy or to an authenticated out-of-process provider.

### Activation

A run-scoped decision to expose a capability to a particular agent session. Activation narrows the visible surface but does not replace execution-time authorization.

### Capability profile

A curated set of capabilities appropriate to a task class, such as research, editing, design-system work, plugin administration, or release/deploy.

### Frontend bridge

A short-lived authenticated channel through which a backend run can request an action that only a connected browser/desktop UI can perform, such as a file picker, visible selection, or user confirmation.

## 7. Proposed high-level architecture

```text
                    PRODUCT HOST

 Frontend command palette       Local/remote agent
            |                         |
            | catalog search          | MCP / ACP / adapter
            v                         v
      +----------------------------------------+
      |       Capability Control Plane          |
      |                                        |
      |  CapabilityCatalog                     |
      |  Profile + Context Resolver            |
      |  Activation Manager                    |
      |  MCP / frontend / HTTP adapters         |
      +-------------------+--------------------+
                          |
                          | exact capability invocation
                          v
      +----------------------------------------+
      |       ToolExecutor / Policy Gate        |
      | authorize -> confirm -> execute -> audit|
      +-------------------+--------------------+
                          |
            +-------------+--------------+
            |                            |
            v                            v
 Product application service      Frontend-session bridge
            |
    +-------+---------+------------------+
    |                 |                  |
 Product SQLite   Files/artifacts   External providers

 Separate and private:
 - Jini event-log SQLite
 - runtime handler registry
 - credentials/token stores
```

The key direction is horizontal parity over a shared application service:

```text
Frontend HTTP route ----+
CLI command ------------+--> product app-service --> stores/providers
MCP capability ---------+
```

No transport should reproduce product business logic independently.

## 8. Capability metadata model

A detailed descriptor might look like this conceptually:

```json
{
  "id": "open-design.project.export_pptx",
  "version": "1.2.0",
  "schemaHash": "sha256:...",
  "provider": {
    "kind": "plugin",
    "id": "open-design.exports",
    "version": "3.4.0",
    "trustTier": "built-in"
  },
  "title": "Export project to PowerPoint",
  "summary": "Create a PPTX export for the active project.",
  "description": "Runs export preflight and produces a downloadable PPTX result.",
  "kind": "tool",
  "tags": ["project", "export", "powerpoint", "pptx", "presentation"],
  "aliases": ["export deck", "download slides"],
  "inputSchema": {
    "type": "object",
    "properties": {
      "includeNotes": { "type": "boolean" }
    },
    "additionalProperties": false
  },
  "outputSchema": {
    "type": "object",
    "required": ["artifactRef"],
    "properties": {
      "artifactRef": { "type": "string" }
    }
  },
  "risk": "external-write",
  "requiresConfirmation": true,
  "supportsDryRun": true,
  "idempotency": "required",
  "requiredScopes": ["project:read", "project:export"],
  "requiredContext": ["active-project"],
  "frontendRequirement": "none",
  "timeoutMs": 120000,
  "maxOutputBytes": 32768,
  "availability": "available"
}
```

Exact field ownership is undecided. At minimum, the catalog needs enough structured metadata to support:

- safe filtering before search;
- high-quality text discovery;
- input/output validation;
- user-facing descriptions;
- version and provider pinning;
- risk and confirmation decisions;
- context and frontend-session requirements;
- runtime availability checks.

## 9. SQLite catalog proposal

SQLite with FTS5 is a strong default for a local daemon. It is durable, transactional, easy to package, and more than sufficient for hundreds or thousands of metadata records. The first version should use lexical search, aliases, tags, and contextual ranking before adding embeddings.

An illustrative schema follows. It is intentionally conceptual; names and normalization should be debated before implementation.

```sql
CREATE TABLE capability_definitions (
  capability_id          TEXT NOT NULL,
  capability_version     TEXT NOT NULL,
  schema_hash            TEXT NOT NULL,
  provider_id            TEXT NOT NULL,
  provider_version       TEXT NOT NULL,
  provider_kind          TEXT NOT NULL,
  trust_tier             TEXT NOT NULL,
  kind                   TEXT NOT NULL,
  title                  TEXT NOT NULL,
  summary                TEXT NOT NULL,
  description            TEXT NOT NULL,
  input_schema_json      TEXT,
  output_schema_json     TEXT,
  risk_class             TEXT NOT NULL,
  requires_confirmation  INTEGER NOT NULL,
  supports_dry_run       INTEGER NOT NULL,
  idempotency_mode       TEXT NOT NULL,
  timeout_ms             INTEGER,
  max_output_bytes       INTEGER,
  availability           TEXT NOT NULL,
  enabled                INTEGER NOT NULL,
  installed_at           INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  PRIMARY KEY (capability_id, capability_version)
);

CREATE TABLE capability_tags (
  capability_id       TEXT NOT NULL,
  capability_version  TEXT NOT NULL,
  tag                 TEXT NOT NULL
);

CREATE TABLE capability_aliases (
  capability_id       TEXT NOT NULL,
  capability_version  TEXT NOT NULL,
  alias               TEXT NOT NULL
);

CREATE TABLE capability_scopes (
  capability_id       TEXT NOT NULL,
  capability_version  TEXT NOT NULL,
  scope               TEXT NOT NULL
);

CREATE TABLE capability_context_requirements (
  capability_id       TEXT NOT NULL,
  capability_version  TEXT NOT NULL,
  requirement         TEXT NOT NULL
);

CREATE VIRTUAL TABLE capability_search USING fts5(
  capability_id,
  title,
  summary,
  description,
  tags,
  aliases,
  tokenize = 'unicode61'
);

CREATE TABLE run_capability_activations (
  run_id               TEXT NOT NULL,
  capability_id        TEXT NOT NULL,
  capability_version   TEXT NOT NULL,
  schema_hash           TEXT NOT NULL,
  source                TEXT NOT NULL,
  activated_by          TEXT NOT NULL,
  activated_at          INTEGER NOT NULL,
  expires_at            INTEGER,
  PRIMARY KEY (run_id, capability_id)
);

CREATE TABLE capability_execution_audit (
  execution_id          TEXT PRIMARY KEY,
  run_id                TEXT NOT NULL,
  principal_id          TEXT NOT NULL,
  capability_id         TEXT NOT NULL,
  capability_version    TEXT NOT NULL,
  schema_hash           TEXT NOT NULL,
  requested_at          INTEGER NOT NULL,
  authorization_result  TEXT,
  confirmation_result   TEXT,
  execution_status      TEXT,
  input_hash            TEXT,
  output_hash           TEXT,
  redacted_detail_json  TEXT,
  completed_at          INTEGER
);
```

The database stores definitions, state, and evidence. It does not contain executable JavaScript handler bodies.

### 9.1 Source of truth

The recommended starting stance is:

- built-in feature/plugin manifests are the source of declared capability metadata;
- SQLite is a validated, searchable, durable materialization of those manifests plus local enablement state;
- the private runtime registry is the source of currently executable handlers;
- an exact ID, version, and schema hash must match before execution.

This avoids a stale catalog entry resolving to a different upgraded handler. It also lets historical audit records continue referencing removed versions without making those versions runnable.

An alternative is to make SQLite the authoritative mutable catalog. That is simpler for dynamically installed remote tools but raises provenance, tampering, upgrade, and reconciliation questions. This should be debated explicitly.

## 10. Search and discovery

### 10.1 Agent-facing search

The permanent discovery tool should accept structured filters rather than only a free-form query:

```json
{
  "query": "export this project as a powerpoint",
  "kinds": ["tool", "workflow"],
  "risk": ["read", "write", "external-write"],
  "limit": 5
}
```

The server supplies authority and context; the agent does not get to claim them:

- principal and scopes;
- active product/host;
- current run;
- active project/workspace/context reference;
- connected frontend session;
- enabled plugins and providers;
- current capability profile;
- host policy.

### 10.2 Filter before ranking

Search must never rank the global catalog and filter afterward. Mandatory authority and availability filters should run first so unauthorized or sensitive capability names are not leaked through results.

Suggested search stages:

1. Resolve principal, run, host, active context, and frontend session.
2. Filter disabled, unavailable, incompatible, untrusted, and out-of-scope definitions.
3. Filter capabilities whose required context is absent.
4. Apply SQLite FTS to title, summary, description, tags, and aliases.
5. Boost the current profile, active feature area, and exact domain nouns.
6. Optionally rerank with semantic similarity after lexical behavior is measured.
7. Return a small result set with concise, normalized summaries and risk labels.

### 10.3 Result shape

Search results should be summaries, not full schemas:

```json
{
  "results": [
    {
      "id": "open-design.project.export_pptx",
      "version": "1.2.0",
      "title": "Export project to PowerPoint",
      "summary": "Create a PPTX export for the active project.",
      "risk": "external-write",
      "requiresConfirmation": true,
      "availability": "available",
      "matchReason": "Matched project, export, PowerPoint, and PPTX."
    }
  ]
}
```

The agent calls `capabilities.describe` only for likely candidates. That response can include complete JSON schemas, examples, limitations, and confirmation behavior.

### 10.4 Frontend search

The frontend should call the same catalog application service for:

- command palette actions;
- plugin marketplace capabilities;
- “what can the assistant do here?” UI;
- admin capability inspection;
- permission and audit views.

The frontend may apply presentation filters, but it should not maintain an independent catalog or ranking implementation.

### 10.5 Semantic search

Embeddings may improve matches such as “turn this into slides” -> `project.export_pptx`, but should not be the first dependency. Initial quality should come from:

- stable domain names;
- concise summaries;
- curated aliases and synonyms;
- feature/profile boosts;
- active-context information;
- FTS5 ranking.

If semantic search is added, vectors should be derived from normalized trusted metadata, versioned with the descriptor hash, and treated as a reranker rather than an authorization mechanism.

## 11. Preventing model overload

The complete catalog can be large. The visible per-run surface must remain intentionally small.

```text
All installed capabilities
        |
        | principal + host + context + enabled plugins
        v
Permitted searchable catalog
        |
        | selected profile
        v
Initial run toolset (roughly 5–15 tools)
        |
        | search + policy-approved activation
        v
Additional task-specific tools
```

The exact tool-count budget should be measured rather than hardcoded as doctrine, but “hundreds by default” should be rejected.

### 11.1 Capability profiles

Illustrative profiles:

| Profile | Typical visible capabilities | Excluded by default |
|---|---|---|
| Explore/read | workspace overview, content list/read/search, memory search | writes, installs, deploys |
| Build/edit | explore tools, apply content changes, artifact inspect/refresh, run status | plugin trust, OAuth, deployment |
| Design system | design-system inspect/search/revise, token/resource reads, preview | plugin admin, account settings |
| Plugin operator | plugin inspect/doctor/apply, task status | trust/install/upgrade until elevated |
| Release | export/deploy preflight, deployment status | publish until confirmed |
| Administration | provider/config/status operations | secrets and recovery operations |

Profiles are host-owned policy inputs. An agent may recommend a profile or request a family, but it cannot grant itself scopes.

### 11.2 Active context reduces tool parameters

If the host has already selected a project, tools should not accept an arbitrary project ID by default:

```text
content.read({ path })
```

is preferable to:

```text
project_file.read({ projectId, workspaceRoot, absolutePath })
```

The first form is easier for the model and safer because the current context is bound outside model-controlled input. Cross-project operations should require an explicit capability and authority.

### 11.3 High-level outcomes instead of CRUD explosion

The capability surface should consolidate technical endpoints into useful operations:

- `content.apply_changes` can validate and atomically apply several related file patches.
- `project.export` can accept a typed format instead of separate tools for every transport detail, if risk and schema remain understandable.
- `deployment.publish` should call a deployment app-service, not expose provider HTTP endpoints.
- `plugin.apply` should encapsulate the product workflow rather than expose every internal step.

Consolidation must not create an unrestricted “do anything” tool. Each high-level tool still needs a bounded domain, strict schema, predictable effects, and policy.

## 12. MCP surface

### 12.1 Initial permanent tools

Proposed universal surface:

#### `capabilities.search`

Searches the permitted catalog. It has no side effects and cannot grant authority.

#### `capabilities.describe`

Returns full trusted metadata and schemas for selected results.

#### `capabilities.request_activation`

Requests that a capability or family be made visible to the current run. The result can be:

- activated by existing policy;
- pending user/host approval;
- denied;
- unavailable;
- requires a new/restarted agent transport.

This tool never directly executes the requested capability.

#### `capabilities.execute`

A compatibility fallback for MCP clients that cannot refresh their tool list. It accepts an exact activated capability ID/version plus a JSON input value. The server validates against the stored schema and executes through `ToolExecutor`.

This fallback is less desirable because the model's native function-calling layer cannot validate or select against the specific capability schema before the call. The server remains authoritative, but argument quality may be lower.

### 12.2 Preferred native activation

When an MCP client supports refreshed tool discovery:

1. The agent searches and requests activation.
2. The host approves or denies.
3. The per-run MCP server updates its visible tool set.
4. The client refreshes and receives the real tool definition with its specific JSON schema.
5. The agent invokes the strongly typed tool normally.

Dynamic tool-list interoperability must be tested across actual supported agents. The architecture must not assume every Codex, Claude, Cursor, ACP, or other client behaves identically.

This search-then-activate shape is not unproven. Claude Code's own harness already runs the identical pattern for its own large, host-side tool surface: tools outside the default set are "deferred" (name-only, no schema loaded), a `ToolSearch`-equivalent call resolves a query to matching tool names, and only the matched tool's full schema is loaded and made callable from that point forward. That a production coding-agent harness already ships this exact discovery-then-activation flow at scale is evidence for the approach, not just a design analogy.

### 12.3 Resources

MCP resources should carry read-only contextual information that would otherwise bloat prompts or tool counts:

- active workspace summary;
- project/content tree;
- design-system overview;
- database/domain schema summary;
- plugin and skill documentation;
- run status and result summaries;
- capability family guides;
- product help and policy summaries.

Resources need the same principal/context filtering and redaction as tools.

### 12.4 Transport strategy

Recommended sequence:

1. Per-run local stdio MCP for locally spawned agents.
2. Authenticated loopback transport for separately launched local clients.
3. Authenticated streamable HTTP MCP for remote/external agents only after the local authority model is proven.

Per-run stdio has useful properties:

- lifecycle is tied to the agent process;
- no discoverable network listener is required;
- per-run context and token material can be injected narrowly;
- the server can expose a run-specific tool set;
- shutdown and cancellation are easier to couple.

Global installation such as `codex mcp add` is useful for a user-installed general Jini endpoint, but a product-hosted run should prefer run-specific configuration so one product does not silently mutate every future agent session on the machine.

## 13. Invocation and authorization flow

Discovery, activation, and execution are separate gates:

```text
SEARCH VISIBILITY
  Is the capability safe and useful to reveal to this principal/context?

ACTIVATION
  May this capability be attached to this run/profile/session?

EXECUTION AUTHORIZATION
  May this exact principal perform this exact operation with this input now?

CONFIRMATION
  Does the user approve this concrete side effect?

HANDLER VALIDATION
  Does the product service still accept the operation under current state?
```

No earlier decision bypasses a later one.

Suggested flow:

```text
agent call
  -> resolve exact activated id/version/schema hash
  -> validate JSON input
  -> resolve current principal/run/context
  -> ToolExecutor policy authorization
  -> optional dry-run or preflight
  -> optional user confirmation
  -> execute private handler/app-service
  -> validate/truncate/redact output
  -> durable audit
  -> canonical tool result event
```

### 13.1 Risk classes

An illustrative policy taxonomy:

| Risk | Examples | Default behavior |
|---|---|---|
| Read | list projects, read content, search memory | allow when scoped; redact sensitive data |
| Reversible write | rename draft, update project metadata, save artifact revision | policy-controlled; confirm when delegation is unclear |
| Destructive write | delete, purge, overwrite, revoke | mandatory confirmation and recovery information |
| External write | deploy, publish, send/share, install/upgrade | preflight + mandatory confirmation |
| Security/admin | trust plugin, OAuth connect/disconnect, permission changes | explicit elevation; often user-only |
| Secret/account | reveal credentials, password/recovery, export tokens | never model-visible or executable |

Confirmation should present the resolved effect, not the model's prose:

```text
Publish project “Acme Launch” to Vercel production?
Target: acme-launch.example.com
Files changed since last deploy: 14
Rollback available: yes
```

### 13.2 Idempotency and transactions

Write capabilities should declare an idempotency contract. The control plane should propagate an execution/request key into the product app-service so retries do not duplicate comments, deployments, exports, payments, or plugin installations.

Multi-record changes should execute transactionally where the provider supports it. A capability that cannot provide atomicity should describe its partial-failure and compensation behavior.

## 14. Database access

Agents should be able to answer questions from product data and request product data changes. The default mechanism should be domain capabilities over app-services, not raw access to the SQLite file.

### 14.1 Separate databases and concerns

At least three different data concerns may exist:

1. Jini internal run/event/activation/audit data.
2. Product domain data such as Open Design projects, conversations, memories, plugins, and design systems.
3. Plugin/provider-owned data.

They should not be presented to the agent as one ambient database. Jini's durable event log should remain an internal kernel store except for intentionally projected run/status resources.

### 14.2 Preferred read capabilities

Examples:

```text
workspace.overview
content.search
content.list
content.read
conversation.search
memory.search
design_system.inspect
plugin.inspect
deployment.status
```

These can use SQLite, filesystem indexes, vector stores, or remote services internally without making storage choice part of the agent contract.

### 14.3 Preferred write capabilities

Examples:

```text
project.update_metadata
content.apply_changes
conversation.add_comment
memory.save
artifact.refresh
plugin.apply
routine.run
deployment.publish
```

The product service validates domain rules, ownership, current revision, and transactions.

### 14.4 Schema discovery

If an agent needs to understand available data, expose a redacted domain-schema resource rather than SQLite internals. It can describe entities, fields, relationships, and supported query filters without revealing internal tables, token stores, migration state, or sensitive columns.

### 14.5 Optional restricted SQL

A trusted developer/admin profile may eventually justify a separate read-only SQL capability. If accepted, it should have all of the following:

- a genuinely read-only connection or replica;
- a strict allowed database/schema set;
- parser/AST enforcement for a single `SELECT`, `WITH`, or `EXPLAIN` statement;
- denial of `PRAGMA`, `ATTACH`, extension loading, writes, and multi-statements;
- statement deadline and cancellation;
- row, column, byte, and pagination limits;
- sensitive-table and sensitive-column redaction;
- query hashing and audit;
- no access to Jini credential/token stores;
- no presence in ordinary profiles.

Arbitrary SQL writes should not be an ordinary product capability. Typed domain actions are safer, more understandable, more portable beyond SQLite, and easier to confirm.

## 15. Frontend parity and frontend tools

“Anything a user can do in the frontend” needs to be separated into three categories.

### 15.1 Backend outcome

The UI invokes a backend effect such as creating a project, renaming a file, applying a plugin, or deploying. The agent should call the same product app-service through a capability.

### 15.2 UI-session action

The action only makes sense in a connected browser/desktop session:

- open a tab or panel;
- focus an artifact;
- select a visible element;
- open a file picker;
- read the user's current visual selection;
- request clipboard access;
- display a diff or confirmation.

These should be session-scoped frontend capabilities. The backend routes a request to an authenticated frontend session and receives a structured result. If no eligible frontend is connected, the capability is unavailable.

The frontend should register only declared actions with short lifetimes. A generic `evalJavaScript` or unrestricted DOM execution tool should not be part of the default bridge.

### 15.3 Human-only action

Some UI actions should remain human-only even if technically automatable:

- reveal or copy a secret;
- change account recovery or authentication factors;
- approve a new trust root;
- accept legal/financial terms;
- bypass safety policy;
- grant the agent broader authority.

The catalog may explain that these outcomes require the user, but it should not expose an executable model tool.

## 16. Plugin-contributed capabilities

Plugins are the scaling reason for a searchable catalog, but also the largest trust risk.

### 16.1 Manifest contribution

A plugin capability manifest should declare:

- stable namespaced ID;
- version and schema hash;
- title, summary, tags, and aliases;
- input/output JSON schemas;
- risk and confirmation classification;
- required host scopes/context;
- provider/runtime binding kind;
- availability probe;
- examples and limitations;
- frontend-session requirements;
- trust/provenance information.

The installer validates and normalizes the manifest before indexing it.

### 16.2 Runtime binding

Capability metadata alone never makes a capability executable. Execution requires an exact private binding, for example:

```text
capability id/version/hash
  -> built-in app-service handler
  -> isolated plugin worker RPC
  -> authenticated remote provider
  -> connected frontend-session handler
```

Third-party plugin code should eventually run out of process with explicit declared capabilities. Loading arbitrary code in the daemon process lets it bypass the tool gate entirely.

### 16.3 Tool-description prompt injection

Tool metadata becomes model-visible text. A malicious plugin can place instructions such as “ignore all other rules” in descriptions or examples. The catalog must treat plugin prose as untrusted input.

Possible controls:

- only advertise trusted/enabled plugins;
- normalize descriptions into declarative product language;
- enforce length and field limits;
- reject instruction-like or hidden content;
- preserve publisher/source labels;
- keep security policy outside model-visible descriptions;
- scan manifests during install/upgrade;
- require reapproval when capability schemas or descriptions materially change;
- test malicious metadata fixtures.

### 16.4 Upgrade behavior

An active run should pin exact capability versions/schema hashes. A plugin upgrade should not silently alter a running agent's contract. Options include:

- keep the old worker/version until runs finish;
- mark the capability unavailable and require restart;
- allow only backward-compatible schema upgrades after validation.

The first implementation should prefer explicit restart over clever hot replacement.

## 17. Product capability inventory: Open Design

The current Open Design code graph demonstrates the likely scale. A targeted route-node inventory found, before deduplicating test/fixture/argument-derived route nodes:

- roughly 116 project-prefixed route nodes;
- 28 design-system-prefixed route nodes;
- 25 plugin-prefixed route nodes;
- 24 agent/skill/routine-prefixed route nodes;
- 28 artifact/live-artifact/run-prefixed route nodes;
- 45 memory/MCP/project-location-prefixed route nodes.

These are graph route-node counts, **not a claim that Open Design has exactly that many production endpoints**. The graph includes method variants, test-derived URLs, and argument-derived route nodes. The counts are evidence of breadth, not a tool-generation input.

The capability inventory should group product outcomes instead of mirroring endpoints.

### 17.1 Project and workspace

Potential reads/resources:

- list and inspect projects;
- workspace overview and status;
- project locations and scan status;
- archive and activity history;
- deployment/export history;
- applied plugins and design-system association.

Potential actions:

- create, rename/update, duplicate, archive, restore, or delete a project;
- select/import a project location;
- prepare handoff;
- run project-specific generation/finalization;
- request export or deployment.

### 17.2 Content, files, and folders

Potential reads/resources:

- list folder/content trees;
- read text content and metadata;
- search content;
- inspect previews and revisions;
- resolve project-relative references.

Potential actions:

- create or update content;
- apply a validated multi-file patch;
- rename/move content;
- create/delete folders;
- delete content with recovery information;
- upload/import files through a frontend or authenticated provider.

### 17.3 Conversations, messages, and comments

Potential reads/resources:

- list conversations;
- retrieve message history and run summaries;
- search messages/comments;
- inspect feedback and status.

Potential actions:

- create/rename/archive/delete a conversation;
- add/edit/delete a comment;
- start/cancel/retry a run;
- update supported message metadata;
- send structured feedback.

Agents should not be allowed to rewrite immutable audit/event history merely because the frontend has internal maintenance endpoints.

### 17.4 Artifacts and media

Potential reads/resources:

- list and inspect artifacts;
- preview/render artifact content;
- inspect refresh history and compatibility;
- inspect lint results.

Potential actions:

- save/update an artifact;
- refresh/regenerate;
- lint/validate;
- generate media;
- export image/PDF/PPTX/package formats;
- delete an artifact with confirmation.

### 17.5 Design systems

Potential reads/resources:

- list and inspect systems;
- files, previews, showcases, archives, revisions;
- token contract and package-audit status.

Potential actions:

- create/update/delete;
- import from local/GitHub/shadcn sources;
- install into a workspace;
- create a revision job;
- rebuild token contracts;
- copy/apply a design system to a project.

### 17.6 Plugins

Potential reads/resources:

- discover installed/available plugins;
- inspect examples, assets, trust, diagnostics, events, and stats;
- inspect candidate recommendations.

Potential actions:

- apply a plugin;
- run plugin doctor;
- install/upload/upgrade/uninstall;
- trust or revoke trust;
- share or duplicate a plugin-backed project;
- draft/dismiss candidate operations.

Install, upgrade, uninstall, and trust operations need elevated profiles and strong confirmation.

### 17.7 Skills and routines

Potential reads/resources:

- list/inspect skills and files/examples;
- list/inspect routines and run history.

Potential actions:

- import/install/update/delete a skill;
- create/update/delete a routine;
- run a routine;
- crystallize a successful run into reusable form.

### 17.8 Agents and runs

Potential reads/resources:

- list available agents and capability/auth status;
- inspect runs, events, results, development-loop iterations, and generated UI surfaces.

Potential actions:

- start, cancel, retry/resume, or replay a run;
- respond to a generated UI surface;
- send feedback;
- initiate a sign-in flow through a human-visible frontend.

An agent should not recursively launch unbounded agents merely because `run.start` exists. Host quotas, nesting depth, budgets, and authority inheritance require explicit policy.

### 17.9 Memory and context

Potential reads/resources:

- search/list memories;
- inspect memory tree, rules, extractions, verifications, and effective system context;
- retrieve connector-derived context summaries.

Potential actions:

- propose/save/update/delete memory;
- request extraction/indexing;
- update memory organization;
- request rule suggestions.

Memory writes deserve visibility because they influence future agents. They should be auditable and often confirmed or reviewed.

### 17.10 Integrations, providers, and MCP

Potential reads/resources:

- provider/agent availability and health;
- configured external MCP server status;
- OAuth connection status without tokens;
- install/configuration guidance.

Potential actions:

- propose/update an external MCP configuration;
- start/disconnect OAuth through a human-visible flow;
- install/remove an agent integration;
- run a connectivity probe.

Tokens and credentials remain opaque handles owned by the host.

### 17.11 Export, deploy, share, and external effects

Potential reads/resources:

- preflight results;
- target status;
- deployment history;
- link checks and rollback availability.

Potential actions:

- export artifacts/projects;
- deploy/publish;
- share externally;
- open external links through a connected frontend;
- prepare/download handoff packages.

These should separate preflight from commit and require explicit confirmation for external effects.

## 18. Agent integration strategy

The control plane must be agent-neutral.

### 18.1 MCP-capable agents

Expose the same per-run Jini MCP server to Codex, Claude, Cursor, Copilot, and other MCP-capable clients using each client's configuration mechanism. The server provides a normalized product capability vocabulary even when agent vendors differ.

### 18.2 ACP agents

ACP can support richer request/response mediation, but the Jini capability gateway should remain protocol-neutral. An ACP adapter should decode an ACP-side delegated request and call the same gateway/bridge as MCP.

ACP permission for the agent's own native tool and Jini authorization for a backend capability remain separate decisions.

### 18.3 Non-MCP agents

A custom adapter may expose the same catalog/search/execute operations through the agent's supported RPC mechanism. It must not reimplement authorization or handlers.

### 18.4 Autonomous JSON-stream CLIs

For agents that own their native shell/file/web loop and merely narrate events:

- Jini can provide MCP backend capabilities.
- Jini cannot assume it pre-authorizes native operations.
- the process should run in a controlled working directory;
- product databases and credentials should not be mounted into that directory;
- environment inheritance should be allowlisted;
- native web/search and shell permissions should be configured according to product policy;
- filesystem access should exclude daemon/product data except explicit project roots;
- process cleanup and resource limits remain necessary.

The controlled MCP route should be the only intended path to backend authority.

## 19. Security model

### 19.1 Principal and context

Every search, activation, and execution must carry host-resolved identity:

```text
principal
run id
opaque product context reference
host/product identity
capability profile
connected frontend session, if any
trace/audit context
```

Agents should not mint principals, contexts, scopes, or frontend-session IDs.

### 19.2 Least privilege

Visibility, activation, and execution should all be least-privilege. A read task should not receive deployment or plugin-trust tools. A project-scoped run should not enumerate other tenants or workspaces.

### 19.3 Credentials

Handlers receive scoped provider handles, not raw environment dumps. Credentials should be resolved inside the provider/host at execution time and never returned in tool output.

### 19.4 Output safety

Tool output can leak secrets or overwhelm the model. Enforce:

- schema validation when possible;
- field-level redaction;
- maximum rows/items;
- byte/token limits;
- pagination/cursors;
- MIME/content-type policy;
- untrusted-content labeling;
- output truncation evidence.

### 19.5 Prompt injection through data

Database rows, files, web results, plugin descriptions, and external resources may contain adversarial instructions. Tool results should distinguish data from instructions and preserve source/provenance. The agent prompt must not treat arbitrary retrieved content as authority.

### 19.6 Audit

Durable audit should record enough to reconstruct authority decisions without storing unnecessary secrets:

- principal/run/context;
- exact capability ID/version/schema hash/provider;
- request and idempotency identifiers;
- redacted input or input hash;
- policy result and reason code;
- confirmation request and decision;
- start/end/status/timing;
- redacted/truncated output metadata;
- cancellation/timeout/failure;
- trace links to product-side operations.

Search queries may also need privacy-aware telemetry to improve relevance, but should not become an unbounded log of user prompts.

## 20. Example flows

### 20.1 Read product information

```text
User: “Which design system is this project using?”

Agent sees explore profile.
Agent calls workspace.overview.
Gateway resolves active project from host context.
Policy allows scoped read.
Product service queries product data.
Result returns design-system reference and summary.
```

No raw SQL or arbitrary project ID is needed.

### 20.2 Discover and export PowerPoint

```text
User: “Export this project as a PowerPoint.”

Agent calls capabilities.search("export project powerpoint").
Search returns open-design.project.export_pptx.
Agent describes and requests activation.
Host policy activates export preflight.
Agent calls export preflight.
Frontend shows exact target/result estimate.
User confirms publish/export effect.
ToolExecutor calls the shared export app-service.
SSE emits tool result and artifact reference.
```

### 20.3 Update product data

```text
User: “Rename this project to Acme Launch.”

Agent calls project.update_metadata({ name: "Acme Launch" }).
Input schema rejects unrelated fields.
Policy verifies project ownership and current context.
Product service checks uniqueness/revision.
Write executes transactionally and is audited.
```

### 20.4 Frontend-only selection

```text
User: “Use the component I selected on the canvas.”

Agent calls frontend.current_selection.
Gateway verifies a connected authorized frontend session.
Frontend asks for/reads the current selection.
Structured selection metadata returns to the run.
No arbitrary DOM evaluation is exposed.
```

### 20.5 Native agent bypass attempt

```text
Agent tries to open the product SQLite file through its shell.

The file is outside the agent's readable/writable roots.
No database path or credential is present in its environment.
The attempt fails independently of MCP.
The intended operation remains available only through scoped capabilities.
```

## 21. Candidate package and ownership boundaries

This section is a proposal for debate, not a package-set decision.

### Jini-neutral responsibilities

Likely homes:

- `@jini/core`: minimal public capability/tool contracts only if they are true kernel invariants.
- `@jini/daemon`: execution, activation orchestration, run/event integration, policy/confirmation/audit coordination.
- `@jini/mcp`: generic MCP server adapter, capability discovery projection, stdio/HTTP transport integration, agent install/runtime configuration.
- `@jini/sqlite`: adapters for catalog, activation, and durable audit ports if those ports are accepted.
- `@jini/node-host`: safe local composition preset and per-run agent/MCP wiring.
- `@jini/http`: optional catalog/search/admin projections calling the same services.

An alternative is a dedicated feature package such as `@jini/capabilities`. That avoids overloading the kernel but would add a package outside the currently locked set. It requires explicit architectural approval and a two-consumer or experimental justification.

### Product responsibilities

Open Design owns:

- Open Design capability names and descriptions;
- mapping frontend outcomes/routes to Open Design app-services;
- Open Design domain schemas and policies;
- project/design-system/plugin/memory/deployment capability packs;
- Open Design frontend-session actions;
- product-specific confirmation summaries;
- product database adapters and migrations.

These belong in the Open Design consumer/integration, not neutral `@jini/*` packages.

### Plugin responsibilities

Plugins own declared metadata and an isolated implementation/provider. They do not own authorization policy for the host; the host may further restrict or deny any plugin declaration.

## 22. Migration and implementation sequence

The feature is large and should be delivered as vertical slices rather than a bulk exposure of the whole backend.

### Stage 0 — capability inventory and service seams

- Inventory meaningful frontend outcomes and product API services.
- Mark each as backend, frontend-session, or human-only.
- Identify duplicate routes that should share one app-service.
- Assign risk, scope, context, confirmation, idempotency, and output policies.
- Do not generate tools mechanically from routes.

### Stage 1 — catalog contracts and SQLite search

- Define capability descriptor/version/schema/provenance contracts.
- Define async catalog store/search ports.
- Implement in-memory adapter and SQLite/FTS adapter.
- Validate/sanitize manifests.
- Add frontend and agent-neutral catalog search service.
- Prove permission filtering occurs before ranking.

### Stage 2 — generic MCP server

- Implement local stdio MCP runtime in `@jini/mcp` or an approved adjacent package.
- Expose search/describe/request-activation/execute-fallback.
- Authenticate and bind each server instance to principal/run/context.
- Route execution through `DelegatedToolBridge` and `ToolExecutor`.
- Add lifecycle/cancellation/idle shutdown.

### Stage 3 — read-only vertical slice

Start with a small Open Design pack:

```text
workspace.overview
content.list
content.search
content.read
conversation.search
memory.search
run.status
```

Prove a real agent can discover a tool, read product data, and cite returned records without direct database access.

### Stage 4 — controlled write vertical slice

Add:

```text
project.update_metadata
content.apply_changes
conversation.add_comment
artifact.refresh
```

Prove validation, authorization, confirmation, idempotency, cancellation, restart behavior, and durable audit.

### Stage 5 — dynamic activation and profiles

- Implement profiles and contextual initial toolsets.
- Test dynamic tool refresh against each real agent client.
- Retain the generic execute fallback only where required.
- Measure tool-selection quality and context size.

### Stage 6 — frontend bridge

- Define authenticated frontend-session registration.
- Implement current selection, open/focus, file-picker, and confirmation primitives.
- Add disconnect, timeout, cancellation, and replay-safe behavior.
- Keep arbitrary eval/DOM execution out of the default protocol.

### Stage 7 — plugin ecosystem

- Define plugin capability manifests and validation.
- Add trust/provenance display and prompt-injection tests.
- Add isolated worker/remote provider binding.
- Pin versions for active runs.
- Add install/upgrade/uninstall reconciliation.

### Stage 8 — high-risk product families

- design-system mutation;
- plugin administration;
- deployment/publish/share;
- external provider operations;
- OAuth initiation/disconnection;
- nested agent/routine execution with budgets.

Each family should land behind explicit policy and conformance tests.

## 23. Acceptance criteria

The control plane should not be considered complete merely because an MCP client can list tools.

### Catalog and discovery

- Hundreds or thousands of definitions can be indexed without increasing the initial model tool list proportionally.
- Unauthorized capabilities do not appear in search results.
- Disabled/uninstalled/unavailable versions cannot activate.
- Search returns useful results for synonyms and product language.
- Frontend and agent search use the same catalog service.
- Malicious plugin-description fixtures cannot inject authority or hidden instructions.

### Activation

- Every run records its exact activated capability versions/schema hashes.
- Profiles cannot grant scopes the principal lacks.
- Agent requests can be denied or require user approval.
- A plugin upgrade cannot silently alter an active run's schema.
- Client incompatibility with dynamic tool refresh has a tested fallback.

### Execution

- Every invocation validates input against the exact activated schema.
- Unknown/stale capability IDs fail closed.
- Authorization runs again at execution time.
- Allowed, denied, confirmation-denied, timed-out, cancelled, failed, and successful paths are audited.
- Output is validated/redacted/truncated and cancellation reaches the handler.
- Write retries do not duplicate side effects.
- Product handlers are not publicly retrievable.

### Agent isolation

- The agent cannot read the Jini event database or product database directly.
- Product credentials are absent from the ambient child environment.
- The agent is confined to approved working roots.
- Native web/shell/file authority is explicitly configured and tested per agent family.
- A real-agent test proves the MCP path rather than only a fake fixture.

### Product vertical slice

- A user request enters over HTTP or UI.
- The agent discovers the relevant capability.
- The capability executes through the shared product app-service.
- Events stream through canonical Jini protocol.
- Disconnect/reconnect/cancel/restart behavior remains correct.
- The frontend can show the same capability, confirmation, and audit information.

## 24. Failure modes and anti-patterns

### One MCP tool per route

This leaks transport details, duplicates business logic, overwhelms the model, and makes route churn an agent contract.

### Generic `http.request`

This bypasses domain schemas and turns every local route into ambient authority.

### Generic writable `sql.execute`

This bypasses app-service invariants, portability, confirmation semantics, and least privilege.

### Relying on hidden tools for security

Tool omission improves relevance but is not authorization. Direct invocation must still fail closed.

### Putting executable handlers in SQLite

Serialized code or arbitrary command templates create a code-injection and provenance problem. Store metadata and private binding references, not executable bodies.

### Letting the model choose its principal or project

Identity and active context are host-resolved. Model-supplied IDs are untrusted inputs.

### Letting plugins write persuasive free-form tool prompts

Tool metadata is model-visible untrusted content. Normalize and validate it.

### Calling autonomous stdout observation a policy gate

If the child already executed its native tool before emitting output, Jini did not authorize it. Sandboxing and a delegated tool protocol are separate requirements.

### Treating frontend parity as DOM parity

Agents should request product outcomes. Browser-only actions require a small session bridge, not unrestricted UI scripting.

### Building the entire Open Design tool surface first

The control plane should be proven with one read and one confirmed write vertical slice before hundreds of capabilities are indexed.

## 25. Debate questions

The debate should resolve or explicitly defer the following.

### Architecture and ownership

1. Is `CapabilityCatalog` a kernel invariant, a daemon feature, or a new experimental feature package?
2. Which metadata belongs in the existing `ToolDescriptor`, and which belongs in a separate capability descriptor?
3. Is SQLite a materialized index of signed manifests or the authoritative mutable catalog?
4. Which activation/audit/confirmation state must be durable across daemon restart?
5. Does the generic MCP runtime belong entirely in `@jini/mcp`, or should transport and capability application-service logic be split?

### Discovery and model ergonomics

6. What is the default per-run tool budget, and how will it be measured across agent families?
7. Are profiles selected by the user, host routing, a classifier, or a combination?
8. Should `capabilities.search` search individual tools, workflows, resources, and families together or separately?
9. Should semantic search be part of v1, or should FTS5/aliases/context prove insufficient first?
10. How much tool metadata should search return before `describe`?

### Dynamic tools

11. Which target agents support dynamic MCP tool-list refresh reliably?
12. Is generic `capabilities.execute` an acceptable permanent compatibility path or only an experimental bridge?
13. If a client cannot refresh tools, should Jini restart/resume the agent with a new MCP profile rather than use generic execution?
14. How are capability activations represented in the canonical run event stream?

### Safety and authority

15. What risk taxonomy is stable across products?
16. Which reversible writes may run under predelegated authority without per-call confirmation?
17. How should nested agents/routines inherit or narrow scopes, budgets, and activated tools?
18. Should a restricted read-only SQL capability ever ship, and under what trust tier?
19. How are plugin descriptions normalized without destroying useful discoverability?
20. What isolation level is required before third-party plugin handlers are executable?

### Frontend parity

21. Which frontend actions represent backend outcomes, UI-session actions, or human-only actions?
22. How does a frontend session authenticate, register actions, disconnect, and recover?
23. Can an agent request a UI action without a user-visible confirmation when the action has no side effect?
24. How does the command palette present capabilities that are installed but unavailable in the current context?

### Product integration

25. Which Open Design application services can be reused directly, and which current route handlers contain business logic that must first be extracted?
26. What is the first minimal Open Design read/write capability slice?
27. How is OD upstream patchability preserved when route logic moves into shared app-services?
28. Which OD capabilities remain permanently product-owned instead of being abstracted into Jini providers?

### Prior art alignment

29. Should Jini's vocabulary be `capability` (this proposal) or `tool` (the `open-design-agentic` RFC), given both are otherwise well-designed and the latter is already shipped?
30. Should the OD RFC's `viewStateOnly` / "could it be meaningfully invoked with no browser attached?" litmus test become the literal Jini-kernel rule for what qualifies as a browser/UI-session-only tool, or stay a product-layer convention?
31. Should Jini's frontend-bridge action identity reuse the OD RFC's `invocationId` shape and its pending→responded return-endpoint pattern directly, or should Jini design its own?

## 26. Recommended starting position for debate

The following is a coherent initial position, not a locked conclusion:

1. Build a product-neutral `CapabilityCatalog` port/service plus a SQLite FTS adapter.
2. Treat feature/plugin manifests as declared metadata source and SQLite as the validated searchable materialization.
3. Keep executable handlers in a private versioned runtime registry or isolated provider.
4. Put the generic MCP server adapter in `@jini/mcp` and route all calls through the existing delegated bridge and `ToolExecutor`.
5. Expose only search, describe, activation-request, and compatibility execute tools initially.
6. Use host-selected capability profiles and active context to keep the visible set small.
7. Prefer dynamically activated strongly typed tools; retain generic execution only for incompatible clients.
8. Map product outcomes to shared app-services rather than generating tools from routes.
9. Keep Open Design capability definitions and domain handlers in the Open Design consumer/integration.
10. Prove project/content read plus one confirmed write before expanding to plugins, design systems, deployment, and external integrations.
11. Keep product databases and credentials outside agent filesystem/environment authority.
12. Treat plugin metadata and retrieved content as untrusted model-visible data.

## 27. Current implementation anchors

Relevant code and documentation at the time this proposal was written:

- `packages/core/src/tool-registry.ts` — public descriptors and private handler/policy registrations.
- `packages/daemon/src/tool-executor.ts` — authorization, confirmation, timeout, cancellation, truncation, and audit phases.
- `packages/daemon/src/delegated-tool-bridge.ts` — canonical agent tool events around `ToolExecutor` calls.
- `packages/daemon/src/agent-executor.ts` — local agent subprocess execution and stream/protocol drivers.
- `packages/http/src/runs.ts` — current generic create/status/cancel/SSE run transport.
- `packages/node-host/src/create-local-node-daemon.ts` — local composition preset and host-owned run-start hook.
- `packages/mcp/source-map.md` — generic MCP primitives retained and the OD-coupled stdio server intentionally dropped.
- `foundry/docs/jini-port/extraction-plan.md` — locked Jini architecture and package boundaries that this proposal must extend rather than bypass.
- `/Users/la/Desktop/Programming/OSS-Repos/open-design-agentic/docs/rfc-drafts/agent-ready.md` and `agent-ready-cross-project.md` — a sibling repo's shipped RFC + contracts for the same problem at the OD-product level (see §3.6); informs this proposal but must not be imported into `@jini/*`.

## 28. Decision record placeholder

After debate, record:

```text
Decision:
Status:
Date:
Participants/models:
Accepted architecture:
Rejected alternatives:
Package ownership:
Security invariants:
First vertical slice:
Deferred questions:
Required conformance tests:
```

Until that record exists, this document remains a proposal and discovery artifact.

---

## 29. Addendum (2026-07-27): entity-parameterized capabilities with per-principal enums

Status: **proposal**, same standing as the rest of this document. Added after a source-level survey
of ten shipped products (Strapi, Directus, Payload, WordPress core, novamira, Ghost, Medusa,
bolt.diy, open-saas, and Jini itself). All claims below were read-verified in those repositories.

### 29.1 The two shapes that exist in the wild, and why neither is sufficient

Two shipped answers to §11's "preventing model overload" problem, and they are **opposites**:

**Payload — entity as a parameter.** `packages/plugin-mcp/src/mcp/buildMcpServer.ts:126-151`
registers one tool per *operation*, deduped by tool name, and appends an entity-slug argument via
`withSlugInput`. `findDocuments({ collectionSlug, where })` replaces
`findPosts` / `findProducts` / `findUsers`. The result is roughly **21 tools regardless of how many
collections the product defines** — the CRUD explosion collapses because `findPosts` and
`findProducts` were never different operations, only the same operation with a different noun.
Authorization survives the collapse: the authorized item list is still per-entity, and
`callEntityTool` re-checks the exact tool-and-slug pair at execution.

**Strapi — schema narrowed per principal.** `content-manager/server/src/mcp/derive-content-type-mcp-tools.ts`
generates 5-8 tools *per content type*, so its absolute count grows. Its answer is different: a
tool's advertised input/output schema is resolved per request from the caller's live CASL ability
(`mcp/permissions.ts` — `getPermittedFields`, `resolvePermittedLocaleSchema`), so a caller with read
access to three of ten fields receives a contract listing three fields. **The permission boundary is
visible in the contract, not merely enforced behind it.**

Payload optimizes tool count. Strapi optimizes per-session relevance and least privilege. They are
in tension: one shared schema cannot be narrowed to a specific entity's fields.

### 29.2 The gap in Payload's version

`withSlugInput` (`buildMcpServer.ts:~229`) types the slug as an unconstrained string:

```ts
const slugSchema = z.string().describe('The collection slug')
```

Three consequences: the model cannot tell which entities exist from the tool list, so Payload must
ship `getConfigInfo` and `getCollectionSchema` as extra round trips; the model can name an entity it
has no access to and learn this only from a runtime error; and "tool absent from the list" stops
being usable as an authorization signal, since the tool is always present.

### 29.3 Proposal

Make the entity discriminator a **per-principal enum resolved at activation time**, not a free
string:

```ts
// resolved per activation, from the host-resolved principal
collectionSlug: z.enum(permittedEntitiesFor(principal, capabilityId))
```

This composes the two shapes rather than choosing between them:

1. **Tool count stays constant** — Payload's collapse is preserved.
2. **The discovery round trip disappears** — the model reads the valid entity set off the schema it
   already has; no `getConfigInfo` call, and the values arrive with the tool rather than before it.
3. **Least privilege moves into the contract** — the model cannot name an entity it may not touch.
   This is §10.2's filter-before-rank rule and Strapi's narrowing idea applied to the *entity* axis
   rather than the field axis.

### 29.4 Consequences and open questions

- The advertised schema becomes principal-dependent, so any schema cache key must include the
  principal and a permission version. This interacts directly with §7.3's `schema_hash` pinning: the
  hash must be computed over the **resolved** schema, and a permission change must invalidate the
  activation.
- **Execution-time authorization is still mandatory.** A per-principal enum is a discovery
  affordance, never the gate. Permissions can change mid-run, so the executor must re-authorize the
  concrete entity on every call. This is the same distinction Strapi states in
  `syncMcpSessionCapabilities.ts:49-50` ("a coarse allowlist... field/entity conditions must be
  enforced by capability handlers").
- **Residual gap:** field-level typing still cannot be entity-specific in a shared tool. Narrowing
  the entity axis does not recover Strapi's per-field narrowing. If field-level least privilege in
  the contract matters more than tool count for some capability family, that family should keep
  per-entity tools.
- **This only collapses capabilities that share a shape.** Distinct outcome capabilities ("export as
  PPTX", "deploy site", "publish campaign" — §17's inventory, and §16's plugin contributions) do not
  parameterize together. That count grows with the plugin ecosystem and is what will eventually
  force a real catalog. Build discovery when the *measured* count justifies it, per the sequencing
  in `PROP-tool-catalog-discovery-2026-07-26.md` §9 — not before.
- **Unmeasured risk:** whether a model selects a correct enum *value* as reliably as it selects a
  distinct tool *name*. No product in the survey measured this. Worth an eval before committing.

- **Hard dependency: do not adopt tool-collapse without schema-on-error.** Collapsing many
  entity-specific tools into one parameterized tool necessarily loosens the wire schema — Payload's
  collapsed `create` accepts `z.record(z.string(), z.unknown())`
  (`plugin-mcp/src/mcp/builtin/collections/createTool.ts:32`). That is only affordable because
  validation failure **returns the entity's full schema** in both `content` and `structuredContent`
  (`validateEntityData.ts:112-125`, extended to runtime errors at `formatCollectionError.ts:20-33`),
  so the model self-corrects in one turn instead of dead-ending. It is a one-line change to an error
  path and it is the cheapest high-value item in the entire survey. Ship it *before* collapsing
  tools, not after.

  Payload also demonstrates the failure mode of collapsing without solving discovery: its
  `collectionSlug` is a bare `z.string()` with no enum (pinned by a test), and `getConfigInfo`
  returns bare slugs — so its own documented answer to "how does the model know which entity to
  target?" is a config option **no code reads** (`types.ts:207`, documented at
  `docs/plugins/mcp.mdx:839-861`, zero consumers). The per-principal enum in §29.3 is the fix.

- **Empirical evidence for §6.3, from a team that tried the alternative.** Payload built a
  per-key capability-grant admin UI beside its primary access-control model, localised it into ~40
  languages, *redesigned* it, and then deleted it seven days later — commit `5effd37122`
  (2026-06-22): 177 files, 725 insertions, **7,500 deletions**. The commit body gives the reasoning:
  consistency with the primary access-control model, and a planned RBAC plugin serving both surfaces.
  This is the strongest available argument that the catalog must never become a second authorization
  model, and it bears directly on `PROP-tool-catalog-discovery-2026-07-26.md` debate question 6.

### 29.5 Related findings from the same survey

- **Fail-closed at registration.** Strapi's `McpCapabilityDefinitionRegistry.define()` throws at boot
  if a capability declares neither `devModeOnly` nor auth policies, making "registered with no auth
  check" unreachable rather than merely discouraged. Recommended for §13's flow.
- **Registration lifecycle.** Strapi keeps an append-only registry and adds an enable/disable bit
  with a four-state status; WordPress core instead ships true `wp_unregister_ability()`, callable at
  any time. Both are shipped answers to `PROP` debate question 3; Strapi's is the smaller change and
  preserves the kernel invariant.
- **Authorization belongs in the capability, not the transport.** WordPress's `WP_Ability::execute()`
  (`abilities-api/class-wp-ability.php:734`) runs
  `normalize → validate_input → check_permissions → execute → validate_output`, and **all three entry
  paths funnel through it** — the REST run controller, the LLM function-calling resolver, and direct
  PHP. Adding a transport therefore *cannot* forget the gate.

  The guarantee is **two-layer, and only the second layer is unconditional** — a distinction worth
  copying deliberately rather than by accident. Registration *does* throw when
  `permission_callback` is missing (`class-wp-ability.php:288-292`), but both mandatory-callback
  checks are gated on `get_class( $this ) === self::class`, so a plugin registering with a custom
  `ability_class` **skips the registration-time guardrail entirely**. What still holds is the runtime
  default: `check_permissions()` denies unless a callable `permission_callback` returns `true`, so a
  subclass that evades validation is unusable rather than open.

  Design lesson: **construction-time validation is a developer-experience affordance and can be
  subclassed around; the runtime deny-by-default is the actual security property.** Build both, and
  do not let the loud one at registration convince you the quiet one at execution is optional.

  This is the structural fix for the single most common defect found across the survey. Five of the
  products examined had a capability set reachable by two or more paths where the paths applied
  **different** checks — a kill switch honoured on one transport and ignored on another, an
  admin flag enforced on one route and silently dropped on a second, a security wrapper applied to
  integration routes and none of the AI ones. Every one of those bugs is "a transport forgot a
  check," and every one is impossible under this shape. Weight: highest of anything in the survey.

- **Credential scoping** (unaddressed anywhere in this document). Two shipped designs, one of which
  is a cautionary tale:

  Directus inverts the read capability at `api/src/services/payload.ts:169-195` — the *absence* of a
  principal is what grants plaintext, so any principal-bearing request receives a masked value and
  administrators cannot read provider keys through the API at all. The guarantee is a property of
  the service constructor, i.e. of the source.

  WordPress's Connectors API is the counter-example and **should not be copied as-is**:
  `register_setting(… 'show_in_rest' => true)` exposes the raw key (`connectors.php:596-615`) and
  masking is bolted on afterwards via a `rest_post_dispatch` filter that only fires when the route
  string equals `/wp/v2/settings` exactly (`connectors.php:522-566`). That filter runs in
  `serve_request()`, `embed_links()` and `serve_batch_request_v1()` — **not** in `dispatch()`, which
  `rest_do_request()` calls directly, so an internal REST call returns the key unmasked. The lesson:
  **redact at the schema or the source, never in a late filter keyed on a route string.**
- **Kill-switch completeness.** Directus and novamira both let an agent create artifacts (a Flow with
  an `exec` step; a sandbox PHP file) that continue running after the AI feature is disabled.
  Whatever §19's disable path becomes, it must be tested against artifacts already created, not only
  against new invocations.
