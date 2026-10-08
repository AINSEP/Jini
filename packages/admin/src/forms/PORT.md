# Forms admin port — C1 Part A

Programmer(Execution): Programmer + Refactor personas; implement the portable screens and preserve behavior while extracting state and host seams.

## Inputs and governing decisions

C0-admin-common.md and C1 Forms brief (owner 2026-10-07, Part A only), CMS-JINI-MODULAR-DESIGN.md Rev 3 decision 1, architecture sections 13/14, core/ports/forms.ts's binding header, and the authoritative uncommitted host feature source. Media and agent-plugins establish the approved tokens, controller-store, bindReact, HTTP transport and optional peer patterns. No new package dependency is needed.

The source's Fields/Submissions strip is still bespoke; Phase 18's broader TabBar migration did not replace this strip. Preserve this source, rather than invent a tab migration during extraction. The field-attributes dialog already uses the native Jini Dialog and remains native.

## Boundary and acceptance contract

The API token's type is the existing **AdminFormsPort**, never a parallel forms API. Additive core fields: `AdminFormField.className/attributes`, `AdminFormDefinition.mode/html`, and `AdminFormCreateInput` / `AdminFormUpdatePatch.mode/html`. No new core operation, slug update, definition delete or field removal is added. Models are mutable editor projections of the core types. A saved field's id/removal controls remain disabled; memory updates reject replacements that omit a stored field id.

Module id `forms`; page ids `list` and `editor`; routes `/forms` and `/forms/:formId`; editor tabs `fields` and `submissions`; permission `admin.forms.manage`. The host maps `/forms/:formId/submissions` to editor with the submissions tab. Preserve DOM, CSS, ARIA, agent handles, English strings, load/error/empty states, sorting, dates, payloads, and the seeded draft across route-derived tab changes. The editor must receive `formId` on its module page props and remain mounted across tab switches.

`formsTrash` is a required host seam with the generic `{ type, id }` projection for `form` / `form_submission`. It delegates removal to the existing host/CMS Trash owner; it does not implement that owner's transactional lifecycle, restoration, permissions or audit behavior. Backend `@jini-ai/cms/trash` requires actor/workspace/clock/display/expectedVersion and is unsuitable as a direct browser port. No generic admin Trash port exists in current source. This separate request projection preserves both screens' existing generic Trash POST; core submission DELETE now also means reversible Trash. This projection has one request builder shared by the form and submission views.

**Contract correction authorized by Coordinator (01:10, 2026-10-08):** keep today's behavior; submission DELETE moves to Trash. The core header/method now describe reversible removal rather than the underlying repository's hard delete. An optional submission `status` field models active/trash records (absent means active). HTTP sends the existing form-scoped DELETE with no permanent-delete callback or local 501. Memory marks and retains the original record, and active list/detail reads exclude it. Conformance rejects cross-form removal and checks active-read exclusion; the conformance test additionally asserts the exact retained payload and Trash status. Restore/purge remain owned by generic Trash. Neither screen changes its generic POST request.

Optional `formsEvents` subscribes through the media-style `{ onRefresh }` ABI. Optional navigation reuses `Pick<AdminShellNavigationPort, 'navigate'>` from core/ports/shell.ts; the brief's `AdminShellPort` name does not exist. The adapter owns route/envelope mapping only. Transport owns auth, retries, deadlines, tracing, serialization and errors. Trash classification recognizes both the core error and the existing host's error status/code fields; it preserves quiet 404 recovery and the localized version-changed message.

## HTTP wire

Supply `basePath: /workspaces/<host-id>/forms` over the host request/url transport, whose API prefix is host-owned. GET list/detail; POST create; PUT update; mode or HTML patches append `/authoring`. Submission reads use `/forms/<encoded-formId>/submissions[/<encoded-id>]`, with cursor then limit encoded via URLSearchParams. Generic Trash gets its own explicit `basePath: /workspaces/<host-id>/trash/items` and POSTs unchanged `{ type: "form" | "form_submission", id }`. Definition reads keep slug-first/id-second resolution; writes use the loaded record's actual id. There is no form-definition DELETE route.

## React host swap

Call `forms({}, { t, locale, headerActions, slots: { RecipientLabel }, clipboard })` or supply these live options through its stable React Provider, bind `formsApi`, `formsTrash`, optional `formsNavigation/formsEvents`, and mount through its React Provider. t defaults to the exact English keys in messages.en.ts; locale defaults to en. Publication actions occupy the original list header slot. RecipientLabel remains a typed host slot because the original uses the shared-components dictionary, not the Forms dictionary. Clipboard defaults to the browser ABI and can be injected in tests.

One React folder level contains pages/components/hooks. TSX owns declarative rendering only; row shaping, event handlers and focus-ref binding live in hooks. Controller stores own the six draft/confirmation/pagination sections; the editor's atomic seed/mode transition and the attribute draft's validation live headlessly. Core createControllerStore and useController own disposal/attachment, and installed fetch-query owns requests, mutations and cache invalidation. They are called, not reimplemented. In-flight pagination keeps the existing generation and same-tick lock; background reads do not overwrite edits.

The host must retain imports of native-domain-dialogs.css and form-field-attrs.css in its surviving thin forms adapter. CSS class bytes, including `tovu-domain-dialog`, are retained under the explicit C0 DOM contract. No host styles or imports enter the package. The current editor has no PublishSectionButton, so adding one there would change its DOM; headerActions is used exactly at the existing list location.

## Tests and verification

Thirteen suites are copied. Existing assertions are untouched. Hook tests use test-only legacy-shape bridges backed by the core memory adapter; those shapes are not exported by any production entry. UI suites exercise the source HTTP adapter with the core transport and browser-navigation host fixtures. The copied German list case supplies an explicit German translator/locale rather than reading the host locale. The original host wiring case remains in its Tovu file. The html-mode dictionary-only case remains exclusively in Tovu; its four behavior cases are copied unchanged. forms-i18n.unit.test.ts stays in Tovu. Universal rules use a framework-free test bridge; all rendering suites are under react/__tests__.

Exactly one new suite/test: __tests__/forms-api.conformance.test.ts runs the framework-free checklist against the memory adapter, including seeded reversible submission Trash. No assertions were weakened. No tests, typechecks, builds, installs, servers, git mutations or indexing ran, per dispatch. Static syntax/import/entry-closure and assertion-fidelity checks are inspection evidence only. Runtime correctness and packaging remain unverified until the coordinator runs the prescribed suites and gates.

## Source mapping and rationale

- rules.ts/html-rules.ts retain the pure host behavior; public boundaries use two objects. Test-only import bridges keep the original positional assertions.
- FormsList.tsx → react/pages/FormsList.tsx plus forms-view.hooks.ts and the list controller/hook.
- FormEditor.tsx → react/pages/FormEditor.tsx and nine section components; no new DOM wrapper.
- Host API dependency files → adapters/http.ts/memory.ts and scoped port bindings. Unused getMailStatus behavior is omitted from production: the authoritative editor no longer consumes it after notify UI removal; the old fake method exists only in test compatibility.
- Seven state/effect hooks → six headless section controllers, the shared draft-update helper, and seven React bindings. DOM refs/effects stay in React, not universal controllers.
- SOURCE-RATIONALE.md retains every extracted source rationale comment verbatim. Active comments repoint host dependency files to their surviving owners.

Part A left Tovu unchanged and supplied exports through out/c1-exports.json. Part B was subsequently authorized explicitly, including the core Trash contract correction. Next assignee: Coordinator for source review, Jini rebuild/publish, prescribed tests and the published typecheck/Chrome visual gates.


## Part B host integration (2026-10-08)

The package Provider accepts optional live `options` so locale updates preserve editor identity. Editor page accepts existing `formId` or optional `params.formId`; requestedTab stays route-derived. No rendered wrapper is added. Existing `useFormsList` and `useFormEditor` hooks are exported additively from the React barrel for the host request-volume measurement (the existing Redirects measurement precedent); no new entry or dependency is required. Tovu mounts via its unchanged panel exports and retains dictionary-only tests. Jini source must be rebuilt/published by the Coordinator before release; no runtime or build validation was run here.
