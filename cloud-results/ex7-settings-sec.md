PARTIAL 0651499f4 b9d51d2f: per-file-blocked remainder: Security SEC-6..14/SEC-T*/U-AUTH-T1 (owner OD-2, OD-3a-d); X-settings-1 site-title.ts + dependents (owner decision 1); K5-settings-1..4, K5-site-search-1, K5-seo-1, K5-redirects-1 rest, K5-consent-1 rest (service/request/region-plugins/ensure-privacy-defaults/revisions.repo/tool-registrations), K5-analytics-1 config.settings/tool-registrations, A-K2-settings-1..4 product-copy/shell-prereq files, RT-K1-adm-{settings-1/2,consent-1,seo-2,analytics-1}, RT-K1-pub-{middleware-2,visitor-analytics-1,site-seo-render-context-1} (unlanded K4/K5 prerequisites, listed below)

# ex7-settings-sec: Settings, Consent, SEO, Redirects, Analytics + Security (2026-11-23)

This was an unattended cloud run, coordinated by Opus at high effort. 18 subagent batches ran in 5 waves, never more than 4 at a time. Each batch's folders were disjoint, and no subagent committed. I reviewed every diff and committed each batch's Jini and Tovu halves separately.
- Not used: codebase-memory tools, force-push, `--no-verify`, tags, publishing.
- `main`, `integ/*`, `plan/*` and `release/*` were only fetched.
- Wall-clock was about 1h25 of the 3.5h cap (19:51–21:15 UTC). I stopped because every per-file-movable item in the lane is done or listed below with its blocker.

## Bases and provisional foundation
- **Jini** `codex/ex7-settings-sec-jini` = `origin/integ/merge-14-2026-11-22` (4902a6a1a) with these merged in:
  - `ex4-settings-jini` and `ex4-security-jini` (clean)
  - `ex5-fnd-kit-jini`, `ex5-fnd-routes-jini` and `ex3-c0b-jini`. Their only conflicts were in JSON (`packages/admin/package.json`, `cms/package.json`, `api-baseline/jini-ai__core.json`), resolved as a key union.
  - `ex5-fnd-seams-jini` (clean)
  - **Skipped: `ex5-fnd-inject-jini`**. It is non-trivial: 25 files overlap with seams (core `contracts/site/*`, chat run-events, diagnostics), both being parallel K4-seam implementations.
  - Run base = merge commit `7484e2b1`.
- **Tovu** `codex/ex7-settings-sec-tovu` = `origin/integ/merge-13-2026-11-22` (f7185f153a) with these merged in:
  - `ex4-settings-tovu` and `ex4-security-tovu` (clean)
  - `ex2-tovu-halves`, `ex2-holds-tovu` and `ex5-fnd-routes-tovu`. Their conflicts were in why-comments-debt JSON only (union).
  - `ex5-fnd-kit-tovu`: 4 import-line conflicts plus JSON, resolved toward the kit's Jini specifiers at the post-ex2 paths.
  - **Skipped: `ex5-fnd-seams-tovu`**. It conflicts non-trivially: UD on 9 `contracts/core/tool-metadata/*` files, plus `App.hooks.ts` and `use-sites-sidebar-nav*` against the kit.
  - **Skipped: `ex5-fnd-inject-tovu`**. It has 60+ conflicts (tool-metadata, routes, settings).
  - Run base = merge commit `946d066c4`.
- **Setup:**
  - Node 22.23.5 (no /opt/node24 here), pnpm 10.33.2.
  - Jini: `pnpm install --frozen-lockfile` exited 0 and `pnpm --no-bail -r build` exited 0 (0 `error TS`).
  - Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat exited 0/0/0/0. `link-jini.mjs` was run against this Jini checkout. `packages/contracts` tsc exited 0 and `packages/sdk` build exited 0.
  - Base gates ran in clean worktrees at the two run-base merge commits, sharing node_modules.
- **In-flight avoidance:** I listed the files changed by commits on each in-flight branch itself (`ex6-*`, `p12-*`, `bugs-*`, `p11-next-*`, `sec5-jini`, `visitor-chat-tovu`), excluding commits they inherited from the foundation branches. Only these overlap the lane:
  - `apps/website/src/features/settings/visitor-tools-permissions.ts` and its test (ex6-users): not touched.
  - Jini `cms/src/seo/content-analysis/*` (ex6-fnd-shared-a): not touched.
  - `packages/admin/package.json` and `api-baseline/jini-ai__admin.json`: shared registries, additive only.

## Batch table
| batch | subagent | files moved (Tovu → Jini) | importers / host wiring | tests | status |
|---|---|---|---|---|---|
| B1 A-K2-redirects-1 | opus | 2 + 1 test → `admin/screens/redirects` (dictionary split under 500 lines; `ModulePanelHook` gets one neutral owner, `screens/module-panel.ts`, shared with Seo) | 5 lines; panels/panel-pages pass `useModulePanel` + `RedirectsModuleLoading`; lazy-loading test stub | Jini 28/28; 3 mutations red→green | DONE |
| B2 A-K2-analytics-1 (+A-adm-other-1/3 rows) | opus | 7 + 2 tests → `admin/screens/analytics` (`useAnalyticsHook` REQUIRED; jini-* classes) | host `integrations/jini-admin/analytics-{module.hooks,page}.ts`; panel-pages lazy import; `api/analytics-api.ts` stays (host HTTP) | Jini 31/31; 2 mutations | DONE |
| B3 A-K2-content-analysis-1 | opus | 6 + 5 tests → `admin/screens/content-analysis` (port + `useAdminLocale` REQUIRED; core `AdminApiError`; dictionary split) | host `content-analysis-ports.ts`; PostSavedPanels + 4 test mocks; editor.css selectors | Jini 212/212; Tovu ports 3/3; 3 mutations | DONE |
| B4 A-K2-consent-1 | opus | 8 + CSS + tests → `admin/screens/consent` (dictionary split into 5 locale files; injected port/translate hook/errors/section UI). `index.ts` dropped (would have been a forwarder) | host `consent-{ports,screen}.tsx`; panel-pages lazy import; stale size-exception row for the old dictionary removed | Jini 83/83; 6 mutations | DONE |
| W1 RT-K1-adm-seo-1 | opus | 4 routes → `cms/admin-http/routes/seo/*` as `defineJsonRoute` specs + neutral `deps.ts` (host `routes/seo/deps.ts` stays: Express/RouteDeps) | host registrars in `composition/modules/seo.ts` (`mountAdminJsonRoute`/`mountJsonRoute`, pinned 500 copy kept); 7 test imports | Jini 21/21; 2 mutations | DONE (get/put-settings not in the sheet; they stay) |
| W2 X-redirects-1 | opus | `phase-handler.ts` + 2 tests → `cms/redirects/site/phase-handler` (`registerResolvePhase` injected on the existing deps union) | app.ts, site-deps/redirects.ts, 3 tests; barrel lines removed | Jini 6/6 (new supersede test; M1 survived the moved suite before it) | DONE |
| B5 A-K2-settings-1 | opus | 7 of 15 → `admin/screens/settings` (3 dictionaries, memory dictionary split, locale sync, ExternalMcpSharedChoice + hooks over an injected port) | host `settings-{locale-sync,external-mcp-shared-choice}.hooks.ts`; stale hook-debt rows removed | Jini 11/11; 2 mutations | PARTIAL (8 STAY: product copy, see below) |
| B6 K5-consent-1 (partial) | opus | 5 + 3 tests → `cookie-consent/src/site` (config, validation, revisions, cookie-consent, privacy-page-template) | 25 import lines; settings.ts forwarding line removed | Jini 35/35; M1/M2 on new `cssSource` helper | DONE (part) |
| B7 K5-analytics-1 / K5-seo-1 (partial) | opus | `analytics/site/contracts`, `cms/seo/site/capability-card`; analytics barrel deleted (it would only have forwarded) | 6 lines | +4 tests; 1 mutation | DONE (part) |
| C1 jini-* class sweep (rule 4) | opus | — (consent + content-analysis render only `jini-*`) | host CSS copies the old declarations (`consent-screen.css`, editor.css block); parity test pins 34 rule pairs | Jini 399/399 screens; Tovu 995/995; 3 mutations | DONE |
| C2 A-K2-settings-2..4 (partial) | opus | 4 + 1 test (active-tab scroll, ToolsModal hooks, remove-confirm hook with REQUIRED `buildCopy`, interface CSS → jini-*) | 3 harnesses to `render-with-jini-kits` (1 line each) | Jini 20/20; 3 mutations | PARTIAL |
| C3 reporters | opus | `analytics/site/forwarding` (REQUIRED `warn`), `cookie-consent/site/settings` (REQUIRED `reportPrivacyDefaultsFailure`) | host `features/analytics/warn.ts`, `features/consent/privacy-defaults-reporter.ts` (byte-identical console lines) | Jini 10/10 + 2/2; Tovu 8/8 + 87/87; 4 mutations | DONE |
| D1 analytics adapters + salt | opus | `analytics/site/{jini-adapters,salt}` + 3 tests; salt context + forward reporter REQUIRED on `AnalyticsIngestRouteDeps` | host `features/analytics/salt-context.ts` keeps `"tovu-analytics-daily-salt-hkdf-v1"` verbatim; a test pins the derived value captured before the move | Jini 255/255; Tovu 97/97; 2 mutations | DONE |
| D2 consent readiness | opus | `cookie-consent/site/readiness` (node entry; cookie-consent now declares `@jini-ai/core` + `parse5`) + 2 tests | 4 lines | Jini 55/55 | DONE |
| E1 why-comments | sonnet | — | 55 "moved to Jini" allow rows (same style as ex4/ex5); 1 comment restored to analytics INFO.md; 0 truly dropped | run-base check 0 open | DONE |
| E2 sweep | opus | `cms/settings/site/ui-locales-tool` (host injects `ADMIN_LOCALES` and binds its tool metadata) | tool-registrations host wrapper | Jini 5/5, Tovu 5/5 + 39/39; 2 mutations | DONE; all other candidates blocked (below) |
| F1 guard fixes | opus | — (53 → 0 guard violations: screen CSS reads `--jini-admin-*` with shared `--jini-*` fallbacks, and the host maps its values in `consent-screen.css`/`settings.css`; precise `isolation.entries/shared` rows for the moved screens, SEO routes and consent site modules; `ReadonlyMap` for the ui-locales risk map) | | | DONE: guard 0; admin screens 399/399, cms 41/41, cookie-consent 55/55, Tovu 806/806 |
| coordinator | — | hook-injection gate: a REQUIRED host hook prop counts as injected (owner rule 2; test first, red 1/14 → green); consent `useAdminKit` through its hooks bag; content-analysis `useContentAnalysisHook` defaulted to its own package hook; consent preview frame `#fff` → `var(--jini-preview-frame-bg, white)` | | | |

## Steps skipped / still blocked (exact blockers, verified per file)
- **Security lane: nothing new is possible.**
  - SEC-6/8/12/14 and their chains (SEC-7/9/10/11/13) wait on **OD-3 (a)–(d)**, which is unanswered.
  - U-AUTH-T1 waits on **OD-2**, which is unanswered. `P9-SEC-owner-decisions.md` records only OD-1.
  - SEC-T0/T1a-c need all of the above.
  - SEC-10/11 also need the A-K2-0a.chip kit slot.
  - SEC-1/2/3/5 and U-AUTH-1/2/3 were already done (ex4); sec4/sec5 were not redone.
- **X-settings-1 `site-title.ts`** (and so `site-title-write`, `site-title-preservation*`, `form-delivery-write`, `mail-provider`, `visitor-tools-write`, `tool-deps`, `chat-execution-write`, `seo/settings.ts`): held by owner decision 1 (the `LEGACY_SITE_TITLE` product literal).
- **K5-settings-2/3/4 visitor-tools-***: need the `contracts/site-assistant/visitor-tools*` host contracts. Jini core has no visitor-tools contract (K4-seam-11 target). `visitor-tools-permissions.ts` is in flight (ex6-users).
- **K5-consent-1 remainder:**
  - `revisions.repo.ts`: `KyselyKernel` from `@jini-ai/db/kernel` would be a domain-to-domain edge; core has no kernel type (K4-seam-5).
  - `service.ts`: host `request.ts`, `deploymentRefusal`, and `TOVU_ERROR_REDACTION_OPTIONS` logging with no reporter on `ConsentServicePorts`.
  - `request.ts`: `resolveSitePath` (K5-site-inspection-1).
  - `region-plugins.ts`: agent-plugins lifecycle types (K5-agent-plugins-4), plus console logging.
  - `ensure-privacy-defaults.ts`: host `createPost` (V-post-5).
  - `tool-registrations.ts`: tool-metadata/consent (K5-contracts-core-4, in the unmerged inject branch) and `human-confirm` (K5-contracts-core-10).
- **K5-analytics-1 remainder:**
  - `config.settings.ts`: settings barrel (K5-settings-3).
  - `tool-registrations.ts`: tool-metadata/analytics (K5-contracts-core-4).
- **K5-site-search-1:**
  - `index-state-store.ts`: KyselyKernel + `kysely` runtime.
  - `access.ts`, `cms-document-source.ts`: host ContentKernel, routing, and the members/post read-model.
- **K5-seo-1:** `index.ts`, `settings.ts`, `tool-registrations.ts` need the settings barrel (held site-title), post/media/members, platform routing, and tool-metadata.
- **K5-redirects-1:**
  - `repo.sqlite.ts`: host DB kernel. `index.ts` now forwards only that file, so it stays with it.
  - `publish-content.ts`: host publish-content (K5-publish-content-1/3, K4-publish-content-2).
  - `tool-registrations.ts`: host tool-metadata, daemon/platform implementations.
- **A-K2-settings-1..4 remainder:**
  - `external-mcp-i18n.ts` (107 "Tovu" mentions), `settings-capabilities-i18n.ts`, `settings-execution-i18n.ts`, `external-mcp-admissions-rules.ts`, `ExternalMcpToolPicker.hooks.tsx`, `ExternalMcpSettingsPanel.hooks.tsx`, `ai-agent-presentation*`, `use-external-mcp-oauth-connect.hooks.ts` (`"tovu:external-mcp-connected"` message type): product copy in keys and values. Injecting it needs new args objects (STOP rule).
  - `rules.ts` (>500 lines; `lib/execution-settings`, `use-settings-slice`), `use-user-interface-tab`, `use-settings-ui`, `use-admin-appearance-settings`: need shell-lib/hooks prerequisites (A-K2-shell-lib-6/7, -hooks-1/3/4).
  - `AdminAppearance.tsx`: theme, stays.
  - `ExternalMcpRemoveConfirmDialog.tsx`: Tovu `ConfirmActionDialog`.
  - `use-external-mcp*`, `ExternalMcpAdmissionsBanner`, `ExternalMcpToolPicker.tsx`, `ExternalMcpToolsModal.tsx`: A-K2-integrations-1 / A-K2-auth-1.
- **RT-K1 routes:**
  - adm-settings-1/2 need K5-settings-3 and T-theme-1.
  - adm-consent-1 needs K5-consent-1's `service.ts`.
  - adm-seo-2 needs K5-seo-1.
  - adm-analytics-1 needs K4-seam-16.
  - pub-middleware-2, pub-visitor-analytics-1 and pub-site-seo-render-context-1 need K5-consent-1/K5-analytics-1/K5-seo-1 in full.
  - adm-redirects-1 `create.ts` stays (pinned direct-invoke order, ex5-fnd-routes).
- **Dead code (not moved, not deleted):** `apps/admin/src/features/seo/api/seo-api.types.ts` and `features/redirects/api/redirects-api.types.ts` have no importer.

## Owner / Codex review items
1. **Hook-injection gate semantics (Jini `5c95d084`).** The gate accepted only `{ useFooHook = useFoo }` (defaulted). This run's owner rule 2 requires host hooks as REQUIRED props with no package default, so the gate now also accepts a destructured hook prop with no default. Test first.
2. **Product words neutralised in moved literals (P9-BREAKS):**
   - cookie-consent `SITE_CONSENT_DEFAULT_CSS` comment: "Tovu's default cookie banner style" → "Default cookie banner style".
   - validation message: "Tovu cookie preferences reopen through a link." → "Cookie preferences reopen through a link."
   - No test asserts either string. Because `SITE_CONSENT_DEFAULT_CSS` is a settings default, confirm that a changed comment inside the default is acceptable.
3. **log-safety +2 rows (Jini).** `[stored-error-text] cms/admin-http/routes/seo/{deps,put-entry}.ts`. They are wire parity: the 404/400/409 bodies carry `err.message`, exactly as the Tovu routes did (same class as the ex4-security MFA row). Allow them, or change the wire (a behaviour change, test first).
4. **error gate (WARN mode, not failing): +1.** `[catch-reads-error] admin/screens/content-analysis/hooks/use-content-analysis.hooks.ts`, moved verbatim.
5. **Behaviour notes:**
   - A non-`AdminApiError` failure in content-analysis and the external-MCP shared choice now shows the fallback copy instead of `e.message` (core `describeApiError`). The host ports convert every `ApiError`.
   - Content-analysis `STATUS_META.tone` values are now `jini-status-*` (public view-model field).
6. **Analytics `site/ports.ts`** still duplicates 6 root names (ex4 decision 2). No new duplicates were added.
7. **Stale comment-only path mentions** (no code): `features/newsletter/{confirmation,unsubscribe}.ts:45`, `features/origin/INFO.md:187`, `features/site-export/__tests__/site-exporter.test.ts:1029`, `public-http/routes/site/pages/redirect-phase.ts:20`, `platform/db/repos/analytics-sink.ts:12`, `features/plugins/hooks/use-{plugin-remove-confirm,agent-plugin-disable-confirm}.hooks.ts`, `SettingsUi.tsx:102,222`, `development/scripts/write-path-inventory.baseline.json:3455-3473` (phase-handler path; needs a baseline refresh).

## Gates (base-diff; base = clean worktrees at the run-base merges, same linked Jini)
**Tovu** (worktree at the tip; exit codes and rows compared after normalising timings):

| gate | base | tip |
|---|---|---|
| size | 1 | 1. Same rows, minus the removed consent-dictionary exception (file gone) |
| boundaries | 0, 112 warn | 0, **110 warn** (2 analytics deep imports gone) |
| complexity | 1 (App.tsx:676 AdminShell 12, from the foundation merge) | 1, identical |
| hooks | ok, 41 calls | ok, **38** |
| errors | 0 (7 improved) | 0 (**8** improved) |
| architecture | 1 | 1. Same failing row; files 2236 → 2221; deep-import edges 2799 → 2782 |
| typecheck | 2 (2 `plugin-tier2/worker.ts` errors, foundation pairing) | 2, identical |
| typecheck:scripts | 2 | 2, identical |
| typecheck:tests | 2 | 2, identical, after `78c06bef` fixed the one new consent-test literal |
| admin tsc | 0 | 0 |
| why-comments (default base terra) | 1 | 1. No new open id except two allow-listed ancestor ids; run-base check (`--base 946d066c4 --other-root Jini`) **0 open** |

**Jini** (main tree at the tip; base = worktree at `7484e2b1`):

| gate | base | tip |
|---|---|---|
| full build | 0 | 0 (admin/analytics/cms/cookie-consent rebuilt per batch) |
| typecheck | 0 | **0** |
| guard | env-only rows | **0 violations** (after F1 `b9d51d2f`; it was 53 before F1, all from this run's moves) |
| api:check | 0 | **0** (`api:update` per batch; additions only, apart from hash refreshes of the edited `SeoModulePanelHook`/`ContentAnalysisCard*`; the core baseline's key-order churn from the JSON merges was not committed) |
| hooks | ok | **ok** (after the gate fix) |
| size | 1 | 1, identical |
| complexity | 1 | 1, identical |
| log-safety | 1 | 1, **+2 rows** (item 3) |
| errors (WARN) | 26 | 27 (item 4) |
| why-comments `--base 4902a6a1a` | — | 8 open rows, all in `agent-plugins/src/lifecycle/*` and `chat/src/*` (foundation merges); none in files this run touched |
| XP `check:cross-package` | XP1 39 / XP2 33 / XP3 3190 / XP4 860 / XP5 6 | XP1 39 / XP2 33 / XP3 2089 / XP4 760 / XP5 6 (main tree with dist; the base worktree lacks dist, so its XP3/XP4 are inflated). **No XP row names a file this run added or moved**; XP1/2/5 identical |

**Package vitest (Jini, at the tip):**
- admin: 3929/3930. The 1 red is `theme-boundaries`, about the consent `#fff`; it is fixed in `57625939` and the test passes now.
- analytics: 255/255.
- cookie-consent: 276/276.
- cms: the run's dirs (`admin-http/routes/seo`, `redirects/site`, `seo/site`, `settings/site`) pass in each batch's runs.

**Tovu tests:**
- **Admin vitest:** 119 files, every lane importer: 3040 passed, 3 red.
  - 2 are BASE-RED, identical in the base worktree: `panel-access` "database/redirects declares only ids its server route checks".
  - 1 is a load flake that passes alone (28/28): `app-sites-section-visibility`.
- **After waves 3–4:** 79 files, 1530/1530 green.
- **Node:** 96 files (every changed test, every test importing a changed production file, every W1/W2 importer). Hubs `composition/app.ts` and `server/routes/types.ts` were skipped, as in combine-13. 88 green, 8 red, and **all 8 are BASE-RED with identical counts at base**:
  - `mcp-ui-tool-calls-route.static-publish` 3/1
  - `template-render.canary` 4/8
  - `share-database.integration` 37/1
  - `request-cost-cacheability.measurement` 3/12
  - `request-cost-render-work.measurement` 1/4
  - `site-phase-handler-fail-policy` 0/2
  - `seo-site-serving` 7/2
  - `publish-site-route` 31/3
- Earlier interim runs also matched base: `automatic-agent-plugins` 41/2, `member-pages.route` 8/8, `app.consent-capture` 5/3, `create-app-boot-work` 4/1, `bundled-inactive-gating` 7/1.

## Self-check (Codex's 11-22 findings)
1. **No re-export or forwarding files.** Moved sources are deleted, and barrels that would only forward were deleted (analytics, consent admin `index.ts`), with their users repointed. Host glue files hold real bindings.
2. **Every host hook reaches a Jini component as a REQUIRED prop:** `useAnalyticsHook`, `useAdminLocale`, `useTranslate`, `useExternalMcpSharedChoiceHook`, `useModulePanel`. Jini-own hooks may default.
3. **No Express types or host loggers in Jini.** Reporters are injected (analytics warn and forward-failure, consent privacy-defaults), and K1 specs carry no Express types.
4. **`jini-*` classes only.** The C1 sweep has tests; host CSS keeps the look, pinned by a parity test.
5. **No new size-exception or debt rows.** Hook-debt and size-exception rows only shrank. The why-comments allow rows follow the accepted moved-to-Jini practice (rv-d §47).
6. **Shared types have neutral owners:** `ModulePanelHook` in `screens/module-panel.ts`, `ConsentProblem` and `Tracker` from core contracts, `AdminApiError` from core.
7. **Every behaviour-changing slice records a named mutation** (table above). Verbatim moves rely on their moved tests.

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`, ROOT set, clean worktrees)
| tree | moving | shells | **FILES-LEFT** | excl. theme areas (111) |
|---|---|---|---|---|
| integ-13 (`f7185f153`), for reference | 2,483 | 3 | 2,486 | 2,375 |
| run base (foundation merged, `946d066c4`) | 2,390 | 0 | **2,390** | **2,279** |
| tip | 2,338 | 0 | **2,338** | **2,227** |

This run moved **52** files.

Lane areas, base → tip:

| area | base | tip |
|---|---|---|
| adm-other (admin screens) | 407 | 371 |
| analytics | 7 | 4 |
| consent | 13 | 7 |
| redirects | 5 | 4 |
| seo | 4 | 3 |
| settings | 20 | 19 |
| site-search | 3 | 3 |

The admin screens also moved several files the scanner tracks outside these areas (route files, tests).

## Wiring docs
Each Jini destination folder has a README `## Wiring` section that links `docs/decisions/DR-005-portable-package-boundaries.md`:
- `admin/screens/{redirects,analytics,content-analysis,consent,settings}`
- `cms/admin-http/routes/seo`
- `cms/redirects/site`
- `cms/settings/site`
- `cms/seo/site`
- `analytics/site`
- `cookie-consent/site`

Tovu `features/analytics/INFO.md` and `features/redirects/{INFO,README}.md` are updated.

## Commits
**Jini `codex/ex7-settings-sec-jini`** (after the foundation merges, newest first):
```
b9d51d2f8 fix(admin,cms,cookie-consent): guard clean for the ex7 moves (L7 css tokens, SI-domain isolation, HW3 readonly map)
ff0a31441 chore(api): record the ui-locales settings tool entry
e08f469ff feat(cms): K5-settings-1 move the UI-locales settings tool; the host injects its locale list and binds its tool metadata
57625939c fix(admin): consent preview frame background comes from a variable (theme-boundaries: no literal colours in package CSS)
83c8288d1 chore(api): record the cookie-consent readiness and analytics adapters/salt entries
dba49da81 feat(analytics): K5-analytics-1 move the site ingest adapters and daily salt with the host salt context and forward-failure reporter injected
bf5cb6d5f feat(cookie-consent): K5-consent-1 move the site consent readiness check (node entry; declares parse5)
3cca50aa1 chore(api): record settings, forwarding, consent settings and class-sweep entries
94a75c1e0 fix(admin): consent and content-analysis screens render only jini-* class names
30e3608b1 feat(analytics,cookie-consent): K5-analytics-1 / K5-consent-1 move analytics forwarding and site consent settings with injected host reporters
e02020f14 feat(admin): A-K2-settings-2..4 (partial) move the active-tab scroll, external-MCP dialog hooks and interface-settings CSS from the host
b4f335fc1 feat(cookie-consent): K5-consent-1 (partial) move the site consent config, validation, revisions, cookie and privacy-page template from the host
91a0fb502 chore(api): record the consent, settings, seo-route, redirects phase-handler, analytics and capability-card entries
13562b5e1 feat(analytics,cms): K5-analytics-1 / K5-seo-1 (partial) move the analytics site contracts and the SEO capability card from the host
b078fe547 feat(admin): A-K2-settings-1.J move the settings dictionaries, locale sync and the external-MCP shared choice from the host (partial)
5c95d0842 fix(guard): hook-injection accepts a required host hook prop; consent and content-analysis call package hooks through injectable props
5b398e374 feat(cms): RT-K1-adm-seo-1.J SEO entry, analyze and sitemap admin routes as K1 specs with per-route deps
3f31b3b6c feat(cms): X-redirects-1.J move the redirects phase handler from the host with an injected registerResolvePhase
cc0d1fcda feat(admin): A-K2-consent-1.J move the cookie-consent screen, autosave, rules and dictionary from the host
533930137 chore(api): record the redirects, analytics and content-analysis screen entries in the admin API baseline
ddf5a91ab feat(admin): A-K2-content-analysis-1.J move the content-analysis card, rules, hooks and dictionary from the host
50ef13009 feat(admin): A-K2-analytics-1.J move the Analytics screen, dictionary and port types from the host
84c4737e6 feat(admin): A-K2-redirects-1.J move the Redirects screen mount and dictionary from the host
```
**Tovu `codex/ex7-settings-sec-tovu`** (after the foundation merges, newest first):
```
0651499f4 fix(admin): host maps its theme values onto the --jini-admin-* tokens the Jini consent and settings CSS reads
78c06befd test(consent): pass the host privacy-defaults reporter in the registration-failure readiness case (typecheck:tests)
9c0eadd7f chore(why-comments): record the comments that moved to Jini in ex7-settings-sec; restore the analytics barrel purpose in INFO.md
bc2f33d46 refactor(settings): K5-settings-1.T repoint the UI-locales tool to Jini; the host binds its locale list and tool metadata
684cb1577 refactor(analytics): K5-analytics-1.T repoint ingest adapters and salt to Jini; host injects its salt context and forward-failure reporter
bf0afde50 refactor(consent): K5-consent-1.T repoint the consent readiness check to @jini-ai/cookie-consent/site/readiness
c027471f0 fix(admin): host CSS paints the jini-* classes of the Jini consent and content-analysis screens
8fc7795e7 refactor(analytics,consent): K5-analytics-1 / K5-consent-1.T repoint forwarding and site consent settings to Jini; host injects its [analytics] and [consent] reporters
f9f190390 refactor(admin): A-K2-settings-2..4.T (partial) repoint active-tab scroll, external-MCP dialog hooks and interface CSS to Jini; host passes the remove-confirm copy builder
93e763038 refactor(consent): K5-consent-1.T (partial) repoint the site consent config, validation, revisions, cookie and privacy template to @jini-ai/cookie-consent/site
310656868 refactor(analytics,seo): K5-analytics-1 / K5-seo-1 (partial) repoint the analytics site contracts and SEO capability card to Jini; drop the analytics barrel
f499f6a41 refactor(admin): A-K2-settings-1.T repoint settings dictionaries and locale sync to Jini; host binds the external-MCP shared-choice port
8a31ddbf3 refactor(seo): RT-K1-adm-seo-1.T mount the Jini SEO admin route specs from the host seo module
41dc26c2e refactor(redirects): X-redirects-1.T repoint the phase handler to @jini-ai/cms/redirects/site and inject the host registerResolvePhase
03cb14297 refactor(admin): A-K2-consent-1.T mount the Jini cookie-consent screen with host ports, translate hook and section UI
3196116e2 refactor(admin): A-K2-content-analysis-1.T mount the Jini content-analysis card with the host port and locale hook
0fe105eee refactor(admin): A-K2-analytics-1.T mount the Jini Analytics screen with the host-bound controller hook
353c6a7bb refactor(admin): A-K2-redirects-1.T mount the Jini Redirects screen and inject its host hooks
```
The report commit follows on Tovu, with its copy on Jini.

