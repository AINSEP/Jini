# `@jini/http` — provenance

Origin: fork `leonaburime-ucla/open-design`, branch `refactor/http-capability-barrel`
(cloned to `/tmp/od-source` for this task), `apps/daemon/src/http/` (the
"capability barrel" module: `core/`, `request/`, `response/`, `origin/`,
`compat/`, `adapter/` subdirectories + a root barrel). Per the task brief this
branch's own test suites (barrel-imports 24/24, guard 79/79, daemon's
`tests/http` suite 23/23) were independently verified clean before this task
started and were trusted rather than re-verified.

Per extraction-plan.md §3: `@jini/http` is "HTTP/SSE transport + route-pack
registrar + injects `ExecutionDelegate`". This task ports the JSON-route
transport half (the capability-barrel module) and adds a route-pack registrar
that plugs into `@jini/core`'s existing `Pack`/`createDaemon` composition
contract. The generic lifecycle SSE projection was added in the 2026-07-19
vertical-slice pass; `ExecutionDelegate` injection remains explicitly deferred
— see "Explicitly deferred" below.

## File map

| Jini file | Origin file(s) | Transform |
|---|---|---|
| `src/types.ts` | `apps/daemon/src/http/core/types.ts` | `Result`/`ok`/`err`/`RouteInputContext`/`InputParser`/`Handler`/`HttpMethod`/`JsonRouteSpec`, logic verbatim. `ApiError` import switched from `@open-design/contracts` to `@jini/protocol` (see "Dependencies" below). |
| `src/request.ts` | `apps/daemon/src/http/request/parse.ts` | `rawInput`/`validationError`, logic verbatim. `createApiError`/`ApiError` switched to `@jini/protocol`; the `issues` parameter type switched from an inline `Array<{path,message}>` to `Pick<ApiValidationIssue, 'path' \| 'message'>[]` against `@jini/protocol`'s existing `ApiValidationIssue` shape (structurally identical, now a named reusable type). |
| `src/response.ts` | `apps/daemon/src/http/response/response.ts` | `sendJson`/`sendApiError`/`statusForError`, logic verbatim. `ERROR_STATUS_BY_CODE` dropped four OD-product-only codes with no `@jini/protocol` equivalent (`PROJECT_NOT_FOUND`, `FILE_NOT_FOUND`, `ARTIFACT_NOT_FOUND`, `AGENT_UNAVAILABLE` — all product/domain-specific 404/503 mappings, not generic transport concerns) and added mappings for `@jini/protocol`'s existing `TOOL_TOKEN_MISSING`/`TOOL_TOKEN_INVALID`/`TOOL_TOKEN_EXPIRED` → 401, `TOOL_ENDPOINT_DENIED`/`TOOL_OPERATION_DENIED` → 403, `TOOL_NOT_AVAILABLE` → 503 (these generic tool-boundary codes already existed in `@jini/protocol`'s `GENERIC_ERROR_CODES` before this task but had no status mapping anywhere yet). Codes with no explicit entry still fall back to 500, unchanged. |
| `src/origin-validation.ts` | `apps/daemon/src/origin-validation.ts` (daemon-source root, one level above `http/` — a dependency `origin/origin-guard.ts` reaches via `../../origin-validation.js`, not a file inside `http/` itself) | Ported the framework-independent same-origin/allow-list logic verbatim (`parseHostHeader`, `isPrivateIpv4`, `isIpLiteralHostname`, `isLoopbackOrPrivateLanHost`, `isAllowedBrowserHost`, `isAllowedBrowserOrigin`, `isLocalSameOrigin`, `configuredAllowedOrigins`, `configuredAllowedHosts`, `allowedBrowserPorts`, `headerValue`). **Identity-stripped**: env var names `OD_ALLOWED_ORIGINS` → `JINI_ALLOWED_ORIGINS`, `OD_WEB_PORT` → `JINI_WEB_PORT`, `OD_BIND_HOST` → `JINI_BIND_HOST` (all three contain the `OD_` substring the root `AGENTS.md` hard boundary bans). **Not ported**: `isZeroConfigClipperLibraryRequest` and its JSDoc — a bypass predicate for the OD-desktop-specific "OD Clipper" browser extension's probe/ingest routes (`/library/clipper-probe`, `/library/ingest`), a real OD product feature with no generic-transport meaning, not "pure HTTP/SSE transport plumbing." |
| `src/origin.ts` | `apps/daemon/src/http/origin/origin-guard.ts` | `guardSameOrigin`/`OriginContext`, logic verbatim; imports the sibling `origin-validation.ts` above (was two directories up in OD, now a sibling file — both are inside this package). `createApiError` switched to `@jini/protocol`. |
| `src/compat.ts` | `apps/daemon/src/http/compat/api-errors.ts` | `createCompatApiError`/`createCompatApiErrorResponse`/`sendApiError`, logic verbatim. Types switched to `@jini/protocol`. |
| `src/adapter.ts` | `apps/daemon/src/http/adapter/adapter.ts` | `defineJsonRoute`/`mountJsonRoute`/`AdapterContext`, logic verbatim (only import paths flattened from `../request/index.js` etc. to sibling `./request.js` etc., since this package has no subdirectories). `createApiError` switched to `@jini/protocol`. |
| `src/pack-http.ts` | *(new)* | `mountPackHttp` — the route-pack registrar. See "Design decisions" below. |
| `src/index.ts` | `apps/daemon/src/http/index.ts` | Root barrel, re-export set unchanged in kind (adds `mountPackHttp`). Flattened to reference sibling files directly instead of subdirectory barrels, since this package has no subdirectories (the capability-barrel *pattern* — foundation/leaf/orchestration layering — is preserved in the module's internal dependency shape even though the directory nesting was collapsed). |
| `src/daemon-status.ts` | `apps/daemon/src/routes/daemon.ts` (`GET /api/daemon/status`, `POST /api/daemon/shutdown` only — see the routes-classification table below for the rest of that file's verdict) | *(port/backend-routes task, added after the above)* Fully dependency-injected rewrite, not a lift: `getVersion`/`host`/`getPort`/`dataDir`/`isShuttingDown`/`requestShutdown` are all supplied by the caller rather than read from `db`/`env`/process globals the way the origin did. Dropped the origin's `installedPlugins` (a raw `SELECT COUNT(*) FROM installed_plugins` — an OD-product table), a product-specific config-dir field, and a sandbox-mode flag — none of those concepts exist in the engine kernel. The shutdown route reuses the existing `requireSameOrigin: true` `JsonRouteSpec` flag (the same gate `origin.ts`/`guardSameOrigin` already provides) instead of inventing a parallel "local daemon request" gate — this is the pre-existing mechanism, not a new one. `requestShutdown` stays a plain injected callback (not this module calling `process.emit('SIGTERM')` itself) because whether that terminates the process depends on a listener the *caller* registers; preserved the origin's respond-then-`setImmediate`-then-shutdown ordering so the HTTP response is always written before the shutdown callback runs. |
| `src/runs.ts` | `apps/daemon/src/routes/runs.ts`'s thin lifecycle delegations plus new transport design | **New generic transport seam, not a lift.** `POST /api/runs`, `GET /api/runs/:runId`, `POST /api/runs/:runId/cancel`, and `GET /api/runs/:runId/events` project only `RunLifecycle`; no project, conversation, plugin, or artifact semantics cross this boundary. The SSE endpoint uses the canonical `RunProtocolEvent` envelope and `Last-Event-ID`/`afterCursor` reconnect cursors. `RunStartHandler` is deliberately host-owned: after the start record is durable, a host attaches its chosen driver; the route never makes an agent/tool policy decision itself. |

Every file the origin module's barrel actually exported has a Jini equivalent
exporting the same name (`compat`'s `sendApiError` is still re-exported as
`sendCompatApiError` for the same collision-avoidance reason documented in the
origin `README.md`).

### `tool-request-auth.ts` — not found, not ported

The task brief's file list named `tool-request-auth.ts` alongside
`adapter.ts`/`api-errors.ts`/`origin-guard.ts`/`parse.ts`/`response.ts`. It
does not exist anywhere in this repository — verified with
`find . -iname "*tool-request-auth*"` across the entire `open-design` clone
(both on `refactor/http-capability-barrel` and `main`), zero matches. The
task brief's file list also predates the capability-barrel refactor (it
describes a flat `http/` directory of 6 files, which is exactly what the
branch's own `README.md` says the directory looked like *before* this
refactor — see "What changed" in that README). Treated as a stale/approximate
recon list; the actual directory contents on the named branch were used as
ground truth.

## Design decisions

**1. `compat.ts` was ported despite having no current Jini call site.** OD's
`compat/api-errors.ts` exists only because `server.ts`'s routes — written
before `JsonRouteSpec` existed — call error helpers with a different argument
shape than the rest of the module; Jini's `@jini/http` has no such legacy
call sites of its own. It was kept anyway for two reasons: (a) the task brief
explicitly named `api-errors.ts` in its file list, and (b) extraction-plan.md
§4's OD-sync mechanism (hollow re-exports + patch canary) depends on Jini's
port carrying the *same public surface* as the OD module it patch-routes
against — dropping an exported symbol here would be exactly the kind of
silent divergence that mechanism exists to catch. A future host application
with its own legacy hand-mounted routes (mirroring OD's `server.ts`) is the
plausible real consumer; until then it is inert, imported-but-unused code,
which is an acceptable cost for sync fidelity in a package whose whole
purpose is to be a faithful patch target.

**2. `mountPackHttp` (route-pack registrar) is new, not a lift.** OD's
`http/` module has no concept of "packs" — it predates `@jini/core`'s typed
DI-token composition contract entirely; `server.ts` mounts every route by
hand. Per extraction-plan.md §3's description of `@jini/http` as containing
a "route-pack registrar," and per the task brief's explicit instruction to
check `packages/core/src/pack.ts` and compose with it rather than inventing a
separate pattern, `mountPackHttp(app, packs, daemon)` was built fresh: it
iterates the same `packs` array passed to `createDaemon` and calls each
pack's optional `Pack.http(app, services)` registrar (declared in
`@jini/core`'s `pack.ts` with `app` deliberately typed `unknown` so the
kernel never depends on Express) with the *same* Express `app` and the
*same* composed `services` object `@jini/cli`'s eventual CLI registrar would
receive via `Pack.cli` — satisfying extraction-plan.md §2.3's "both
transports call one shared app-service" invariant. Packs with no `http`
registrar are silently skipped (a CLI-only or headless pack is not an error).

**3. `ExecutionDelegate` injection is explicitly out of scope, not
overlooked.** Extraction-plan.md §3 describes `@jini/http` as also
"injects `ExecutionDelegate`" (§2.5's tool-execution-boundary confirm/authorize
callback pair, transport-specific by design). `ToolExecutor` now exists in
`@jini/daemon`, but the external CLI stream currently reports a tool use after
the CLI has executed it; it is not a pre-execution request/response protocol.
This transport therefore does not pretend to inject a post-hoc callback as an
authorization gate. A controlled agent protocol is a real, named follow-up.

**4. `ERROR_STATUS_BY_CODE` was re-scoped to `@jini/protocol`'s codes, not
copied 1:1.** See the `src/response.ts` file-map row above for the exact
additions/removals. This keeps the status-mapping table honest about which
codes are actually reachable through `@jini/protocol`'s `ApiErrorCode` type
(an open string type — a pack's own codes still type-check and simply fall
back to the conservative 500 default, same as OD's unmapped-code behavior).

## Explicitly deferred (not part of this port)

- **Additional streaming projections.** The lifecycle SSE run transport now
  exists, but AGUI mapping, terminal sessions, and product-specific stream
  families remain out of scope.
- **`ExecutionDelegate` injection.** See Design decision 3 above.
- **The OD-sync patch-router** (extraction-plan.md §4.3's "a patch touching a
  `delegated-to-jini` path fails CI until the equivalent package patch
  lands"). Depends on task 1 (harnesses + sync-ownership manifest), which per
  `packages/platform/source-map.md`'s own "Explicitly deferred" note has not
  been done yet anywhere in this repo. Not attempted here for the same
  reason.

## Dependencies

`@jini/core` (workspace) — `Pack`/`Daemon` types for `mountPackHttp`.
`@jini/protocol` (workspace) — `ApiError`/`ApiErrorCode`/`ApiErrorResponse`/
`ApiValidationIssue`/`createApiError`/`createApiErrorResponse`, replacing
OD's `@open-design/contracts` import throughout (that package's DTOs are
OD-product-coupled per `foundry/docs/jini-port/recon/r2-packages.md` §1;
`@jini/protocol/src/errors.ts` already independently defines the same
generic error shapes this module needs — matched 1:1 by name and field
shape, so the switch was a mechanical import-source change with one field
narrowing noted in the `src/request.ts` row above, not a redesign).
`express` (`^4.21.0`, new runtime dependency) + `@types/express`
(devDependency) — this package is Express-typed by design; no HTTP
framework dependency previously existed anywhere in the Jini workspace.

## 2026-07-18 addition — resolving the `http/` recon discrepancy + `local-daemon-request.ts`

Tonight's task brief flagged a discrepancy: `foundry/docs/jini-port/recon/r1-daemon.md`'s
TASK 1 table lists a 10-file `http/` directory (`adapter.ts`, `api-errors.ts`,
`origin-guard.ts`, `parse.ts`, `response.ts`, `tool-request-auth.ts`, "plus 4
more") as GENERIC-ENGINE, which doesn't match this package's already-merged
file list (`adapter.ts`, `compat.ts`, `index.ts`, `origin-validation.ts`,
`origin.ts`, `pack-http.ts`, `request.ts`, `response.ts`, `types.ts`, from
branch `port/http-sqlite-platform-protocol-plus`). Investigated by cloning
the real `leonaburime-ucla/open-design` fork fresh (`/tmp/od-source`) and
comparing three branches' `apps/daemon/src/http/` directories directly (not
relying on either port's prior write-up):

- **`main`** and **`refactor/http-capability-barrel`** (this package's actual
  origin per the "File map" table above) — 7-file flat / capability-barrel-
  subdivided forms of the same six logical modules (`adapter`/`api-errors`/
  `origin-guard`/`parse`/`response`/`types` + `index`). Byte-diffed the flat
  files on `main` against `refactor/web-memory-slice` (see next bullet) —
  **identical**. Diffed `web-memory-slice`'s flat `api-errors.ts` against
  `http-capability-barrel`'s refactored `compat/api-errors.ts` — differs only
  by added JSDoc comments, logic byte-identical. **Verdict: already covered,
  no action** — these six modules are the same underlying source at different
  points in its own capability-barrel refactor history, and this package
  already ports the post-refactor, better-documented version.
- **`refactor/web-memory-slice`** — the recon's actual scope (stated at the
  top of `r1-daemon.md`) — has a **genuinely different, still-10-file**
  flat `http/` directory: the same six shared files above, **plus**
  `local-daemon-request.ts`, `oauth-result-page.ts`, and `tool-request-auth.ts`
  (10 total, matching the recon's count exactly — the prior port's source-map
  claim of "zero matches for `tool-request-auth.ts`... across the entire
  clone (both on `refactor/http-capability-barrel` and `main`)" is accurate
  for the two branches it checked, but did not check `web-memory-slice`,
  which is where the recon's file list actually came from).

Of those three additional files:

- **`local-daemon-request.ts`** — genuinely separate, generic, zero OD
  coupling (loopback-peer/Host/Origin validation + a CORS-header-setting
  Express middleware; no product nouns). **Ported** — see below.
- **`tool-request-auth.ts`** — generic-shaped bearer-token middleware
  (`createToolRequestAuth`, `bearerTokenFromRequest`), but its only
  real dependency, `../tool-tokens.js` (`ToolTokenRegistry`), is
  **OD-product-coupled**: `CHAT_TOOL_ENDPOINTS`/`CHAT_TOOL_OPERATIONS`
  hardcode OD feature endpoints (`/api/tools/live-artifacts/*`,
  `/api/tools/design-systems/read`, `/api/tools/media/generate`,
  `/api/tools/library/*`, `/api/tools/connectors/*`), and its opaque token
  prefix is literally `odtt_`. This isn't a thin coupling to strip — it's
  the whole registry's reason to exist. **Not ported.** This module's
  generic shape (bearer-token-gated tool endpoints) is exactly what
  extraction-plan.md §8 task 6 (`ToolExecutor` boundary, §2.5) will need to
  build as a real engine port when that task starts — a future port should
  design that port's shape fresh against `ToolExecutor`'s actual contract
  rather than reusing this OD-coupled registry.
- **`oauth-result-page.ts`** — pure OD-branded product HTML (an MCP-OAuth
  callback landing page; literal "Open Design" text in its `<title>`/body
  copy, a `BroadcastChannel('open-design-mcp-oauth')` channel name). **Not
  ported** — no generic core to extract; a future MCP-OAuth-flow port (out
  of scope for this task) would need its own neutral result-page template.

### `local-daemon-request.ts` — ported

| Jini file | Origin file | Transform |
|---|---|---|
| `src/local-daemon-request.ts` | `apps/daemon/src/http/local-daemon-request.ts` (on `refactor/web-memory-slice`) | `normalizeLocalAuthority`/`isLoopbackHostname`/`isLoopbackPeerAddress`/`localOriginFromHeader`/`validateLocalDaemonRequest`/`requireLocalDaemonRequest`, logic verbatim except one dead-code removal — see below. Import switched from the origin's own `./api-errors.js` (`sendApiError(code, message, init)`, separate-arguments call shape) to this package's `./compat.js` `sendApiError`, which is the exact same call shape already ported here (see the original "File map" table's `src/compat.ts` row) — a mechanical import-source change, not a redesign. |

**One dead-code removal (behavior-preserving, coverage-proven):**
`normalizeLocalAuthority`'s origin body had
`if (!hostname || parsed.username || parsed.password || parsed.pathname !== '/') return null;`.
Empirically proved unreachable-as-written before removing anything:
`trimmed` is already rejected one line earlier by
`/[\s/@]/.test(trimmed)` whenever it contains `/` or `@` — the two
characters required for a URL to ever produce a non-root `pathname` or a
non-empty `username`/`password` — so those three sub-conditions can never
be true when this line executes. Verified with a standalone probe against
Node's actual `URL` parser (not just reasoning about the grammar) before
simplifying to `if (!hostname) return null;` (the fourth condition, `!hostname`,
*is* reachable — e.g. `trimmed === '.'` parses to `parsed.hostname === '.'`,
which becomes `''` after the trailing-dot strip — and is kept, with a test).
This is the same category of fix Phase 6.5's coverage-driven loop calls a
"dead branch... refactor it away behaviorally-safely," applied narrowly and
proven, not assumed.

## Tests

`src/local-daemon-request.test.ts`, written fresh for this port. Also
backfilled two coverage gaps in the **pre-existing** (not authored by this
task) `origin-validation.ts` while getting this package's aggregate to the
Phase 6.5 bar: `parseHostHeader` had zero tests before tonight (added a
`describe` block covering array-header/empty-array/catch-branch cases), and
`isAllowedBrowserOrigin`/`isLocalSameOrigin`/`isPrivateIpv4`/
`isLoopbackOrPrivateLanHost` had a handful of untested branches (non-http(s)
origin scheme, missing Host header, default 80/443 origin ports, a
completely headerless request, falsy-hostname fallbacks); added
`isIpLiteralHostname` tests (previously untested despite being exported).
Also added `src/index.test.ts` (the barrel had no direct test, so v8 counted
it as 0% covered even though every symbol it re-exports is exercised via its
own file's tests).

## Dependencies

No new dependency — `local-daemon-request.ts` uses only `node:net` plus this
package's own `compat.ts` export and `express`'s existing `Request`/
`Response`/`NextFunction` types (already a dependency of this package).
---

## `routes/` classification (32 files) — backend-routes port task

Scope note on branch: `foundry/docs/jini-port/recon/r1-daemon.md` TASK 1 counts `routes/` at
32 files, but `main`/`refactor/http-capability-barrel` on
`leonaburime-ucla/open-design` only have 29 — three files
(`attribution.ts`, `whats-new.ts`, `project/cancel-owned-runs.ts`) exist only on
`refactor/web-memory-slice`, which is the branch r1-daemon.md was actually reconned
against. This table was built against `refactor/web-memory-slice` (cloned to
`/tmp/od-source` for this task) to match the recon's 32-file scope. Every file was
read in full (directly or via a dedicated research subagent, each independently
verified against the source) before classification; line numbers below refer to that
branch.

Key: **GENERIC** = ports cleanly, no product meaning. **OD-PRODUCT** = Open Design
domain end to end, not portable without a rewrite. **MIXED** = a real generic
sliver exists alongside OD-specific logic that would need to become an injected
port, not a lift.

| # | File | Lines | Verdict | Reasoning |
|---|---|---|---|---|
| 1 | `active-context.ts` | 129 | MIXED | Generic in-memory TTL-store + route-mount scaffold; the one real coupling is `handleGetActive` calling `deps.getProject` (OD project store) to resolve a display name. Renaming `projectId`/`fileName` to a generic "resource ref" would make the whole file portable. All-sync handlers, no async risk. |
| 2 | `automation.ts` | 126 | GENERIC (route file only — **see blocker below**) | The route file itself has zero OD imports beyond a type-only `AutomationProposalStatus`. But its two real dependencies, `automation-proposals.ts` and `automation-ingestions.ts`, are **not** self-contained: `automation-proposals.ts` imports `deleteMemoryEntry/readMemoryEntry/upsertMemoryEntry` from OD's `memory.ts` store. So a direct port would drag in the memory subsystem too — this is a real dependency-chain finding the file-level read alone would miss (flagged explicitly so it isn't silently swallowed the way the audit warned about). Not ported this round; see "Explicitly deferred" below. |
| 3 | `routine.ts` | 348 | MIXED | Generic routine CRUD/schedule/run-tracking engine (a "cron for agent prompts"), minus `target.mode === 'reuse'` validating an OD `projectId` via `getProject`. Real risk: `GET/DELETE /api/routines/:id` and `GET .../runs` have **no try/catch** unlike every sibling handler in the same file — an inconsistency worth a targeted test if ever ported. |
| 4 | `memory.ts` | 690 | MIXED | The large majority (config, entries, extraction pipeline, SSE change/extraction/verify events, connector suggest/extract, system-prompt composition) is generic agent-memory infra with no design/brand nouns. One handler, `POST /api/memory/rules/suggest`, is OD-specific (canvas/deck-annotation shape: `targetLabel`/`filePath`/`selectionKind`/`htmlHint`). Real risk: read-modify-write race on `PATCH /api/memory/config` (no lock between read and write — concurrent patches can lose an update) and a fire-and-forget background extraction whose failure is only `console.warn`'d, never surfaced. Also requires SSE (deferred capability, see below). |
| 5 | `chat.ts` | 2267 | MIXED | Mostly generic BYOK chat/model-proxy plumbing (SSE framing, Anthropic/OpenAI/Azure/Google/Ollama wire adapters, tool-schema translation) — genuinely the largest reusable surface in the whole 32-file set. OD-specific slices: the feedback route's hardcoded design-system-flavored reason-code allowlist + Langfuse sink; two "Critique Theater" routes; a BYOK media tool-loop that writes into OD's project folder; and one **hard boundary violation** — a literal `'X-Title': 'Open Design'` / `opendesign.dev` referrer header sent to OpenRouter (line ~1029), which must be parameterized before any port. Real bug found: the tool-loop variants of the SSE turn-runner (`runTurn`/`runAnthropicToolTurn`/`runGeminiToolTurn`) send a duplicate SSE `end` event on role-marker-guard contamination — the non-tool-loop streamers correctly guard against a double-send with a local `ended` flag; the tool-loop ones don't. Requires SSE (deferred). `ctx.design`/`ctx.chat`/`ctx.validation`/`ctx.lifecycle` are declared in the deps type but never actually used anywhere in the file — the recon's worry about a design-system coupling here does not hold on this branch. |
| 6 | `runs.ts` | 1489 | MIXED, ~85% OD-weighted | Only `GET /api/runs/:id`, `GET /api/runs/:id/events`, `POST /api/runs/:id/cancel` are thin, near-pure delegation to an injected run service. `POST /api/runs` (766 of the file's 1489 lines) is dominated by plugin-snapshot resolution, project/tool-bundle validation, design-system-selection resolution, and a huge inline OD-analytics-event-construction block. `GET /:id/result-package` and `GET /:id/agui` are entirely OD artifact-manifest/AGUI-wire-protocol logic. Real risk: a large unguarded segment of `POST /api/runs` (after the response is already sent) has no try/catch — a synchronous throw there is an unhandled rejection in the async handler with nothing to catch it. All SSE (deferred). |
| 7 | `project/index.ts` | 3957 | OD-PRODUCT | 42 endpoints, all keyed to OD's `projects` SQLite row and its `metadata.baseDir`/design-system/brand/plugin/template subsystems — confirmed no generic "workspace/session CRUD" sliver survives extraction; only isolated *techniques* (Range/ETag revalidation, dual multipart/JSON upload) are reusable, and each is fused to project-specific hooks anyway. Real risk: `POST /api/projects` and `design-system-copy` use manual multi-step DB+filesystem cleanup instead of a transaction — a crash mid-sequence can orphan a DB row or directory. |
| 8 | `project/comments.ts` | 91 | MIXED | Generic preview-comment CRUD; the only OD tie is the `/api/projects/:id/...` path segment and an `updateProject(db, id, {})` call used purely to bump a timestamp. Renaming the parent to a generic workspace/session id would make this portable as-is. `DELETE` lacks the try/catch its POST/PATCH siblings have. |
| 9 | `project/conversations.ts` | 219 | MIXED, leans OD-PRODUCT | Conversation/message CRUD + fork/seed semantics is a plausible generic "chat/run history" shape, but as written it's entangled with `@open-design/contracts`' `ChatSessionMode` (includes the OD-specific `'design'` mode), OD's brand-extraction transcript backfill, and analytics/telemetry reporting. Real risk: `DELETE /conversations/:cid` awaits `cancelRunsOwnedBy(...)` with no try/catch — an unhandled-rejection path (see #10). |
| 10 | `project/cancel-owned-runs.ts` | 33 | GENERIC | A single helper (`cancelRunsOwnedBy`), not a route registrar — defines its own minimal structural `RunCancellationService` interface, no OD imports. Only naming ties to "project" (`{conversationId?, projectId?}` scope), trivially generalizes. Its `runs.list(...)` call is unguarded and is the concrete origin of the unhandled-rejection risk propagating through `conversations.ts` above. |
| 11 | `terminal.ts` | 109 | MIXED | Generic PTY/SSE session transport (list/create/stream/stdin/resize/kill), wrapped in `ctx.projectStore.getProject`/`ctx.projectFiles.resolveProjectDir` purely to resolve a spawn cwd. Would port cleanly once a generic "workspace root resolver" port exists. Requires SSE (deferred). No lock between a `kill` and a concurrent `stdin`/`resize` on the same session id. **Update 2026-07-21**: both blockers this row named are now resolved as standalone prerequisites — `src/sse.ts` (a generic SSE channel) and `src/workspace-root.ts` (a generic workspace-root resolver), see their own 2026-07-21 addition sections below — but `terminal.ts` itself has not been ported; wiring it to these two primitives remains future work. |
| 12 | `daemon.ts` | 173 | MIXED — **partially ported this round, see below** | `GET /api/daemon/status` and `POST /api/daemon/shutdown` are genuinely generic once the OD-specific `installedPlugins`/`mediaConfigDir`/`sandboxMode` fields are dropped. `GET/POST /api/daemon/db*` (SQLite inspect/verify/vacuum) are generic in shape and were originally deferred pending a separate `storage/db-inspect.ts` port — **that port now exists (`@jini/sqlite`'s `db-inspect.ts`) and the three DB routes were ported 2026-07-21 as `src/db-ops.ts`, see its own addition section below.** `POST /api/agents/:agentId/oauth-launch` (hardcoded to `agentId === 'antigravity'`) and `GET /api/critique/conformance` are OD-product and excluded entirely. Real risk: `process.emit('SIGTERM')` only fires *existing* listeners — it doesn't send a real signal — so the shutdown route is a no-op unless something elsewhere registered a handler; preserved as an injected `requestShutdown` callback in the port rather than assumed. |
| 13 | `telemetry.ts` | 180 | OD-PRODUCT (recon's "plausibly generic" guess does not hold) | Only the bare `POST /api/observability/event` passthrough route shape is schema-agnostic; every dependency it's built on (`@open-design/sidecar-proto`, `@open-design/contracts/analytics`, a Langfuse run-feedback bridge, an installer-migration telemetry bootstrap, PostHog wired to OD's consent model) is OD-specific. Also: this module unconditionally installs process-level `uncaughtException`/`unhandledRejection` handlers that call `process.exit(1)` as a side effect of route registration — an architectural smell to flag, not something to port as-is. |
| 14 | `design-system-tool.ts` | 104 | OD-PRODUCT | Single tool-token route resolving a project's *active design system* by id; no generic sliver. |
| 15 | `design-systems.ts` | 473 | OD-PRODUCT | 19 routes, all design-system generation/revision/token-contract/showcase/craft. `@open-design/contracts` `Project`/`ProjectFile` import is a direct product dependency. Two small pure utilities (`sanitizeArchiveFilename`, the showcase asset-URL rewriter's traversal guard) are algorithmically generic but embedded, not separable routes. |
| 16 | `deploy.ts` | 261 | OD-PRODUCT | Every route resolves an OD project's file tree (`buildDeployFileSet`, `prepareDeployPreflight` — exactly the reference-walking family `packages/deploy/source-map.md` documents as deliberately **not** ported) and maintains a project-scoped SQLite deployment ledger. The provider-adapter core it delegates to (Vercel/Cloudflare HTTP calls, reachability polling) is already ported in `@jini/deploy`; this route file is the OD-side caller of that logic, not a duplicate of it. Real risk: concurrent `POST /:id/deploy` calls race on `prior.deploymentCount` with no lock. |
| 17 | `media.ts` | 655 | OD-PRODUCT | Media-generation catalog/config plus unrelated OD features bundled in (Orbit, desktop dialogs, linked-dir recents, research search) — broader grab-bag than the filename suggests. Real risk: `.then/.catch/.finally` chain in the fire-and-forget generate call can throw inside the `.then`/`.catch` callbacks themselves with nothing to catch that — unhandled rejection. |
| 18 | `genui.ts` | 211 | OD-PRODUCT | Human-in-the-loop "genui surface" pattern is conceptually generic, but this implementation is fused to OD's plugin/diff-review/devloop system and raw `genui_surfaces` SQL — would need a fresh design, not a lift. |
| 19 | `handoff.ts` | 176 | OD-PRODUCT | Synthesizes a "resume this chat" prompt from an OD conversation transcript; BYOK upstream call is well-guarded (a model of correct `AbortController`/`finally` cleanup, not a risk). |
| 20 | `plugins/index.ts` | 304 | OD-PRODUCT | OD's plugin/marketplace/atom pipeline; one route path is a literal `/contribute-open-design` product-identity string (guard-script-banned pattern). |
| 21 | `plugins/assets.ts` | 287 | OD-PRODUCT | Plugin-manifest-namespaced (`manifest.od.*`) asset serving. Real risk: the `/preview` and `/example/:name` routes have a weaker symlink TOCTOU guard than the `/asset/*splat` route serving conceptually the same kind of content — worth a security note independent of porting. |
| 22 | `plugins/marketplaces.ts` | 121 | OD-PRODUCT | Thin wrapper over OD's plugin-marketplace subsystem; cleanest error-handling of the three plugin files. |
| 23 | `host-tools.ts` | 380 | MIXED — **partially ported this round, see below** | The editor catalogue + `$PATH`/mac-bundle probing + guarded detached-spawn machinery (`CATALOGUE`, `resolveEntry`, `launchHostTool`, `resolveHostToolLaunchPlan`, `applicableForPlatform`) has zero OD dependency and is well-hardened (a documented, fixed race on spawn-vs-error ordering). `GET /api/editors` uses only that machinery. `POST /api/projects/:id/open-in` additionally calls OD's `projectStore.getProject`/`projectFiles.resolveProjectDir` to resolve a working directory — that route is not ported until a generic workspace-root port exists. (A first-pass automated read of this file called it fully GENERIC; on closer reading the POST route's project-store dependency is real and the file is classified MIXED here instead.) |
| 24 | `library.ts` | 692 | MIXED, OD-leaning | OD's browser-extension "clipper" capture + Figma-import + "edit as page" (creates a new OD project) pipeline. The plumbing underneath (content-addressed storage, MIME sniffing, SSE fan-out, throttled-reconcile-with-shared-in-flight-promise) is reusable in shape but entangled with OD nouns throughout. Real risk: a `force=true` reconcile call arriving while a `force=false` reconcile is in-flight silently returns the stale non-forced promise instead of forcing a fresh one; also an unguarded `fetch()` with no timeout in the remote-asset ingest path. |
| 25 | `static-resource.ts` | 898 | MIXED, OD-leaning | HTTP surface for OD's skill/design-template/design-system/prompt-template/Codex-pets content taxonomy — not generic static-file serving despite the filename. Confirms the recon's note that the OD content-directory taxonomy (`SKILLS_DIR`/`DESIGN_SYSTEMS_DIR`/etc.) is baked into the shared `ServerContext.paths` type itself. Two literal product-identity strings found (`'Open Design Example'` in a page title, `'cannot import Open Design runtime data'` in an error message) — direct boundary-rule violations if ported as-is. Real risk: several TOCTOU races between `fs.existsSync` and a later `readFile` in the multi-step example-resolution fallback chain. |
| 26 | `vela.ts` | 494 | OD-PRODUCT | Vela/AMR vendor integration; hardcoded `amr-api.open-design.ai` domain. Error handling here is unusually mature (explicit comments documenting prior race-condition fixes) — a model file for hardening patterns, not a risk source. |
| 27 | `xai.ts` | 422 | MIXED, OD-leaning | The OAuth start/complete/status/cancel/disconnect shape is a recognizable generic pattern, but this file is fused to a transitional xAI PoC arrangement (a bespoke loopback-port listener tied to xAI's own client_id, an OD-internal credential-cascade referencing another OD system by name, and a vendor-specific `/search` feature route bundled into the same file as auth). Real risk: `activeListener` is process-wide mutable state with no lock — two near-simultaneous OAuth starts can leak an open listener socket. No token-refresh-on-expiry logic exists anywhere in this file (a real gap, not just an untested path). |
| 28 | `attribution.ts` | 354 | OD-PRODUCT | Install/download attribution + growth analytics; hardcoded `download.open-design.ai` domain and an `OD_ATTRIBUTION_LEDGER_*` env var pair (the `OD_` prefix `AGENTS.md`'s guard bans in `packages/@jini/**`). |
| 29 | `social-share.ts` | 31 | OD-PRODUCT | Single route whose *default* share kind is the literal `'open-design-repo'` — the default behavior itself is OD-branded, not just an import. |
| 30 | `whats-new.ts` | 23 | MIXED | The version-lookup + changelog-by-channel shape is generic; the coupling is at the type/wiring level (`@open-design/contracts`' `WhatsNewResponse`, OD-local `app-version.ts`/`services/whats-new.ts`), not literal branding. Worst error-handling posture of any file in the whole set: **zero try/catch** around two awaited calls — a rejection here means no response is ever sent to the client. |
| 31 | `open-design-public-metadata.ts` | 74 | OD-PRODUCT | Confirmed by content, not just filename: hardcoded `nexu-io/open-design` repo name and a specific Discord invite code. No generic abstraction to salvage. |
| 32 | `live-artifact.ts` | 317 | OD-PRODUCT | No `@open-design/contracts` import and no branding literals anywhere — the OD coupling here is architectural (every dependency is OD's project/tool-grant model), not string-based. Real, independent finding: the plain `GET/PATCH/DELETE /api/live-artifacts/:artifactId*` routes have no `authorizeToolRequest`/ownership check at all (only the `/api/tools/live-artifacts/*` routes enforce tool-grant scoping) — a genuine access-control gap worth flagging to OD regardless of the porting question. |

**Tally: 2 GENERIC, 14 MIXED, 16 OD-PRODUCT** (of 32).

### What got ported this round vs. deferred

Only **`daemon.ts`'s status + shutdown pair** was ported this round, as a new
`src/daemon-status.ts` — see its own docblock for the design (fully
dependency-injected: caller supplies `getVersion`/`host`/`getPort`/`dataDir`/
`isShuttingDown`/`requestShutdown`; the OD-specific `installedPlugins`/
`mediaConfigDir`/`sandboxMode` fields were dropped, not carried over). This directly
answers `packages/cli/source-map.md`'s daemon status/stop question — **except that
file does not exist in this repository**: `packages/cli/src/index.ts` is a one-line
placeholder (`// @jini/cli — placeholder.`) with no source-map.md anywhere under
`packages/cli/`. There is no "UNCLEAR row" to resolve because no CLI port has
happened yet on this branch. The finding stands on its own regardless: a generic,
tested, dependency-injected daemon status+shutdown pair now exists in `@jini/http`
for whichever task builds `@jini/cli` for real to consume.

Everything else classified above — including the other five files the task brief
named as "plausibly generic" (`chat.ts`, `runs.ts`, `terminal.ts`, `telemetry.ts`,
`memory.ts`) — is **explicitly deferred**, not silently dropped:

- **`automation.ts`**: route file is clean, but its dependency chain reaches OD's
  memory store (`automation-proposals.ts` → `memory.ts`) — needs that store ported
  or stubbed first. Real, valuable finding; not attempted this round.
- **`chat.ts`, `runs.ts`, `terminal.ts`, `memory.ts`**: all require SSE, which
  `@jini/http`'s adapter (`adapter.ts`/`mountJsonRoute`) does not support yet — this
  package is JSON-route-only by design so far (per this file's own "Explicitly
  deferred" section above, written on a prior task). Porting any of them before an
  SSE primitive exists in this package would mean inventing that primitive
  unilaterally inside a routes-porting task, which is out of scope here.
- **`telemetry.ts`**: turned out OD-PRODUCT on inspection, contradicting the recon's
  guess — not a deferral, a corrected verdict.
- **`daemon.ts`'s remaining routes** (`db`/`db/verify`/`db/vacuum`): generic in
  shape but depended on a `storage/db-inspect.ts` port not built this round. **Update
  2026-07-21**: that port now exists (`@jini/sqlite`'s `db-inspect.ts`) and these three
  routes were ported as `src/db-ops.ts` — see its own addition section below.
- **`host-tools.ts`'s generic sliver** (catalogue/probe/launch machinery, `GET
  /api/editors`): identified as portable and well-hardened, but not ported this
  round for time — a good next-task candidate, smaller in scope than the SSE-bound
  files above.
- **`project/comments.ts`, `project/conversations.ts`, `active-context.ts`,
  `routine.ts`**: each has a real generic core, but every one needs the same
  not-yet-built generic "workspace/session" port (recon's PORT #2) to stand in for
  OD's project store before extraction — building that port was out of scope for a
  routes-classification-and-port task.

This is a partial port by design, not an incomplete one: the 32-file classification
above is complete and is this task's primary deliverable regardless of how much
porting followed it.

## 2026-07-19 addition — `api-security-middleware.ts` + `route-registration-guard.ts` (node-host keystone task)

Ported as part of `@jini/node-host`'s `createLocalNodeDaemon` keystone task (see
`packages/node-host/source-map.md`) — these two files are the security/inventory middleware
`createLocalNodeDaemon` assembles onto its Express app, but they live here rather than in
`node-host` because they are pure `@jini/http` transport concerns (Express middleware, no daemon
composition logic), consistent with this package's existing role as "HTTP/SSE transport + route-
pack registrar." Origin: `apps/daemon/src/http/api-security-middleware.ts` and
`apps/daemon/src/route-registration-guard.ts` on the user's `arch/server-startserver-endgame`
branch (`leonaburime-ucla/open-design`, reference-only clone at
`/Users/la/Desktop/Programming/OSS-Repos/open-design`), read via `git show` (branch not checked
out there).

| Jini file | Origin file | Transform |
|---|---|---|
| `src/api-security-middleware.ts` | `apps/daemon/src/http/api-security-middleware.ts` (new file on the barrel branch) | `registerApiBearerAuthMiddleware`/`registerApiOriginGuardMiddleware`, genericized. Bearer-auth config (`ApiTokenAuthEnvConfig`) is injectable, consuming `@jini/core`'s `isApiTokenMiddlewareEnabled`/`apiTokenFromEnv`. The origin guard reuses this package's **own** `origin-validation.ts` (not `@jini/core`'s separate copy — see "Known duplication" below). **Dropped** (all OD-product-specific, no generic meaning): the project-preview-scope GET exemption, the zero-config "OD Clipper" browser-extension bypass, the live-artifacts-preview bypass, and the `Origin: null` safe-GET allow-list regex (`_NULL_ORIGIN_SAFE_GET_RE`, which named literal OD routes) — `Origin: null` is therefore now always rejected, not conditionally allowed. |
| `src/route-registration-guard.ts` | `apps/daemon/src/route-registration-guard.ts` (already generic) | `installRouteRegistrationGuard`/`getRouteRegistrationInventory`/`guardedRouteKey`, logic verbatim. The origin's hardcoded 2-route `guardedRouteKeys` Set (`POST /api/projects/:id/export/pdf`, `.../media/generate` — both OD product routes) is now an injectable `ReadonlySet<string>` parameter, default empty. `guardedRouteKey` additionally takes the guarded set as an explicit third parameter (was a closure-captured module-level Set in the origin) so it stays a pure, independently unit-testable function. |

**Known duplication, not fixed here (flagged as follow-up):** `@jini/core` has its own
`origin-validation.ts` (a separately-injectable-`env`-config variant), ported on a different task
than this package's own `origin-validation.ts`. `api-security-middleware.ts` deliberately uses
*this* package's copy (`allowedBrowserPorts`/`isAllowedBrowserOrigin` from the sibling file) rather
than `@jini/core`'s, so the new middleware stays consistent with `guardSameOrigin`/`adapter.ts`'s
existing behavior instead of introducing a second, independently-configurable origin decision into
the same request path. Consolidating the two copies is real, valuable follow-up work — out of
scope here since it would mean editing already-tested `adapter.ts`/`origin.ts` internals for a
different task's blast radius.

Tests: `src/__tests__/api-security-middleware.test.ts`, `src/__tests__/route-registration-guard.test.ts`
— 100% coverage on all 4 metrics, no new dependencies (both files use only this package's existing
exports plus `express`, already a dependency).

## 2026-07-21 addition — `cancel-owned-runs.ts` (backlog pass, `feat/http-routes-and-cli-commands`)

Ported the routes-classification table's row **#10 `project/cancel-owned-runs.ts` (GENERIC)**,
the one route-adjacent file the table already called out as fully generic despite living in the
otherwise-OD-PRODUCT `routes/project/` directory. Verified against
`leonaburime-ucla/open-design`, branch `refactor/web-memory-slice` (the branch this table's
routes-classification section was built against), via `git show
refactor/web-memory-slice:apps/daemon/src/routes/project/cancel-owned-runs.ts` — unchanged from
what the table describes: a single 33-line helper (`cancelRunsOwnedBy`), no route registrar, no
OD import.

| Jini file | Origin file | Transform |
|---|---|---|
| `src/cancel-owned-runs.ts` | `apps/daemon/src/routes/project/cancel-owned-runs.ts` (`refactor/web-memory-slice`) | `cancelRunsOwnedBy`, re-scoped rather than lifted verbatim — see below. |

**Re-scoping, not a straight lift.** OD's version takes a `{conversationId?, projectId?}` scope
object and calls `runs.list({...scope, status: 'active'})` — both the two-field scope shape and
the `status: 'active'` list-filter argument are OD nouns/API shape, not kernel concepts. Per
extraction-plan §2.1, `@jini/daemon`'s real `RunLifecycle` keys every run on one opaque
`contextRef: string` (see `packages/daemon/src/run-lifecycle.ts`'s `StartRunInput`/`list`), and
its `list(contextRef?: string): Promise<readonly RunStatus[]>` has no server-side status filter at
all. So this port: (1) takes a single `contextRef: string` in place of the two-field scope object
— the kernel has no separate "conversation" or "project" identity, only the caller's opaque
reference; (2) calls `list(contextRef)` unfiltered and filters non-terminal runs client-side with
`@jini/protocol`'s existing `isTerminalRunState`, since the real `RunLifecycle` has nowhere to push
a `status` argument down to. The per-run-swallowed-cancellation-failure behavior (`.catch(() =>
{})`) and the "safe to call unconditionally, races with a naturally-finishing run harmlessly"
property are both preserved unchanged from the origin.

**Kept structural, not typed against `@jini/daemon`'s `RunLifecycle` directly** (`RunCancellationService`
in the new file) — mirrors the origin's own stated reason ("kept structural so it is satisfied by
the real `design.runs` without depending on the daemon's loose `ServerContext.design: any` type").
In Jini, `RunLifecycle` is already a real, precisely-typed interface rather than a loose `any`, so
the structural cut here is instead about test-double simplicity: a caller can satisfy
`RunCancellationService` with a two-method fake with no need to stub the rest of `RunLifecycle`'s
surface (`rehydrate`/`start`/`get`/`onCancelRequested`/`finish`/`waitForTerminal`). The real
`RunLifecycle.list`/`cancel` return types (`Promise<readonly RunStatus[]>`,
`Promise<RunStatus>`) are both structurally assignable to this file's narrower
`RunCancellationService` (return-type covariance), so passing a real `RunLifecycle` in works with
no adapter.

Not (yet) wired into a route: this port is the reusable helper only, matching the source-map's own
classification of file #10 as "a single helper... not a route registrar." No delete-conversation
or delete-project route exists anywhere in this repo yet for it to be called from (both `#8
project/comments.ts` and `#9 project/conversations.ts` remain deferred per this table's own
"What got ported this round vs. deferred" section — they need a not-yet-built generic
workspace/session port first). `cancelRunsOwnedBy` is exported from the package barrel
(`src/index.ts`) so whichever future workspace/session-delete route lands can call it directly.

Tests: `src/__tests__/cancel-owned-runs.test.ts` — 100% coverage on all 4 metrics (cancels only
non-terminal runs, no-op on an all-terminal or empty run list, swallows a per-run cancellation
rejection without the aggregate promise rejecting). No new dependency — uses only this package's
existing `@jini/protocol` dependency.

## 2026-07-21 addition — `host-tools.ts`'s GENERIC slice (backlog pass, `feat/http-routes-and-cli-commands`)

Ported the routes-classification table's row **#23 `host-tools.ts` (MIXED — "partially ported
this round" caveat)** — specifically the piece that row's own reasoning already identified as
"zero OD dependency and... well-hardened": the editor catalogue, `$PATH`/mac-bundle probing, and
guarded detached-spawn machinery (`CATALOGUE`, `resolveEntry`, `launchHostTool`,
`resolveHostToolLaunchPlan`, `applicableForPlatform`), plus `GET /api/editors`, the one route that
uses only that machinery. Verified against `leonaburime-ucla/open-design`, branch
`refactor/web-memory-slice`, via `git show refactor/web-memory-slice:apps/daemon/src/routes/host-tools.ts`
— 380 lines, matching the table's line count and verdict exactly.

| Jini file | Origin file | Transform |
|---|---|---|
| `src/host-tools.ts` | `apps/daemon/src/routes/host-tools.ts` (`refactor/web-memory-slice`) | `CATALOGUE`/`currentPlatform`/`applicableForPlatform`/`pathDirs`/`probeCommandOnPath`/`probeMacBundle`/`resolveEntry`/`resolveHostToolLaunchPlan`/`launchHostTool`/`listAvailableEditors` (the origin's inline `GET /api/editors` handler body, extracted into its own named, directly-testable function) ported. `HostEditorId`/`HostEditor`/`HostEditorsResponse`/`OpenProjectInEditorResponse` types switched from `@open-design/contracts` to local, non-branded equivalents (`HostEditorId` narrowed to a plain `string` — the catalogue's own id literals are the only real constraint, and pinning a closed union here would make a future catalogue addition a breaking type change for no benefit). `createCommandInvocation` switched from `@open-design/platform` to this repo's own already-ported `@jini/platform` (new dependency on this package, see below) — same signature, mechanical import-source change. **Not ported**: `POST /api/projects/:id/open-in` (needs `ctx.projectStore.getProject`/`ctx.projectFiles.resolveProjectDir` to resolve a working directory — exactly the not-yet-built generic workspace-root port this table's own row #23 note anticipated) and the`server-context.js` `RouteDeps`-based `registerHostToolsRoutes(app, ctx)` registrar shape (replaced with a dependency-free `registerHostToolsRoutes(app, adapter)` mounting only the one ported route). |

**Redesigned for testability, not lifted verbatim — same discipline as `packages/media/src/dispatch/context.ts`.**
The origin reads `process.env`/`process.platform` and calls real `fs.access`/`child_process.spawn`
directly inside `pathDirs`/`probeCommandOnPath`/`probeMacBundle`/`launchHostTool`. Every probing
function here instead takes an injectable `HostToolProbeEnv` (`{access, env, platform}`, defaulting
to `defaultProbeEnv()` which wires the real ones), and `launchHostTool` takes an injectable
`spawnImpl` (defaulting to the real `node:child_process` `spawn`). This is what makes every
platform branch (darwin/win32/linux/unknown), every found/missing outcome (CLI shim on `$PATH`,
mac app bundle, direct absolute-path access), and both directions of `launchHostTool`'s
`'spawn'`/`'error'` settle-race exercisable from one Linux CI runner without a real filesystem or
subprocess — the exact problem a straight lift would have hit immediately (this repo's CI has no
macOS/Windows runner and no installed copies of any catalogue entry).

**One proven dead-branch removal, not carried forward** (same category as `local-daemon-request.ts`'s):
`resolveEntry`'s return type was a discriminated union (`{available: true, resolvedPath, launch} |
{available: false}`) rather than the origin's one-shape-with-optionals, because `resolvedPath` and
`launch` are only ever set together in both of the origin's own "found" branches, never
independently — the origin's `resolveHostToolLaunchPlan` unavailable-branch spread
(`...(probe.resolvedPath ? {resolvedPath} : {})`) was therefore dead code carried forward
unexamined. Making the type a discriminated union (a) makes the impossible state
unrepresentable instead of merely untested, and (b) was required anyway once `exactOptionalPropertyTypes`
flagged assigning a possibly-`undefined` value to the `available: true` variant's non-optional
`resolvedPath` field.

Tests: `src/__tests__/host-tools.test.ts` — 100% coverage on all 4 metrics (every platform branch,
every probe found/missing outcome including the win32 suffix loop and the mac-bundle
array-of-candidate-names case, the real `CATALOGUE` `finder` entry's own `commandArgs` closure
specifically — not just an equivalent inline fixture, `launchHostTool`'s settle-race in both
directions plus a non-`Error` `'error'` payload, and the mounted `GET /api/editors` route).

## Dependencies (updated)

`@jini/platform` (workspace, new) — `createCommandInvocation`, used by `host-tools.ts`'s
`launchHostTool`. Already a dependency-free, well-tested port (see `packages/platform/source-map.md`);
this is its first consumer inside `@jini/http`.

## 2026-07-21 addition — `GET /api/runs` list route (CLI backlog pass, `feat/http-routes-and-cli-commands`)

Not a port from OD (the original `src/runs.ts` "File map" row above already notes `runs.ts` is "a
new generic transport seam, not a lift"). Added while building `@jini/cli`'s `run list` command
(see `packages/cli/source-map.md`): `@jini/daemon`'s `RunLifecycle.list(contextRef?)` already
existed and had no HTTP projection at all, which would have made `run list` either impossible to
build or forced into guessing at a contract. `runListRoute` (`GET /api/runs`, optional
`?contextRef=` query parameter, no same-origin requirement — matching `runStatusRoute`'s read-only
posture) is a thin, direct projection of that existing kernel method: `parseRunList` validates the
query parameter is a non-empty string when present, `handle` calls `lifecycle.list(contextRef)`
and wraps the result as `{ runs }`. Added to `registerRunRoutes` alongside the other three JSON
routes. Tests: `src/__tests__/runs.test.ts` (parse: absent/present/empty/non-string contextRef;
handle: unscoped list, scoped list, empty-result list; mount: route inventory, cross-origin GET
allowed, end-to-end through the real `createRunLifecycle`). No new dependency.

## 2026-07-21 addition — `active-context.ts` (backlog pass, `feat/http-routes-and-cli-commands`)

Ported the routes-classification table's row **#1 `active-context.ts` (MIXED)** — the one row the
table already called "the one real candidate that needs neither SSE nor a workspace/session port."
Verified against the real source first, per this branch's own discipline, rather than trusting the
table's characterization blind: fetched `leonaburime-ucla/open-design`'s
`refactor/web-memory-slice` branch (`git show
refactor/web-memory-slice:apps/daemon/src/routes/active-context.ts`, via a local clone at
`/Users/la/Desktop/Programming/Open-Marketing`, remote-fetched under ref `lucla/refactor-web-memory-slice`).
The read **confirmed the table's characterization** in every respect: an in-memory
`ActiveContextStore` gated by a `ACTIVE_CONTEXT_TTL_MS` (5-minute) staleness check, two fully
synchronous handlers (`handlePostActive`/`handleGetActive` — no `await` anywhere in the origin
file), and exactly one real OD coupling — `handleGetActive` calling `deps.getProject(deps.db,
current.projectId)` purely to resolve a `project?.name` display string. One immaterial
discrepancy found and not worth correcting in the table: the origin file is 128 lines by `wc -l`,
not the table's 129 — a trivial off-by-one in whatever line-counting the original recon used, not
a substantive error.

| Jini file | Origin file | Transform |
|---|---|---|
| `src/active-context.ts` | `apps/daemon/src/routes/active-context.ts` (`refactor/web-memory-slice`) | `ActiveContext`/`ActiveContextStore`/`parsePostActive`→`parseSetActive`/`handlePostActive`→`handleSetActive`/`handleGetActive`/`postActiveRoute`→`setActiveRoute`/`getActiveRoute`/`registerActiveContextRoutes`, logic verbatim modulo the field-renaming and DI changes below. `createApiError` switched from `@open-design/contracts` to `@jini/protocol` (mechanical, same as every other file in this package). |

**Field renaming, per the table's own suggestion.** The origin's `projectId: string` becomes
`resourceRef: string` (an opaque identifier with no project-specific meaning) and `fileName:
string | null` becomes `detail: string | null` (a generic sub-locator within that resource — a
file path was one instance of this, not the concept itself). `GetActiveOutput`'s `projectName:
string | null` becomes `resourceName: string | null`, still resolved the same way (nullish-coalesced
from the resolved resource's own optional `name` field).

**`deps.getProject` becomes an injected `resolveResource`, matching this branch's established DI
convention** (`daemon-status.ts`/`host-tools.ts`: real collaborators supplied by the caller via a
deps object, not read from a global store). The origin's two-argument `getProject(db, projectId)`
signature existed only because OD's project store itself takes a `db` handle; since this package
has no database dependency at all, the port collapses that to a single-argument
`resolveResource(resourceRef): ActiveContextResource | null | undefined` — the caller closes over
whatever store/db it actually has. The origin's `db: unknown` field is dropped from deps entirely
(nothing in the ported file needs it once `getProject` is closed over by the caller instead of
being handed `db` at call time).

**`now` stays an internal testability seam, not a caller-mandatory dependency** — the origin wires
`now: () => Date.now()` inside `registerActiveContextRoutes` itself (not sourced from `ctx`), so
this port makes `ActiveContextDeps.now` optional, defaulting to `Date.now` when the caller omits
it (`deps.now ?? (() => Date.now())`), while still being fully injectable for tests. This is a
narrower dependency surface than `getProject`/`resolveResource`, which is why it lives in the same
`ActiveContextDeps` type but as an optional field rather than being promoted to its own concept.

**Both routes share one in-memory store per `registerActiveContextRoutes` call**, unchanged from
the origin: the store is constructed fresh inside the registrar and closed over by both the
`POST`/`GET` route deps, so a `POST /api/active` is visible to a subsequent `GET /api/active` on
the same mounted instance — this state-sharing is the one behavior a route-level (not just
handler-level) test had to prove, since it is invisible if each route's `handle` is only tested in
isolation.

Not wired into a route pack (no `Pack.http` composition calls `registerActiveContextRoutes` yet)
— matching this file's own precedent (`cancel-owned-runs.ts`'s 2026-07-21 addition: ported and
exported from the barrel, not yet consumed by a concrete pack). `registerActiveContextRoutes` is
exported from `src/index.ts` for whichever future pack needs an active-resource-focus channel.

Tests: `src/__tests__/active-context.test.ts` — 100% coverage on all 4 metrics (27 tests: `parse`
branches for clear/set/missing-resourceRef/non-string-resourceRef/empty-resourceRef/non-string-
detail/empty-detail/null-body; `handle` branches for clear, set, no-current, TTL-expired,
exact-TTL-boundary-still-active, and all four `resolveResource` return shapes — named object,
`{}`, `null`, `undefined`; `registerActiveContextRoutes` mount inventory, cross-route store sharing
for both a set and a clear, `now` default-vs-injected, and same-origin enforcement on both
routes). No new dependency — uses only this package's existing `@jini/protocol`/`adapter.ts`/
`types.ts` exports.

## 2026-07-21 addition — `agents.ts` (`GET /api/agents`, built while wiring `@jini/mcp`'s `list_agents` tool)

Not a port from OD — a new generic transport seam, same category as this file's own `GET
/api/runs` addition above ("`@jini/daemon`'s `RunLifecycle.list(contextRef?)` already existed and
had no HTTP projection at all"). While porting `@jini/mcp`'s stdio MCP tool-hosting mechanism
(`packages/mcp/source-map.md`'s 2026-07-21 addition) and deciding whether to build its `list_agents`
tool, the investigation found `@jini/agent-runtime`'s barrel already exports `AGENT_DEFS:
RuntimeAgentDef[]` (`packages/agent-runtime/src/registry.ts`'s `BASE_AGENT_DEFS`, 24 built-in
adapter defs) — real, static, in-memory registration data with no HTTP projection anywhere in this
package.

The original 2026-07-21 route projected the registry down to static `{id, name}` pairs and
deliberately deferred live probing. **Superseded 2026-07-23:** `AgentSummary` now also carries
client-safe optional discovery fields (`available`, `version`, `authStatus`, `models`,
`modelsSource`, `supportsCustomModel`, one redacted `diagnostic`) and `listAgents` may be
asynchronous. Spawn internals such as `bin`, resolved executable path, argv builders, and env
remain excluded. `@jini/http` still owns no subprocess logic: `AgentsHttpDeps` keeps discovery
host-injected, so probing policy and caching belong to the daemon host.

`POST /api/agents/rescan` was added as the explicit cache-refresh control. It uses the same
response contract as `GET /api/agents`, delegates to `rescanAgents` when supplied (or
`listAgents` for static hosts), and requires same-origin because it causes process probes. This
closes the OD-parity gap identified by the runnable Jini playground: the Composer's picker must
read daemon-owned availability/model state rather than running `detectAgents()` in Vite.

No same-origin requirement (`requireSameOrigin` unset), matching `runListRoute`/`runStatusRoute`'s
posture: a read-only, side-effect-free GET with no per-request state.

Tests: `src/__tests__/agents.test.ts` covers synchronous and asynchronous inventories, explicit
rescan and static-host fallback, mount inventory, end-to-end serialization, cross-origin GET, and
same-origin enforcement on rescan. No subprocess dependency was added to this route module.

## 2026-07-21 addition — `sse.ts` (generic SSE channel prerequisite, `feat/http-routes-and-cli-commands`)

Not a port from OD — a generalization of machinery that already existed inline inside this
package's own `runs.ts` (`registerRunEventStream`'s bounded-queue, backpressure-aware
`res.write`/`'drain'` state machine with `Last-Event-ID` replay support, itself a 2026-07-19
addition). Every "requires SSE (deferred)" verdict against `chat.ts`/`terminal.ts`/`memory.ts` in
the routes-classification table above named this exact gap: `@jini/http`'s adapter was JSON-route-only,
so porting any SSE-shaped OD route meant either inventing a one-off streaming helper per route or
building the shared primitive first. `createSseChannel<E extends SseEvent>(res, options)` is that
primitive: `enqueue`/`open`/`isClosed`/`end`/`abandon`/`onClose`, generalized over any event type
(not just `RunProtocolEvent`) so a route only has to describe *what* to stream, not *how*. OD's own
precedent is `ctx.http.createSseResponse`, an Express-request-scoped helper both
`apps/daemon/src/routes/runs.ts` and `apps/daemon/src/routes/terminal.ts` receive via dependency
injection and call themselves — this file is the Jini equivalent of that shared role, not an
invented-from-scratch design.

`runs.ts` was refactored to call this primitive (`import { createSseChannel, requestedAfterCursor }
from './sse.js'`) rather than keep its own private copy of the same state machine — the same
"one implementation, one set of tests for the mechanism itself" discipline this package already
applies to `origin-validation.ts`/`compat.ts`. `requestedAfterCursor(req)` (reads `Last-Event-ID`,
falling back to an `afterCursor` query parameter) was extracted alongside it, also now shared rather
than duplicated per SSE route.

**This unblocks, but does not itself port,** `terminal.ts`/`chat.ts`/`memory.ts` (routes-classification
table rows #11/#5/#4) — those routes still need their own product-neutral rewrites; only the shared
transport primitive they'd all depend on now exists.

Tests: `src/__tests__/sse.test.ts` — 100% coverage on all 4 metrics (27 tests: wire-format framing
including a custom `formatEvent` override, queue-overflow disconnect at the configured
`maxQueuedEvents` ceiling, backpressure (`write() === false` → `'drain'` → resumed flush), a
mid-flush `res.write` throw calling `onWriteError` and ending the channel without throwing back
through the producer, `isEndEvent`-triggered auto-close, `enqueue` before `open` still replaying on
first flush, idempotency of `open`/`end`/`abandon`, client-disconnect via the response's `'close'`
event observed before `open` is ever called, `onClose` firing exactly once regardless of which cause
closes the channel first and firing immediately if registered after closure already happened, and
`requestedAfterCursor`'s header-then-query-then-null precedence). No new dependency — only
`express`'s existing `Response` type.

## 2026-07-21 addition — `workspace-root.ts` (generic workspace-root resolution prerequisite, `feat/http-routes-and-cli-commands`)

Not a port from OD — a generalization of a dependency several routes-classification rows named by
hand: "given some opaque resource reference, what filesystem directory does a spawned process or
launched editor run in?" OD answers that with `ctx.projectStore.getProject` +
`ctx.projectFiles.resolveProjectDir` (a project-store lookup plus a metadata-driven directory
resolver, both OD-product-specific) — named explicitly as the reason `POST /api/projects/:id/open-in`
(row #23 `host-tools.ts`) and the interactive-terminal spawn route (row #11 `terminal.ts`) were not
ported earlier. The kernel has no concept of "project," so it cannot hardcode that lookup, but it
also must not silently invent a directory (guessing `process.cwd()` or an OS temp dir would let one
request's resource reference leak into an unrelated working directory).

`WorkspaceRootRequest` (`{resourceRef, detail?}`, matching `active-context.ts`'s `resourceRef`/`detail`
naming) plus a host-injectable `WorkspaceRootResolver` callback are resolved by
`resolveWorkspaceRoot(request, options)`. Follows the same explicit-injection, conservative-default
shape already established by `@jini/cli`'s `resolveDaemonUrl` and `db-ops.ts`'s
`denyAllDaemonDbPolicy`: the built-in default (`denyAllWorkspaceRoots`) resolves nothing for every
request, and `resolveWorkspaceRoot` throws a `WorkspaceRootDeniedError` rather than ever falling back
to a guessed path — a host must explicitly opt in with its own resolver before any route can act on
a real directory.

**This unblocks, but does not itself port,** `POST /api/projects/:id/open-in` (row #23) or
`terminal.ts`'s spawn routes (row #11) — those still need to be written to call
`resolveWorkspaceRoot` with a caller-supplied resolver; only the shared port they'd depend on now
exists, exported from the barrel (`denyAllWorkspaceRoots`, `resolveWorkspaceRoot`,
`WorkspaceRootDeniedError`) for whichever future task wires a consumer.

Tests: `src/__tests__/workspace-root.test.ts` — 100% coverage on all 4 metrics (11 tests: the default
resolver denies every request; an explicit resolver's resolved path is returned; `null`/`undefined`/
empty-string resolver results all throw `WorkspaceRootDeniedError` carrying the original
`resourceRef`; a synchronous resolver and an async/`Promise`-returning resolver both work;
`detail` is optional and passed through unmodified when present). No new dependency.

## 2026-07-21 addition — `db-ops.ts` (`GET/POST /api/daemon/db*`, `feat/http-routes-and-cli-commands`)

Ports the routes-classification table's row **#12 `daemon.ts`**'s remaining slice: `GET
/api/daemon/db`, `POST /api/daemon/db/verify`, `POST /api/daemon/db/vacuum` (SQLite
inspect/integrity-check/vacuum). That row originally deferred these three routes pending a separate
`storage/db-inspect.ts` port; that port now exists as `@jini/sqlite`'s `db-inspect.ts`
(`inspectSqliteDatabase`/`verifySqliteIntegrity`). `db-ops.ts` itself does **not** depend on
`@jini/sqlite` or `better-sqlite3` at all — `DaemonDbOperations` is a plain injected interface,
structurally identical to `@jini/sqlite`'s return shapes so a caller can wire those in with zero
adapter code, matching `daemon-status.ts`/`host-tools.ts`'s existing "caller supplies the real
collaborator" convention in this package.

**Routed through the tool-execution boundary, not a plain route handler.** All three operations
reveal internal schema/row-count/file-size information (`inspect`/`verify`) or rewrite the database
file in place (`vacuum`) — real security stakes. Per this repo's tool-execution-boundary precedent
(`packages/deploy/src/tool.ts`'s `deploy.publish`, `packages/daemon/src/delegated-tool-bridge.ts`),
`createDaemonDbToolRegistrations` builds three `{descriptor, handler, policy}` triples a host
registers against `@jini/core`'s `ToolRegistry`; the actual work only runs inside a `ToolHandler`
that `@jini/daemon`'s `ToolExecutor.execute` invokes after `ToolPolicy.authorize` allows it — never
directly from `registerDaemonDbRoutes`'s route handlers. `denyAllDaemonDbPolicy` (every call denied,
unconditionally) is the default policy for all three tools, matching `@jini/deploy`'s
`denyAllDeployPublishPolicy` precedent — a host must explicitly opt in with its own policy (role-gated,
same-principal-as-daemon-owner, etc.) rather than getting a working DB inspector for free merely by
registering the tools. OD's own origin left `GET /api/daemon/db` completely ungated and only guarded
`verify`/`vacuum` behind `requireLocalDaemonRequest` — a real pre-existing gap, not carried forward
here. All three routes additionally keep `requireSameOrigin: true` (matching `daemon-status.ts`'s
shutdown route) as defense in depth, not a substitute for the tool-execution boundary.

Failed/timed-out/cancelled tool executions are redacted the same way `runs.ts`'s
`RunInternalErrorContext`/SEC-005 discipline already established: the client only ever sees a generic
`INTERNAL_ERROR` with a correlation id; the real exception (which can embed schema names, file paths,
or a raw SQLite error message) goes only to a host-owned `onInternalError` sink (defaulting to
`console.error`). `ToolExecutor.execute`'s own `'failed'` status already reduces a caught exception
down to `err.message` (a string) before this route ever sees it — `ToolExecutionResult.error` has no
room for the original `Error` object, so this route's SEC-005 discipline is "never widen that string
back out to the client," not "preserve the original exception," which the test suite asserts against
directly rather than assuming.

Tests: `src/__tests__/db-ops.test.ts` — 100% coverage on all 4 metrics (32 tests). Includes the
load-bearing proof that the `ToolExecutor` authorization gate is actually in the call path and not
bypassable: a dedicated `makeDenyByDefaultDeps` helper wires the tools' real production default
policy (`denyAllDaemonDbPolicy` — no policy override at all) through a real `ToolExecutor`/
`ToolRegistry` (no route-level mock) and asserts the injected `DaemonDbOperations` method itself is
never invoked when denied — proven for `inspect` (asserting the 403-equivalent `TOOL_OPERATION_DENIED`
result) and separately for `verify`/`vacuum`. Also covers: `createDaemonDbToolRegistrations`
registering exactly the three documented tool ids and defaulting every one to
`denyAllDaemonDbPolicy`; a caller-supplied policy overriding the default for all three; confirmation
denial reported identically to a policy denial; `failed`/`timed-out`/`cancelled` `ToolExecutionResult`
statuses all redacted to a correlation-id-bearing `INTERNAL_ERROR` (the timed-out/cancelled cases
driven through a minimal fake `ToolExecutor` that resolves synchronously, rather than racing a real
`setTimeout`-based abort against a handler that — like all three of `db-ops.ts`'s own handlers —
has no way to forward `ctx.signal` into `DaemonDbOperations`, since that interface has none: the real
collaborator it documents itself as wiring, `@jini/sqlite`'s synchronous `better-sqlite3` calls,
cannot be cooperatively cancelled mid-flight regardless); `verify`'s query-parameter parsing
(non-string/repeated `quick` rejected, absent defaults to `false`, `'1'`/`'true'`/`'TRUE'` parsed
true, everything else false); and `registerDaemonDbRoutes`'s route inventory, same-origin enforcement
blocking all three routes before the tool executor ever runs, and an end-to-end mounted request for
each of the three routes (including the vacuum route specifically, to exercise its trivial `parse`
through the real HTTP-adapter path rather than only via a direct `.handle()` call). No new
dependency.

Not wired into a route pack (no `Pack.http` composition calls `registerDaemonDbRoutes` yet), matching
this file's established precedent for freshly-added, barrel-exported-but-unconsumed route registrars
(`active-context.ts`, `cancel-owned-runs.ts`).

## 2026-07-21 addition — `host-tools.ts`'s `POST /api/resources/:resourceRef/open-in` (route-pack audit, `feat/http-routes-and-cli-commands`)

Closes the one remaining gap this file's own "GENERIC slice" section (above) named: OD's `POST
/api/projects/:id/open-in`, not portable at that time because it needed `ctx.projectStore.getProject`/
`ctx.projectFiles.resolveProjectDir` to resolve a working directory. Now that `workspace-root.ts`
exists (this same audit's other prerequisite), the route ports as `openResourceInEditorRoute`
(`src/host-tools.ts`), mounted alongside `hostEditorsRoute` by `registerHostToolsRoutes`, which now
takes an optional third `HostToolsOpenInDeps` parameter (`{resolveRoot?, probeEnv?, spawnImpl?}`,
each defaulting the same way the rest of this file's DI already does).

`projectId` generalizes to the `resourceRef` path param this package already uses
(`active-context.ts`/`cancel-owned-runs.ts`); `getProject`/`resolveProjectDir` generalizes to
`deps.resolveRoot` (defaulting to `denyAllWorkspaceRoots` — a host that never wires a real resolver
gets `404 NOT_FOUND` on every call, never a guessed path). OD's `PROJECT_NOT_FOUND` (dropped from
`ERROR_STATUS_BY_CODE` per this file's own "File map" note — no `@jini/protocol` equivalent) becomes
generic `NOT_FOUND`; `EDITOR_NOT_AVAILABLE` (OD's 409 for "known catalogue entry, not installed on
this machine") becomes `CONFLICT`, which already maps to 409. The launch-failure message is returned
to the caller verbatim, unlike `runs.ts`'s SEC-005 redaction — a documented judgment call: this is a
same-origin, explicitly-consented, single local action (open the tool the caller named), not an
internal agent-run exception crossing a trust boundary.

Tests: `src/__tests__/host-tools.test.ts` grew from 47 to 67 tests, now 100/100/100/100 (was already
100% before this addition). New coverage: every `parse` malformed-input branch; success with/without
an optional `detail` field; unknown editor id; platform-inapplicable editor; the workspace-root
auth-denial path (default resolver, proving the operation is denied end to end); an explicit resolver
denying a specific resource; a non-`WorkspaceRootDeniedError` propagating unmapped rather than being
swallowed; a known-but-not-installed catalogue entry (409); a launch failure (500, real message);
same-origin enforcement on the mounted route; and the `deps.spawnImpl` omitted-default branch —
deliberately exercised against a synthetic, guaranteed-nonexistent absolute path (not a real
catalogue command) so the real `node:child_process.spawn` fails safely with `ENOENT` instead of
risking launching a real editor on whatever machine runs this test suite. No new dependency.

## 2026-07-21 addition — `memory.ts` (memory-routes pack, `feat/http-routes-and-cli-commands`)

Ports the generic majority of the routes-classification table's row **#4 `memory.ts` (MIXED)** —
config, entry CRUD, tree view, index, extraction/verification history, and the SSE change/
extraction/verify feed — now that both of this audit's prerequisites (`sse.ts`, and, for this file,
nothing else was blocking) are in place. Read in full against
`leonaburime-ucla/open-design`'s `refactor/web-memory-slice` branch (`apps/daemon/src/routes/
memory.ts`, 690 lines) rather than re-trusting the prior table's characterization blind.

**New file:** `src/memory.ts` — `memoryOverviewRoute` (`GET /api/memory`), `memoryTreeRoute` (`GET
/api/memory/tree`), `memoryUpdateTreeNodeRoute` (`PATCH /api/memory/tree/:id`),
`memoryWriteIndexRoute` (`PUT /api/memory/index`), `memoryWriteConfigRoute` (`PATCH
/api/memory/config`), `registerMemoryEventStream` (`GET /api/memory/events`, SSE),
`memoryListExtractionsRoute`/`memoryClearExtractionsRoute`/`memoryRemoveExtractionRoute` (`GET`/
`DELETE`/`DELETE :id` on `/api/memory/extractions`), the equivalent three for
`/api/memory/verifications`, and `memoryCreateEntryRoute`/`memoryReadEntryRoute`/
`memoryUpdateEntryRoute`/`memoryDeleteEntryRoute` (`POST /api/memory`, `GET`/`PUT`/`DELETE
/api/memory/:id`). `registerMemoryRoutes` mounts all of them, preserving OD's own static-before-
`:id`-catch-all registration ordering discipline (Express matches in registration order — a literal
`config`/`tree`/`extractions` path segment must not be shadowed by the `:id` wildcard).

**Deliberately does not depend on `@jini/memory`, despite that package already existing in this repo
and its `NoteStore`/`ExtractionLog`/`VerifyLog` interfaces matching every route's needs almost
exactly.** `@jini/memory`'s `UNLOCKED.md` entry has `"lockedPackagesMayImport": false` and
`"status": "incubating"`; `@jini/http` is one of `scripts/check-engine-boundaries.ts`'s fourteen
*locked* packages, so a direct import would fail `pnpm guard`'s R7 check outright — the exact
constraint `packages/media/src/sqlite-task-store.ts`'s `ADS-memory/reports/proposals/
PROP-media-durable-tasks-2026-07-21.md` already documents for `@jini/sqlite`/`@jini/media`. Verified
this would actually trip before writing a line of route code (not assumed). `src/memory.ts` instead
defines local structural types (`MemoryNoteStore`/`MemoryExtractionLog`/`MemoryVerifyLog`/
`MemoryChangeEmitter`) that a real `@jini/memory` instance satisfies with zero adapter code — the
same "host supplies the real collaborator" DI convention `daemon-status.ts`/`host-tools.ts`/
`db-ops.ts` already established, now additionally load-bearing for a hard boundary rule rather than
just a dependency-weight preference.

**Ported, mapped onto `@jini/memory`'s real primitives (verified by reading `packages/memory/src/
note-store.ts`/`extraction-log.ts`/`verify.ts` directly, not guessed):** `readConfig`/`writeConfig`
(→ `enabled` only, see gap below), `readIndex`/`writeIndex`, `listEntries`, `buildTree`,
`updateTreeNode` (`'note not found'` → `404`, matching OD's own `'memory not found'` check pattern),
`upsertEntry`/`readEntry`/`deleteEntry`, and `ExtractionLog`/`VerifyLog`'s `list`/`clear`/`remove` +
their `events` emitters (`'attempt'`/`'verify'`) relayed onto the SSE feed's `extraction`/`verify`
channels alongside `NoteStore.events`'s `'change'` channel — reproducing OD's own "one SSE connection
multiplexing three channels" design via the new `sse.ts` primitive instead of OD's bespoke
`createSseResponse`.

**Explicitly NOT ported** (see `src/memory.ts`'s own module doc for the full per-route reasoning):
`POST /api/memory/rules/suggest` (OD's canvas/deck-annotation distillation — OD-PRODUCT, confirmed by
direct read of the annotation shape: `targetLabel`/`filePath`/`selectionKind`/`htmlHint`), `POST
/api/memory/connectors/suggest` / `.../connectors/extract` (OD's project-scoped connector-mining
pipeline — OD-PRODUCT), `POST /api/memory/extract` (the heuristic-regex pre-turn phase and the
BYOK-chat-provider-passthrough LLM post-turn phase are both OD-specific composition, per this repo's
root `AGENTS.md`'s pre-existing note that `@jini/memory`'s "heuristic-regex... prompt-composition
pieces" were "explicitly left un-ported"), and `GET /api/memory/system-prompt` (`composeMemoryBody`
does not exist anywhere in `@jini/memory` yet — same `AGENTS.md` note). A real, documented
capability gap rather than a route-level scoping choice: `@jini/memory`'s `NoteStoreOptions` is
`{enabled: boolean}` only, so `MemoryConfigPatch`'s other four OD booleans
(`chatExtractionEnabled`/`profileEnabled`/`rewriteEnabled`/`verifyEnabled`) and its whole
`extraction` (LLM-provider) config sub-object have no home to port into yet.

Tests: `src/__tests__/memory.test.ts` — 100/100/100/100 coverage, 52 tests. Covers every route's
success path, malformed-input path, and (for mutating routes) the same-origin-denial path; the
`'note not found'` → 404 vs. any-other-error → 400 split on tree-node update; a non-Error throw
stringified rather than crashing; Express registration ordering (asserted via index positions, not
just "it works"); and the SSE multiplexer's three-channel relay plus listener cleanup on client
disconnect (`res`'s `'close'` event unsubscribing all three `events.on` registrations, proven by
asserting `listenerCount` drops to zero, not just "no more writes happen"). No new dependency.

## 2026-07-21 — route-pack audit (`feat/http-routes-and-cli-commands`): summary and remaining verdicts

The task brief for this backlog pass named seven route packs to investigate: chat/model proxy,
artifact delivery, terminal/PTY, memory routes, automation/routines, DB operations, and editor/host
tools. Per-pack outcome, verified rather than guessed for every one:

- **DB operations** — fully ported and tested this round (`db-ops.ts`, above).
- **Editor/host tools** — the one remaining gap from the prior partial port closed this round
  (`open-in`, above); this pack is now complete.
- **Memory routes** — the generic majority ported and tested this round (`memory.ts`, above); the
  remainder is a documented, real capability gap in `@jini/memory` itself (not a route-level choice).
- **Terminal/PTY** — investigated directly (`apps/daemon/src/routes/terminal.ts` +
  `apps/daemon/src/terminals.ts`, both read in full). Both of this pack's previously-named blockers
  (SSE, workspace-root resolution) are now resolved, but a real, unresolved authorization-shape
  question remains: `ToolExecutor`'s call-scoped `execute()` model does not naturally fit a
  session-scoped interactive shell, where the actual dangerous surface is the *entire session's
  ongoing existence* (every subsequent `stdin` write), not just its creation instant. `node-pty` is
  also a new native compiled dependency with no existing precedent in this workspace. See
  `ADS-memory/reports/proposals/PROP-http-route-packs-terminal-pty-2026-07-21.md`.
- **Automation/routines** — investigated directly (`apps/daemon/src/routes/automation.ts`,
  `apps/daemon/src/routes/routine.ts`, `apps/daemon/src/routines.ts`,
  `apps/daemon/src/automation-{proposals,templates,ingestions}.ts`, all read in full). `automation.ts`'s
  real blocker is three un-ported backend modules (1,225 lines), not "needs OD's memory store" as
  previously stated — though the memory-store dependency specifically is now the *same already-solved*
  shape `memory.ts` handled. `routine.ts`'s CRUD is blocked on a real `RoutineStore` persistence-port
  design decision (the `routines`/`routine_runs` tables are explicitly out of scope per
  `packages/sqlite/source-map.md`). Positive finding: the underlying `routines.ts` scheduler (726
  lines — DST-safe timezone math, race-safe scheduled-slot persistence, already fully
  dependency-injected via `RoutinePersistence`/`RoutineRunHandler`) is genuinely clean and portable
  today, but belongs in `@jini/daemon` (no HTTP surface of its own), not this package — flagged as a
  strong, well-scoped follow-up recommendation. See `ADS-memory/reports/proposals/
  PROP-http-route-packs-automation-routines-2026-07-21.md`.
- **Chat/model proxy** — investigated directly (full route inventory confirmed against the actual
  2267-line file; the OpenRouter `'X-Title': 'Open Design'` product-identity leak confirmed at its
  exact line; the tool-loop turn-runners' missing duplicate-`end`-event guard confirmed by reading
  `runTurn`/`runAnthropicToolTurn`/`runGeminiToolTurn` directly — none of the three declares the
  `ended`-flag guard every non-tool-loop streamer in the same file has). The real blocker is a
  cross-package architecture question, not effort: `@jini/agent-runtime` already owns multi-provider
  wire-protocol knowledge in this codebase (`providers/model-catalog.ts`, `claude-stream.ts`/
  `copilot-stream.ts`/`qoder-stream.ts`, and — concretely — `role-marker-guard.ts`, already the
  ported/generalized version of the exact contamination-guard mechanism chat.ts's tool-loop runners
  use), making it a stronger candidate home than `@jini/http`, which has zero provider-specific
  knowledge anywhere in its existing surface. See `ADS-memory/reports/proposals/
  PROP-http-route-packs-chat-model-proxy-2026-07-21.md`.
- **Artifact delivery** — re-confirmed against this file's own pre-existing, already-thorough
  classification (row #32, `live-artifact.ts`, OD-PRODUCT: "every dependency is OD's project/
  tool-grant model," a real independent access-control gap noted, no generic sliver found). No new
  investigation performed beyond re-citing that already-verified row; nothing to port. Not proposal-
  doc-worthy — this is a clear negative finding, not a genuinely undecided question.

Two new generic prerequisites this pass built and dogfooded: `sse.ts` (§ above; `runs.ts` itself was
refactored to consume it, proving reusability rather than asserting it) and `workspace-root.ts` (§
above; consumed by `host-tools.ts`'s `open-in` route this same pass).

## 2026-07-21 addition — `routines.ts` (routine CRUD + run-history route pack)

Ports OD's `apps/daemon/src/routes/routine.ts` (348 lines, `refactor/web-memory-slice` branch) CRUD +
run-history surface, now that both of this pack's prerequisites named in the "route-pack audit" summary
above exist: the `RoutineService` scheduler and the new `RoutineStore` persistence port, both landed
this same pass in `@jini/daemon/src/routines/` (see that package's own `source-map.md` dated section
for the full design writeup — the scheduler is a faithful port of OD's `routines.ts`; `RoutineStore` is
a new port designed the same way `EventLog` is designed, per this task's brief).

**New file `src/routines.ts`** — `routineListRoute` (`GET /api/routines`), `routineCreateRoute` (`POST
/api/routines`), `routineGetRoute`/`routineUpdateRoute`/`routineDeleteRoute` (`GET`/`PATCH`/`DELETE
/api/routines/:id`), `routineRunNowRoute` (`POST /api/routines/:id/run`), `routineRunsListRoute` (`GET
/api/routines/:id/runs`). `registerRoutineRoutes` mounts all seven. Calls into `RoutineStore`/a narrow
`RoutineScheduler` (`Pick<RoutineService, 'nextRunAt'|'rescheduleOne'|'runNow'|'unschedule'>`, matching
OD's own `RoutineRoutesService` narrowing) the same way `runs.ts` calls into `RunLifecycle` — no
business logic in this file; schedule/target validation reuses `@jini/daemon`'s own pure
`validateSchedule`/`validateTarget` rather than duplicating that logic here.

**Confirmed bug fixed, not reproduced**: OD's `GET /api/routines/:id`, `DELETE /api/routines/:id`, and
`GET /api/routines/:id/runs` (OD source lines 236/268/292) had no try/catch, unlike every sibling
handler in the same file — confirmed directly against the source before porting, not just re-cited from
the proposal. This port does not patch three call sites; it is structurally immune, since every route
here is mounted through `adapter.ts`'s `mountJsonRoute`, whose own top-level try/catch already wraps
every route's `parse`/`handle` invocation (the identical mechanism `runs.ts`/`memory.ts` already rely
on) — the same class of bug is now impossible to reintroduce in a route built this way, not merely
absent from these three.

**Design decision — `target.mode === 'reuse'` project-existence checking is optional DI, not a hard
dependency**: OD's original unconditionally called `getProject(db, projectId)`. This module has no
project concept (matching `active-context.ts`'s `resolveResource` precedent for the identical category
of coupling — confirmed as "the smaller of the two couplings" by the porting proposal itself), so
`RoutineHttpDeps.projectExists?: (projectId) => boolean | Promise<boolean>` is optional: a host with a
project store supplies it and reuse targets are validated exactly like OD did; a host without one (or
that wants to defer the check) omits it and reuse targets are accepted without existence-checking.

**Design decision — `POST /api/routines/:id/run`'s `run` field can legitimately be `null` even on a
successful fire**: `RoutineStore` deliberately does not record runs (see `@jini/daemon`'s
`routine-store.ts` doc — run *writing* stays the scheduler's own separately-injected
`RoutinePersistence` concern, mirroring OD's own architectural split). This route calls
`store.getLatestRun(id)` after `scheduler.runNow(id)` resolves, which is only populated if a host has
bridged the scheduler's `RoutinePersistence.insertRun`/`updateRun` writes into the same store instance
— documented, host-level integration wiring out of this port's scope, the same way `runs.ts`'s
`onStarted` driver is host-supplied. `projectId`/`conversationId`/`agentRunId` on the response always
reflect the real just-started run regardless of that wiring, since those come directly from
`scheduler.runNow`'s own return value, not the store.

**Deliberately NOT ported this pass** (all three previously flagged by the proposal, re-confirmed here
rather than re-asserted blind):
- `GET /api/automation-templates` / `GET /api/automation-templates/:id` — depend on
  `automation-templates.ts`, not ported (see below); no routine CRUD/run-now/run-history route needs it
  to function, confirmed by tracing every route's actual dependency.
- `POST /api/routines/:id/runs/:runId/crystallize` — depends on `ingestAutomationSource`
  (`automation-ingestions.ts`), explicitly scoped by the proposal as a dedicated follow-up task the same
  size and shape as `@jini/memory`'s own original port.
- `automation-templates.ts` itself, content or generic shape: the "ship zero built-in templates, host
  supplies its own" decision was already made before this task started (matching this repo's
  `@jini/memory` prompt-composition / `@jini/deploy` config-path-resolution precedent for
  product-authored content staying host-owned), and since no ported route needs any part of that
  module, none of it — not even its storage/lookup shape — was pulled in.
- `automation-proposals.ts` / `automation-ingestions.ts` — untouched, per the proposal's Finding 1 and
  this task's brief.

Tests: `src/__tests__/routines.test.ts` — 76 tests. Every route's `parse` (structural validation,
schedule/target validation error passthrough, context array cleaning/dedup/empty-field-dropping,
skillId/agentId null-vs-absent-vs-invalid, the run-history `limit` query clamp including the `|| 20`
falsy-fallback vs. the `Math.max(1, ...)` floor for a genuinely negative value — two different code
paths, verified as different, not assumed identical) and `handle` (NOT_FOUND branches, `nextRunAt`
overlay via a fake scheduler, `projectExists` DI in all four shapes — omitted/sync-false/sync-true/
async — for both create and update, the run-now route's `run: null` vs. host-bridged-store-populated
cases, `routine: null` when the routine is deleted mid-flight). `registerRoutineRoutes` mounting +
same-origin enforcement (three read-only GETs exempt, the four mutating routes gated) through the real
Adapter pipeline, matching `runs.test.ts`'s conventions. A dedicated regression block drives a
throwing `RoutineStore` through the three previously-buggy routes and asserts a clean 500
`INTERNAL_ERROR` response rather than an uncaught exception, proving the fix rather than just asserting
try/catch is present in the source.

`pnpm --dir packages/http typecheck`: clean. `pnpm --dir packages/http test:coverage`: this package's
full-suite run was intermittently red during this task purely from a concurrent session's in-progress
`terminals.ts`/`terminal-session.ts` work (two unrelated `terminals.test.ts` failures, confirmed by
reading their assertions — a terminal-metadata field and an SSE exit-event timing case, neither
touching anything this task added) — resolved by the time of this task's own final push; see this
task's own final numbers in the branch history / PR for the as-pushed measurement. `src/routines.ts` +
`src/__tests__/routines.test.ts` measured in isolation (`vitest run src/__tests__/routines.test.ts`):
76/76 passing.

## 2026-07-21 addition — `model-proxy.ts` (chat/model-proxy pack, `feat/http-routes-and-cli-commands`)

Implements the placement decision in `ADS-memory/reports/proposals/
PROP-http-route-packs-chat-model-proxy-2026-07-21.md`, the follow-up to that proposal's own
"real question: where does provider-specific wire-protocol logic belong?" — **`@jini/agent-runtime`,
not this package.** `packages/agent-runtime/source-map.md`'s own 2026-07-21 addition documents the
actual wire-adapter/tool-loop work (`runAnthropicToolTurn`/`runOpenAiToolTurn`, both built fresh
against each provider's real API docs since this task had no direct access to OD's `chat.ts`). This
module is deliberately thin: request parsing, the same-origin guard, and SSE transport via `sse.ts`
(the same primitive `runs.ts`/`memory.ts` already consume) — it has **zero** knowledge of what an
Anthropic `content_block_delta` or an OpenAI `tool_calls[].function.arguments` fragment looks like,
matching this package's existing posture everywhere else (`db-ops.ts`/`daemon-status.ts`/`host-tools.ts`'s
"caller supplies the real collaborator" DI convention, now extended to "the real collaborator is a
whole turn-runner, not just a data store").

**New file:** `src/model-proxy.ts` — `registerModelProxyRoutes(app, deps, adapter)` mounts `POST
/api/proxy/anthropic/stream` and `POST /api/proxy/openai/stream`. Both are raw Express routes (like
`runs.ts#registerRunEventStream`), not `JsonRouteSpec`s, since each streams an SSE response driven by
a POST body rather than returning one JSON value.

**Scope for this pass** (per the proposal's own recommendation): Anthropic and OpenAI only. Azure/
Google/Ollama/OpenRouter routes are **not built this round** — see `packages/agent-runtime/
source-map.md`'s matching note; each would be a mechanical sibling `POST /api/proxy/<provider>/stream`
route once `@jini/agent-runtime` grows the matching turn-runner, following this exact
parse/same-origin/SSE-wiring shape. **Confirmed OD-PRODUCT and excluded regardless of this decision,
per the proposal:** `POST /api/runs/:id/feedback` and the two "Critique Theater" routes — not touched
by this module at all.

**BYOK, not server-held credentials.** Every request body carries its own `apiKey` (plus optional
`baseUrl`/`extraHeaders`/model params) — this route never stores or reads a server-side credential,
matching `providers/model-catalog.ts`'s existing BYOK shape one package over.

**Request validation is deliberately shallow, per the "no wire-protocol knowledge in the HTTP layer"
mandate.** `parseCommon`/`parseAnthropicProxyRequest`/`parseOpenAiProxyRequest` check only the
transport-level shape every request shares — non-empty `apiKey`/`model` strings, a non-empty
`messages` array, primitive types for the optional fields (`baseUrl`/`temperature`/`maxToolTurns`/
`extraHeaders`, plus Anthropic's required `maxTokens` and optional `apiVersion`/`system`/`tools`) —
and never the *contents* of `messages`/`tools`, which is provider wire-protocol knowledge this
package does not have. A malformed message/tool shape is instead rejected by the real provider API
and surfaces as a normal `'error'` SSE event through the turn-runner, exactly like any other upstream
rejection — not a 400 from this route.

**Wiring the SSE channel to the turn-runner's `end` contract.** Each turn-runner event is wrapped as
`{opaqueCursor, kind: event.type, data: event}` and enqueued onto `sse.ts#createSseChannel` with
`isEndEvent: (event) => event.kind === 'end'`. Because both turn-runners guarantee exactly one
`{type: 'end'}` event per call (the duplicate-end-event fix, `turn-end-guard.ts` — see
`packages/agent-runtime/source-map.md`), the channel auto-closes exactly once with no extra logic on
this side; after `run(...)` resolves normally there is deliberately **no** `channel.end()` call — see
the inline comment at that call site for the reachability proof (every exit path in both turn-runners'
`while (true)` loops calls `emitEnd` before it can `break`, so the promise cannot resolve without the
channel already having auto-closed).

**SEC-005 catch-all for a turn-runner promise that rejects outright.** Both turn-runners already
convert every provider/network failure into an `'error'`+`'end'` event pair internally and never
throw for those cases — the only realistic way `run(...)`'s promise rejects is a caller-supplied
`executeTool` throwing (neither turn-runner wraps that call in a try/catch — see
`packages/agent-runtime/source-map.md`'s matching note). `registerProxyStreamRoute`'s `catch` block
logs the real exception via `onInternalError` (default `console.error`, matching `runs.ts`) and
enqueues a synthetic `{type: 'error', message: 'an internal error occurred', code: correlationId}` +
`{type: 'end', reason: 'error'}` pair — `enqueue` is `sse.ts`'s own documented no-op-once-closed, so
this is safe to call unconditionally regardless of whether the channel already auto-closed.

**Tool execution is optional DI, not built in this pass.** `ModelProxyHttpDeps.anthropicExecuteTool`/
`openaiExecuteTool` are both optional; with neither supplied, the routes still stream back any
`tool_use`/`tool_calls` events the model requests, but the turn-runner does not attempt a server-side
tool loop — matching `packages/deploy/source-map.md`'s "deferred real `ToolExecutor` wiring"
precedent this package's `db-ops.ts` section already cites. Not routed through `@jini/core`'s
`ToolRegistry`/`ToolExecutor` boundary (unlike `db-ops.ts`'s DB inspect/vacuum tools) — that boundary
exists for locally-dangerous daemon-side operations; this route proxies an external, already-BYOK-
gated API call using credentials the caller supplies per-request, a materially different trust shape.
`requireSameOrigin`-equivalent protection is still applied (via a direct `guardSameOrigin` call, since
this is a raw route rather than a `JsonRouteSpec`) as the first line of defense against a cross-site
page abusing the local daemon as a confused-deputy relay for billed provider calls.

**Bug fixes verified at this layer too** (both already fixed at the source in `@jini/agent-runtime`;
this package's tests independently prove the fix survives the HTTP round-trip): the OpenRouter-shaped
product-identity leak (a test asserts `HTTP-Referer`/`X-Title` are absent from the outbound fetch
headers by default, and equal exactly what a caller supplies via `extraHeaders` — an assembled-at-runtime
string, not a literal, so the regression check itself doesn't trip `pnpm guard`'s own R5-neutrality
scan); the duplicate-`end`-event bug (the "invokes the injected executeTool" test asserts exactly one
`end`-kind SSE frame is written and `res.end()` is called exactly once, end-to-end through a real
tool-use round).

**Dependency:** adds `@jini/agent-runtime` to `package.json` — both are `scripts/check-engine-boundaries.ts`
locked packages (R7 only restricts a locked package importing an *unlocked* one), so this needed no
`UNLOCKED.md` entry, matching the placement decision's own reasoning.

Tests: `src/__tests__/model-proxy.test.ts` — 100/100/100/100 coverage, 30 tests. Covers: same-origin
rejection before any fetch call (both routes); every validation-failure branch (missing/empty
`apiKey`/`model`/`messages`, wrong-typed `baseUrl`/`temperature`/`maxToolTurns`/`extraHeaders`, and
Anthropic's `maxTokens`/`apiVersion`/`system`/`tools`) via `it.each`; a full successful SSE round-trip
for both providers (headers, request body, `text_delta`/`end` events, `res.end()` called once); every
optional field (`baseUrl`/`apiVersion`/`system`/`tools`/`temperature`/`maxToolTurns`/`extraHeaders`)
actually reaching the turn-runner's request; the injected `executeTool` hook completing a full
tool-use round for both providers; the SEC-005 catch-all (executeTool throwing, redacted response,
`onInternalError` invoked once with the real error, default `console.error` fallback); and
`registerModelProxyRoutes` mounting both routes.

## 2026-07-21 addition — `terminals.ts` (interactive-terminal route pack, resolving the `terminal.ts` MIXED verdict)

Implements the specific decision made in
`ADS-memory/reports/proposals/PROP-http-route-packs-terminal-pty-2026-07-21.md`, closing the
routes-classification table's row #11 `terminal.ts` verdict (both named blockers — SSE and a generic
workspace-root port — were already resolved as standalone prerequisites earlier this same pass; this
addition is the actual route wiring the 2026-07-21 route-pack audit section above left as future work).

**Zero business logic in this file, by design** — mirrors this package's own established discipline
(`runs.ts` calling into `RunLifecycle`, `db-ops.ts` calling into an injected `DaemonDbOperations`): the
actual `node-pty` spawn, the in-memory session registry, session-ownership gating, and the kill/write/
resize lock all live in `@jini/daemon`'s new `terminal-session.ts` (see that package's own
2026-07-21 dated source-map section for the full design writeup) — a native-compiled-dependency
concern this package does not and should not take on.

**Routes**: `GET /api/terminals` (`terminalListRoute` — lists the calling principal's own sessions,
optionally narrowed by `resourceRef`; no `ToolExecutor` gate, matching `runs.ts`'s `runListRoute`
precedent for a read scoped to the caller's own resources), `POST /api/terminals`
(`terminalCreateRoute` — the one gated call), `POST /api/terminals/:id/stdin` (`terminalStdinRoute`),
`POST /api/terminals/:id/resize` (`terminalResizeRoute`), `POST /api/terminals/:id/kill` /
`DELETE /api/terminals/:id` (`terminalKillRoute`/`terminalDeleteRoute`, both delegating to the same
`handleKill` helper — mirrors OD's own dual-route-same-handler shape), and `GET
/api/terminals/:id/stream` (`registerTerminalEventStream`, a raw Express route like
`registerRunEventStream`/`registerMemoryEventStream` — not through `mountJsonRoute`, so it carries no
`requireSameOrigin` guard of its own, matching both of those routes' precedent).

**`POST /api/terminals` is the one call routed through `ToolExecutor.execute(..., 'terminal.create',
...)`** — resolves `resourceRef` to a spawn `cwd` via `workspace-root.ts` first (identical to
`host-tools.ts`'s open-in route), then authorizes+spawns through the gate, then maps the
`ToolExecutionResult` the same way `db-ops.ts`'s `toolResultToApiResult` does (denied/confirmation-
denied → `TOOL_OPERATION_DENIED`; timed-out/cancelled/failed → a redacted, correlation-id-bearing
`INTERNAL_ERROR`, SEC-005). `stdin`/`resize`/`kill`/`stream` deliberately do **not** re-enter
`ToolExecutor` — they call `deps.manager`'s lighter, still-explicit session-ownership-checked methods
directly, per the proposal's own reasoning: wrapping every keystroke in a full authorize/confirm/audit
round-trip would make an interactive terminal unusable. A session-ownership mismatch (or an unknown
id) surfaces identically as `NOT_FOUND` from every one of these routes — never a distinguishable
403 — matching `@jini/daemon`'s own `checkOwnership` doc.

**A real bug found and fixed while wiring the SSE adapter, not carried forward**: `@jini/daemon`'s
`TerminalSessionManager.attach()` can call the injected `TerminalSseSink.end()` *synchronously, from
inside the `attach()` call itself* — an already-exited session's replay path sends the buffered `exit`
event and then immediately calls `end()`, before this route has ever called `sse.ts`'s
`channel.open()`. An initial version of this adapter mapped `sink.end()` straight to `channel.end()`,
which — since `channel.open()` had not yet run — ended the response with `res.end()` while the queued
backlog was still sitting unflushed in the channel's internal queue and no SSE headers had even been
sent: the client got a bare closed connection with zero bytes written, never seeing the replayed `exit`
event. Caught by a real end-to-end test (`registerTerminalEventStream > replays buffered scrollback and
ends immediately for an already-exited terminal`), not a code-reading guess. Fixed with a small
`channelOpened` flag: `sink.end()` calls `channel.end()` immediately only once the channel has actually
been opened; an `end()` that arrives before `open()` (the already-exited-session replay path) is
deferred and applied right after `channel.open()` returns (safe even if `open()`'s own `isEndEvent`
match already auto-closed the channel while draining the queue — `channel.end()` is documented
idempotent). A live session that exits *while already streaming* (well after `open()` ran) still calls
`channel.end()` immediately, as before — covered by a second, separate test.

**`TerminalWireEvent`** reshapes `@jini/platform`'s `send(event, data, id)` triple into `sse.ts`'s
generic `SseEvent` (`opaqueCursor`/`kind` naming, matching `runs.ts`'s `RunProtocolEvent` adaptation).
Reconnect replay uses `sse.ts`'s `requestedAfterCursor` (the same `Last-Event-ID` header / `afterCursor`
query-parameter helper `runs.ts` already uses) rather than OD's origin-specific `Last-Event-ID` / `after`
query-parameter pairing — a deliberate generalization (documented, not silent) consistent with this
package's "one shared SSE mechanism" discipline.

Tests: `src/__tests__/terminals.test.ts` — 46 tests. `parse` validation for all five JSON routes;
`terminalCreateRoute.handle`'s full `ToolExecutor` result-mapping matrix (completed/denied/confirmation-
denied/timed-out/cancelled/failed, the SEC-005 redaction proof with a real embedded-path error message,
`onInternalError` invocation and its `console.error` default) exercised through a **real**
`ToolExecutor`/`ToolRegistry`/`TerminalSessionManager` triple (matching `db-ops.test.ts`'s "prove the
real production default, not a mock of it" discipline) with a fake `PtySpawn`/`PtyProcess` — no real
subprocess anywhere in this file; `terminalListRoute`'s principal-scoping and `resourceRef` narrowing;
`terminalStdinRoute`/`terminalResizeRoute`/`terminalKillRoute`/`terminalDeleteRoute`'s success/not-found/
cross-principal-not-found paths; `registerTerminalRoutes`' full route-mount inventory and same-origin
enforcement (including proving the list route is deliberately exempt); `registerTerminalEventStream`'s
missing-id/unknown-id/cross-principal-unknown 400/404 paths, the live-streaming happy path (headers,
open connection, a live `data` event actually reaching `res.write`), the already-exited replay-and-end
path (the bug above, now regression-covered), the live-exit-while-streaming path (the `channelOpened`
branch's other side), client-disconnect cleanup (`detach` called, no further output delivered), and the
`Last-Event-ID`-header-over-`afterCursor`-query-parameter precedence + zero-default cases.

`pnpm --dir packages/http typecheck`: clean. `pnpm --dir packages/http test:coverage`: this package's
full-suite coverage run was measured under heavy concurrent load from several other sessions actively
running their own test/coverage passes against this same package at the same time (confirmed via
`ps aux`, and via repeated transient `ENOENT`/`coverage/.tmp/coverage-N.json` races on retry — vitest's
coverage temp directory is a fixed, not process-unique, path) — this file's own coverage was verified
directly, in isolation, rather than trusted from a contended aggregate run; see this task's own final
push for the as-measured full-package numbers once the shared environment quieted down.

## 2026-07-22 addition — full re-test against the new `delegated-tools.ts` route + a real fix for `terminals.ts`'s coverage discrepancy

**`delegated-tools.ts` re-tested against `packages/daemon`'s gap-3-part-2 spawn wiring** (see that
package's own 2026-07-22 dated entry): `packages/daemon/src/agent-executor.ts` gained spawn-time
`.mcp.json` injection this same pass, which is the piece that actually makes a `claude`-spawned
run's own MCP client call back into this route for real. This route itself needed no code change —
its contract (`{runId, toolUseId, toolId, input}` → `createDelegatedToolBridge`) was already
correct — but per this task's anti-cheating standard it was re-run rather than assumed still
passing: `pnpm --dir packages/http exec vitest run --coverage` — **694/694 tests pass** (up from
690 before this pass's `terminals.ts` addition below), `delegated-tools.ts` **100/100/100/100**.

**`terminals.ts`'s line-320 coverage discrepancy: root-caused for real, not left as "unreachable."**
The prior pass's own note guessed the cause was contended coverage instrumentation under parallel
vitest workers. That guess was checked and **ruled out**: `pnpm --dir packages/http exec vitest run
src/__tests__/terminals.test.ts --coverage` (this single file, in complete isolation, no other
worker running) reproduced the identical gap — line 320 (`channel.end()` inside `TerminalSseSink
.end()`'s `if (channelOpened)` branch) stayed uncovered every time. The real cause, confirmed by a
synchronous `console.log` probe placed directly inside that branch and removed once the diagnosis
was confirmed (not inferred from reading the source): it is a genuine **reentrancy** between this
route and `@jini/platform`'s `TerminalService.finish()` (`packages/platform/src/terminal.ts`). For
a *live* session that exits while already streaming, `finish()` calls `sink.send('exit', ...)`
before its own separate `sink.end()` loop. `send()` here forwards straight to
`channel.enqueue()`, whose `isEndEvent: (e) => e.kind === 'exit'` match auto-closes the channel
*synchronously inside that same `enqueue()` call* — which synchronously runs this route's own
`channel.onClose` callback, which calls `deps.manager.detach(id, attachedSink)`, removing this
sink from `TerminalService`'s live `session.clients` Set *before* `finish()`'s own `sink.end()`
loop (which iterates `session.clients` fresh, not a pre-`emit()` snapshot) ever runs. By the time
that loop executes, this sink has already detached itself — `sink.end()` is consequently never
invoked while `channelOpened` is `true` via any call graph this repo's current `@jini/platform` +
`@jini/http` composition can produce. The route's own prior doc comment claiming this path "still
calls `channel.end()` immediately, as before — covered by a second, separate test" was **wrong**:
that second test only proves `res.end()` gets called (via the channel's own generic auto-close),
never that this route's own explicit `sink.end()` → `channel.end()` statement executes.

**The fix, per this task's "extract, don't cut" standard — not a deletion, not a forced test.**
The branch is not provably *permanently* unreachable (a hypothetical non-SSE `TerminalSseSink`, or
a future `TerminalService` exit reason not preceded by a matching `send()`, would hit it), so it
was not deleted as dead code. It also cannot be exercised in place without either (a) changing real
production timing/wiring purely to satisfy a coverage number — rejected, since the *current*
behavior is already correct (proven: `res.end()` fires exactly once for the live-exit case, per
this file's own long-standing, still-passing test) — or (b) extracting it into a directly-testable
unit, which is what this repo's own established convention calls for. `createDeferredEndGate(
channel)` is the extraction: the `channelOpened`/`endRequestedBeforeOpen` state machine, pulled out
of `registerTerminalEventStream`'s closure into its own small, exported, pure-ish factory
(`{markOpened(), end()}` over a minimal `{end(): void}` channel shape) that needs no `SseChannel`,
no `TerminalSessionManager`, no Express req/res — just a fake with one spied method. Four new
direct unit tests in `createDeferredEndGate`'s own describe block cover both orderings explicitly:
`end()` before `markOpened()` (the already-exited-at-attach-time replay path, previously the only
one production could reach) and `markOpened()` before `end()` (the previously-unreachable-via-
integration branch, now exercised directly and permanently regression-covered regardless of
whether any future production call graph happens to reach it). `registerTerminalEventStream`
itself is otherwise unchanged in behavior — it now delegates to `createDeferredEndGate` instead of
inlining the two local variables, a mechanical extraction with a full reachability analysis
recorded in the function's own doc comment (see `terminals.ts`).

**Verified, personally, this session:** `pnpm --dir packages/http exec vitest run --coverage` —
**694/694 tests pass**, `terminals.ts` **100% statements/functions/lines**. Branch coverage for
this file is 93.45% in the full-suite run; the residual uncovered branches (lines 165–167, 209,
215, 237–238 — `parseCreateTerminalInput`'s three optional-field spread ternaries,
`actionResultToApiResult`'s `result.session ?` spread, and one guard-clause side each in
`parseStdinInput`/`parseResizeInput`) are **pre-existing**, not introduced by this pass, not named
in this task's own item-2 scope (which named line 320 specifically), and not hit by this task's
fix — flagged here honestly rather than silently left out of the record, but left as a genuine,
separate finding for a future pass rather than folded into this one. Package-wide aggregate
remains comfortably above this package's committed threshold (98/98/98/98):
**100/99.28/100/100** measured this run. `pnpm --dir packages/http exec tsc --noEmit`: clean. Root
`pnpm guard`: clean (re-run after this change, not assumed still clean from before it).

## 2026-07-19 — Fastify transport split

Everything described above (the "File map" table, the `routes/` classification, and the
`api-security-middleware.ts`/`route-registration-guard.ts` addition) predates this section and
described an **Express-only world**. This package is now transport-plural: it ships two
independent, idiomatically-native transport subtrees plus a small shared root.

### Layout

```
src/
  types.ts               shared: Result/route-spec types (framework-agnostic)
  origin-validation.ts   shared: same-origin/allow-list predicates (framework-agnostic)
  pack-http.ts           shared: mountPackHttp (app typed `unknown`, never Express-specific)
  index.ts               shared: root barrel — re-exports the three files above,
                          plus `export * as express` / `export * as fastify` namespaces
  express/               every file from the "File map"/"routes/" sections above, unmoved in kind,
                          moved from src/ root into this subdirectory
  fastify/               an independent reimplementation of the same nine jobs, native to Fastify's
                          own hook/plugin model instead of Express's middleware/req/res model
```

Every symbol a consumer previously imported from the package root (`adapter.ts`, `compat.ts`,
`daemon-status.ts`, `local-daemon-request.ts`, `origin.ts`, `request.ts`, `response.ts`,
`route-registration-guard.ts`, `api-security-middleware.ts`) now lives under `express/` — this is a
breaking import-path change for any pre-existing caller, accepted deliberately since there is
exactly one caller of this package in the repo (`@jini/node-host`) and it was updated in the same
change (see that package's own source-map.md).

### `transport?: 'express' | 'fastify'` — the config surface this enables

`@jini/node-host`'s `createLocalNodeDaemon` is the only consumer today; it takes a
`transport?: 'express' | 'fastify'` option (default `'express'`) and wires the matching namespace
off this package's barrel (`http.express.*` / `http.fastify.*`) for the route-registration guard,
the two `/api` security middlewares, and the daemon-status routes. This package itself has no
opinion on which transport a consumer picks — it just exposes both namespaces.

### Design decision: deliberately duplicated, not a shared interface — with one exception

`express/` and `fastify/`'s nine matching files (`adapter`, `api-security-middleware`, `compat`,
`daemon-status`, `index`, `local-daemon-request`, `origin`, `request`, `response`,
`route-registration-guard`) are **independent implementations of the same job, not two adapters
behind one shared interface.** This was a deliberate choice, not an oversight: Express's
middleware-chain model (`(req, res, next) => void`, `res.json(...)`, `app.use(...)`) and Fastify's
hook/plugin model (`onRequest`/`onRoute` hooks, `reply.send(...)`, schema-validated route options)
are different enough in shape that forcing them behind one abstraction would either leak one
framework's idioms into the other's native surface, or flatten both down to a lowest-common-
denominator API that fights each framework's own strengths (Fastify's schema-based validation and
radix-tree routing, in particular, are not expressible through an Express-shaped adapter without
losing most of their value). Each subtree is written the way an engineer fluent in that framework
would write it, and each is independently tested to 100% coverage.

**The one exception: `fastify/daemon-status.ts` reuses `express/daemon-status.ts`'s route-spec
data directly** — `daemonStatusRoute`/`daemonShutdownRoute` are pure `defineJsonRoute`-shaped
data plus framework-agnostic `parse`/`handle` functions (see that file's own doc). They never
reference Express at runtime: `express/daemon-status.ts` only imports `type { Express }` for one
parameter type, and TypeScript's `verbatimModuleSyntax` erases type-only imports from the compiled
output entirely — verified there is zero runtime `express` dependency pulled into the `fastify/`
subtree by this reuse. `fastify/daemon-status.ts`'s own job is only the Fastify-specific mounting
wrapper (`registerDaemonStatusRoutes`, calling `./adapter.js`'s Fastify `mountJsonRoute`). This is
the single case where sharing was correct instead of duplication: the route *data* (path, method,
input parser, pure handler) has no framework opinion in it at all — only the *mounting glue* does,
and that glue is what actually differs and stays independent per subtree.

### `mountPackHttp` transport-agnosticism does not make a pack's own registrar portable

Documented directly in `pack-http.ts`'s own module doc (see that file) and repeated here since it
is a frequent point of confusion for pack authors: `mountPackHttp` only ever forwards `app`
straight through, unmodified, to a pack's own `http(app, services)` registrar. That registrar
still receives a transport-specific `app` — an Express-shaped handler calling `res.json(...)`
throws (surfaced as a 500) if mounted on a raw Fastify instance, since Fastify's `reply` has no
`.json()` method (`reply.send(...)` is the equivalent, which auto-serializes a plain object with a
200 default status). A pack that must run under both transports should branch on the app shape
itself, or better, be written against this package's own `defineJsonRoute`/`mountJsonRoute` from
the matching namespace, which does abstract the difference away. Proven concretely by
`packages/node-host/src/__tests__/create-local-node-daemon.fastify-transport.test.ts`'s own
`makePingPack()` fixture doc, which deliberately is NOT the same fixture the Express-transport
suite uses for exactly this reason.

### Tests

337 tests across 21 test files, 100% coverage on all 4 metrics (statements/branches/functions/lines)
for both `express/` and `fastify/` subtrees plus the shared root — reverified fresh as part of the
Part A completion task (2026-07-19): `pnpm --filter @jini/http exec vitest run --coverage
--coverage.include='src/**'` → 337 passed, 100/100/100/100 across every file. No coverage gaps were
found in this package itself; the gaps closed in this pass were one layer up, in
`@jini/node-host`'s integration suite — see that package's own source-map.md.

## 2026-07-19 — SSE primitive + AG-UI run-stream route (Part B.7)

This section fills the "Explicitly deferred: SSE" gap noted above (this package was previously
JSON-route-only). Unlike `express/`/`fastify/`'s deliberate per-transport duplication, SSE is a
raw-stream concern both frameworks expose identically underneath: Express's `Response` literally
extends Node's `http.ServerResponse`; Fastify's `reply.raw`/`request.raw` give you that exact
underlying `http.ServerResponse`/`http.IncomingMessage` pair directly. Building it once therefore
turned out to be genuinely less total work than building it twice, not a design compromise.

### New files (shared root)

| File | Job |
|---|---|
| `src/sse.ts` | `createSseResponse(req, res, options)` — opens `res` as an SSE stream (writes `text/event-stream`/`no-cache`/`keep-alive` headers immediately), returns an `SseConnection` (`send(data)`/`close()`/`closed`). Arms a keepalive interval (`: ping\n\n` comment lines, default every 15s) so an idle connection survives gaps between events, and wires `req.on('close', ...)` so a client disconnect closes the connection and runs an optional caller-supplied `onClose` cleanup hook exactly once. Typed only against `node:http`'s `IncomingMessage`/`ServerResponse` — no Express or Fastify import anywhere in this file. |
| `src/run-stream.ts` | `handleRunStreamRequest(req, res, runId, {lifecycle})` — the framework-agnostic core of the AG-UI SSE route: opens the connection via `createSseResponse`, subscribes to `runId` via `@jini/daemon`'s `RunLifecycle.stream`, encodes every delivered event through a fresh `@jini/agui` `createAguiEncoder()`, and forwards each non-null result. Closes the connection once the run's own terminal `'end'` event has been forwarded (nothing follows it, by `RunLifecycle`'s own contract), and unsubscribes from the run if the client disconnects first (wired through `createSseResponse`'s `onClose` hook) so a dropped client never leaves a dangling subscriber. A non-`'ok'` `StreamSubscribeResult` (`unknown-run`/`replay-gap`/`invalid-cursor`) is reported as one `{ error: <kind> }` SSE data event before closing — there is no JSON-status-code channel left once SSE headers are already committed, which is why this differs from a `JsonRouteSpec`'s `Result`-based error path. Also exports `RUN_STREAM_ROUTE_PATH` (`/api/runs/:runId/agui-stream`) as a plain string constant with zero framework coupling, so both transport subtrees' glue files import the identical path from one place rather than each hardcoding it. |
| `src/express/run-stream.ts` | `registerRunStreamRoute(app, deps)` — the Express-specific sliver: resolves `req.params.runId` and hands `req`/`res` straight through to `handleRunStreamRequest` (Express's `req`/`res` already *are* the raw Node objects the shared handler wants). A few lines, not a reimplementation. |
| `src/fastify/run-stream.ts` | `registerRunStreamRoute(app, deps)` — the Fastify-specific sliver: calls `reply.hijack()` (tells Fastify this handler owns the raw response and Fastify's own reply lifecycle must not act on it further — see the empirical finding below for why this specific call is load-bearing, not just doc-driven), resolves `request.params.runId`, and hands `request.raw`/`reply.raw` straight through. |

### Empirical finding: `reply.hijack()` is load-bearing, verified by a real server test, not assumed from Fastify's docs

Writing directly to `reply.raw` without calling `reply.hijack()` first is a well-known Fastify
footgun: Fastify's own reply lifecycle expects the handler to either call `reply.send(...)` or
return a value for it to serialize, and will otherwise try to act on a response this handler has
already written to and ended directly — this typically surfaces as either a "reply already sent"
warning/error, or an attempt to serialize this async handler's `undefined` return value on top of
an already-ended response. Rather than trusting that reasoning alone,
`src/fastify/__tests__/run-stream.test.ts` proves it empirically: it boots a real Fastify server on
an ephemeral port, drives a real run through `emit()`/`finish()`, and reads the actual SSE bytes
back over a real `fetch()` connection twice in sequence (once for a live event, once for the
terminal `run.lifecycle` event) — if `hijack()` were wrong or missing, this test would hang, throw,
or receive a malformed/incomplete response instead of cleanly observing both events and a clean
close.

### New dependencies: `@jini/daemon` and `@jini/agui`

`@jini/http`'s dependency list grows by two workspace packages this task: `@jini/daemon` (for
`RunLifecycle`'s type, consumed by `run-stream.ts`) and `@jini/agui` (for `createAguiEncoder`).
Verified this introduces no dependency cycle before adding either: `@jini/daemon`'s own
dependencies are `@jini/agent-runtime`/`@jini/core`/`@jini/platform`/`@jini/protocol` (none of
which depend on `@jini/http`), and `@jini/agui` depends only on `@jini/protocol` — so
`@jini/http → @jini/daemon`/`@jini/agui` is a new downward edge, not a cycle. This is a real,
deliberate architectural addition: `@jini/http` was previously "HTTP/SSE transport + route-pack
registrar" with no dependency on the run/agent kernel at all; it now also depends on
`@jini/daemon`'s `RunLifecycle` and `@jini/agui`'s encoder specifically to implement the SSE route
this task's brief asked for in this package. Whether that coupling should eventually move (e.g. the
route registrar living in `@jini/node-host`, which already depends on both, mounting a purely
transport-agnostic primitive from `@jini/http`) is a reasonable question for a future architecture
review — not revisited here since the task brief was explicit that this route belongs in
`packages/http/src/`, mirroring `daemon-status.ts`'s own registration shape.

### Not wired into `createLocalNodeDaemon`

`@jini/node-host`'s `createLocalNodeDaemon` does not call `registerRunStreamRoute` today — this
task built the route inside `@jini/http` (as scoped) but did not extend `createLocalNodeDaemon` to
mount it automatically, since that wiring wasn't part of this task's brief and doing it without
being asked would be scope creep into a different package's already-tested assembly path. A future
task can add it the same way `registerDaemonStatusRoutes` is already wired in.

### Tests

11 new tests in `src/__tests__/sse.test.ts` (the primitive, via fake req/res `EventEmitter`/`vi.fn`
objects — headers, `send`/`close`/idempotent-`close`/send-after-close, the keepalive interval and
its cadence/default/stop-on-close, client-disconnect-triggers-close, `onClose` firing exactly once
either way). 7 new tests in `src/__tests__/run-stream.test.ts` (the shared handler, using a real
`@jini/daemon` `createRunLifecycle`/`createInMemoryEventLog` pair for genuine integration
confidence rather than a hand-rolled fake lifecycle — plus two fake-lifecycle tests for the
`replay-gap`/`invalid-cursor` `StreamSubscribeResult` kinds a real in-memory log's own happy paths
can't produce): text_delta forwarding, close-on-'end', replaying an already-terminal run, unsubscribe-
on-client-disconnect (proven by checking a post-disconnect `emit()` no longer produces a new
`res.write` call), and the `unknown-run`/`replay-gap`/`invalid-cursor` error-and-close paths. Plus
one real-server integration test per transport (`src/express/__tests__/run-stream.test.ts`,
`src/fastify/__tests__/run-stream.test.ts`) — see the `hijack()` finding above for why the Fastify
one specifically matters. 357 tests total for the package (was 337 before this addition), 100%
coverage on all 4 metrics across every file including all four new ones.
`pnpm --filter @jini/http exec vitest run --coverage --coverage.include='src/**'` → 357 passed,
100/100/100/100.

## 2026-07-22 — Merging the Fastify transport split into `main`: the actual final architecture (supersedes this file's "Layout"/"breaking import-path change" claims above)

The two sections above were written against `main` as of 2026-07-18/19. By the time this branch
was actually merged (2026-07-22), `main` had gained ~118 more commits, including a full batch of
new, Express-only route packs (`runs.ts`, `agents.ts`, `host-tools.ts`, `memory.ts`, `routines.ts`,
`terminals.ts`, `model-proxy.ts`, `db-ops.ts`, `delegated-tools.ts`, `active-context.ts`) that this
branch's own "Layout"/"breaking import-path change" description above never accounted for — those
files all still import `defineJsonRoute`/`mountJsonRoute`/`rawInput`/`sendApiError`/etc. from the
flat root (`./adapter.js`, `./request.js`, `./response.js`, ...), not from an `express/` subtree.

**What actually landed, and why it differs from the plan above:** rather than moving
`adapter.ts`/`api-security-middleware.ts`/`compat.ts`/`daemon-status.ts`/`local-daemon-request.ts`/
`origin.ts`/`request.ts`/`response.ts`/`route-registration-guard.ts` into `express/` (which would
have broken every one of those ten newer route-pack files' imports, and is exactly what git's own
rename-detection tried to do automatically during the merge, silently, before this was caught and
reverted), these nine files stay at the flat root, unchanged, as the single canonical
implementation. A new file, `src/express-index.ts`, is a thin barrel that re-exports this exact
same flat implementation (plus `registerRunRoutes`/`registerAgentRoutes`/`registerHostToolsRoutes`)
under an `express` namespace — mirroring `fastify/index.ts`'s shape so `create-local-node-daemon.ts`
can pick either namespace symmetrically — without ever duplicating or relocating the underlying
code. `express/` itself still exists, but now contains only the one file that's genuinely new and
transport-specific with no flat-root equivalent: `express/run-stream.ts` (the AG-UI SSE mounting
sliver, exactly as originally built).

**Corrected layout:**

```
src/
  types.ts, origin-validation.ts, pack-http.ts     shared, framework-agnostic (unchanged)
  adapter.ts, api-security-middleware.ts, compat.ts,
  daemon-status.ts, local-daemon-request.ts, origin.ts,
  request.ts, response.ts, route-registration-guard.ts   the ONE canonical Express-mounting
                                                            implementation — flat, not moved
  runs.ts, agents.ts, host-tools.ts, memory.ts,
  routines.ts, terminals.ts, model-proxy.ts, db-ops.ts,
  delegated-tools.ts, active-context.ts                   every route pack — all still import
                                                            the flat files above directly, zero
                                                            import-path changes for any of them
  raw-sse.ts          the branch's original sse.ts primitive (createSseResponse), renamed to avoid
                       colliding with main's own, independently-built src/sse.ts (createSseChannel
                       — a different, older, load-bearing primitive runs.ts/terminals.ts/
                       model-proxy.ts already depend on); see "sse.ts naming collision" below
  express-index.ts     NEW — thin re-export barrel, `express` namespace, points at the flat files
                       above (not a copy)
  express/             now contains only run-stream.ts — the one piece with no flat equivalent
  fastify/             the independent Fastify-native implementation (see below) — unchanged in
                       spirit from the section above, but see "Real dual-transport parity" below
  index.ts             root barrel — every flat file/route-pack above stays exported here exactly
                       as before this merge (NOT reduced to only framework-agnostic pieces, as the
                       2026-07-19 section above planned), plus `export * as express`/`export * as
                       fastify`
```

**No breaking import-path change, contrary to this file's 2026-07-19 section above:** every
existing consumer (all ten route packs, `@jini/node-host`) keeps importing from the exact same flat
paths it always did. The `express`/`fastify` namespaces are additive, opt-in surface for a caller
that specifically wants to pick a transport (today, only `createLocalNodeDaemon`'s `transport`
option does).

### `sse.ts` naming collision — two independent, both load-bearing, primitives

This branch's `sse.ts` (`createSseResponse`, a simple `node:http`-typed keepalive/send/close
primitive, used only by `run-stream.ts`'s AG-UI route) and `main`'s own, independently-built
`sse.ts` (`createSseChannel`, a bounded-queue/backpressure/cursor-replay primitive, used by
`runs.ts`'s canonical run-events stream and reused by `terminals.ts`/`model-proxy.ts`) collided at
the same path with genuinely different, both-real implementations — neither one is a stray/
duplicate of the other. Resolution: `main`'s `sse.ts`/`createSseChannel` stays unchanged at that
path (it has more callers and predates this merge on `main`'s own timeline); this branch's version
was materialized as a new file, `raw-sse.ts`, with its two callers (`run-stream.ts`,
`raw-sse.test.ts`) updated to the new import path. Both primitives are real, both are 100% tested,
both stay — this is not a downscoping, just a rename to resolve the collision.

### Real dual-transport parity for `runs`/`agents`/`host-tools` — not left Express-only

Per this repo's standing rule (refactor to make things reachable and tested rather than leaving a
scope gap), `registerRunRoutes`/`registerAgentRoutes`/`registerHostToolsRoutes` were NOT left
Express-only despite predating this branch. `runs.ts`/`agents.ts`/`host-tools.ts` already used the
exact same transport-agnostic `JsonRouteSpec` pattern this branch's own `fastify/` subtree is built
on (`defineJsonRoute`/pure `parse`/`handle` functions) — only their `register*Routes` mounting
wrappers were Express-specific. New files `fastify/runs.ts`, `fastify/agents.ts`,
`fastify/host-tools.ts` mount the exact same spec objects via `fastify/adapter.ts`'s own
`mountJsonRoute`, with zero route-logic duplication.

**The one genuine complication, resolved for real rather than left as an excuse: SSE run-events
streaming.** `runs.ts`'s `registerRunEventStream` (the `GET /api/runs/:runId/events` handler) used
`createSseChannel`, which was typed `import type { Response } from 'express'` — a real
Fastify-incompatibility, not an assumed one. Investigated directly: `createSseChannel`'s only
actually-Express-specific call was `res.status(200)` on the `open()` path; every other call
(`write`/`setHeader`/`flushHeaders`/`end`/`on('close'|'drain')`/`writableEnded`) already exists
identically on the raw `node:http` `ServerResponse` Express's own `Response` extends. Retyped
`createSseChannel`'s parameter from `Response` to `ServerResponse` and replaced `res.status(200)`
with `res.statusCode = 200` (the same assignment Express's own `.status()` performs internally) —
Express callers are unaffected (`Response` still satisfies `ServerResponse` structurally), and
Fastify's `reply.raw` now satisfies it too. `handleRunEventStreamRequest` was extracted as a new,
exported, transport-agnostic core (mirroring `run-stream.ts`'s own `handleRunStreamRequest`
pattern) taking an already-resolved `runId`/`afterCursor` plus a raw `ServerResponse`; a new
`sendRawApiError` (in `sse.ts`) handles the pre-SSE-open JSON error path (`unknown-run`/
`invalid-cursor`/`replay-gap`/internal-error) without going through either framework's own
response wrapper. `fastify/runs.ts`'s `registerRunEventStream` hijacks the reply
(`reply.hijack()`, the same load-bearing pattern `fastify/run-stream.ts` already established) and
calls the identical core function with `reply.raw`. Net result: `transport: 'fastify'` now serves
`runs`/`agents`/`host-tools` identically to the Express default — not a reduced set.

`create-local-node-daemon.ts`'s doc comment previously (in an earlier, abandoned draft of this
merge) described these three route packs as staying Express-only "since building real Fastify
parity is a separate task" — that framing was **wrong per the standing rule** and was corrected
before landing; the doc comment now on that file describes the real, full-parity state.

### Verification, personally run this session

`pnpm --dir packages/http exec tsc --noEmit`: clean. `pnpm --dir packages/http run test:coverage`:
**875/875 tests pass**. Coverage: **100% statements/functions/lines** across every file in
`src/`, `src/express/`, and `src/fastify/`; branches **99.39%** overall — the two sub-100% files
(`runs.ts` at 98.88%, one pre-existing branch at line 69 unrelated to this merge; `terminals.ts` at
93.45%, pre-existing, already documented above) are both untouched by this pass. `src/fastify/`
subtree itself: **100% on all four metrics**, every file, including the three new route-pack
mounting files. Root `pnpm typecheck` and `pnpm guard`: clean.

### Merge note (2026-07-22, later the same day): four more audit-fix sections below merged in from a second, parallel cloud session

The sections immediately below (`delegated-tools.ts` barrel export, `media.ts`, and the
`runs.ts`/`terminals.ts` coverage pass) were written on a branch (`fix/audit-6-fixes-20260722`) that
forked from `main` *before* the Fastify-transport-split merge above landed, so they were authored
against the pre-split flat-file layout. They merged in cleanly with no logical conflict — the
route-pack files they touch (`delegated-tools.ts`, `runs.ts`, `terminals.ts`) are exactly the ones
this merge's "Corrected layout" section above kept flat at the package root, not moved into
`express/`, so every path/import reference below is still accurate post-merge. `media.ts` (new in
that branch) is likewise flat at the root and barrel-exported the same way. None of these four
sections needed any correction for the Fastify split; see `node-host/source-map.md`'s own merge note
for the one piece that did (the six route packs `media.ts` joins are wired Express-only for now,
deliberately, per this repo's owner's explicit instruction to table Fastify parity for the newly
merged route packs — tracked as follow-up work, not silently dropped).

## 2026-07-22 addition — export `delegated-tools.ts` from the package barrel (audit fix)

**Gap found by independent audit**: `registerDelegatedToolRoutes` (and its supporting types —
`DelegatedToolExecuteRequest`, `DelegatedToolExecuteResponse`, `DelegatedToolsHttpDeps`,
`DelegatedToolsInternalErrorContext`, `delegatedToolExecuteRoute`) were implemented and tested
(see the entry immediately above — 100/100/100/100) but never re-exported from `src/index.ts`.
Every other route pack in this package (`memory.ts`, `routines.ts`, `terminals.ts`, `db-ops.ts`,
`model-proxy.ts`, `agents.ts`, ...) is barrel-exported; this one was not, so no real host importing
only `@jini/http`'s public surface could reach the MCP-callback bridge — the primary continuation
path for the ~12 of 24 agent defs that round-trip tool calls through an MCP subprocess rather than
a native tool-call transport. Fixed by adding the same `export type {...} from './delegated-tools.js'`
/ `export {...} from './delegated-tools.js'` pair every other route pack already has, placed after
`model-proxy.ts`'s block. No behavior change to the route itself — it was already correct and
tested, just unreachable from outside the package.

## 2026-07-22 addition — `media.ts`: a real HTTP caller for `@jini/media`'s dispatch engine (audit fix)

**Gap found by independent audit**: `@jini/media`'s `createMediaDispatchEngine`/
`createSqliteMediaTaskStore` were real and 100%-tested but had zero callers anywhere outside their
own package. This package gained `@jini/media` as a new dependency and a new route pack —
`src/media.ts` — to give them one, following the exact route-pack conventions `memory.ts`/
`routines.ts` already established (`defineJsonRoute`/`mountJsonRoute`, a `RouteInputContext` parser
per route, `registerMediaRoutes` mounting all of them).

**Routes**: `POST /api/media/generate` (`requireSameOrigin: true`, `202`), `GET
/api/media/tasks/:id`, `GET /api/media/tasks?ownerRef=...`, `DELETE /api/media/tasks/:id`
(`requireSameOrigin: true`). See `media.ts`'s own module doc for the full "request-now, poll-later"
design and the where-do-bytes-land decision (a base64 `data:` URL stored on `MediaTask.file`, no new
persistence port invented).

**SEC-005 redaction, matching `delegated-tools.ts`'s established pattern exactly**: a raw error from
`MediaDispatchEngine.generate()` (which can carry vendor-SDK/network internals, API keys in a
response body, ...) never reaches an HTTP caller verbatim. Two redaction sites: `POST
/api/media/generate` itself (a `taskStore.create()` failure, source `media-generate-validate`) and
the background generation failure path (source `media-generate-dispatch`, recorded onto the task's
own `error` field with the same redacted `{message, code}` shape a caller would see from the sync
path). Both call the same injectable `onInternalError` sink (default `console.error`), correlation-
id-bearing, exactly like `delegated-tools.ts`'s `reportInternalError`.

**Verified, personally, this session**: `pnpm --dir packages/http exec tsc --noEmit`: clean.
`pnpm --dir packages/http run test:coverage` — **748/748 tests pass** (49 new in `media.test.ts`),
`media.ts` **100/100/100/100**. Package-wide: 100/99.35/100/100 (the two pre-existing, unrelated
gaps — `runs.ts:68` and `terminals.ts`'s five lines — are addressed separately; see this task's own
coverage pass).

## 2026-07-22 addition — genuine 100% branch coverage: runs.ts + terminals.ts (audit fix, coverage pass)

**`runs.ts:68`** (`RunInternalErrorContext.runId?`'s ternary spread): both real call sites
(`run-start` after a durably-created run's id is already known; `run-stream` against an
already-parsed path parameter) always had a `runId` in hand — the `?`/ternary was speculative
flexibility no caller ever exercised. Real refactor, not a padded test: `runId` is now a required
field/parameter throughout `RunInternalErrorContext`/`reportInternalError`, removing the dead
branch entirely instead of forcing a fake call site to reach it.

**`terminals.ts`** (93.45% → 100% branch): five real gaps, each closed with a real refactor or test,
none padded:
- Lines 165-167 (`terminalCreateRoute.handle`'s `cols`/`rows`/`shell` optional-field spreads into
  `toolInput`): the existing tests only exercised `.parse()` threading these fields, never
  `.handle()` itself with them set. New test calls `.handle()` directly with all three populated.
- Line 209 (`actionResultToApiResult`'s `result.session ? ... : {}`): the `null`-session side is a
  real race (`write`/`resize`/`kill` finding metadata for an id whose session was concurrently
  killed — see `@jini/daemon`'s `terminal-session.ts` `currentSnapshot`), not a hypothetical.
  `actionResultToApiResult` is now exported (matching this same file's `createDeferredEndGate`
  precedent) and directly unit-tested against a synthetic `{status:'ok', session: null}` result
  rather than forcing the real race through a full `TerminalSessionManager`.
- Line 215 (`parseStdinInput`'s `!isRecord` guard): no test ever supplied a non-object body: new
  `terminalStdinRoute.parse({body: 'not-an-object', ...})` test.
- Lines 237-238 (`parseResizeInput`'s `!parsedId.ok`/`!isRecord` guards): same gap, new tests for a
  missing `id` param and a non-object body.

**Verified, personally, this session**: `pnpm --dir packages/http exec tsc --noEmit`: clean.
`pnpm --dir packages/http run test:coverage` — **755/755 tests pass** (8 new), **genuine
100/100/100/100 across every file in this package** — not a single uncovered line/branch anywhere.
`vitest.config.ts`'s committed threshold raised from 98/98/98/98 to 100/100/100/100 to lock this in
(a regression now fails CI instead of silently sliding under a safety margin). Root `pnpm -r run
build`: clean. Root `pnpm guard`: clean.

## 2026-07-22 addition — Fastify transport removed, parked on `future/fastify-transport`

The switchable `express`/`fastify` transport documented in the two sections above ("2026-07-19 —
Fastify transport split" and "2026-07-22 — Merging the Fastify transport split into `main`") was
removed the same day it was fully merged. Reason: nothing in this repo, `examples/minimal-host`, or
any known downstream consumer ever set `transport: 'fastify'` — the Fastify subtree was fully built
and 100%-tested but had zero real consumers, and its presence had a real, ongoing cost: every new
route pack added to this package (six landed the same day — `memory`/`terminals`/`model-proxy`/
`active-context`/`db-ops`/`media`, see the two entries below this one) implicitly raised "does this
also need a Fastify mounting sibling, or do we explicitly defer it" (AUD-004 in
`ADS-memory/reports/audit-fastify-merge-and-six-gap-fixes-2026-07-22.md`), a recurring parity tax
for an option nobody used.

**What was removed:** `src/fastify/` (the entire Fastify-native subtree — route-registration guard,
security middleware, daemon-status routes, and mounting siblings for `runs`/`agents`/`host-tools`),
`src/express-index.ts` (the thin `express` namespace barrel built to mirror `fastify/index.ts`
symmetrically), and the `export * as express`/`export * as fastify` namespace exports from this
file's own barrel. `src/express/run-stream.ts` (the one file that subdirectory ever held) was merged
back into the shared, flat `run-stream.ts` as `registerRunStreamRoute`, now barrel-exported flat
like every other route pack's registrar — there is no longer an `express/` subdirectory at all.

**What's now flat that wasn't before:** `installRouteRegistrationGuard`/`getRouteRegistrationInventory`/
`guardedRouteKey` (previously only reachable via the `express`/`fastify` namespaces, needed directly
by `@jini/node-host` now that there's only one transport) and `registerRunStreamRoute` (previously
only reachable via `express.registerRunStreamRoute`).

**Preserved, not deleted:** the full removed implementation lives unchanged on the
`future/fastify-transport` branch — see `FASTIFY-TRANSPORT-PARKED.md` at that branch's repo root for
the reasoning and exactly how to revive it (which route packs still lack a Fastify sibling, and
which of those already sit on the shared, transport-agnostic `createSseChannel` primitive vs. still
need the retype-to-raw-`ServerResponse` treatment `runs.ts` got).

**Verified, personally, this session**: `pnpm --dir packages/http run build`/`exec tsc --noEmit`:
clean. `pnpm --dir packages/http run test:coverage`: **773/773 tests pass** (down from 937 — the
deleted `fastify/__tests__/*` and `express/__tests__/run-stream.test.ts` accounted for the
difference, one test merged into `src/__tests__/run-stream.test.ts`), genuine **100/100/100/100
across every remaining file**. Root `pnpm guard`: clean. Every other package's own `tsc --noEmit`
re-run individually clean (root `pnpm -r run build`/`pnpm typecheck` are currently blocked by an
unrelated, pre-existing, uncommitted `packages/ui` state from a different concurrent session — not
touched or caused by this change).

## 2026-07-22 addition — model-proxy's 3 new providers + catch-all, `health.ts`, `connectors.ts`, `research.ts`

Closes the item `model-proxy.ts`'s own 2026-07-21 dated entry flagged as deferred (Azure/Google/
Ollama proxy routes), and adds three new route packs.

**`model-proxy.ts`**: three more fixed-path routes (`POST /api/proxy/{azure,google,ollama}/stream`),
each following the identical `registerProxyStreamRoute` shape the existing anthropic/openai routes
already use, wired against `@jini/agent-runtime`'s new `run{Azure,Google,Ollama}ToolTurn` (see that
package's own 2026-07-22 dated source-map.md section). Plus a new generic `POST
/api/proxy/:provider/stream` catch-all, dispatching through a `provider -> {parse, run}` registry —
see the module's own doc for why the registry's entries for the five known providers are real,
tested code but only reachable via actual HTTP traffic for a provider name that has no dedicated
fixed route (Express matches the literal-path routes, registered first, before the `:provider`
param route). `ModelProxyInternalErrorContext['provider']` widened to the five-provider union.
OpenRouter evaluated as part of this pass's OD route-parity audit and deliberately still not
built — flagged as open/deferred (pending further discussion on gateway-vs-native-provider
placement), not rejected.

**`health.ts`** (new file): `GET /health`, `/api/health` (plain liveness), `GET /ready`, `/api/ready`
(real readiness via an injected `checkReadiness`, defaulting to always-ready), `GET /version`,
`/api/version`. Finally gives `api-security-middleware.ts`'s `OPEN_PROBE_PATHS` set (which already
named exactly these six paths as always-open, with no routes to serve them) real routes.
`daemon-status.ts#daemonStatusRoute`'s doc comment updated to stop calling `/api/daemon/status` "a
health-check" — it's operator detail now, `health.ts` is the real liveness/readiness contract. Added
`SERVICE_UNAVAILABLE`/`NOT_CONFIGURED` (both 503) to `response.ts`'s `ERROR_STATUS_BY_CODE` map to
support this and `connectors.ts` below.

**`connectors.ts`** (new file) — **the event that gives `@jini/capability-providers` its first real
wiring-level consumer.** That package's own `source-map.md` names "composition happens at the
binding site, not in this package" as the reason it ships no registry/discovery module of its own
(see its "Design decisions" section); this route pack *is* that binding site, for the HTTP
transport. One JSON route per method across `AuthProvider`/`StorageProvider`/`PaymentsProvider`/
`DbProvider`/`RealtimeProvider` (17 routes; `RealtimeProvider.subscribe` has no route — inherently a
streaming/websocket concern, out of scope for a request/response pack). Every route checks its one
required capability slot is configured before doing anything else (`503 NOT_CONFIGURED` otherwise —
all five slots are independently optional, and `@jini/node-host`'s zero-config default leaves every
one unconfigured); every real provider call is wrapped so a raw Stripe/SQL/JWT/WebSocket error never
reaches the caller (SEC-005, matching `media.ts`/`delegated-tools.ts`'s `reportInternalError`
precedent). `@jini/capability-providers` added to `package.json` as a `dependencies` entry (matching
`@jini/media`'s existing precedent of a workspace package used only via `import type`).

**The boundary-checker nuance, stated precisely (not the shorthand "type-only imports are exempt"
version)**: `@jini/http` is locked, `@jini/capability-providers` is `"incubating"` in `UNLOCKED.md`
(not `"stable"`). `scripts/check-engine-boundaries.ts`'s R7 rule is *written* to flag any
`@jini/<pkg>` import specifier — including `import type` — from a locked package into a non-stable
unlocked one; only R6 (a different rule, about `@jini/core/internal`) special-cases `typeOnly`.
Empirically, `npx tsx scripts/check-engine-boundaries.ts` exits 0 for `connectors.ts` anyway — traced
why: `UNLOCKED.md`'s manifest keys are the scoped name (`"@jini/capability-providers"`), but R7's
lookup uses the *unscoped* `targetPackage` (`'capability-providers'`); `'capability-providers' in
unlocked` is `false` for every single entry in the manifest, so R7 currently never fires for *any*
package regardless of typeOnly status. `@jini/node-host`'s `create-local-node-daemon.ts` already
relies on this same open gate for a **genuine runtime** (non-type) import of `@jini/media`
(`createMediaDispatchEngine`/`createSqliteMediaTaskStore`) and `@jini/memory` — both already merged,
both real precedent. Not fixed here (out of scope for this task); flagged in `connectors.ts`'s own
module doc too, so a future maintainer who does fix the manifest-key mismatch knows to re-audit
these import sites rather than being surprised when R7 starts firing on previously-invisible
violations.

**`research.ts`** (new file): `POST /api/research/search`, a Tavily Search API wrapper ported from
OD's real `apps/daemon/src/research/tavily.ts` (read directly in the sibling
`/Users/la/Desktop/Programming/OSS-Repos/open-design` checkout — request/response shape and
defaults only; OD's own `TavilyError` class, abort-based timeout, and `dispatcher` passthrough were
not carried over, this route pack's own SEC-005 convention replaces the thrown-error shape).
`ResearchSource`/`ResearchSearchResponse` field names match OD's real `@open-design/contracts/api/
research.ts` `ResearchSource` contract. Defaults credential resolution to `@jini/media`'s
`resolveProviderCredentialsFromEnv('tavily')` — a genuine runtime import, safe because `@jini/media`
is already a real (non-type) dependency of this package (`media.ts` already lists it). Missing
credentials is a clean `503 NOT_CONFIGURED`, never routed through the SEC-005 sink (no real
exception/secret to hide, just an honest "not set up" answer); every other failure is caught,
reported via `onInternalError`, and redacted (`redactSecrets`, reused from `@jini/agent-runtime`'s
`connection-guard.ts` — already reachable through this package's existing `@jini/agent-runtime`
dependency) before it can reach the HTTP caller.

**`@jini/node-host`'s wiring** (`create-local-node-daemon.ts`): `registerHealthRoutes` is mounted
first — before `installRouteRegistrationGuard`'s route-tracking is followed by `express.json()`/the
bearer-auth/origin-guard middleware — with a real `checkReadiness` built from
`verifySqliteIntegrity({db: dbOpsConnection, quick: true})` (reusing the same raw `better-sqlite3`
handle `daemonDbRoutesDeps` already operates through, not a third connection) plus `!shuttingDown`.
`registerConnectorsRoutes(app, {}, ...)` and `registerResearchRoutes(app, {}, ...)` both use the
zero-config-default pattern (`registerModelProxyRoutes(app, {}, ...)`'s own established precedent in
this same file) — all five connectors capability slots stay unconfigured, and research's credential
resolver falls back to env-var lookup. `create-local-node-daemon.ts` itself imports nothing new from
`@jini/media` for `research.ts`'s sake — that file's own default resolver lives inside
`packages/http/src/research.ts`; this preset already depends on `@jini/media` for `mediaRoutesDeps`,
so wiring research in adds no new boundary surface either way (verified empirically, not assumed, by
re-running `npx tsx scripts/check-engine-boundaries.ts` after the change).

**Verified this session**: `pnpm --dir packages/http exec tsc --noEmit` / `run build` — clean.
`pnpm --dir packages/node-host exec tsc --noEmit` / `run build` — clean. Repo-root `npx tsx
scripts/check-engine-boundaries.ts` and `npx tsx scripts/guard.ts` — both clean, re-run after every
sub-step of this addition. Test files for `health.ts`/`connectors.ts`/`research.ts` follow this
package's existing `makeApp`/`makeRes`/direct-`.parse()`/`.handle()` unit-test convention (see
`daemon-status.test.ts`/`media.test.ts`) and `research.test.ts` additionally mirrors
`model-proxy.test.ts`'s `vi.stubGlobal('fetch', ...)` convention — not executed under this session's
standing test-runner restriction, verified via `tsc --noEmit` instead (real imports, no `any`-typed
escape hatches).

## 2026-07-22 addition — `xai.ts` (`POST/GET /api/xai/oauth/*`, `/api/xai/auth/status`, `POST /api/xai/search`)

Deliberately scoped **out** of the `health.ts`/`connectors.ts`/`research.ts` route-parity pass
documented immediately above, pending a product decision on whether to build xAI OAuth support at
all (xAI's real shape — a PKCE OAuth connect flow plus a gated search call — is not a chat-turn-
runner like azure/google/ollama, so it didn't fit that pass's proxy-provider shape). Approved after
that pass landed; this is that build. Ported from OD's real `apps/daemon/src/routes/xai.ts` (422
lines — read directly in the sibling `/Users/la/Desktop/Programming/OSS-Repos/open-design` checkout,
matching this repo's "verify against the real source, don't guess" convention) plus its three
integration siblings, `integrations/xai-oauth.ts`, `xai-oauth-server.ts`, and `xai-tokens.ts` — see
the routes-classification table above, row **#27 `xai.ts` (MIXED, OD-leaning)**: "the OAuth start/
complete/status/cancel/disconnect shape is a recognizable generic pattern, but this file is fused to
a transitional xAI PoC arrangement."

**Reused `@jini/agent-runtime`'s existing generic OAuth+PKCE machinery — did not build a second
OAuth stack.** Before writing anything, checked `packages/agent-runtime/src/providers/{pkce,oauth-
provider,oauth-callback-server,oauth-tokens,oauth-credentials}.ts` per this task's own explicit
instruction, and confirmed (via that package's own `source-map.md`, "providers/ — LLM-provider
integrations", 2026-07-18) that these five files are **already a direct, generalized port of this
exact origin's OAuth siblings** — `integrations/xai-oauth.ts` → `oauth-provider.ts`
(`beginOAuthPkce`/`completeOAuthPkce`/`refreshOAuthPkceToken`, config-driven via
`OAuthPkceProviderConfig`, with `XAI_OAUTH_PROVIDER_CONFIG` kept as the concrete xAI preset the
origin shipped), `integrations/xai-oauth-server.ts` → `oauth-callback-server.ts`
(`startOAuthCallbackListener`, de-branded, `host`/`port`/`path` already caller-supplied instead of
xAI-hardcoded constants — meaning the fixed-loopback-port quirk needed **no new listener-mechanics
code**, only a caller-supplied default), `integrations/xai-tokens.ts` → `oauth-tokens.ts`
(`getStoredOAuthToken`/`setStoredOAuthToken`/`clearStoredOAuthToken`, filename now a parameter),
`integrations/xai-credentials.ts` → `oauth-credentials.ts` (`resolveOAuthBearer`, refresh-on-read).
That prior port had zero HTTP route consumers anywhere in the repo — `xai.ts` is the first one. So
this task built **only** the pieces that machinery had no opinion on: xAI's concrete `providerConfig`/
callback host-port-path *defaults* (all overridable via `XaiHttpDeps`, defaulting to
`@jini/agent-runtime`'s real `XAI_OAUTH_PROVIDER_CONFIG`/`XAI_OAUTH_REDIRECT_HOST`/`_PORT`/`_PATH`),
the HTTP wire shapes (`RouteInputContext` parsing, `Result`/`ApiError` responses,
`requireSameOrigin` — reusing this package's own `defineJsonRoute`/`mountJsonRoute`/`guardSameOrigin`
exactly like every other route pack, rather than OD's origin manual `isLocalSameOrigin` checks), and
the `x_search` Responses-API call itself (`callXaiSearch`, `extractAnswerText`, `extractUrlCitations`
— genuinely xAI-specific, no existing home in `@jini/agent-runtime`).

**Dropped: OD's "SuperGrok subscription" gate.** The origin's `POST /api/xai/search` resolved
credentials through OD's own multi-source cascade (`resolveProviderConfig(..., 'grok')`: OD-native
OAuth token → a separate "Hermes" tool's `auth.json` → `OD_GROK_API_KEY` env var → `XAI_API_KEY` env
var) and returned a 401 with product-specific copy ("sign in with your SuperGrok subscription...")
when nothing resolved. Both are OD product/billing decisions the neutral engine has no business
modeling. The port checks only "is an xAI OAuth account connected" (via `resolveOAuthBearer` against
this file's own token store) and answers a clean `NOT_CONFIGURED` (503) when it isn't; if a connected
account isn't actually entitled to `x_search`, xAI's own `/responses` endpoint returns its own real
error, surfaced through the same SEC-005 `INTERNAL_ERROR` path as any other upstream failure — no
hardcoded pre-flight entitlement check sits on top of xAI's own answer.

**Wire shape changed from OD's snake_case request body to this package's established camelCase
convention** (`allowedXHandles`/`excludedXHandles`/`fromDate`/`toDate`/`enableImageUnderstanding`/
`enableVideoUnderstanding`, matching `media.ts`/`connectors.ts`'s camelCase JSON surfaces) —
converted to xAI's real snake_case (`allowed_x_handles`, ...) only when building the actual upstream
`x_search` tool payload, the same split `research.ts` already applies to Tavily's
`search_depth`/`max_results`.

**State-sharing design, not a straight per-request default.** Unlike `research.ts`'s
`resolveCredentials` (stateless — a fresh default is harmless every call) or `connectors.ts`'s
per-capability `deps.auth`/`deps.storage` (genuinely optional forever, never defaulted), this route
pack's `pending` (`PendingAuthCache`) and `listenerRef` (the in-flight loopback-listener slot) are
mutable state that must be the *same instance* across `oauth/start` → `oauth/complete`/`oauth/
cancel`/`oauth/disconnect` for the dance to work — a fresh `PendingAuthCache` minted independently
per request would mean `start` and `complete` never see each other's state. `registerXaiRoutes`
resolves every optional `XaiHttpDeps` default exactly once and hands that single resolved object to
every mounted route, so a zero-config `registerXaiRoutes(app, {}, adapter)` call still shares one
cache/listener-slot across the whole mounted lifetime. Each individual route's own `handle` also
re-resolves defaults at its own top (an idempotent pass-through once `registerXaiRoutes` has already
resolved them) purely so each route stays directly unit-testable in isolation, matching every other
route pack's test convention in this package.

**SEC-005**: every thrown error converts to a redacted, correlation-id-bearing generic
`INTERNAL_ERROR` before it ever reaches the HTTP caller. For the two paths that touch an untrusted
upstream response body — token exchange/refresh and `callXaiSearch` (which sends this file's own
just-issued bearer token as a header, the highest-risk path) — `redactSecrets` (reused from
`@jini/agent-runtime`'s `connection-guard.ts`, already this package's `research.ts` precedent)
additionally strips it out of the message before it is even logged to the host's own sink. One
mid-review fix: the module doc originally claimed this redaction applied to *every* thrown-error
path; the first test pass caught that `handleListenerCallback`'s and `xaiOauthCompleteRoute`'s own
token-exchange catch blocks were logging the raw (unredacted) error to the sink, contradicting that
claim — fixed by adding a small `redactError` helper applied at both those catch sites, and the
module doc was rewritten to state precisely which paths get redaction (the two that touch upstream
text) versus which don't need it (purely local `fs`/listener-bind failures carry no upstream text to
redact in the first place). `completeOAuthPkce`'s own pre-network "state not found or expired"/"state
mismatch" validation errors are the one deliberate non-redacted exception — surfaced verbatim as
`BAD_REQUEST`, since they carry no secret and are a legitimate client-correctable failure, not an
internal one.

**`@jini/node-host`'s wiring** (`create-local-node-daemon.ts`): `registerXaiRoutes(app, { dataDir:
config.dataDir }, { resolvedPortRef })`, alongside the `connectors`/`research` zero-config calls —
`dataDir` is the one default worth overriding at this call site (this preset already has a real,
trusted `dataDir` for `events.db`/`journal.db`/etc.); every other `XaiHttpDeps` field keeps its own
built-in default. No OAuth account is connected until a caller completes the `/api/xai/oauth/*`
dance — `/api/xai/search` answers a clean 503 `NOT_CONFIGURED` until then, the same zero-config-safe
shape every other route pack added this session already established.

**Verified**: `pnpm --dir packages/http exec tsc --noEmit` / `run build` — clean. `pnpm --dir
packages/node-host exec tsc --noEmit` — clean (after rebuilding `@jini/http`'s `dist`, which
`node-host` resolves against). Repo-root `npx tsx scripts/check-engine-boundaries.ts`, `npx tsx
scripts/guard.ts`, and `npx tsx scripts/check-protocol-purity.ts` — all clean. `src/__tests__/
xai.test.ts` — direct `.parse()`/`.handle()` unit tests plus `registerXaiRoutes` mount tests,
matching `research.test.ts`/`connectors.test.ts`'s conventions: real temporary-directory filesystem
I/O for token storage (mirroring `@jini/agent-runtime`'s own `oauth-tokens.test.ts`/
`oauth-credentials.test.ts` `mkdtemp`/`rm` convention) and a real `PendingAuthCache`/`beginOAuthPkce`
for PKCE state — only the loopback listener (`startCallbackListener`) and `fetchImpl` are injected as
mocks, so the suite proves this route pack's own parsing/wiring/SEC-005 behavior without re-testing
socket mechanics `oauth-callback-server.test.ts` already covers independently. Not executed under
this session's standing test-runner restriction (verified via `tsc --noEmit` instead, matching this
file's own established precedent for every route pack added this session).

## 2026-07-23 — package-admission dependency inversion

`pnpm guard`'s R7 manifest lookup was repaired and exposed three previously-hidden locked→
incubating edges from this package (`@jini/agui`, `@jini/media`, and
`@jini/capability-providers`). The HTTP layer now owns the narrow structural ports its connector
and media routes consume; concrete provider/media implementations satisfy those ports at a product
composition root. Research credential resolution owns a narrow `TAVILY_API_KEY` default instead
of importing the media package. The SSE run-stream accepts a `RunStreamEncoder`, so AG-UI is one
composition choice rather than a downward HTTP dependency.

Fable's independent stabilization review then found four transport/guard defects. Media task-store
read/delete/list failures are now all redacted through a dedicated `media-task-store` diagnostic
source instead of falling through Express with raw SQLite/driver messages. Run-stream encoding and
replay failures are contained, reported through an optional host sink, and close the SSE response;
a client disconnect during durable replay now unsubscribes as soon as the delayed handle arrives.
Auth session verification moved from `GET ?token=` to same-origin `POST` JSON so credentials do not
land in URLs. The shared guard walker now scans `.tsx` as well as `.ts`, with a TSX-only known-bad
self-test fixture.

Verified: `pnpm guard`; `pnpm --filter @jini/http build`; `pnpm --filter @jini/http typecheck`;
`pnpm --filter @jini/http test` (**907/907**).

## 2026-07-29 addition — `requireStrictBearerToken`, shared bearer primitives, and `route-manifest.ts`

**Nothing was ported.** Two additions generalized from a real consumer (Tovu), plus one consolidation.

### `requireStrictBearerToken` (`api-security-middleware.ts`)

`registerApiBearerAuthMiddleware` lets **any loopback peer through unauthenticated** before it reads the
`Authorization` header. That is the right affordance for a desktop UI or local CLI reaching its own
daemon, and a complete no-op for a daemon whose threat model is a *co-resident process*: a `127.0.0.1`
bind excludes remote hosts and says nothing about a sibling process running as the same user. A consumer
spawning a Jini daemon that can start agent runs and execute tools against a real database had to write
its own middleware to close that, and did.

The new factory is that middleware, generalized: fail-closed **503** when the named env var is unset
(never a silent pass-through), **401** on missing/malformed/mismatched, **no** peer-address exemption,
**no** disable flag, and an exact-match-only `exemptPaths` defaulting to empty.

**This is not a new opinion for Jini.** `remote-run-events.ts`'s own gate already made the identical
call for the identical reason on a single route — see its module doc: *"a loopback bind is exactly the
shape a same-machine but lower-trust process would also present"*. This generalizes that posture from
one route to a whole `/api` surface.

`tokenEnvVar` is **required with no default**, matching `McpJsonInjectionOptions`'s "host-resolved, not
this package's to know" posture. This package does not name a host's secret.

### Consolidation: shared `bearerTokenFromHeader` + `timingSafeTokenMatch`

Both pre-existing gates parsed the bearer header with their own copy of the same regex and compared
tokens with `!==`. A plain string compare short-circuits on the first differing byte, making duration a
function of how many leading bytes were correct — recoverable over many requests. Both now route through
one exported header parser and one `timingSafeEqual`-backed comparison.

`requireRemoteToolBridgeToken` was **not** folded into the new factory despite the identical posture: its
two routes own distinct `REMOTE_TOOL_BRIDGE_*` error codes so an operator can tell *which* secret is
missing from the response alone. Only the decision logic is shared, not the response shape — the
existing suite passes unmodified, which is the evidence that consolidation changed no behavior.

### `route-manifest.ts`

Published `{method, path}` inventory per feature family, as data readable without mounting. A host
proxying a daemon in another process had no way to ask for the route list and copied path strings by
hand; one real consumer's proxy consequently shipped without `GET /api/runs`, leaving that endpoint
404-ing at the host's own router with nothing to indicate the host was the cause.

The design constraint that makes it trustworthy: **it declares no method or path literals.** Every entry
references the same `JsonRouteSpec` constant the family's registrar mounts, so a spec's path change moves
the manifest automatically. The paired test mounts each declared family's real registrar onto a recording
app and asserts equality, closing the one remaining gap (a family gaining a route nobody lists).

That test found a real discrepancy on its first run: the `runs` family mounts **two** spec-less streaming
routes — `RUN_EVENTS_ROUTE_PATH` (`/api/runs/:runId/events`, mounted by `registerRunRoutes` itself) and
`RUN_STREAM_ROUTE_PATH` (`/api/runs/:runId/agui-stream`, mounted separately by `registerRunStreamRoute`).
They are easy to mistake for one another and a proxy needs both. The former was a bare literal at its
registration site until this pass; it is now an exported constant for the same
reference-don't-restate reason.

Scope is deliberately partial — the families a sidecar consumer proxies, not all 19. `routeFamilyManifest`
returns `undefined` rather than `[]` for an undeclared family so a proxy can never mistake "undocumented"
for "has no routes".

**Verified, personally, this session**: `pnpm --filter @jini-ai/http-kit run typecheck` clean; the
package's full suite **1002/1002 passing** (36 files), including 17 new strict-gate tests and 14 new
manifest tests. The pre-existing `remote-run-events` and `api-security-middleware` suites pass
**unmodified**.
