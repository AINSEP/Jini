# Media parity contract

## Approved scope and decisions

Extend the existing port/controller/ui-kit slice in place. Media metadata adds independent slug,
optional native-size dimensions, CSS class and HTML attributes. New fields remain optional on
asset snapshots so existing hosts keep working. Public links come from the server; authenticated
original-byte URLs are never substituted. Embed markers use the server slug, never the hash/id.

Replacement is an optional identity-preserving capability: missing method or explicit false hides
it and the controller fails closed. Never simulate replacement through upload/trash. Memory and
configured HTTP implement it; conformance runs with and without it.

Provider configuration is an optional settings write, separate from credentials so blank keys
cannot accidentally clear secrets. Hosts must return baseUrl/model and implement saveSettings to
enable persistence. UI edits survive unreachable reads; full-map serialization is host-owned.

One page-owned library controller provides full-library counts, search/order and write refreshes.
Counts ignore search/type filtering and include trashed rows. Tab switches preserve the query.
All behavior stays in .ts; views compose ui-kit controls and stable legacy agent handles.

## Validation contract

Preserve existing tests and add behavior tests before completion: frozen partial metadata patches,
null clearing, attribute hint without save gating, clipboard denial/manual selection and cleanup,
server-only public links, preview fallback, keyboard clamps/focus, optional replacement, provider
settings, counts/order persistence, row menus and legacy handles. Host-only transport, routing,
translations, security and cache lifecycle tests remain explicitly mapped below.

## Legacy test mapping

The source inventory contains exactly 17 legacy test files. The table covers each file, including
mixed tests whose transport/style/dictionary assertions belong to the host. Portable tests use
injected APIs, never a host singleton. Existing tests remain; new coverage verifies behavior,
without exclusions, skips, weaker assertions or reduced capabilities.

| Legacy file under `features/media/__tests__/` | Shared-module test(s) | Host-only assertions retained outside this module |
|---|---|---|
| `Media.unit.test.tsx` | `react/__tests__/library-parity.test.tsx`, `edit-parity.test.tsx`, `media.test.tsx`; `__tests__/parity-controllers.test.ts`: upload bytes/trim/reset, preview fallback, image click/video controls, bounded keyboard/focus, trash/purge ladder, partial metadata/null clearing/slug/attributes, shared form entry points, deep link/handles | Header/theme classes, publish contribution, concrete authenticated HTTP payload/endpoint integration, router subscribers/history, localized chooser, server atomic validation/sniffing |
| `media-agent-drive.unit.test.tsx` | `library-parity.test.tsx` distinct original row handles; `edit-parity.test.tsx` fills original title handle and saves; upload test fills original alt field and submits | Agent runtime's `page.fill` transport itself; handles and actual controlled changes are tested here |
| `media-byte-size.unit.test.ts` | `__tests__/legacy-rules.test.ts` byte/KB/MB/GB boundaries, decimals, default locale and German formatting; library size rendering | None |
| `media-html-attributes.unit.test.tsx` | `legacy-rules.test.ts` exact flat allowlist, syntax, ordered rejection reasons, interior-control URL bypass, CSS escaping, malformed synchronization, tag-breaking names and specific hints; `edit-parity.test.tsx` hint/save guard | Independent server write/render validation remains the server's responsibility |
| `media-i18n.unit.test.ts` | `legacy-rules.test.ts` locale-sensitive bytes and specific English hint messages; module's `messages.en.ts` exposes translatable labels | Host locale inventory, complete per-locale dictionary/key coverage, literal source-key scan and shared-dictionary fallback. This module does not import the host's dictionaries; locale UI parity requires host/module translation integration |
| `media-order-by.unit.test.tsx` | `legacy-rules.test.ts` copied deterministic sorting, case/trim/ties/empty title; `library-parity.test.tsx` real selector default/change and persistence across tabs | Legacy `.media-order-control` host stylesheet rule |
| `media-preview-click-lightbox.unit.test.tsx` | `library-parity.test.tsx` image click, separate video expansion, independent native controls; keyboard/button boundaries and retargeted preview | None; real browser native media playback remains QA |
| `media-provider-catalog.unit.test.tsx` | `library-parity.test.tsx` injected provider rows/config controls; generic module consumes host catalogue unchanged | Canonical provider-ID/23-vendor roster/model dedup/default URL/catalogue filtering conversion belongs to the injected catalogue adapter. Keep existing host descriptor and tests; never replace it with a reduced module-owned list |
| `media-providers-port.unit.test.ts` | `__tests__/controllers.test.ts`, `parity-controllers.test.ts`: unreachable null/rejected reads preserve rows, authoritative empty clears rows, credential write secret-free, settings preserve siblings | Concrete whole-map GET/PUT authentication/binding and server authoritative copies; host serializes/rereads full-map changes |
| `media-tab-counts.unit.test.tsx` | `legacy-rules.test.ts`, `parity-controllers.test.ts`, `library-parity.test.tsx`: loading absence vs known zero, full counts independent of filter/search, upload/trash/purge refresh, provider catalogue count | Concrete DELETE route; provider catalogue roster itself |
| `media-type-filter.unit.test.tsx` | `legacy-rules.test.ts` MIME-family filters/untyped/octet-stream; `library-parity.test.tsx` content tabs, disclosure and video empty copy | Server sniff/backfill/attachment defusal |
| `use-edit-media-modal.hooks.unit.test.tsx` | `edit-parity.test.tsx` shared ui-kit Dialog controlled backdrop/cancel/pending, ID reseeding; `media.test.tsx` kit focus/ref and pending safeguards | Native showModal/close fallback mechanics now belong to ui-kit; real Escape/top-layer/trap requires browser QA |
| `use-edit-media-panel.hooks.unit.test.tsx` | `edit-parity.test.tsx` public URL/null/slug embed/hash, all three independent 1500ms feedback timers, denied clipboard/manual values, unmount cleanup, invalid HTML submitted, server errors, frozen baseline; `parity-controllers.test.ts` metadata writes | Server-specific validation/atomicity; fake intentionally does not implement it |
| `use-media-lightbox.unit.test.ts` | `library-parity.test.tsx` captures/restores trigger focus, close initial focus, bounds and controlled cancel/backdrop | ui-kit owns showModal/close already-open guards/native fallback and unique heading IDs; real-browser modal restrictions remain QA |
| `use-media-preview.hooks.unit.test.tsx` | `library-parity.test.tsx` exact injected safe original URL, alt/image/video/unsupported chain/download; keyed preview resets per asset | Fake's intentionally non-browser URL scheme is rejected by the shared module's URL policy. No real byte route is called; authenticated original route/headers belong to host |
| `use-media-tabs.hooks.unit.test.tsx` | `legacy-rules.test.ts` all valid/invalid query values; `library-parity.test.tsx` deep links and exact host callback | Concrete `/admin` prefix/query-preservation/history-replace/router subscribers are host bridge tests |
| `use-media.hooks.unit.test.tsx` | `controllers.test.ts`, `parity-controllers.test.ts`, `library-parity.test.tsx`: pending initial null, write/error/reload, refresh/unsubscribe, stale responses, purge safety | Resource-scoped refresh-bus filtering is host adapter behavior; module receives authorized refresh notifications only. Shared controller serializes mutations, so unrelated writes cannot clear in-flight destructive state |

## Retained rationale inventory

These comments moved with the implementation. Host-only comments remain documented as host duties;
organization/complexity/extraction-history notes do not add runtime requirements. Superseded claims
that attributes were unwired or only one locale existed were not copied as current claims.

| Legacy rationale location | Preserved decision and destination |
|---|---|
| `rules.ts` metadata diff; edit hook frozen ref | Compare only dirty fields against frozen original snapshot; a live refetch must not revert another operator. `rules.ts`, `controllers/edit-media.controller.ts`, edit/controller tests |
| Metadata types/pixel parser/field sizing | Native blanks are null, never inferred; CSS/HTML blank clears; slug never nullable and independent from title; invalid numbers reach server validation. Models/rules/edit hook and tests |
| HTML parser/header/live hint incident | Browser feedback is no security boundary and never disables unrelated saves; server separately validates write/render atomically. `html-attributes.ts`, edit hook, PORT host duties |
| Attribute name incident/token/error docs | Anchored name shape prevents closing a tag through open prefix families; value escaping cannot fix unsafe names. Exact flat list/global extras, specific named hints, ordered diagnostics, accepted tokens survive rejection; malformed synchronization discards all values. `html-attributes.ts` and 109-rule suite |
| URL/CSS/classification/parser comments | Strip all ASCII controls/interior whitespace; reject script/data schemes on every value; reject CSS escapes/backslashes/bindings/imports/expression while safe URL styles survive. Event handler before URL before allowlist before style. Do not sanitize unsafe tokens into acceptance. `html-attributes.ts` |
| Type filter/untyped comments | MIME families accommodate future codecs; null/unreadable differs from opaque known bytes; All still contains both, with honest filtered disclosure. SVG may classify as image but host must defuse served bytes. `rules.ts`, library hook, adapter comments/tests |
| Counts/tab descriptors | No zero badge before authoritative data; known zero retained; descriptors use IDs and full-library counts, not search matches; Providers last and catalogue-sized. Library/page controller/hooks and tests |
| Sort and byte formatter | Full list already loaded: sort/filter locally independent of server order, copy array, deterministic ID tie breaks, trim/case normalize, empty title allowed. Binary unit base agrees with limits; whole small units/one decimal larger units; locale owns separators. `rules.ts` and library tests |
| Write/read/cache/refresh comments | Prior background failure never blanks loaded rows; new write clears stale error; one list identity means every write and authorized refresh rereads it. Serializing writes preserves in-flight purge state; scope disposal unsubscribes/aborts. Library controller/hook/page tests; host owns refresh resource filtering/cache binding |
| Menus/trash/purge | Inject callbacks rather than reaching global clients. Metadata edit meaningful in every preview stage; active trash reversible/unconfirmed, trashed purge requires human confirmation/no undo. MediaCard hook and ui-kit ConfirmDialog/controller tests |
| Preview historical HEAD rationale | Optimistic image→video→placeholder renders real bytes without assuming HEAD contract or blocking each image on a probe; attachment-defused HTML/SVG naturally fails both. Unsupported is unpreviewable, not broken: original download still available, larger-placeholder action omitted. `MediaCard.hooks.ts`/component and tests |
| Image/video/accessibility comments | Image inside an actionable button supports pointer/keyboard expansion; native video stays outside buttons and does not expand on native-control clicks. File/alt/order require actual accessible names; data-agent-label/placeholder alone cannot supply them. Components and library tests |
| Public URL/embed/hash/copy docs | Server-computed public URL distinct from authenticated original, absent for trash/no transform. Embed uses current server slug, not title/ID/hash/unsaved slug, displayed even without public URL; hash remains secondary/selectable. Independent feedback begins after success and expires; denial leaves manual copying. Edit hook/tests |
| Shared dialogs/form reseeding/preview key/index | One dialog per library rather than per card; eye/menu edit same form. ID keys reseed drafts on asset switch and reset preview fallback; same-item refresh retains frozen draft. Lightbox indexes the exact sorted/filtered visible array. Library/Lightbox components/hooks/tests |
| Lightbox dialog/ref/keyboard docs | Open transitions capture trigger before focusing close, restore it on close; close is stable across list positions; navigating must not reopen/re-capture trigger. Controlled cancel/backdrop prevents divergent state; bounds clamp rather than wrap a library like a slideshow. ui-kit Dialog owns native guards/unique heading ID; media hook/tests own arrows. Focused native video can still seek and navigate together, the disclosed legacy limitation |
| Agent handle docs | Keep literal tab/form/upload/lightbox/purge handles and ID-derived distinct row expand/edit/menu names on actual focus targets. Host owns runtime metadata validation; values are injected through ui-kit attrs. Library/edit tests |
| Tabs/icons/catalogue/provider comments | Provider credentials beside generated assets and fourth/last; host bridge owns bookmarkable URL/history replacement. Decorative/vendor icon decisions remain host presentation; module uses text labels. Host supplies canonical browser-safe provider catalogue/IDs/model dedup/defaults/stable roster, never UI aliases or non-configurable stubs. Catalogue conversion tests remain host-owned |
| Provider transport/read/save docs | Missing evidence is null, never authoritative empty; saves reject on failure, secret-free responses retain endpoint/model and siblings. Full-map host writes serialize/reread before mutation; server-specific key-clear uses omission. Controllers/memory tests and host follow-up |
| Translation/barrel/editor comments | Vendor proper names remain catalogue labels. Host dictionaries/shared fallback and editor node-removal semantics remain host-only. Public barrel keeps callers independent of feature layout. Existing module messages are English defaults; no host dictionary or editor import |

## Host follow-up

1. Implement an identity-preserving replace-file endpoint and wire `createHttpMediaApi`'s optional
   `replacePath`. Until then replacement is absent and the controller/UI fail closed.
2. Return `baseUrl`/`model` in provider view rows and implement optional `saveSettings`. Serialize
   full-map settings writes, reread first, preserve sibling providers and credentials, and return
   authoritative secret-free settings. Existing credential-only ports render disabled controls.
3. Keep canonical catalogue, locale dictionaries/translation integration, router replace/query
   preservation, server validation/sniffing/public transformation and publish contributions in host
   adapters. Do not delete legacy tests/helpers until these host assertions still pass.
4. Run browser QA against a reviewed normal build later. This change intentionally does not rebuild
   the live dist; jsdom tests cannot establish native media playback, pixel parity or modal traps.


## Final source verification

Working directory: engine repository root. Exit codes read directly from completed commands.

- `pnpm --filter @jini-ai/admin exec tsc --noEmit` — exit 0.
- `env -u TOVU_ADMIN_PASSWORD pnpm --filter @jini-ai/admin exec vitest run src/media` — exit 0;
  8 files / 178 tests. Baseline: 4 files / 19 tests, both commands exit 0.
- `env -u TOVU_ADMIN_PASSWORD DEBUG_PRINT_LIMIT=1000 pnpm --filter @jini-ai/admin exec vitest run src/media --maxWorkers=1 --minWorkers=1`
  — exit 0; same 8 files / 178 tests.

An intermediate parallel run timed out the existing lazy-tab test at 5 seconds. The lazy test now
allows 15 seconds for module loading; assertions remain unchanged. New library tests use the same
5-second async lookup allowance as the existing slice and await the new tab's content after Suspense
resolves. Typecheck caught optional-property and duplicate byte-size initialization mistakes; corrected
before final green verification. No ignore, skip, exclusion, reduced assertion or removed test was used.

## Exact changed-file inventory

All runtime/type/test/document changes below are relative to this media directory. Other jobs already
have changes in the shared repository; this is authored-file attribution, not the entire git status.
- `PORT.md`
- `PROTOTYPE.md`
- `models.ts`
- `ports.ts`
- `rules.ts`
- `html-attributes.ts`
- `index.ts`
- `controllers/edit-media.controller.ts`
- `controllers/library.controller.ts`
- `controllers/providers.controller.ts`
- `adapters/http.ts`
- `adapters/memory.ts`
- `conformance/media-api.conformance.ts`
- `react/hooks/EditMediaPanel.hooks.ts`
- `react/hooks/LibraryTab.hooks.ts`
- `react/hooks/MediaCard.hooks.ts`
- `react/hooks/MediaGrid.hooks.ts`
- `react/hooks/MediaLightbox.hooks.ts`
- `react/hooks/MediaPage.hooks.ts`
- `react/hooks/ProvidersTab.hooks.ts`
- `react/hooks/UploadButton.hooks.ts`
- `react/components/EditMediaPanel.tsx`
- `react/components/MediaCard.tsx`
- `react/components/MediaGrid.tsx`
- `react/components/MediaLightbox.tsx`
- `react/components/MediaPurgeDialog.tsx`
- `react/components/UploadButton.tsx`
- `react/tabs/LibraryTab.tsx`
- `react/tabs/ProvidersTab.tsx`
- `react/pages/MediaPage.tsx`
- `__tests__/http.test.ts`
- `__tests__/legacy-rules.test.ts`
- `__tests__/parity-controllers.test.ts`
- `react/__tests__/media.test.tsx`
- `react/__tests__/edit-parity.test.tsx`
- `react/__tests__/library-parity.test.tsx`

## QA recovery and presentation follow-up — 2026-10-03

The QA source fixes add explicit upload success/failure and hidden kit-driven file selection,
batch/drop upload, muted inline video fallback, mutually exclusive loading/error state and
automatic retryable-read recovery (1s/2s/4s, capped 30s; no automatic write replay). Tab changes
retry failed reads; shared-library tab remounts recover even with cached rows. Disposal cancels
read requests and retry timers. Known rows survive background failures.

Legacy All/type tabs include both statuses. The additional Status filter selects Active or Trash
without changing the full-library counts. `MediaApiPort.restore` and `restoreSupported` are optional:
a callable restore with no explicit disable plus `media.restore` is required for controls. HTTP
only exposes restore with a supplied `restorePath`; memory restores identity/metadata. Missing
capability never falls back to upload, trash or metadata update. Hosts own route/grant mapping.

`media({ overlays }, { headerActions })` accepts a host publish contribution in the right-hand
header slot. Hosts must move existing contributions into this slot; the reusable module performs
no publishing. The exported media page prop type also supports this slot. No new package export
is required. Source-scoped styles travel with compiled JS. Media dialogs retain kit modal/focus/
pending behavior, remove the known default duplicate Close, keep existing agent handles and
unmount when closed. Custom kit overrides still own their structure. The lightbox has a large
viewport; permanent deletion names the file and moves focus to the next surviving card or grid.

QA tests: `__tests__/qa-recovery.test.ts` (7) and `react/__tests__/qa-fixes.test.tsx` (8), added
RED before runtime changes; all 178 previous tests retained. No browser parity claim: dist was
intentionally left untouched. See the requested QA handoff for exact final commands/exit codes.
