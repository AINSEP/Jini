# SEO admin port — Part A, 2026-10-07

Programmer(Execution): Programmer persona loaded for a behavior-preserving extraction into the existing admin module architecture.

## Inputs and approved ownership

C0-admin-common.md and C4-seo-admin.md, coordinator's Part-A-only dispatch, CMS-JINI-MODULAR-DESIGN.md Rev 3 decision 1 / section 4 C4, authoritative uncommitted Phase 17 native Dialog and Phase 18 TabBar source. Tovu architecture chapters 13/14 were consulted as target constraints. Pattern seed is the explicitly directed existing media module/HTTP adapter and agent-plugins PORT/controller pattern, not a new unapproved design. Graph MCP tools were unavailable; discovery used current source reads in Tovu/Jini. No indexing or install was attempted.

The existing `core/ports/seo.ts` AdminSeoPort is the sole production API contract. This domain introduces tokens, presentation models, controllers, HTTP/memory adapters, React binding and framework-free conformance. All controller state uses the existing createControllerStore; effects/disposal use the existing useController. No React is reachable through universal runtime imports. DOMParser is the existing native browser XML parser and is invoked only by the sitemap view hook; calling the exported parsing rule requires a DOM-capable host.

## Reuse-before-write record

- Reuse: API ownership; searched the core SEO port and source seo/sitemap port dependencies and lib/api SEO calls; inspected core/ports/seo.ts and both host dependency bindings; extended AdminSeoPort, never created a production parallel API; owner record C0/C4.
- Reuse: state/effect lifecycle; inspected media and agent-plugins controllers, core/module/controller-store.ts and core/react/use-controller.ts; called the existing store and effect-owned hook rather than copying sibling lifecycle implementations. The headless entry controller keeps the source's generation invariant with a scalar counter because the old useSettlementGeneration hook is React-bound.
- Reuse: native screen chrome; inspected authoritative source Seo/SitemapModal and existing @jini-ai/ui tab-strip / ui-kit Dialog usage; imported those same public owners directly; owner record Phase 17/18 and C4.
- Reuse: tab guard; searched resolveActiveTabId in Jini UI source/exports and inspected the panel-kit entry. The existing export is a browser entry whose barrel includes React; the universal rules entry cannot import it. Used the standard-library fixed-array find with the exact source fallback instead; no UI export or fenced shared file was changed.
- Reuse: sitemap parsing/filtering and override normalization; inspected X/rules.ts and source hooks; moved those implementations, using native DOMParser and standard array/string operations, with only object-boundary adaptations; owner record C4 moves.
- Reuse: media selection and preview; searched buildMediaRef/resolveMediaRefPreviewUrl/parseMediaRefParts in Jini admin/media, UI and CMS SEO; inspected the shared mediaPickerToken, source host wrapper and CMS SEO media implementation. Called the existing picker through its token or injected existing host wrapper. The frontend preview contract uses the authorized admin original URL and no content/media kernel lookup; the private CMS parseMediaRefParts supports server rendition resolution and is not a callable public preview owner. The moved source preview rules retain this distinct contract; no server resolver is forked.
- Reuse: transport/error handling; inspected media/adapters/http.ts, source sitemap dependencies and describeApiError; injected the existing request/url, raw sitemap read and error formatter owners rather than importing host implementations or constructing fetch.

## Acceptance contract

- Module `seo`, page `settings`, path `/seo`, permission `admin.seo.manage`.
- Ordered query ids `defaults`, `sitemap`, `entries`; default/fallback `defaults`. Tab clicks call the module onTabChange({ tab }); the host keeps `?tab=` and replacement history.
- Preserve source DOM, CSS classes (including `tovu-domain-dialog`), data attributes, handles, ARIA labels, English strings and all loading/empty/error/pending states. CSS stays host-owned; the native Dialog and TabBar are imported from their existing Jini owners.
- All seven defaults remain mounted inside one uncontrolled FormData form; the image field alone is controlled and rebases on accepted settings reads/writes. Blank optional defaults become null. Untouched entry keys are omitted; emptied text/URL overrides become null; false remains false.
- PUT resolves to authoritative effective metadata. Trailing analysis is best-effort and does not delay clearing saving. A later save's analysis supersedes an older response.
- Disabled sitemap never requests XML; it is a terminal disabled state. Raw view uses exact response text; parsing/filtering use native DOMParser and the source rules. Refetch happens only after successful regenerate; older refetch settlements are ignored. Native Dialog owns modality and cancellation.
- The host/server still owns auth, workspace boundaries, permission enforcement, error decoding, retries, CMS SEO resolution, publication and media hydration. No parallel CMS lifecycle or picker implementation is introduced.

## Core contract additions

`AdminSeoOverridesPatch` widens every override with the existing null-remove sentinel, and `AdminSeoSettingsPatch` widens only defaultDescription/defaultOgImage/twitterSite. Existing read shapes and method names are unchanged. `AdminSeoEntryChoice` projects id/title/status; adapters preserve the full returned host row without depending on a host content type.

Added operations: `listSeoPosts({}, {})`, `listSeoPages({}, {})`, `fetchSitemapXml({}, { signal })`, `mediaOriginalUrl({ id }, {})`. No existing operation is removed. M2 must export the three new types from core/index.ts and core/ports/index.ts as listed in c4-exports.json. Only the domain-owned core SEO file was edited here.

## HTTP contract and host swap

`createHttpSeoApi({ transport, basePath }, { sitemapTransport })` receives the existing request/url pair. basePath is `/workspaces/<workspaceId>` as seen by that transport, not `/seo`. Authentication, API base prefix and JSON serialization belong to the host.

| Operation | Unchanged transport path/method/body |
|---|---|
| getSeoSettings | GET `<base>/seo/settings`, unwrap data |
| putSeoSettings | PUT `<base>/seo/settings`, exact patch object, unwrap data |
| regenerateSeoSitemap | POST `<base>/seo/sitemap/regenerate`, no body, unwrap data |
| getSeoEntry | GET `<base>/seo/entries/<encoded id>`, unwrap data |
| putSeoEntry | PUT same entry path, exact touched patch, unwrap data |
| analyzeSeoEntry | GET same entry path + `/analyze`, unwrap data |
| listSeoPosts / listSeoPages | GET `<base>/posts` / `<base>/pages`, unwrap posts[].post without projection loss |
| mediaOriginalUrl | transport.url for `<base>/media/<encoded id>/original` |
| fetchSitemapXml | sitemapTransport.get({ path: '/sitemap.xml', credentials: 'same-origin' }, { signal }) |

The public XML seam is separate because the existing admin transport decodes JSON. Supply `sitemapTransport.get` as a thin host callback to fetch(siteUrl(path), { credentials, signal }); the adapter retains the source HTTP-success + content-type-contains-xml check and error copy. Absence fails explicitly if the viewer is requested; the factory never constructs a global fetch dependency.

`seo({ siteUrl: () => siteUrl('') }, { t, describeError, headerActions, slots })` uses:

Part B (2026-10-08): `feature.react.Provider` also accepts `options?: SeoReactOptions`.
Factory options remain its default; supplied live options update copy/slots without recreating
the lazy views or controllers. The public React barrel re-exports the existing resolveSeoTabs
and sitemapStateLabel for host dictionary contract tests. The page's context-backed tab hook
runs before loading/error returns, preserving React hook order without changing markup.
These source additions require a Jini admin rebuild and publication before shipping the host.

- t = the host's createDictionaryTranslator(SEO_DICT, locale). English identity is the default; dictionaries stay in Tovu. Existing locale props are compatibility metadata, not a second translation owner. A translator update does not discard controller drafts.
- describeError = ({ error, fallback }) => describeApiError(error, fallback). This preserves the host ApiError class's special empty-message fallback on picker/entry reads and writes. Settings errors retain their pre-existing Error.message behavior.
- headerActions = the host PublishSectionButton for settings, inside the unchanged page-actions div.
- slots.MediaPickerDialog = the existing components/MediaPickerDialog wrapper. It owns the source picker DOM/handles and hydration of the selected CMS row (notably slug and active status). This is necessary for exact legacy parity; it is a host seam, never a copied production implementation.
- With no slot, the optional mediaPickerToken is consumed through its existing promise service. Assets retain any structural slug they carry; without one the documented id fallback applies. A host requiring slug/legacy-dialog parity supplies the slot. No fenced media contract or media domain file was edited.
- Optional seoEvents subscribes via { onRefresh }; the host filters content-refresh-bus events before passing them. Event unsubscribe and controller disposal are owned by React effects.

The bound page keeps source banners and panel lifetime. Lazy standalone tab descriptors reuse the same panel functions and controllers; no alternate tab markup owner exists. Generic module mounting receives requestedTab/onTabChange from the host's existing ModulePanel bridge.

## Memory and conformance

`createMemorySeoApi(seed, { resolveEntry })` deep-clones returned snapshots and seeds; settings merge preserves omitted defaults and clears null to absence. Entry edits are accumulated separately from seeded effective fallback values, so a later null removes an earlier edited key. The default resolution is the source fake's field projection over seeded effective metadata, not a reimplementation of CMS content/schema derivation. Richer domain derivation uses the resolveEntry callback; production uses the HTTP/server owner. Analysis stays seeded, matching the source fake.

runSeoApiConformance({ api }, { entryId }) is framework-free and destructive: use an isolated backend with the selected entry seeded. It checks settings merge/clear/snapshots; entry merge/clear/snapshots; analysis; accept trigger; both choice reads; raw XML; sync preview URLs; aborted XML rejection. One new test seeds memory and asserts all 14 named checks.

## Tests and source mapping

Eight suites were copied with import/render-harness changes only; no assertion or test body was changed. Legacy ABI wrappers exist only under react/__tests__/harness and delegate to the production controllers/core-port memory adapter; they are not a parallel production SeoPort. The render harness supplies an English translator, memory API, site origin and host-owned media slot fixture. The fixture represents the source picker callback contract; it does not claim to certify the shared media service's own DOM.

`Seo.hooks.unit.test.tsx` remains in Tovu because it tests real router replacement history and the Spanish SEO dictionary. Its FormData assertion stays there too as part of the same file; Part B must rewire its imports to the surviving host/module test harness without changing assertions. Tovu panels/nav/sidebar/module wiring suites remain host-owned.

| Source | Jini owner |
|---|---|
| rules.ts, tab ids/resolve, FormData mapping | rules.ts |
| seo-port/dependencies, sitemap-port/dependencies | core SEO port, adapters/http.ts, adapters/memory.ts |
| use-seo | controllers/seo.controller.ts, react/hooks/use-seo.hooks.ts |
| use-entry-picker | controllers/entry-picker.controller.ts, react/hooks/use-entry-picker.hooks.ts |
| use-seo-entry-panel | controllers/seo-entry.controller.ts, react/hooks/use-seo-entry-panel.hooks.ts |
| use-seo-entry-section | controllers/entry-section.controller.ts, react/hooks/use-seo-entry-section.hooks.ts |
| use-sitemap-modal | controllers/sitemap.controller.ts, react/hooks/use-sitemap-modal.hooks.ts |
| MediaRefField hooks/component | controllers/media-ref.controller.ts, react/hooks/MediaRefField.hooks.ts, react/components/MediaRefField.tsx |
| SitemapModal hooks/component | react/hooks/SitemapModal.hooks.ts, react/components/SitemapModal.tsx |
| Seo hooks/glyphs/component | react/hooks/SeoPage.hooks.ts, react/components/SeoIcons.tsx, react/pages/SeoPage.tsx |
| i18n calls | messages.en.ts + injected translator; dictionaries remain Tovu |

SOURCE-RATIONALE.md retains every source comment verbatim, including historical design tradeoffs. Active prose points to surviving owners; archived references remain original provenance.

## Static review and honest validation status

Architecture Audit: WARNING (source-boundary inspection passed; runtime, type, packaging and UI validation are intentionally pending). Checked C0/C4 fences, canonical core port ownership, dependency inversion, universal/browser split, one React folder level, native UI owners, optional peers, two-object new boundaries, preserved assertions and the explicit host seams above. No out-of-domain files or manifests were edited. The Tovu/Jini governance scopes reviewed contain no additional SEO-admin governance ADR.

Source AST inspection, without compiling or typechecking, found no syntax diagnostics or missing relative imports in the inspected source. All 491 expect expression statements across the eight copied suites are byte-identical. Final inspection is saved to the host CMS-BRIEFS/out/c4-static-review.json (46 source files, 21 universal-closure files, matching class/handle/ARIA literals and assertions). Existing TypeScript parser was reused; no analyzer or dependency was installed.

No tests, builds, typechecks, installs, servers, commits, git add/stash/checkout, push, publishing or index_repository were run. No processes remain running. Pass/fail counts, coverage, runtime parity and visual parity are not claimed. user-event ^14.6.1 is requested only as a development dependency in the exports JSON; runtime dependencies already exist as optional peers.

Function-quality review: controller actions use bounded one/two-request flows; post/page collection combines in O(p+q), issue sort O(n log n), sitemap parse/filter O(document-size)/O(url-count), memory snapshots O(snapshot-size), and override merging O(patch-keys). No new per-row I/O was added. Source request bounds remain host-transport policy.

| Assessed unit | Disposition | Finding / local action |
|---|---|---|
| settings / entry state machines | NO_RECORDED_FINDINGS | Existing store/React lifecycle reused; nullable clear sink and analysis-generation invariant retained |
| entry picker / sitemap | NO_RECORDED_FINDINGS | Original order, terminal disabled state, parse memoization and stale-settlement handling retained |
| HTTP adapter | NO_RECORDED_FINDINGS | Host request/url and explicit raw XML transport; unchanged wire contract |
| media binding | RECOMMENDED | Generic picker contract omits CMS slug hydration/legacy handles; explicit existing-host slot keeps parity, mandatory for Tovu Part B |
| memory resolution | RECOMMENDED | Seed projection does not simulate CMS derivation; resolveEntry seam or server integration owns richer behavior |
| presentation / copied tests | NO_RECORDED_FINDINGS | Native owners and exact source markup/491 assertion statements retained; host wiring test excluded from move |

Documentation classification: public boundary/acceptance/host seam docs added; source why-comments retained; no operational guide or new framework tooling introduced. Pre-completion scope/assertion/import/syntax inspection is complete; self-validation is PARTIAL because executable checks are forbidden in this dispatch. Suggested next assignee: Coordinator for validation/diff acceptance, then M2 for shared exports/dev dependency, then serial Part B only after publication gates.
