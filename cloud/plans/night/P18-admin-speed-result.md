Software Architect(Direct): Loaded the requested Software Architect persona. This is a static, read-only plan; no files changed, tests/builds/servers run, or localhost accessed.

**Goal**

Remove avoidable route-loading delays and make `/admin/assistant` redirect to `/admin/ai-assistant`, preserving query parameters and browser history.

**Findings (file:line)**

- **Two different loading screens:** [App.tsx:696](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/App.tsx:696) gates the shell on authentication. [panels.tsx:1293](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/panels.tsx:1293) shows identical text while a route’s code loads. The reported text alone does not identify the blocker.
- **Bootstrap already runs once:** [App.hooks.ts:128](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/App.hooks.ts:128) uses a mount-only effect and retains its initial promise across Strict Mode replay. Navigation never sets `checking` back to true. Normal authenticated boot costs one identity request; boot-token redemption costs two; successful local-owner recovery can cost three.
- **Normal navigation preserves the shell:** [router.ts:58](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/lib/router.ts:58) delegates to Jini’s History API navigation. [main.tsx:60](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/main.tsx:60) keeps the session owner above App. No route-keyed root remount was found.
- **Shell settings already share cached reads:** [use-admin-locale.hooks.ts:59](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/hooks/use-admin-locale.hooks.ts:59), interface preferences, and appearance use principal-scoped queries with infinite freshness plus explicit invalidation. They do not normally refetch on navigation or hold the entire shell waiting.
- **A concrete lazy waterfall exists:** [panel-pages.ts:25](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/panel-pages.ts:25) defers Comments; its [wrapper:14](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/features/comments/index.ts:14) then renders Jini’s separately [lazy page:27](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/admin/src/comments/react/index.ts:27). Redirects, SEO, and Widgets have the same wrapper → Jini page sequence. Page data starts after mounting.
- **Splitting is already implemented elsewhere:** [panel-pages.ts:13](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/panel-pages.ts:13) contains the existing feature splits. Posts/Pages list and editor exports share feature imports, potentially pulling editor code into list navigation.
- **Connection starvation is a credible hypothesis:** [vite.config.ts:42](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/vite.config.ts:42) documents HTTP/1 connection contention. [Jini Forms:9](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/admin/src/forms/react/index.ts:9) deliberately keeps its list eager to avoid an import waiting behind streams. This does **not** prove the reported 8–20 seconds.
- **Routing fallback confirmed:** [Jini rules.ts:90](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/admin/src/core/routing/rules.ts:90) returns `panelId: null` for unknown segments; [App.tsx:209](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/admin/src/App.tsx:209) renders Dashboard. Only `ai-assistant` is registered.

A repeated delay on already visited routes needs runtime evidence: cached imports alone cannot explain it.

**Design (smallest)**

- Add one Tovu-specific assistant alias before generic matching. Reuse `redirectPath` and the existing `IntegrationsRedirect`, which already performs replacement navigation.
- Keep the session, cache, shell, and dock ownership unchanged. “No bootstrap rerun” is already implemented; protect it with navigation coverage.
- Remove only the outer lazy imports around the four thin Jini wrappers: Comments, Redirects, SEO, Widgets. Keep Jini’s real page/tab loaders lazy. Their combined wrapper source is **5,719 bytes**, including comments; emitted/compressed size is unknown.
- **Optional, measurement-dependent:** split Posts/Pages list exports from editor exports if editor download/evaluation dominates.
- **Optional:** intent-based code prefetch only if cold chunk latency remains material. Generic prefetch belongs in `@jini-ai/admin`, with Tovu supplying route wiring. No blanket preload or data prefetch.

**Cost: requests and bytes per navigation**

Let `D/Bd` be destination data requests/bytes, `C/Bc` uncached code/assets, and `T/Bt` existing telemetry traffic.

| Navigation cost | Current clone | Planned |
|---|---|---|
| Document + auth bootstrap | 0 requests / 0 bytes | Same |
| Unchanged shell settings | 0 requests / 0 bytes | Same |
| Cold destination | `D + C + T`; `Bd + Bc + Bt` bytes | Same formula; redundant wrapper boundary removed |
| Four affected bridges, if emitted separately | Wrapper request(s) and bytes before page loading | Wrapper bytes move to initial shell; corresponding navigation requests disappear |
| Already imported destination | `D + T`; `Bd + Bt` bytes | Same |
| Assistant alias overhead | Incorrect Dashboard work | 0 redirect HTTP requests; canonical page costs apply |

Exact aggregate counts and transferred bytes require a built artifact and trace; source import boundaries do not guarantee separate network requests. No numeric latency or byte saving is claimed.

New reads, writes, and polls: **0 × 0 bytes**. Optional prefetch costs one uncached target dependency set per distinct prefetched route/document, including wasted bytes when never visited.

**Steps (ordered, files)**

1. Capture the quiet-machine baseline below before choosing additional performance work.
2. Write RED alias and wrapper-loading tests; extend existing boot/navigation characterization.
3. In `apps/admin/src/App.tsx`, recognize the exact `/assistant` alias, preserve query bytes, and reuse replacement redirect handling. Preserve unrelated unknown-route behavior.
4. In `apps/admin/src/panel-pages.ts`, make the four thin wrappers eager; update its explanatory comment. Retain heavy page splitting and the Forms exception.
5. Update `apps/admin/src/__tests__/unit/admin-route-lazy-loading.unit.test.tsx` to distinguish eager adapters from deferred actual pages.
6. Verify in an isolated environment, then compare traces. Apply optional splitting/prefetch only when the comparison justifies it.

**Tests (RED first, DI fakes; future execution)**

- Alias tests fail first: direct URL, SPA navigation, trailing slash, `?tab=admin`, replacement history, no Dashboard mount, and unchanged `/assistant/typo` fallback.
- Loading tests fail first: adapters are available synchronously while fake Jini page loaders remain untouched until their route renders; unrelated pages stay unloaded.
- Extend `app-boot-request-volume.test.tsx`: navigate away/back with injected session/settings ports and stream fakes; assert no extra identity/bootstrap reads, unchanged settings counts, and stable shell/dock DOM identity.
- Retain identity isolation, logout/401 behavior, editor keys, permission gates, and settings invalidation coverage. No elapsed-time assertions in unit tests.

For Chrome measurement later, use an isolated clone deployment on a quiet Mac: one admin tab, no active chats/background jobs, no throttling, and identical data/build mode. Record **runtime Performance traces with screenshots**, separately for first visits and repeated visits; compare development and production builds separately. Measure click → useful route paint and loading-notice duration. [Chrome trace instructions](https://developer.chrome.com/docs/devtools/performance/reference/)

Record Network requests/transfer bytes, initiator chains, protocol, queueing, TTFB, and script evaluation. Confirm no new Document or `/auth/me` request during SPA navigation. Export traces and HAR; repeat the same route sequence five times before/after and report median/range. [Chrome Network reference](https://developer.chrome.com/docs/devtools/network/reference/)

**Risks**

- Removing wrapper boundaries cannot fix slow server responses or saturated connections.
- Eager wrappers increase initial shell code slightly; verify actual emitted bytes.
- Required architecture chapters 13/14, Tovu constitution, and project memory were unavailable in this clone; governance verification remains incomplete. Graph tools were unavailable; findings were checked against source.

**Out of scope**

Router replacement, bootstrap redesign, transport rewrites, blanket prefetch, schema changes, plugins, and vendor integrations. Preserve “why” comments and complexity ≤10. Default changes require no Jini release.

**Estimate**

3–5 engineering hours for alias, wrapper adjustment, and focused tests; 1–2 hours for controlled traces. Optional splitting/prefetch estimated only after measurement. Next assignee: Programmer for RED-first implementation.