# Plan: the end-to-end principal-scoped tool path (vertical slice)

**Status:** plan only. No `packages/**` source was changed to write this.
**Date:** 2026-07-28. **Branch context:** `feat/agentic-capability-layer` (uncommitted work untouched).
**Scope:** `registration → search → describe → activate → ToolExecutor → durable audit`, sequenced.

**Inputs read in full, this session:** `ai-control-plane.md` §29 (uncommitted addendum, 2026-07-27),
`PROP-tool-catalog-discovery-2026-07-26.md`, `20260728T154101Z-handoff.md`,
`packages/core/src/tool-registry.ts`, `packages/daemon/src/tool-executor.ts`,
`packages/node-host/src/create-local-node-daemon.ts:570-619`,
`packages/sqlite/src/db/schema/migrate.ts:1-80`,
`packages/registry/src/database-backend.ts:121-151`, `packages/composio/src/catalog.ts`,
`packages/agentic/src/capability.ts`, `packages/agentic/src/guards.ts:230-235`,
`packages/agentic/src/page-executor.ts`, `packages/http/src/db-ops.ts:155-182`,
`packages/daemon/src/terminal-session.ts:423`, `packages/deploy/src/tool.ts:128-135`.

This plan **sequences** the existing design. It redesigns exactly one thing — the schema-variance
collision the handoff named as the blocking decision (§1) — and corrects one stale premise the
whole PROP rests on (§0).

---

## 0. Correction: `PROP` §1.3 is now false, and that changes the sequencing

`PROP-tool-catalog-discovery-2026-07-26.md` §1.3 states: *"Nothing registers a tool yet… No product
code registers a single tool. **We are proposing search over a catalog that currently has zero
entries.**"* Its §9 sequencing, and debate question 5 ("is the bar in `migrate.ts` actually met?"),
both follow from that premise.

The premise no longer holds. `packages/node-host/src/create-local-node-daemon.ts:585-613`
unconditionally registers **four real first-party tools** into a real `ToolRegistry`, wired to a
real `ToolExecutor`, reachable over real HTTP routes:

| tool | descriptor | policy today |
|---|---|---|
| `terminal.create` | `packages/daemon/src/terminal-session.ts:423` | `denyAllTerminalCreatePolicy` |
| `daemon.db.inspect` | `packages/http/src/db-ops.ts:155` | `denyAllDaemonDbPolicy` |
| `daemon.db.verify` | `packages/http/src/db-ops.ts:164` | `denyAllDaemonDbPolicy` |
| `daemon.db.vacuum` | `packages/http/src/db-ops.ts:176` | `denyAllDaemonDbPolicy` |

A fifth, `deploy.publish` (`packages/deploy/src/tool.ts:128`, `denyAllDeployPublishPolicy`), is built
but requires a host to wire it; the reference app does not.

Plus a host seam — `config.toolRegistrations` (`create-local-node-daemon.ts:325, 611-619`) — which
is the *existing* third-party registration path, in code, at composition time. **`examples/reference-web`
uses it today**: `createFrontendControl({capabilities: [...PAGE_CAPABILITIES, ...CHAT_CAPABILITIES]})`
(`daemon.ts:162-164`) mints "one gated tool per capability" (`node-host/src/frontend-control.ts:89-90`),
adding 14 more. **The running playground therefore has 18 registered tools, not zero.**

Two caveats that keep this from being over-claimed:

- The 14 frontend tools are **session-scoped** — they are meaningless with no tab attached
  (`CapabilitySurface: 'session'`, `packages/agentic/src/capability.ts:27`). They prove the
  registration and execution path, but they are not durable-catalog candidates; a catalog row cannot
  describe a capability that exists only while a browser tab is open.
- `reference-web` passes `policy: { authorize: () => 'allow' }` (`daemon.ts:164`). Fine for a
  playground, but it is the example every future consumer will copy, and it is precisely the shape
  A1 exists to make impossible to write accidentally — an allow with no `reasonCode`, no `policyId`,
  and no way to tell from an audit row that it was a placeholder.

**What this changes:**

1. The **execution half** of the path (`ToolExecutor` → audit) has real consumers *today*. Work on
   `AuthorizationResult` and durable audit is no longer speculative — it is servicing five shipped
   tools whose only current audit trail is an in-memory `Map` that dies with the process.
2. The **discovery half** still has near-zero corpus. Five tools do not justify FTS5, and building
   search for them would repeat the 2026-07-24 mistake exactly.
3. Therefore the slice is **not** one uniform push. It splits into a part that is overdue and a
   part that must stay gated behind a measured corpus. §3 sequences it that way.

**Two other stale citations to fix when the PROP is next edited:** `normalizeAgentLabel` and
`CapabilityDef` are cited at `packages/chat-core/src/agentic/{guards,capability}.ts`; both now live
at `packages/agentic/src/{guards,capability}.ts` (verified — `guards.ts:230`, `capability.ts:36`).
`chat-core/src/agentic/` today contains only `chat-capabilities.ts` and `index.ts`.

---

## 1. The blocking decision: can a tool's input schema vary by principal?

**Yes — via a narrowing-only template, resolved at describe time.** This is the one design call the
handoff said must be settled before any table exists, and it is settled here.

### 1.1 The collision

- `PROP` §5.1 stores **one** `input_schema_json` per `(id, version)` and hashes it once
  (`schema_hash`, §7.3). A schema is a property of the *tool*.
- `ai-control-plane.md` §29.3 proposes `collectionSlug: z.enum(permittedEntitiesFor(principal, capabilityId))`
  — the advertised schema is a property of the *(tool, principal)* pair. §29.4 already concedes the
  consequence: "the hash must be computed over the **resolved** schema, and a permission change must
  invalidate the activation."

§29 has effectively already chosen. The PROP has not caught up. Ratify §29, with three constraints
that keep it from becoming an arbitrary code-runs-at-describe-time hook.

### 1.2 The decision

The catalog stores a **schema template**. `describe_tool` resolves it against the caller's principal
context. Both hashes are recorded.

```ts
/** Stored. The security-review artifact and the honest ceiling on what any principal can see. */
interface ToolSchemaTemplate {
  readonly schema: JsonSchemaObject;
  /** Declared narrowing points. Empty ⇒ resolution is the identity function. */
  readonly narrowings?: readonly SchemaNarrowing[];
}

type SchemaNarrowing =
  /** Replace a string property with an enum drawn from a named, host-resolved set. */
  | { readonly kind: 'enum'; readonly path: string; readonly setId: string }
  /** Drop optional properties the principal may not read/write. */
  | { readonly kind: 'omit-optional'; readonly paths: readonly string[]; readonly setId: string };

/** Pure. No I/O. The caller supplies already-resolved sets. */
function resolveToolSchema(
  template: ToolSchemaTemplate,
  sets: ReadonlyMap<string, readonly string[]>,
): { schema: JsonSchemaObject; resolvedHash: string };
```

Three constraints, each enforced by a test rather than a comment:

1. **Narrowing only.** Resolution may replace a declared `string` with an enum of that string's
   permitted values, and may remove *optional* properties. It may never add a property, widen a
   type, relax `required`, or touch a path not named in `narrowings`. Property: *the resolved schema
   always accepts a subset of what the template accepts.* Test it with a structural subtype check
   over a fixture matrix, not by eyeballing diffs.
2. **Purity.** `resolveToolSchema` takes resolved sets as data. Permission lookup happens in the
   caller (`describe_tool`'s handler), never inside resolution. This is what makes it unit-testable
   without a database and cacheable at all.
3. **Identity by default.** A template with no `narrowings` resolves to itself and
   `resolvedHash === templateHash`. Every tool that does not opt in pays exactly nothing — the
   PROP's original single-schema model is the degenerate case, not a rejected alternative.

### 1.3 Storage and pinning consequences

- `tool_catalog` stores `input_schema_json` (the template) and `template_hash`. `schema_hash` as a
  column name is dropped — it is ambiguous under this model and would be misread by anyone holding
  the PROP.
- The **cache key** for a resolved schema is `(id, version, template_hash, principalId, permissionVersion)`.
  `permissionVersion` is a monotonic counter the host bumps on any grant change; without it, a
  permission change cannot invalidate a cached narrow schema and §29.4's requirement is unmet.
- An **activation pins `(id, version, template_hash, resolvedHash, permissionVersion)`**. Both hashes,
  because the two invalidate for different reasons — an upgrade changes `template_hash`, a
  permission change changes `resolvedHash`.

### 1.4 Activation lifetime (`PROP` debate question 8, answered)

When a pinned activation is stale at call time, the executor **fails that call, does not fail the
run**, and returns the newly resolved schema in the error payload. Completed calls stand.

This is the same move §29.4's last bullet demands for tool collapse ("schema-on-error"), reused: the
model gets the corrected contract in the same turn and retries, rather than dead-ending or silently
running against a schema it was never shown. New `ToolExecutionStatus` member: `'stale-activation'`.

**Execution-time authorization is unchanged and unconditional.** A per-principal enum is a discovery
affordance. `ToolPolicy` still re-authorizes the concrete entity on every call, exactly as §29.4 and
Strapi's `syncMcpSessionCapabilities.ts:49-50` both insist.

---

## 2. Ownership: no new package

`PROP` debate question 7 asks where this lives. Answer: **nowhere new.** The repo already carries 26
packages against a locked set of 14, and that sprawl is a recorded finding. Every piece of this slice
has an existing owner with shipped precedent:

| piece | home | precedent |
|---|---|---|
| `AuthorizationResult`, `ScopedToolRegistry` | `@jini/core` | `ToolRegistry`/`ToolPolicy` already live there; this is the same kernel noun |
| `ToolCatalogEntry`, `ToolSchemaTemplate`, backend port | `@jini/protocol` | `RegistryBackend` wire types live in protocol, adapters in leaves (`registry/src/index.ts` module doc says so verbatim) |
| `tool_catalog` DDL + queries, durable audit DDL | `@jini/sqlite` | see below |
| `search_tools`/`describe_tool`/`activate_tools` transport | `@jini/mcp` | `createMcpToolServer` already takes a caller-supplied `readonly McpToolDef[]` |
| provider indirection wiring | `@jini/node-host` | `config.toolRegistrations` is already the seam |

**The DDL must not go in `migrate()`.** That is what got the 2026-07-24 tables deleted a day later —
every daemon got two tables nothing read. Follow `packages/registry/src/database-backend.ts:121-151`
instead: an exported `ensureToolCatalogTables(db)` / `ensureToolAuditTables(db)`, called by the
consumer that actually wires the feature. A host that does not use the catalog never grows the
tables. This is the concrete, already-shipped answer to `PROP` debate question 5, and it should be
recorded in `migrate.ts`'s header note so the next reader does not re-derive it.

---

## 3. Sequencing

Two tracks. **Track A ships now** — it services the five real tools from §0 and does not depend on a
single catalog row. **Track B is gated** on a measured corpus. Do not interleave them; Track A's
`AuthorizationResult` is a prerequisite for Track B's provenance columns.

```
Track A (overdue, real consumers today)      Track B (gated on corpus)
  A1 AuthorizationResult                       B1 ScopedToolRegistry
  A2 Durable audit                             B2 schema-on-error
  A3 Fail-closed registration                  B3 tool_catalog + providers
                                               B4 discovery eval harness
                                               B5 search / describe / activate
                                               B6 real-source proof
```

### Track A1 — `AuthorizationResult` replaces `'allow' | 'deny'`

**Why first:** every audit row Track A2 persists is worthless without a reason and a policy id.
Denials today are indistinguishable — `{status:'denied'}` with no indication of *which* of the two
gates denied, or why. Doing A2 first would durably persist that hole.

**Change:**

```ts
export type AuthorizationEffect = 'allow' | 'deny';

export interface AuthorizationResult {
  readonly effect: AuthorizationEffect;
  /** Stable, machine-readable. Never free prose. e.g. 'no-grant', 'scope-missing', 'kill-switch'. */
  readonly reasonCode: string;
  readonly policyId: string;
  readonly policyVersion: string;
  /** Closed union, engine-enforced. See below. */
  readonly obligations?: readonly Obligation[];
}

export type Obligation =
  | { readonly kind: 'require-confirmation' }
  | { readonly kind: 'redact'; readonly paths: readonly string[] }
  | { readonly kind: 'max-output-bytes'; readonly bytes: number };
```

**Invariant, and the reason this union is closed:** an obligation the executor does not recognise
**denies the call**. An open/extensible obligation set means a policy can return a constraint the
gate silently ignores — a policy author believes they attached a redaction that never ran. Fail
closed, and add members deliberately. Test: a policy returning `{kind:'not-a-real-obligation'}`
yields `status:'denied'` with `reasonCode:'unknown-obligation'`.

**Second invariant — record which layer denied.** `ToolExecutor` consults `policy.authorize` and
then, only on allow, `delegate.onAuthorize` (`tool-executor.ts:235-238`). The audit event must carry
`source: 'policy' | 'delegate'`. Today a delegate veto is indistinguishable from a policy veto.

**Blast radius (measured, small — do it in one commit, no compatibility shim):**
`packages/core/src/tool-registry.ts:67-86`; `packages/daemon/src/tool-executor.ts:81, 235-243`;
five registration sites (`http/src/db-ops.ts`, `daemon/src/terminal-session.ts`,
`deploy/src/tool.ts`, and their `denyAll*` policies); the corresponding test files. The repo is
pre-1.0 and every consumer is in-tree — a dual-accepting boundary would be permanent debt bought for
nothing.

**Also here, from §29.5 (WordPress `WP_Ability` lesson):** make the runtime deny-by-default explicit
and unconditional. `ToolExecutor` must deny when `policy.authorize` throws, returns `undefined`, or
returns a non-`AuthorizationResult` — not propagate the throw. *"Construction-time validation is a
developer-experience affordance and can be subclassed around; the runtime deny-by-default is the
actual security property."*

**Acceptance:** `pnpm typecheck` + `pnpm guard` clean; every existing `tool-executor.test.ts` denial
case asserts a `reasonCode` and a `source`; the unknown-obligation test passes; no `'allow' | 'deny'`
string union remains in `packages/**`.

### Track A2 — durable audit, backing `ToolExecutionAuditRecord`

**Do not create a `tool_executions` table** — `migrate.ts:16-19` and `PROP` §7.4 both forbid reviving
the weaker parallel noun. Persist the record that already exists.

- `@jini/sqlite`: `ensureToolAuditTables(db)` → `tool_execution_audit` (one row per execution:
  `executionId` PK, `toolId`, `principalId`, `runId`, `status`, `startedAt`, `endedAt`) +
  `tool_execution_audit_events` (append-only: `executionId`, `seq`, `phase`, `at`, `source`,
  `reasonCode`, `policyId`, `policyVersion`, `detail`).
- `@jini/daemon`: `CreateToolExecutorOptions` gains an optional
  `auditSink?: { append(executionId, event): void; open(record): void; close(executionId, status): void }`.
  Omitted ⇒ today's in-memory `Map`, byte-identical behaviour. `tool-executor.ts:168-173`'s module
  doc already predicts exactly this seam ("a real host that needs audit records to survive a restart
  layers a durable store behind `getAuditRecord`/an append hook later").
- `@jini/node-host` wires the SQLite sink into `create-local-node-daemon.ts`'s
  `zeroConfigToolExecutor` (line 586), against the already-open `eventsDbPath` handle (line 597-598).

**Two failure modes to handle explicitly, not discover later:**
- A sink that throws must **not** fail the tool call *and must not silently drop the event*. Log and
  set a `degraded` flag on the record; a durable audit that quietly stops is worse than none.
- Cancellation and timeout paths (`tool-executor.ts:293-300`) must close the record. Test each of
  the ten `ToolExecutionPhase` members reaches the table.

**Acceptance:** a real `daemon.db.vacuum` denial through the HTTP route produces a row that survives
a daemon restart and names `denyAllDaemonDbPolicy` as `policyId`. That is the whole point — an audit
trail that answers "who was denied what, by which rule" across process lifetimes.

### Track A3 — fail-closed at registration

From §29.5 (Strapi's `McpCapabilityDefinitionRegistry.define()`): `register()` throws at composition
time if a registration supplies no `policy`. Today `ToolPolicy` is a required field so TypeScript
covers the in-tree case — but `config.toolRegistrations` accepts host-supplied objects across a
package boundary where types are advisory. Add the runtime check.

Pair it with the §29.5 caveat, deliberately: this is the *loud* layer and it is evadable. A1's
unconditional runtime deny is the *quiet* layer and is the actual guarantee. Both, and say so in the
module doc so nobody later deletes the runtime check as redundant.

**Gate between tracks:** A1–A3 must be green, committed, and `pnpm guard`-clean before B1 starts.

### Track B1 — `ScopedToolRegistry` (the dynamic overlay)

`PROP` debate question 3 asked whether to break `ToolRegistry`'s append-only invariant. **Do not.**
Take Strapi's answer over WordPress's (§29.5): keep the kernel registry append-only and add a
composing overlay that owns the churn.

```ts
interface ScopedToolRegistry extends ToolRegistry {
  /** Later registration of the same id supersedes; the superseded entry stays resolvable by version. */
  registerVersioned(reg: ToolRegistration, version: string): void;
  setEnabled(toolId: string, enabled: boolean, principalScope?: string): void;
  /** Scoped, paged, filtered *in the query* — never rank-then-filter (`PROP` §6.2). */
  list(opts?: { principal?: Principal; enabled?: boolean; limit?: number; cursor?: string }): readonly ToolDescriptor[];
}
```

The kernel `createToolRegistry()` is untouched. `ScopedToolRegistry` composes over one. This resolves
`PROP` §3's three gaps without editing an invariant whose module doc calls it deliberate.

`list()` filtering must happen where the candidate set is built, not after — enumerating tools a
caller cannot invoke leaks their existence, and post-filtering produces short pages that
misrepresent the corpus.

### Track B2 — schema-on-error (ship before any tool collapse)

§29.4 calls this *"the cheapest high-value item in the entire survey"* and makes it a **hard
dependency** of collapse. On an input-validation failure or a runtime error caused by malformed
input, the error payload carries the tool's full resolved schema. One change to an error path;
turns a dead end into a one-turn self-correction. Reuse §1.4's `'stale-activation'` payload shape so
there is one "here is the contract you should have used" envelope, not two.

### Track B3 — `tool_catalog` + provider indirection

Per `PROP` §2 and §4, unchanged and endorsed: **no executable ever comes out of the database.** A row
names a `provider` registered in code; the provider resolves a row into a `ToolRegistration`. A row
naming an unregistered provider is inert and reports as such.

Table per `PROP` §5.1 with three amendments: `schema_hash` → `template_hash` (§1.3); add
`permission_version_at_write INTEGER`; add `policy_id TEXT NOT NULL` so provenance is a stored
property, not something reconstructed at read time. `TEXT` not JSONB, per `PROP` §5.2 — items 1-4
stand regardless of how the unverified item 5 resolves, so that debate question does not block.

**Sanitisation, both directions.** `normalizeAgentLabel` (`packages/agentic/src/guards.ts:230`) on
`title`/`description` at ingest **and** at read, per `PROP` §7.1. Carry `source`
(`first-party|plugin|unverified`) into what the model sees. The live evidence that this class of bug
is real here is `page.navigate`'s error message reflecting a 5071-char bidi payload verbatim —
because it is the one page-authored string that skips the normaliser.

**Agent may never write the catalog** (`PROP` §7.2): enforce with a guard rule + self-test against a
known-bad fixture, matching `scripts/check-engine-boundaries.ts`. A doc comment is insufficient — the
`@jini/core/internal` incident is the precedent.

### Track B4 — discovery eval harness (before the search it measures)

Non-negotiable ordering, and the handoff names it explicitly. Build the measurement before the thing
measured, or the "BM25 is enough" decision is unfalsifiable.

- `EVAL_DISCOVERY=bm25|hybrid` selects the ranker; the harness is ranker-agnostic.
- Corpus: real catalog rows (§4), not generated fixtures. Query set: written by hand against real
  tools, recorded with the expected `(id, version)`, checked in.
- Metrics: recall@k and MRR at k ∈ {1,3,5,10}; plus **the number that actually decides this** —
  tokens spent per successful tool selection, since the entire three-verb staging in `PROP` §6.1
  exists to protect the context budget, not to maximise recall.
- Also measure §29.4's *unmeasured risk*: **does a model select a correct enum value as reliably as
  it selects a distinct tool name?** No product in the ten-repo survey measured this, and it is the
  empirical premise the §1 decision rests on. If enum selection is materially worse, §29.3's
  collapse is wrong for Jini and this plan's §1 narrowing stays but tool-collapse does not follow.

**Gate:** B5 does not start until B4 produces a baseline number on a corpus of ≥100 real rows. If
the corpus cannot reach 100 real rows, that is the signal that search is not yet justified — stop,
and say so, rather than building it against a corpus of five.

### Track B5 — `search_tools` / `describe_tool` / `activate_tools`

Per `PROP` §6.1, unchanged. `search_tools` returns **ranked** results from day one (no schemas), so a
vector stage can be added later without an API change — independently agreed by the prior session and
by `gpt-5.6-sol`. `LIKE` first; FTS5 as a contentless external-content table when row counts justify
it; the cited paper (arXiv 2603.20313, 121 tools / 140 constructed queries) is not a mandate.

`describe_tool` is where §1's `resolveToolSchema` runs. `activate_tools` pins the five-tuple from
§1.3. A fourth verb, `execute_tool(id, input)`, exists as the fallback for MCP clients that cannot
refresh a tool list dynamically — and it goes through `ToolExecutor` like everything else.

**The catalog is an index, not an ACL** (`PROP` §6.3). Discovery grants nothing. A row saying
`approval: 'auto'` is a hint to the UI, never a grant. Payload's deleted per-key grant UI (commit
`5effd37122`: 177 files, 7,500 deletions, seven days after redesign) is the empirical argument, and
it bears directly on `PROP` debate question 6 — `owner TEXT` is enough; a second authorization model
is the failure.

### Track B6 — the real-source proof

Two sources, each proving a different half. **No fixtures.**

1. **Execution half — the daemon preset tools (§0).** Already registered, already policied, already
   routed. They prove A1–A3 and the `ToolExecutor`→durable-audit path end to end with zero new
   surface area.
2. **Catalog half — `@jini/composio`'s connector catalog.** `packages/composio/src/catalog.ts`
   already models `ConnectorToolDetail` with `safety.{sideEffect, approval}`, `requiredScopes`,
   `inputSchemaJson`, `inputSchemaUnsupportedReason`, `curation.useCases` — `PROP` §1.4 is right that
   this is the closest designed row shape in the repo and its vocabulary should be reused rather than
   a third one invented. It is genuinely third-party, it produces **no handler** today
   (`@jini/composio` does not depend on `@jini/core` — verified), so it *forces* the provider
   indirection rather than letting it be designed around.

   **Caveat, stated up front:** `FEATURED_COMPOSIO_CATALOG` contains ~8 statically defined tools.
   Reaching B4's 100-row gate means hydrating from the live Composio API (network + API key) or
   accepting that the corpus is too small. **That is the honest gate on Track B**, and it is better
   discovered here than after `tool_catalog` ships.

---

## 4. What is deliberately NOT in this slice

- **Embeddings / vector search.** Optional and later. B5's ranked return keeps the door open.
- **A policy language.** Cedar and Rego were evaluated and parked
  (`PARKED-policy-language-cedar-rego-2026-07-27.md`); A1's `AuthorizationResult` is what replaced
  them.
- **Tool collapse (§29.3's entity-parameterized capabilities).** §1 makes it *possible* by settling
  schema variance; B4 decides whether it is *warranted*. Shipping collapse before B2's
  schema-on-error is explicitly forbidden by §29.4.
- **Governing the WebMCP path.** The new confirmation gate (`packages/agentic/src/webmcp.ts`) is
  page-local: no run, no principal, no `ToolExecutor`, no audit. Real gap, separate work item.
- **Renaming `createAguiEncoder`/`AGUIEvent`/`AguiEncoder`** and `@jini/http`'s
  `/api/runs/:runId/agui-stream` route. Wire visible, deliberately deferred.
- **`mcp-ui-apps.ts` finishing.** `@modelcontextprotocol/ext-apps` is not installed and official
  types are not wired. `gpt-5.6-sol`'s claim that our `MCP_UI_HOST_NOTIFICATIONS` inverts
  `ui/initialized` and `ui/notifications/size-changed` **is unverified — check it against
  `modelcontextprotocol/ext-apps` before acting on it.**

## 5. Cross-cutting requirements, from the ten-repo survey

These apply to every phase and are the survey's highest-weighted findings.

1. **One funnel, all transports.** WordPress's `WP_Ability::execute()` runs
   `normalize → validate_input → check_permissions → execute → validate_output`, and all three entry
   paths go through it — so adding a transport *cannot* forget the gate. Five of the ten surveyed
   products had a capability set reachable by two or more paths applying **different** checks. Jini
   has this property today via `ToolExecutor`; the requirement is that B5's new verbs and any future
   transport add **no** second execution path. Enforce with a test that asserts `getToolRegistration`
   has exactly one caller.
2. **Kill-switch completeness.** Directus and novamira both let an agent create artifacts that keep
   running after the AI feature is disabled. Whatever disable path B1's `setEnabled` becomes, test it
   **against artifacts already created** (a live terminal session, a pinned activation, an in-flight
   deploy), not only against new invocations.
3. **Redact at the schema or the source, never in a late filter.** Directus inverts the read
   capability so the *absence* of a principal is what grants plaintext; WordPress bolts masking onto
   a `rest_post_dispatch` filter keyed on an exact route string, which `dispatch()` bypasses. A1's
   `redact` obligation must be applied by the executor on the output path, not by a route wrapper.

## 6. Open items this plan does not close

| # | item | why it is not closed here |
|---|---|---|
| 1 | Does the Composio corpus reach 100 real rows without a live API key? | Empirical; B4's gate answers it |
| 2 | Enum-value selection vs tool-name selection reliability | Requires the B4 eval; §1's decision holds either way, tool-collapse does not |
| 3 | `mcp-ui-apps` message-direction claim | Must be verified against `modelcontextprotocol/ext-apps`, not inferred |
| 4 | `PROP` debate question 2 (SQLite JSONB stability) | Does not block — `PROP` §5.2 items 1-4 stand alone |
| 5 | cbm index registered as `Users-la-Programming-Jini-packages`, plus six confirmed extractor defects | Affects anything read from that index; cross-check structural claims against source |

## 7. Handoff contract

- **Inputs used:** listed in the header; all line numbers read from source this session, not recalled.
- **Output summary:** a two-track sequence with per-phase acceptance criteria, one settled design
  decision (§1), one corrected premise (§0), one ownership decision that adds no package (§2), and
  two explicit gates (A1–A3 green before B1; B4 baseline on ≥100 real rows before B5).
- **Risks:** Track B's corpus gate may not be reachable with in-tree sources (§3 B6 caveat); nothing
  on `feat/agentic-capability-layer` is committed; three deferred renames leave wire-visible
  misnomers.
- **Suggested next assignee:** Coordinator, for task breakdown of Track A1.
