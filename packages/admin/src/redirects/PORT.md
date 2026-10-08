# Redirects admin port — C3 Part A, 2026-10-07

Programmer(Execution): behavior-preserving admin extraction; the approved C0/C3 module and adapter pattern governs this implementation.

## Inputs and governing decisions

C0-admin-common.md SHA256 `6c1b41d519cccf41fc687d9f3c744b208bdbde7200f697d551bdfdec025b0efe`;
C3-redirects-admin.md SHA256 `4d697a99129f371bba9ef984fdbd9a05c7591668feab90a00f39304f9b360403`.
CMS-JINI-MODULAR-DESIGN.md Rev 3 decision 1, section 4 C3; the coordinator's Part-A-only dispatch,
including landed native dialogs/tab-strip source, is authoritative. C0 explicitly selects the existing
media and agent-plugins examples as the approved seed patterns; no new architectural choice is introduced.
Tovu architecture sections 13/14 remain constraints, not claims about deployed capabilities.

The binding API owner is `../core/ports/redirects.ts` (`AdminRedirectsPort`).
**New core operations: none.** Import and hit counts are already represented. There is no parallel
production redirects API interface. Records, create/update inputs, open vocabularies, closed status
codes, hit statistics and import outcomes all reuse that core file.

`matchType: "regex"` stays in the core union and is never dropped, rewritten or hidden from imported
JSON. The reference host rejects it at its write boundary; the UI therefore offers only exact,
prefix and wildcard, just as the source does. A type accepting regex does not establish host support.
`source: auto_slug_change` is read-only provenance. Tombstone is a soft delete under the core contract.

## Source mapping and lifecycle ownership

| Tovu source | Surviving Jini owner |
|---|---|
| rules.ts | rules.ts; translator is injected and boundaries take two objects |
| hooks/redirects-port.hooks.ts | existing core/ports/redirects.ts, exposed by ports.ts token |
| hooks/redirects-dependencies.hooks.ts + lib/api redirects calls | adapters/http.ts; adapters/memory.ts for isolated presentation fixtures |
| hooks/use-redirects.hooks.ts | controllers/redirects.controller.ts + react/hooks/use-redirects.hooks.ts |
| hooks/use-import-redirects-form.hooks.ts | controllers/import-redirects.controller.ts + react/hooks/use-import-redirects-form.hooks.ts |
| hooks/use-hit-count-cell.hooks.ts | controllers/hit-count.controller.ts + react/hooks/use-hit-count-cell.hooks.ts |
| Redirects.tsx | react/pages/RedirectsPage.tsx, react/components/{HitCountCell,ImportRedirectsForm}.tsx |
| table projections and host wiring | react/hooks/{RedirectsPage,wired,RedirectsOptions,RedirectsPorts}.hooks.ts |

Fetch-query remains the owner of cache entries, request/mutation status, independent write errors,
prefix invalidation and query subscriptions. Controllers reuse core's createControllerStore/useController
for confirmation, raw import text/parse outcome/result and the lazy-hit requested gate. Hooks bind effects;
TSX renders. No copied fetch-query lifecycle exists. Controller effects create/dispose instances, including
StrictMode replay. Mount-local state survives translator/id/port changes, matching the original useState.

Preserved invariants: only first load blocks the page; background refresh keeps the table; each successful
write/import invalidates the redirects prefix (including mounted hit counts); newest write resets siblings'
errors; write error precedes list error and a pending write suppresses stale list failures; saving guards
row actions; delete closes on success/failure with catch before finally; form input resets only after a
successful create; hit counts require a gesture and zero remains visible; import checks JSON plus array only,
keeps per-item 207 outcomes, and clears prior results/parse/request errors in the original order.
SOURCE-RATIONALE.md retains every original screen/hook/port rationale verbatim as historical provenance.

## Host swap and localization contract

Call `redirects({}, { t, locale, headerActions, slots: { renderMessage } })`. Bind `redirectsApi` to
`createHttpRedirectsApi({ transport, basePath: workspacePath + '/redirects' }, {})` and optionally
`redirectsEvents` to `{ subscribe(listener): unsubscribe }`. The host filters its refresh notifications
for the `redirects` resource before calling the listener. No rows cross the refresh port.

The transport is the existing media-style `{ request, url }` pair; it owns auth, workspace addressing,
JSON serialization, retry policy and error decoding. Map host-specific API errors to core AdminApiError
where necessary to retain its empty-message fallback; do not rewrite nonempty messages. The adapter
preserves wire response objects, unwrapping only the existing `{ data }` envelope. Extra host wire fields
such as workspaceId remain untouched at runtime and are unnecessary to the universal core contract.

`t(key, vars)` binds the existing redirects dictionary/common copy to the host locale. The following
existing helper messages also need bridging, since their tables are private to the Tovu dictionary:

| Key requested by Jini | Existing Tovu helper |
|---|---|
| `{created} created, {failed} failed.` (`vars.created`, `vars.failed`) | importResultSummary(locale, created, failed) |
| `Created` | createdLabel(locale) |
| `Item {index} ({code})` (`vars.index`, `vars.code`) | failedItemLabel(locale, index, code) |
| `Actions for redirect rule from "{fromPattern}"` | actionsForRedirectLabel(locale, vars.fromPattern) |
| raw server status, with `vars.serverLabel` equal to that value | components/status-labels.serverLabel(value, locale) |

The serverLabel marker distinguishes protocol-value localization from action-copy translation. The host
must call its existing shared serverLabel for that marker, retaining known enum translations and raw
unknown-value passthrough, rather than constructing another known-enums list in this domain.

**Node keys**, supplied through `slots.renderMessage({ key, vars, shapeCode }, {})`:

- `importRulesLabel`: call the existing importRulesLabel(locale, shapeCode). Jini supplies the original
  code node containing `{matchType, fromPattern, toTarget, statusCode, override?, priority?}`. English fallback
  is the original fragment order without a wrapper.
- `deleteRedirectBody`: call deleteRedirectBody(locale, String(vars.fromPattern)). The original `<p>` wrapper
  is retained, including in the English fallback.

`headerActions` is the host's original `<PublishSectionButton section="redirects" />`, rendered inside
the original `.page-actions` wrapper. Publication behavior remains host owned. English messages, form ids,
class names, data-agent handles, ARIA labels, error fallbacks and table columns retain source spelling.
Localization never independently reads settings per row.

## Existing HTTP contract

Base is `/api/admin/v1/workspaces/<workspaceId>/redirects` supplied by the host, never hardcoded here.
Verified against the current Tovu route registrars at dispatch:

| Operation | Request | Response mapping |
|---|---|---|
| listRedirects | GET base; optional status/source/matchType query | `{ data: rows }` → rows |
| getRedirect | GET base/encodedId | `{ data: row }` → row |
| createRedirect | POST base, `{ ...input, ...options }` | `{ data: row }` → row |
| updateRedirect | PATCH base/encodedId, patch | `{ data: row }` → row |
| tombstoneRedirect | DELETE base/encodedId; no body | `{ data: row }` → row |
| getRedirectHitStats | GET base/encodedId/hits | `{ data: stats }` → stats |
| importRedirects | POST base/import, `{ rules }` | created/failed result unchanged, including 207 |

List page id is `redirects.list`, path `/redirects`, permission `admin.redirects.manage`. No tabs are added.
Server authorization, origin/target gates, pattern/schema validation, chain/loop checks, Trash indexing,
revisions, batch limits and durable hit counts stay server owned. The memory adapter is an isolated
presentation backend, not the CMS write chokepoint: no target/security/chain validators are copied. It has
immutable snapshots, all core operations, zero hits versus missing ids, retained soft deletes, partial
imports and reference regex rejection; a supplied `validate` callback owns alternate host vocabularies.

## Acceptance contract and validation handoff

Five copied suites retain **68 test cases with byte-identical non-import bodies**:
`Redirects.unit`, `use-redirects.hooks.unit`, `use-import-redirects-form.hooks.unit`,
`use-hit-count-cell.hooks.unit` in react/__tests__, and `rules.unit` in __tests__.
`redirects-i18n.unit.test.tsx` stays Tovu: its subject is the host dictionary/locale helper tables.
The one new test is __tests__/memory.conformance.test.ts, which calls the framework-free checklist.
Its referenceRegexRejection option defaults true for the reference host; hosts implementing regex set it
false, preserving the core's open-vocabulary contract instead of enforcing the reference profile globally.

Test-only harnesses bridge old positional calls/envelopes and host slots to the new owners. The source
fake's mutable `.rules`, update-without-version-bump and physical-removal behavior are preserved only
there to keep assertions intact; the shipped memory adapter follows the core's snapshot/soft-delete
contract. The publish assertion verifies host-slot placement; host publish behavior tests stay Tovu.
Network-fixture tests inject a fetch-backed host transport; production code never constructs fetch/auth.

Static evidence: 31 TS/TSX files parsed with TypeScript's syntax parser, zero syntax diagnostics;
universal runtime import traversal visited 18 source files and found no react, react-dom or node:*;
no host source imports. This is not test execution, type checking, packaging, DOM parity or browser proof.

No build/test/typecheck/install/server/commit/indexing was run, per dispatch. Coordinator must run copied
suites and conformance, pnpm guard, and packaging after M2 consumes out/c3-exports.json. Owner diff
acceptance, publication, published-typecheck and post-switch browser validation remain Part B gates.
No Tovu source, other domain, manifest, shared core, shared React component or dist file was edited.

## Reuse decisions

Reuse: redirects API; queried graph for AdminRedirectsPort and inspected core/ports/redirects.ts,
Tovu lib/api.ts and all redirects HTTP registrars; reused the existing core port, no added operations;
owner record C0 and C3 API-port clauses.

Reuse: errors; queried graph for describeApiError and inspected core/transport/errors.ts versus Tovu
lib/api.ts; reused core's formatter and typed error instead of copying the fallback; owner record core
transport file header.

Reuse: cache/request lifecycle; inspected the three source hooks and @jini-ai/ui fetch-query contract;
continued calling that package's queries/mutations/invalidation, not recreating its lifecycle; owner
record source pilot rationale and C0 reuse-before-write.

Reuse: mount-local state; inspected media and agent-plugins controller/hook bindings and core
controller-store/useController; extended that mechanism with redirects-specific confirmation/import/hit
gates; no new shared controller store; owner record C0 prescribed shape and seed examples.

Reuse: localization/publication; inspected redirects-i18n.tsx helper tables and shared serverLabel;
host t/node slots/headerActions call those existing owners; no locale tables or known-enums fork;
owner record C0 seam table and C3 node-message requirement.

Code discovery used codebase-memory CLI for core owners, then source inspection for uncommitted
freshness. Graphify/understand indexes returned no redirects-admin candidate. Sonnet sidekick is unavailable
in this host; this task was kept single-agent with no background processes.

Next assignee: Coordinator/M2 for exports and permitted validation; then owner acceptance; Part B later.

## C3 Part B live-options seam (2026-10-08)

The existing React Provider additionally accepts `options?: RedirectsReactOptions`, falling back to
the factory options. Options context is owned by that stable Provider rather than captured inside
the lazy page. Host locale/slot changes update the mounted page while retaining draft inputs and
requested hit state; no new module/API/controller owner or DOM wrapper is introduced.
Tovu's host integration injects the current locale, the existing dictionary/helper translators,
both node slots and PublishSectionButton. Host ApiError identity maps to existing core AdminApiError
with message/status/code/body retained. No new API operation or dependency. Host swap suites cover
live options, node-message ordering, partial import and lazy zero hits; execution is deferred to the
coordinator. Rebuild and publish admin before the host published-typecheck release gate.
