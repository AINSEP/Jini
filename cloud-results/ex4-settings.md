PARTIAL 4b921c1e4 38cb35dc: X-settings-1 site-title.ts (owner decision 1); blocked on unlanded prerequisites: X-redirects-1, K5-settings-1/2/3/4, K5-analytics-1, K5-site-search-1, K5-consent-1, K5-redirects-1, K5-seo-1, A-K2-settings-1/2/3/4, A-K2-consent-1, A-K2-redirects-1, A-K2-analytics-1, A-K2-content-analysis-1, RT-K1-adm-{settings-1/2,consent-1,seo-1/2,redirects-1/2,analytics-1}, RT-K1-pub-middleware-2, RT-K1-pub-visitor-analytics-1, RT-K1-pub-site-seo-render-context-1

# ex4-settings — Settings, Consent, SEO, Redirects, Analytics (2026-11-22)

Unattended cloud run, Opus high, no subagents. Lane per `plans/P9F-check.md` (corrected) + `plans/P9F-feature-lanes.md` on `origin/plan/whats-left-1122` (`18f1b17c0`).

- **Bases:** Jini `origin/integ/merge-14-2026-11-22` `4902a6a1`. Tovu `origin/integ/merge-13-2026-11-22` is `f7185f153` (the stated `0d7f78fa4` plus one docs-only commit, the combine-13 report). Both branches start there.
- **Branches (plain `git push`, never force):** Jini `codex/ex4-settings-jini`, content tip `38cb35dc`; Tovu `codex/ex4-settings-tovu`, content tip `4b921c1e4`. The SHAs on the first line are these content tips; the commits that add this report (Tovu) and its copy (Jini) follow them.
- **Done in this run:** 5 steps, both halves each (X-settings-1 with 6 of its 7 files). **12 Jini-bound files left Tovu** (FILES-LEFT 2,486 → 2,474). No new red test, and every Tovu gate is equal to base or better. Jini adds two ratchet rows from verbatim-moved code; both are listed for the owner (decision 3).
- **Not used / not touched:** no subagents, no codebase-memory tools, no force-push, no `--no-verify`, no tags, no publish. `main`, `integ/*`, `plan/*`, `refactor/terra` were only fetched. `apps/admin/src/features/settings/api/settings-api.ts` (P0.T, another branch) is untouched.
- **`_optional = {}` pads:** none removed or renamed. Every moved file keeps its pads byte for byte; the new `Seo` signature keeps `_optional: Record<string, never> = {}`.

## Setup
- Node 24.22.3 (`/opt/node24`), pnpm 10.33.2, npm 11.
- Jini: `pnpm install --frozen-lockfile` 0; `pnpm --no-bail -r build` 0 (0 `error TS`). After each Jini commit the changed package was rebuilt (`pnpm run build` in `packages/<pkg>`) and `pnpm api:update` run; Tovu links the Jini packages dir, so it saw each rebuild directly.
- Tovu: `npm ci --ignore-scripts` in root, admin, desktop, site-chat: 0/0/0/0. `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`: 82 links. `packages/contracts` tsc 0, `packages/sdk` build 0.
- **Base gates (Tovu)** ran in a clean `git worktree` at `f7185f153` sharing `node_modules` (`cloud-results/ex4-settings-raw/tovu-base/`). Jini base = combine-14's final gates on the same commit (`cloud-results/combine-14-jini-raw/gates-final/`).
- Test runner: each file alone, 15-min watchdog, 3 in parallel. Node files: the root `npm test` imports (`node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks`). Admin files: `npx vitest run <file>` in `apps/admin`. Jini: `npx vitest run <dir>` in the package.

## Steps

| step | files moved (Tovu → Jini) | importers repointed | tests | mutation | status |
|---|---|---|---|---|---|
| **X-settings-1** | 6 of 7 → `@jini-ai/cms/settings/site/{admin-interface,chart-provider,form-delivery,form-destination,mail-sender,site-timezone}`. **`site-title.ts` held** (decision 1) | 32 specifier lines (the sheet's list minus site-title, plus `form-submissions.ts` at :17 now) + 11 barrel users of the 3 deleted `settings/index.ts` re-export lines (13 names) | Jini: new `site-timezone.unit.test.ts` 4/0 (characterization, tests-first). The sheet's `site-timezone-local-fallback` test uses `t.after` (more than an import-line edit → STOP 5), so it stays in Tovu, repointed. Tovu: 45 files, 44 green; 1 BASE-RED (`automatic-agent-plugins.integration` 41/2, same as combine-12/13) | `ownerTimeZone` `===`→`!==`: Jini 2/4 red; **Tovu wiring check** via linked dist: `site-timezone.test.ts` 4/7 red; both restored green | DONE (6/7) |
| **X-analytics-1** | 2 → `@jini-ai/analytics/site/{agent-tools,ports}` | 9 lines + 6 barrel users of the 2 deleted `analytics/index.ts` re-export blocks (19 names) | Jini: new `site-ports.test.ts` 2/0. Tovu: 10/10 files green (120 tests) | sheet's "first if" does not exist (interfaces + empty classes); planted `permission: "analytics.read"`→`write` → 1/2 red; restored green | DONE |
| **X-seo-1** | 1 → `@jini-ai/cms/seo/site/page-head-contributor` | 3 lines (barrel line deleted; `extra-head.ts` already imported directly) | Jini: new `page-head-contributor.unit.test.ts` 2/0. Tovu: 14 files (seo + `extra-head` importers): 13 green, 1 BASE-RED (`render.golden.characterization` 12/1, identical in the base worktree) | `!ctx.entry`→`ctx.entry` → 1/2 red; restored green | DONE |
| **X-site-search-1** | 1 → `@jini-ai/search/site/settings` | 4 lines | Jini: the host's `settings.test.ts` copied as characterization (principal lookup stubbed, core `set`) 4/0; the Tovu copy stays as the consumer test. Tovu 4/4 files green | `!isSearchProviderId(value)` negated → 3/4 red; restored green | DONE |
| **A-K2-seo-1** | 2 → `@jini-ai/admin/screens/seo` (`Seo`) and `./screens/seo/seo-i18n` (+ `typesVersions`) | 4 lines + K5hook wiring: `panels.tsx` passes `useModulePanel` and `SeoModuleLoading` (through the existing `panel-pages` import), `seo-host.harness` and `seo-swap` pass them; `admin-route-lazy-loading` mock path → the Jini specifier | Moved: `seo-i18n-parity` (21 locales). New Jini `Seo.unit.test.ts`. `Seo.hooks.unit.test.tsx` needs the host harness → stays in Tovu (repointed). Jini 23/0. Tovu admin: 22 files green after the lazy-loading fix below | named: rename one `es` key → parity 1/23 red; `tabId !== null`→`===` → 2/23 red; restored green | DONE |

**Jini side of every step:** verbatim copy; only changes are same-package imports made relative (`@jini-ai/cms/forms` → `../../forms/index.js`, `@jini-ai/analytics` → `../index.js`, `@jini-ai/search` → `../index.js`, …), "Tovu" in comments → "the host" (4 comments: `admin-interface.ts:64`, `analytics/site/ports.ts:2,155`, `page-head-contributor.ts:13`, `seo-i18n-parity` test), and `COMMON_I18N` → `ADMIN_COMMON_I18N` (K4i). Export entries in the dist-triple shape plus `jini.entries`; `api-baseline` deltas are additions only (cms +7 entries, analytics +2, search +1, admin +2). One changeset per step (`.changeset/p9-<step>.md`, patch).

**Guard follow-up (Jini `38cb35dc`):** `pnpm guard` flagged two new SI-domain/runtime findings from these moves:
- `settings/site/site-timezone` reaches `widgets/date-label` at runtime. Fixed by adding `src/widgets/date-label.ts` to cms `jini.isolation.shared` (as `markers/marker.ts` and `media/cover-image.ts` already are; it imports only `@jini-ai/core/errors/idioms`).
- `seo/site/page-head-contributor` reaches the node-only `cover-image.ts` (parse5). Its entry runtime is now `node`, the same as `./seo/cover-image`.
- `pnpm guard` is then 0 violations.

**Lazy-loading test (Tovu `777b05bc2`):** `admin-route-lazy-loading.unit.test.tsx` "opening navigation…" went from 806 ms to 4.9 s and timed out (5 s) under 3-way parallel load. Base passes under the same load. Cause: the test mocks each eager bridge (`features/seo` among them), which hid `integrations/jini-admin/modules.hooks` (the whole host admin module scope). `panels.tsx` now imports the hook itself. Production's eager graph is unchanged: `features/seo` already imported both modules eagerly. Fix: the test stubs those two host modules with `vi.doMock` at the same thin-adapter seam. Every assertion is unchanged. Back to 822 ms; 52/52 under load.

## Steps skipped (prerequisite not landed in these bases) — verified per file, not only from the sheet's `Depends on`
| step | blocking prerequisite (not in Jini merge-14 / Tovu merge-13) | evidence |
|---|---|---|
| X-redirects-1 | C-platform-routing-1 | `phase-handler.ts:6` imports `registerResolvePhase` from `#src/platform/routing/index`; no `packages/cms/src/routing/site` |
| K5-settings-1 | K4-seam-11/13/21/4 (+ held `site-title.ts`) | core has no `contracts/site/{site-assistant-visitor-tools-management,core-settings-vocabulary,assistant-agent-discovery,platform-mail}`; the only verbatim file, `form-delivery-write.ts`, imports `./site-title-write.js` (in this step), and `site-title-preservation*` import the held `site-title.ts` |
| K5-settings-2/3/4 | K5-settings-1, K4-seam-1/5/11, X-identity-1, X-webmcp-1, K5-publish-content-3, K4-publish-content-2, K5-contracts-core-6/10, K5-contracts-headless-2 | sheet deps; none landed |
| K5-analytics-1 | K4-seam-3/6, K5-contracts-core-2/4, K5-settings-3 | |
| K5-site-search-1 | K4-seam-5, K5-platform-routing-1, K5-contracts-core-3, K5-post-3, V-members-3 | |
| K5-consent-1 | K4-seam-15/5/1, K5-contracts-core-10/4, K5-agent-plugins-4, V-post-5 | |
| K5-redirects-1 | X-redirects-1, K5-publish-content-1/3, K4-publish-content-2, K5-contracts-core-6/4 | |
| K5-seo-1 | K4-seam-5, K5-settings-3, V-post-5, V-media-3, V-members-3, K5-platform-routing-1, … | |
| A-K2-settings-1–4, A-K2-consent-1, A-K2-analytics-1 | A-K2-0 (only 0a landed), A-K2-shell-lib-*, A-adm-shell-lib-*, A-adm-other-*, A-K2-integrations-1, … | e.g. Tovu `lib/admin-http/*`, `hooks/use-admin-locale.hooks` |
| A-K2-redirects-1 | A-adm-shell-lib-2 | `redirects-i18n.tsx:2` imports `../../lib/merge-locale-overlays` (Tovu lib, not in Jini) |
| A-K2-content-analysis-1 | A-K2-shell-lib-4, A-adm-shell-lib-1, A-K2-shell-hooks-3 | `rules.ts:1` / `content-analysis-dependencies.hooks.ts:1-2` import `@/lib/admin-http/*`; `use-content-analysis.hooks.ts:3` imports `@/hooks/use-admin-locale.hooks` |
| RT-K1-adm-{settings-1/2, consent-1, seo-1/2, redirects-1/2, analytics-1}, RT-K1-pub-middleware-2, RT-K1-pub-visitor-analytics-1, RT-K1-pub-site-seo-render-context-1 | RT-K1-0.T (only RT-K1-0.J is in Jini merge-14), plus R-admin-http-1 / K5-* / K4-seam-14/16/6 per sheet | P9F-check: close RT-K1-0.T and BX-53/54 before mount cutovers |

## Owner decisions
1. **`site-title.ts` (X-settings-1) is held.** `LEGACY_SITE_TITLE = "Tovu Demo Site"` is more than a comment:
   - It is the definition default of `core.site.title`.
   - It is the value pinned onto every pre-existing workspace.
   - It is the render fallback on every failed read.
   The sheet's "rename to the jini form" would change the title that existing sites render and store (`ensureSettingDefinitions` reconciles a changed core default). STOP 3 applies: a product literal. Options:
   - (a) K3: the host passes the legacy title through the existing `EnsureSiteTitleSettingDefinitionInput` and resolver deps.
   - (b) Keep `site-title.ts` in Tovu permanently.
   K5-settings-1's `site-title-write` / `site-title-preservation*` and the SEO test that imports it wait on this.
2. Analytics `site/ports.ts` duplicates 6 names that Jini's own `src/ports.ts` already exports with different shapes or identities: `AnalyticsPiiRejectedError`, `AnalyticsSinkPort`, `AnalyticsConfigPort`, `AnalyticsHooks`, `IngestDeps`, `AnalyticsSinkCapabilities`. The move is verbatim, so behaviour is unchanged (the classes stay distinct; a test pins it). Merging the two is a follow-up decision.

3. **Two Jini ratchet rows from moved code.** Both files moved verbatim, and the Tovu gates allowed them where they were:
   - size: `admin/src/screens/seo/seo-i18n.ts` has 1567 lines, the 21-locale dictionary. Jini's `size-exceptions.json` takes owner-approved entries only.
   - log-safety: `[error-text] cms/src/settings/site/site-timezone.ts` (1). The debt file "may only shrink".
   Approve the exception and the debt row, or ask for a split of the dictionary and a change to the log shape. The log change would be a behaviour change, so it needs a test first.

## Minor findings (LISTED, not fixed)
- `features/analytics/tool-registrations.ts:50` keeps `catalogModule: "features/analytics/agent-tools.ts"`. This is a descriptive diagnostics label that now names a moved file. Changing it is more than a specifier edit (STOP 6).
- `X-analytics-1` / `A-K2-seo-1` sheets name a mutation target with no `if`; the substitutes are recorded above.
- The X-settings-1 sheet's named mutation targets `site-title.ts` (held) with a test of `site-timezone`; the substitute is on `site-timezone.ts`.
- `cms/src/seo/__tests__/support/legacy-api.fixture.ts` keeps its own simplified `createSeoPageHeadHook` (no cover/OG alignment). It is a test fixture, not a collision, but it now differs from `seo/site/page-head-contributor`.
- Desktop tsc ×4 not re-run: no desktop file imports any moved module (the repoint sweep covered `apps/`).

## Gates (base-diff; raw in `cloud-results/ex4-settings-raw/`)
**Tovu**: base is a clean worktree at `f7185f153`; final is the tip. All runs use the same linked Jini.

| gate | base | final | note |
|---|---|---|---|
| size | exit 1 (BASE-RED rows) | exit 1, **same rows** | the `panels.tsx` +1 row from the first wiring was removed in `fd163c6c0` |
| boundaries | 0, 112 warnings | 0, **111 warnings** | −1: `runtime-preferences.ts → settings/admin-interface.ts` deep import gone |
| admin tsc | 2 (4 `jini-kits.ts`/`main.tsx` AdminKit errors: Jini merge-14's kit vs Tovu merge-13) | 2, **identical 4** | BASE-RED |
| typecheck (+e2e) | 0 | 0 | |
| typecheck:tests | 0 | 0 | |
| typecheck:scripts | 2 | 2, identical errors | BASE-RED |
| errors (WARN) | 3 new/worse | identical | |
| complexity | ok, 0 | identical | |
| hooks | ok | identical | |
| why-comments (vs `origin/refactor/terra`) | 80 open | **80, same set** | 5 moved-to-Jini rows added to `development/why-comments-debt.json` (`4b921c1e4`), each naming its Jini commit |
| architecture | FAILED: runtime-only propagation 3.06 → 3.29 | **identical row** (3.29) | files 2271 → 2261; API surface 687 → 681; all-import 12.45 → 12.46 (still "improved" vs ratchet) |

**Jini**: base is combine-14's final gates on `4902a6a1` (`cloud-results/combine-14-jini-raw/gates-final/`); final is the tip.

| gate | base | final | note |
|---|---|---|---|
| full build | 0 | **0** (0 `error TS`) | |
| typecheck | 0 | 0 | |
| guard | ok | **ok, 0 violations** | after `38cb35dc` |
| api:check | 0 | 0 | `api:update` deltas are additions only (+12 entries) |
| hooks | ok | ok | |
| why-comments `--base 4902a6a1` | — | **0 lost** | |
| why-comments default (terra) | exit 1 | identical | |
| complexity | exit 1 (BASE-RED rows) | **identical** | |
| error gate (WARN) | 25 new/worse | identical | |
| XP `check:cross-package` | 1: XP1 39 / XP2 33 / XP3 2050 / XP4 760 / XP5 6 | **identical counts**; no row names a file this run added | shallow clone deepened by 400 to reach `35c4961af` |
| **size** | exit 1 | exit 1, **+1 NEW: `packages/admin/src/screens/seo/seo-i18n.ts` max-lines 1567** | moved verbatim (the 21-locale SEO dictionary). `size-exceptions.json` admits owner-approved entries only → **owner decision 3** |
| **log-safety** | exit 1 | exit 1, **+1 NEW: `[error-text] packages/cms/src/settings/site/site-timezone.ts`** | moved verbatim (`resolveSiteTimeZone`'s fallback log). The debt file "may only shrink", so it was not added → **owner decision 3** |

Changed Jini packages' full vitest: analytics 228/228, search 375/375, admin 3110/3110, cms 5026/5027. The 1 cms red is `cms/forms/src/__tests__/package-boundary.test.ts` (version `0.7.2` vs `0.7.3-next.2`), **identical at `4902a6a1`** in a clean worktree: BASE-RED.

## Tovu tests (final sweep at the tip; raw `final-tests.txt`)
- **Set:** 169 files = every test file the run changed, plus every test that directly imports a changed production file, plus each step's sheet list. Hubs skipped, as in combine-13: `composition/app.ts` (471 test importers, one specifier change) and `server/routes/types.ts` (177, type-only change). That is 142 node files and 27 admin vitest files.
- **163 green, 6 red. All 6 are BASE-RED**, with identical counts in the base worktree:
  - `automatic-agent-plugins.integration` 41/2
  - `domain-no-direct-tool-registration.boundary` 6/1
  - `owner-passkey-http.integration` 0/1
  - `mail-send.golden` 0/1
  - `plugin-host.integration` 22/3
  - `render.golden.characterization` 12/1
- `admin-route-lazy-loading` is 52/52 under 3-way load after the stub fix. Before the fix it was 51/1 under load, while base was 52/52 under the same load.
- Per-step runs: `xs1-tests.txt`, `xa1-tests.txt`, `xseo-tests.txt`, `xss-tests.txt`, `aseo-tests.txt`. Mutation outputs: `mutations.txt`.

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs`, plan ref `18f1b17c0`)
| tree | moving | shells | **FILES-LEFT** | excluding the scanner's theme areas (111) |
|---|---|---|---|---|
| base `f7185f153` | 2,483 | 3 | **2,486** | **2,375** |
| tip | 2,471 | 3 | **2,474** | **2,363** |

−12 = X-settings-1 6, X-analytics-1 2, X-seo-1 1, X-site-search-1 1, A-K2-seo-1 2. Lane areas (website): settings 25→19, analytics 9→7, seo 5→4, site-search 4→3; redirects 5 and consent 13 unchanged. The base number equals combine-13's final (2,486 / 2,375).

## Commits
**Jini `codex/ex4-settings-jini`** (base `4902a6a1`):
- `37902e97` feat(cms): X-settings-1.J move six settings modules from the host
- `65febfe6` feat(analytics): X-analytics-1.J move agent-tools and site ports from the host
- `020ec101` fix(analytics): X-analytics-1.J narrow the catalog entry in the characterization test
- `31c512b2` feat(cms): X-seo-1.J move the SEO page-head contributor from the host
- `ce1f6809` feat(search): X-site-search-1.J move the search-provider setting from the host
- `18b88b85` feat(admin): A-K2-seo-1.J move the SEO screen mount and dictionary from the host
- `38cb35dc` fix(cms): guard SI-domain/runtime for the moved settings and SEO site entries
- (report copy commit follows)

**Tovu `codex/ex4-settings-tovu`** (base `f7185f153`):
- `91a959437` refactor(settings): X-settings-1.T repoint six settings modules to @jini-ai/cms/settings/site
- `5da59b25a` refactor(analytics): X-analytics-1.T repoint agent-tools and ports to @jini-ai/analytics/site
- `0f4ac7eb6` refactor(seo): X-seo-1.T repoint the page-head contributor to @jini-ai/cms/seo/site
- `45ab84bdc` refactor(site-search): X-site-search-1.T repoint the provider setting to @jini-ai/search/site/settings
- `777b05bc2` refactor(admin): A-K2-seo-1.T mount the Jini SEO screen and inject its host hooks
- `fd163c6c0` fix(admin): A-K2-seo-1.T take the SEO mount hooks through panel-pages
- `4b921c1e4` chore(why-comments): record the five comments that moved to Jini in ex4-settings
- (report commit follows)

**Merge note for Codex review:** each T half needs its J half linked. Jini `38cb35dc` covers all five.

Raw outputs: `cloud-results/ex4-settings-raw/` (gates base/final, test tables, mutations, files-left).
