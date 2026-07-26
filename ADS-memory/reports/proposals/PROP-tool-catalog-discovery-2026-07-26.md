# Proposal: a durable tool catalog and discovery surface for third-party tools

**Status:** Proposal only — not implemented. No `packages/**` source was changed for this document.
Written 2026-07-26 to be debated (Gemini 3.1 Pro via `agy`, Codex GPT-5.6-sol via `codex`, plus
subagent participants) before any table or package is scaffolded.

**Question it answers:** how does an agent *find* the right tool when there are hundreds, and how
does someone building on Jini persist tools of their own into that set?

**Everything in §1 was read from source at `ef1c92e06`,** not recalled. Line numbers are real.
Two claims are explicitly marked unverified; they are the two most worth attacking.

---

## 1. What actually exists today

### 1.1 `ToolRegistry` is the catalog, and it is in-memory only

`packages/core/src/tool-registry.ts` — tools are `{descriptor, handler, policy}` triples. The
public surface is `register` / `has` / `list`. Handlers are never publicly retrievable; the only
path to execution is `@jini/daemon`'s `ToolExecutor` via `getToolRegistration`, exported solely
from `./internal.js`. That invariant is sound and this proposal does not touch it.

### 1.2 The SQLite tables for this were built and then deliberately deleted

`packages/sqlite/src/db/schema/migrate.ts:12-20`. `capability_definitions` and
`capability_executions` were added **2026-07-24** and removed **2026-07-25**. The recorded reason:

> they had zero consumers, so `migrate()` was creating two tables in every daemon's database that
> nothing read or wrote. The registry (`ToolRegistry`) is the catalog until search-at-scale is a
> real requirement, and `capability_executions` duplicated `ToolExecutionAuditRecord`
> (`packages/daemon/src/tool-executor.ts`) in a strictly weaker shape — no `principalId`, no
> `runId`, no per-phase event log. When the audit trail needs durability, back *that* record here
> so there is one audit noun, rather than reviving a parallel one.

**This proposal is bound by that note.** It argues the bar is now met, and it does not revive
`capability_executions` at all — §7.4.

### 1.3 Nothing registers a tool yet

`rg` across `packages/**` finds `createToolRegistry()` called only in tests
(`packages/http/src/__tests__/db-ops.test.ts`, `delegated-tools.test.ts`). No product code
registers a single tool. `PROP-mcp-tool-surface-file-tools-2026-07-21.md:23` independently reached
the same conclusion: "it is empty." **We are proposing search over a catalog that currently has
zero entries.** §9 is about not pretending otherwise.

### 1.4 Adjacent prior art, and what it is not

- `packages/composio/src/catalog.ts` — `ConnectorToolDetail` already models the metadata we need:
  `safety: {sideEffect: 'read'|'write'|'destructive'|'unknown', approval: 'auto'|'confirm'|'disabled'}`,
  `requiredScopes`, `inputSchemaJson`, `inputSchemaUnsupportedReason`, `refreshEligible`,
  `curation.useCases`. This is the closest thing to a designed row shape in the repo. **Reuse its
  vocabulary rather than inventing a third one.**
- `packages/registry/src/static-backend.ts` — a `RegistryBackend` with `list/search/resolve/doctor`
  and a `database-backend` that already reads from SQLite. **This is a content/package registry
  (marketplace entries), not a tool registry.** Same verbs, different noun. Do not conflate; do
  steal the backend-interface shape, which is already proven against three storage backends.
- `ai-control-plane.md:141` — a sibling repo (`open-design-agentic`) shipped a working
  SQLite-backed `AgentToolRegistry`, with FTS5 named as the next step and `LIKE` today. External,
  must not be imported, but validates the trajectory.

---

## 2. The constraint that shapes the entire design

**A database row cannot hold a handler.** `ToolRegistration.handler` is a closure. SQLite can
persist a descriptor; it can never persist the function that runs.

So a third party is never really "saving a tool." They are saving **a durable pointer to a tool
that some registered provider can rebuild at load time.** The row names a `provider` (code
registered at composition time) and carries an opaque `config` the engine never interprets.

This is not a limitation to work around — it is the security boundary, and it should be stated as
a load-bearing invariant:

> **No executable ever comes out of the database.** A hostile or corrupted row can make a tool
> undiscoverable, misdescribed, or misconfigured. It can never introduce code.

Everything in §7 follows from this. It also matches what the 2026-07-19 gateway debate landed on
independently (SQLite stores searchable metadata, never handlers).

---

## 3. What `ToolRegistry` cannot do yet

Three gaps, all in `packages/core/src/tool-registry.ts`:

1. **Append-only, no `unregister`.** `register()` throws on a duplicate id (line ~118), and the
   module doc states this is deliberate: "this registry is append-only by design, matching the
   kernel's 'tools are registered once at composition time' model." **A plugin can therefore never
   be upgraded, disabled, or uninstalled.** This is the single hardest blocker and it is an
   explicit documented invariant — changing it is a decision, not a patch.
2. **`list()` returns everything, unscoped.** No filter, no paging, no principal awareness. At 800
   plugin tools this cannot go in a prompt, and enumerating tools a caller may not invoke leaks
   their existence.
3. **Composition-time registration only.** Nothing can register after boot. A plugin install *is*
   registration after boot.

---

## 4. Proposed model: two nouns, one direction

```
ToolCatalogEntry   (durable, searchable, data)      ──resolve──▶   ToolRegistration (runtime, has a handler)
   id, version, provider, config, descriptor…                        {descriptor, handler, policy}
```

- **`ToolCatalogEntry`** is what SQLite stores and what search returns. Pure data.
- **`ToolProvider`** is registered in code at composition time:
  `{ id, resolve(entry): ToolRegistration }`. A provider is the *only* thing that can turn a row
  into something runnable. An entry naming an unregistered provider is inert and reports as such.
- **`ToolRegistration`** stays exactly as it is today.

A third party ships a provider (code) plus rows (data). The rows are cheap, dynamic, and
user-editable; the provider is reviewed, installed, and trusted. That split is the whole design.

### 4.1 Naming

`ai-control-plane.md:155` records this as an open fork ("debate question 29"): the OD RFC says
**tool**, the capability-gateway proposal says **capability**.

**Recommendation:** the persisted catalog stores **tools** — engine nouns, server-side, resolving
to `ToolRegistration`. Frontend **capabilities** (`packages/chat-core/src/agentic/capability.ts`)
stay a separate, per-session PUSH-advertised set, because a live tab's surface genuinely cannot be
discovered from a table. `ai-control-plane.md`'s §3.6 item 4 makes the same PUSH-vs-PULL argument
from shipped code. Cheap to reverse now, expensive once rows exist. **Debate question 1.**

---

## 5. Storage

### 5.1 Table shape (sketch, not final DDL)

```sql
CREATE TABLE IF NOT EXISTS tool_catalog (
  id                TEXT    NOT NULL,          -- 'acme.invoice.send'
  version           TEXT    NOT NULL,          -- semver; (id, version) is the PK
  provider          TEXT    NOT NULL,          -- resolves to a registered ToolProvider
  config_json       TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(config_json)),
  title             TEXT    NOT NULL,
  description       TEXT    NOT NULL,          -- UNTRUSTED. see §7.1
  input_schema_json TEXT             CHECK (input_schema_json IS NULL OR json_valid(input_schema_json)),
  schema_hash       TEXT    NOT NULL,          -- see §7.3
  side_effect       TEXT    NOT NULL,          -- read|write|destructive|unknown  (composio's vocabulary)
  approval          TEXT    NOT NULL,          -- auto|confirm|disabled
  required_scopes   TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(required_scopes)),
  source            TEXT    NOT NULL,          -- first-party|plugin|unverified   (§7.1)
  owner             TEXT,                      -- workspace/user scoping (§6.2)
  enabled           INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (id, version)
);
```

### 5.2 TEXT, not JSONB — measured

Asked directly: yes, JSONB is available. Verified on this repo's pin (`better-sqlite3 ^11.10.0`,
**SQLite 3.49.2**): `typeof(jsonb('{"a":1}'))` → `blob`; it round-trips through
`json(schema)` correctly and `json_extract(schema,'$.type')` works.

Recommend `TEXT` anyway:

1. **SQLite's JSONB is not PostgreSQL's JSONB.** Same name, unrelated format. No GIN index, no
   operator classes, no containment operators. Anyone reaching for it on Postgres instincts gets
   none of what they expect. This misconception is the main reason to say so explicitly in the doc.
2. **It buys nothing for this access pattern.** JSONB's win is skipping a reparse on repeated
   `json_extract`. We store a schema and hand it back whole; we do not query into it.
3. **`better-sqlite3` returns BLOB as a `Buffer`** (measured), so every read needs `json()` in SQL
   or a conversion in JS — friction on the hot path, for no gain.
4. **It is opaque** to `sqlite3` CLI, `packages/sqlite/src/db-inspect.ts`, and any dump/diff.
   Debuggability of a catalog humans will hand-edit is worth more than microseconds.
5. **UNVERIFIED CLAIM, attack this:** my understanding is SQLite documents JSONB as an internal
   format not intended for interchange and reserves the right to evolve it, which would couple a
   persisted DB file to a SQLite implementation detail. I could not fetch the SQLite docs in
   session to confirm. If this is wrong, item 5 drops and 1-4 still stand. **Debate question 2.**

### 5.3 FTS5 is a later swap, not an architecture

`LIKE` over a few hundred rows is fine and is what the sibling repo shipped. FTS5 becomes a
contentless external-content table over `(title, description, use_cases)` when row counts justify
it. Nothing above changes when it does — which is the point of writing the query behind an
interface (§4's `RegistryBackend` precedent).

---

## 6. Discovery

### 6.1 Three verbs, staged — never one that returns everything

| verb | returns | why |
|---|---|---|
| `search_tools(query, limit)` | `{id, version, title, one-line, score}` | candidates only. **No schemas.** Loading schemas at search time is what blows the context budget. |
| `describe_tool(id, version)` | full schema + safety + scopes | paid for only on the 2-3 that survive |
| `activate_tools(ids)` | binds into the run's working set | the agent's live tool list stays small (6-15) |

This is exactly how Claude Code's own `ToolSearch` behaves — deferred schemas, fetched by name on
demand. That is a live production existence proof, not a hypothetical.

A fourth verb, `execute_tool(id, input)`, is needed as a fallback for MCP clients that cannot
refresh a tool list dynamically. Input is validated against the *stored* schema either way.

### 6.2 Filter before you rank — never rank then filter

Scoping by principal, workspace, `enabled`, and granted scopes must happen **inside** the SQL, not
as a post-filter on ranked results. Rank-then-filter leaks the existence and names of tools the
caller cannot invoke, and produces short pages that silently misrepresent the corpus.

### 6.3 Discovery is not permission

Finding a tool grants nothing. `ToolExecutor` re-authorizes at execution against `ToolPolicy`. Two
independent gates, and the catalog is never consulted for authorization — it is an index, not an
ACL. A row saying `approval: 'auto'` is a *hint to the UI*, not a grant.

---

## 7. Security

### 7.1 Third-party descriptions are a prompt-injection surface

A plugin's `description` lands verbatim in a model's context. It is attacker-controlled text with
a direct line to the agent's instructions.

`normalizeAgentLabel` in `packages/chat-core/src/agentic/guards.ts` already solves exactly this
problem for page-authored labels — strips C0/C1 controls, bidi overrides (`U+202A-202E`), invisible
formatting, collapses whitespace, caps length. **Reuse it verbatim** for `title`/`description` on
ingest *and* on read. Carry `source` (`first-party|plugin|unverified`) into what the model sees, so
a description can be weighed rather than trusted.

Note the live evidence that this class of bug is real here: a concurrent adversarial probe
(`ADS-memory/.local-artifacts/handoff/sidekick/policy-stress-findings.md`) confirmed
`page.navigate`'s error message reflects a 5071-char bidi payload verbatim because it is the one
page-authored string that *skips* `normalizeAgentLabel`. Coverage gaps of exactly this shape are
the failure mode.

### 7.2 The agent may never write the catalog

`search`/`describe`/`activate` are read-only. Registration is a host/plugin-install action on a
different surface with a different principal. **Enforce with a test, not a doc comment** — the
`@jini/core/internal` incident (a doc claiming the exports map enforced a boundary it did not)
is the precedent for why. A guard rule with a self-test against a known-bad fixture, matching
`scripts/check-engine-boundaries.ts`.

### 7.3 Version and hash, or upgrades change tools silently

`(id, version)` is the PK and `schema_hash` covers the input schema. An activated tool is pinned to
the `(id, version, schema_hash)` the agent was shown. If a plugin upgrade changes the schema, the
activation is invalidated rather than silently re-pointed — otherwise "send invoice" can mean
something different mid-run than it did at `describe` time.

### 7.4 One audit noun

Per `migrate.ts:16-20`: do **not** create `tool_executions`. When execution audit needs durability,
persist `ToolExecutionAuditRecord` (`packages/daemon/src/tool-executor.ts`) — it already has
`principalId`, `runId`, and per-phase events, all of which the deleted table lacked. Out of scope
here; named so the debate does not re-derive it.

---

## 8. What building on this actually looks like

The user-facing test of this design. A developer adding their own tools:

```ts
// 1. Ship a provider — code, installed and trusted, registered at composition time.
const httpProvider: ToolProvider = {
  id: 'acme.http',
  resolve: (entry) => ({
    descriptor: toDescriptor(entry),
    handler: (ctx) => callEndpoint(entry.config.url, ctx.input, ctx.signal),
    policy: scopePolicy(entry.requiredScopes),
  }),
};

// 2. Save rows — data, dynamic, no redeploy, no code review per tool.
await catalog.upsert({
  id: 'acme.invoice.send', version: '1.2.0', provider: 'acme.http',
  config: { url: 'https://acme.test/invoices/send' },
  title: 'Send an invoice',
  description: 'Emails an invoice to a customer.',
  inputSchema: { type: 'object', properties: { invoiceId: { type: 'string' } }, required: ['invoiceId'] },
  sideEffect: 'write', approval: 'confirm', requiredScopes: ['invoices:write'],
});
```

Adding the 400th tool is an `INSERT`. Adding a new *kind* of tool is a provider — reviewed once.
That is the property worth optimizing for, and it is what makes the "no executable from the DB"
invariant survivable rather than annoying.

---

## 9. Sequencing — and the trap

**Do not start with SQLite.** §1.3: nothing registers a tool at all today. Building FTS5 search
over an empty catalog is the breadth-before-depth failure the 2026-07-19 swarm-consensus report
already spent a session on, and the same failure that got the last two tables deleted after a day.

1. **Dynamic registry** (in-memory, no DB): `unregister`, replace-by-version, scoped and paged
   `list`. Resolves §3's three gaps. This is where the third-party-facing API is actually designed.
2. **Prove one third-party tool** registering after boot, being upgraded, and being uninstalled.
3. **Then persistence**: `tool_catalog` + provider resolution, so step 2 survives a restart.
4. **Then search**: `LIKE` first, FTS5 when row counts justify it.

Each step has a consumer before the next begins. Step 1 is worth doing regardless of whether the
rest of this proposal survives debate — the registry cannot support plugins today no matter where
the catalog lives.

---

## 10. Questions for the debate

Sharpest first. 1, 3, and 5 are the ones that change the architecture.

1. **Tool or capability?** (§4.1) Does the persisted catalog store engine `tool`s, with frontend
   `capability`s staying a separate per-session PUSH set — or is there one unified noun with a
   `surface` discriminator, as `ai-control-plane.md`'s OD RFC prior art has it?
2. **JSONB.** (§5.2) Is the "internal format, not for interchange" claim right? If SQLite
   guarantees JSONB stability, does anything change? (I say no — items 1-4 stand alone.)
3. **Is append-only worth breaking?** (§3.1) `ToolRegistry`'s no-`unregister` invariant is
   deliberate and documented. Is dynamic register/unregister the right fix, or should plugin tools
   live in a *separate* dynamic registry that composes with the static one — preserving the
   kernel's invariant and isolating churn to the untrusted set?
4. **Provider indirection: necessary or ceremony?** (§2, §4) Is there a defensible design where a
   row is directly runnable — a declarative HTTP-call row the engine interprets natively — and does
   that quietly reintroduce "executable from the database"?
5. **Is the bar in `migrate.ts` actually met?** (§1.2) Third-party persistence is a real
   requirement, but it has no implementation demanding it *today*. Does this proposal repeat the
   2026-07-24 mistake at larger scale? What is the smallest real consumer that would settle it?
6. **Scoping model.** (§6.2) Is `owner TEXT` enough, or does multi-tenant search need a real
   grant table from the start? Retrofitting scoping onto a populated catalog is expensive.
7. **Where does this live?** A new `@jini/tool-catalog`, or inside `@jini/core` (whose `source-map.md`
   charter is explicitly composition-only — `packages/registry/source-map.md` already refused this
   widening once, and its reasoning applies verbatim), or `@jini/registry` (right verbs, wrong noun)?
8. **Activation lifetime.** (§7.3) When a pinned `schema_hash` is invalidated mid-run, does the run
   fail, re-describe, or continue on the old schema until the tool is next called?

---

## Appendix: what was verified in-session

| claim | how |
|---|---|
| `ToolRegistry` is in-memory, append-only, no `unregister` | read `packages/core/src/tool-registry.ts` in full |
| capability tables added 07-24, removed 07-25, with reasons | read `packages/sqlite/src/db/schema/migrate.ts:12-20` |
| no product registers a tool | `rg createToolRegistry` — test files only |
| SQLite 3.49.2; `jsonb()` → `blob`; returns a `Buffer`; `json()`/`json_extract` work | ran against the repo's own `better-sqlite3` |
| `normalizeAgentLabel` strips controls/bidi and bounds length | read `packages/chat-core/src/agentic/guards.ts` |
| `packages/sqlite/src/db/capabilities/capabilities.ts` **does not exist** | `codebase-memory-mcp` returned it confidently; it is stale (indexed against the old `~/Desktop` path, commit `9cb4ffc5`). Cross-checked with `rg`. **Re-index before trusting that tool on this repo.** |
