PARTIAL e0ecca846 9ea24d37: left = host-kernel repos (consent revisions.repo, site-search index-state-store, settings/redirects repo.sqlite, site-title-preservation*) waiting on a neutral Kysely kernel in core (K4-seam-5); consent request.ts (error-gate pin); settings barrel index.ts (~212 importers across other lanes) + visitor-tools-agent-tools/-permissions (host copy/grants); admin ExternalMcp* cluster + ai-agent-presentation* + rules/use-settings-ui/appearance (need hosted-mcp wire types and execution-card types in core: owner decision); RT-K1 settings/consent/seo-2/redirects-2/analytics/pub-* routes (lane w3-rtfnd)

# w3-settings: Settings, Consent, SEO, Redirects, Analytics (wave 3, 2026-11-23/24)

Unattended cloud run. Opus coordinated and Opus/Sonnet subagents built. No more than 4 subagents ran at once, and none of them committed. I reviewed each diff and committed every batch per repo, splitting shared files hunk by hunk where two batches touched the same file. Programmer contract read: `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5).
- Wall clock: 22:20 → 00:25 UTC, about 2h05 of the 3.5 h cap.
- The container restarted twice (23:37 and 00:10). Each time, the in-flight subagent edits were found on disk, committed as `wip:` and pushed, and the agents were re-dispatched from those commits. Nothing was lost.
- Not used: codebase-memory tools, force-push, `--no-verify`, tags, publishing. `main`, `integ/*`, `plan/*` and `release/*` were only fetched.

## Base and setup
- **Branches:** Jini `codex/w3-settings-jini` and Tovu `codex/w3-settings-tovu`, both from `origin/integ/merge-15-2026-11-23` (Jini `0a44b54c`, Tovu `bd89a2aa8`). The latest merge-15 head (`60c6cd52` / `33701312a`) was merged in at 23:36. A re-check at 00:22 found nothing newer.
- **combine-15 had HELD `ex4-settings`:** it reverted Jini `c379b4a0c` and Tovu `047fc74dd` over rv1123c Settings FIX 2/3.
  - This run re-applied it by reverting those reverts (Jini `f7c94c23`, Tovu `4c0392a99`). Then it applied the FIXes on top.
  - why-comments-debt.json was union-merged.
- **Prior `codex/ex7-settings-sec-*`:** cherry-picked rather than merged.
  - The branch also carries `ex4-security`, which combine-15 held, and old foundation merges.
  - Merging it would have re-imported held security work (17 security conflicts), so only its own 23 Jini / 18 Tovu lane commits were picked (`git cherry-pick -x`).
  - The conflicts were all import lines where merge-15 had moved types to core contracts and ex7 had moved the module to Jini. Each was resolved with Jini on the module and core on the types.
  - The JSON conflicts were union-merged.
  - Security (SEC-*) is not in this lane's list. It was not touched.
- **Setup:**
  - Node 22.23.5. No Node 24 here, so `RegExp.escape` is missing; see ENV below.
  - Jini: `pnpm install --frozen-lockfile` 0, `pnpm --no-bail -r build` 0 (0 `error TS`). The container's setup had left 41 modified tracked files (package.json/README/plugin.json rewrites from an older catalog) and stale `dist`. I restored them and rebuilt clean.
  - Untracked setup leftovers were left alone and not committed: `packages/agent-plugins/core/commerce-server.{d.ts,mjs}` and `packages/*/LICENSE`.
  - Tovu: `npm ci --ignore-scripts` (root/admin/desktop/site-chat) 0, `link-jini.mjs` 0, `packages/contracts` tsc 0, `packages/sdk` build 0.
  - Base gates ran in worktrees `/home/user/base/{Jini,Tovu}` at merge-15, with Tovu linked to the base Jini.

## FIX items applied (Tovu `origin/plan/whats-left-1122:reviews/rv1123*.md`)
The only review rows for this lane's prior branches are **rv1123c `codex/ex4-settings-*` FIX 1–3**. No rv1123 file reviews `ex7-settings-sec`.
| FIX | status | where |
|---|---|---|
| 1 (timezone reporter without raw text; seo-i18n split + 21-locale parity) | **VERIFIED**, present in the re-applied ex4 | Jini `cms/settings/site/site-timezone.ts` and Tovu `site-timezone-fallback.ts` + test; `admin/screens/seo/seo-i18n*.ts` (21/21 parity) |
| 2 (inject `ensureSettingDefinitions`/`getEffective` into the 7 Jini settings modules; bind in Tovu) | **APPLIED** | J `7f5a07d4`, T `67c9a3a95`. Core owns `EnsureSettingDefinitionsPort`/`GetEffectivePort`; Tovu binds once on `siteTitleSettingsDeps` plus per reader. Mutation: form-destination `getEffective` key → `"wrongKey"` → red |
| 3 (thread one host legacy title through registration/preservation/resolution, then move) | **APPLIED** | J `432c7e7c`, T `48066d938`. `LEGACY_SITE_TITLE` stays in Tovu `site-title-legacy.ts` (K3). Test first: 22/1 → 23/0. Three hard-coded-string mutations each red |

## Batch table
| batch | model | files moved (Tovu → Jini) | importers / host wiring | tests | status |
|---|---|---|---|---|---|
| re-apply ex4 + cherry-pick ex7 | coordinator | (ex4: 6 settings modules, seo/analytics/site-search pieces; ex7: 52 files) | conflicts resolved toward Jini module / core type | — | DONE |
| A rv1123c FIX 1–2 | opus | — (7 Jini modules re-plumbed) | 10 prod + 18 test files | J cms 17/17, search 5/5 (+8 new); T 531 pass, 2 BASE-RED | DONE |
| B K5-consent-1 / K5-analytics-1 | opus | consent `service`, `region-plugins`, `ensure-privacy-defaults`, `tool-registrations`; analytics `tool-registrations`, `config.settings` (6) | 12 prod + 7 tests; host `features/consent/host-bindings.ts` (byte-identical `[consent]` lines, test first) | J 55/55 + 29/29; mutation `[consent-x]` red | DONE (2 stay, below) |
| C K5-redirects-1 | opus | `tool-registrations`, `publish-content` (2); forwarding `index.ts` deleted | 14 | J 12/12; T 156/156; 2 mutations | DONE (repo.sqlite stays) |
| E X-settings-1 site-title (FIX 3) | opus | `site-title.ts` | 19 | J 3 new; T 43/51 files green, rest ENV/BASE-RED | DONE |
| G A-K2-settings-1 | opus | `external-mcp-i18n` (split 162 + 3×326), `use-external-mcp-oauth-connect.hooks` (2) | 10 admin files; host `integrations/jini-admin/settings-external-mcp-{copy,oauth-connect.hooks}.ts` | J 26/26; T admin 511/511; 3 mutations | PARTIAL (rules/picker blocked) |
| H K5-site-search-1 | opus | `cms-document-source`, `access` (2), local posts table slice, kysely type-only peer | 2; host `cms-search-rules.ts` | J 384/384; T 90/90; mutation red (2 J + 6 T) | DONE (index-state-store stays) |
| D K5-seo-1 | opus | `seo/settings` (431 lines), `seo/tool-registrations` (2); `seo/index.ts` keeps host wiring, its forwarding block deleted | 14 (the get/put-settings handlers only spread `seoSettingsHostBindings` into existing deps) | J 280/280; M1–M6 red | DONE |
| G2 A-K2-settings-2 | opus | `settings-execution-i18n`, `SettingsUi.hooks`, `ExternalMcpRemoveConfirmDialog` (3) | 13 admin files; host `settings-execution-copy.ts` | J 32/32; T 1099/1099; 2 mutations | PARTIAL |
| F1 K5-settings-1/2 write cluster | opus | `site-title-write` (chokepoint), `form-delivery-write`, `mail-provider`, `tool-deps`, `chat-execution-write` (5) | 22; host `settings-write-policies.ts` binds `writePolicies` once, so the barrel `set` keeps its shape for ~25 callers | J 30/30; T 594/595 (1 BASE-RED); 2 mutations | DONE |
| G3 interface panel | opus | `UserInterfaceSettingsPanel.tsx` (jini-settings-interface-switch classes); forwarding `admin-ui/index.ts` deleted | 6; styles.css selector appends only, parity test | J 36/36; T 714/714; 2 mutations | DONE (AdminUi stays: product composition) |
| F2 K5-settings-2/3/4 visitor tools | opus (resumed after restart) | `visitor-tools-{write,configure,service,registrations}`, `visitor-tools-contract` (port types), `publish-content` (6) | host `VISITOR_TOOLS_HOST` in settings-write-policies; publish manifest binds 5 collaborators | J 38/38; T all settings tests green; 2 mutations | DONE (3 stay) |
| I K5-settings-4 confirm-write | opus | `settingsConfirmWrite` builder (the ~45-line card closure) | Tovu `tool-registrations.ts` keeps its rule tables + `SETTINGS_CONFIRM_COPY` (K3) | J 4 new; T 214/214; 2 mutations | DONE |
| log-safety fix | opus (resumed) | site-title failures go to injected reporters with a fixed message + errorClass | host `site-title-reporter.ts` + test | J 8/8; T 67/70 (3 ENV) | DONE |
| why-comments ×2, stale paths, gate fixes | sonnet + coordinator | — | 47 debt rows (each names the Jini file); comment-path repoints; arch-baseline/error-gate-debt rows of deleted files; 4 tests following moved signatures; AiAssistant scope label via host helper (size back to base) | gates below | DONE |
| G4 ai-agent presentation | opus | — | README note only | — | BLOCKED (owner decision, below) |

## Skipped / still in Tovu (exact reason, recommendation)
- **Kysely kernel repos:** consent `revisions.repo.ts`, site-search `index-state-store.ts`, settings `repo.sqlite.ts` / `site-title-preservation{,.sqlite}.ts`, redirects `repo.sqlite.ts`.
  - They need `KyselyKernel` query/execute plus the `kysely` runtime. Core only has `StorageKernel.run`, so moving them would add a new domain→`@jini-ai/db` edge.
  - redirects/settings `repo.sqlite.ts` are pure host connection wiring: after injection, the Jini file would only forward.
  - **Rec:** land K4-seam-5 (neutral query/execute kernel port in core) first; keep the two `repo.sqlite.ts` files in the host.
- **consent `request.ts`:** pinned by `development/eslint-rules/__tests__/error-gate.unit.test.ts:72` as a reviewed sample site. Jini already receives its three functions through `ConsentToolHost`.
- **settings `index.ts` barrel:** ~212 importers across other lanes' folders, and it still holds host-bound `set`/`clear` and `createSettingsPrincipalLookup`. Editing 212 other-lane files breaks lane ownership.
  - **Rec:** a dedicated sweep after wave 3 that repoints core forwards to `@jini-ai/core/settings` and host-bound functions to `settings-write-policies.ts`.
- **`visitor-tools-agent-tools.ts`** (model-facing catalog copy + host tool policy) and **`visitor-tools-permissions.ts`** (14 lines of host grants on identity): these are host product policy.
- **settings `tool-registrations.ts`:** only the card closure moved (batch I). The rule tables and confirmation copy are product policy and stay (K3).
- **seo `index.ts`:** real host wiring (post/media/members/routing/outbox ports + `seoSettingsHostBindings`).
- **admin `external-mcp-admissions-rules.ts`, `external-mcp-tool-picker-rules.ts`, `ExternalMcpToolPicker{,.hooks}.tsx`, `use-external-mcp-tool-picker.hooks.ts`, `use-external-mcp{,-admissions}.hooks.ts`, `ExternalMcpAdmissionsBanner`, `ExternalMcpToolsModal`, `ExternalMcpSettingsPanel{,.hooks}`:** need `AdminToolRefusalReason`, `AdminRemoteToolSurfaceEntry`, `AdminFederatedAdmissionEntry`, `AdminExternalMcpConfigFailure`, `AdminExternalMcpAdmissionsSnapshot` (host `integrations-api.types`), and `useWiredSourceConfigAddForm` (`@jini-ai/ui`).
  - **Rec:** A-K2-integrations-1 moves those wire types into `@jini-ai/core/contracts/hosted-mcp`. The `{productName}` keys and vars are already in place.
- **admin `ai-agent-presentation.ts`, `use-ai-agent-presentation.hooks.ts`:** these hit a genuine owner decision.
  - admin→ui is an L1 layer edge (both layer 5).
  - The ui `DetectedAgent`/`ExecutionPort`/`ExecutionConfig` (27 exports in `ui/src/features/execution/types.ts`) have no core owner. Core's `DetectedAgent` is a different shape.
  - **Recommendation: option 1**: move the execution-card types to `@jini-ai/core/contracts/execution` as one unit and have ui import them. Option 2 (generic structural functions) would duplicate field names (self-check 6).
  - `isDesktopAdmin` stays in the host either way.
- **admin `rules.ts` (502 lines), `use-settings-ui`, `use-user-interface-tab`, `use-admin-appearance-settings`, `AdminAppearance.tsx`, `SettingsUi.tsx`:** need shell-lib/hooks prerequisites (A-K2-shell-lib-6/7, -hooks-1/3/4) and theme (frozen). `use-user-interface-tab` stays as the host hook that the moved panel takes as a required prop.
- **admin `settings-capabilities-i18n.ts`:** all 8 keys describe the product's own backend state. Its header records that it was moved out of Jini on purpose (K3: stays).
- **AdminUi.tsx:** product composition (mounts AdminThemes/AdminAppearance/IntegrationsRedirect, host routes). Only its forwarding `index.ts` was removed.
- **RT-K1 `adm-{settings-1/2,consent-1,seo-2,redirects-2,analytics-1}`, `pub-{middleware-2,visitor-analytics-1,site-seo-render-context-1}`:** route conversions belong to lane w3-rtfnd and were not touched. Settings functions those routes need are now injected (seo-2 and render-context are unblocked on that side).

## Owner / Codex review items
1. **Collaborator pass-through in route handlers.** `routes/seo/{get,put}-settings.ts` and `routes/assistant/visitor-tools.ts` spread host bindings into their existing deps; their registration is untouched. If w3-rtfnd converts them, keep `seoSettingsHostBindings` / `VISITOR_TOOLS_HOST`.
2. **Log content changed for secret-safety (site-title).** Both lines dropped the exception text, matching the rv-d Settings 1 precedent.
   - The pin failure went from `… stays pending, pin failed: <err.message>` to `preserveLegacySiteTitles: workspace stays pending, pin failed` with `{workspaceId, errorClass}`.
   - The render fallback changed the same way.
   - Tests pin the exact lines and that the secret is absent.
3. **Dictionary keys changed text, not output.** Five external-MCP keys and one settings-execution/ai-assistant scope key now carry `{productName}`. The host fills it, and the rendered text is identical (de/ja/en pinned).
4. **Accepted moved-verbatim gate rows (Jini):**
   - log-safety `[stored-error-text]` `cms/admin-http/routes/seo/{deps,put-entry}.ts`: wire parity, carried from ex7 item 3.
   - check:errors (WARN, exit 0) `[catch-reads-error]` content-analysis hook (ex7 item 4) and `cookie-consent/site/service.ts`, plus `[failure-text-from-catalog]` `cms/settings/site/visitor-tools-write.ts`. Those were Tovu error-gate debt rows before the move.
5. **Tovu boundaries:** +5 warnings, all warn-level and 0 errors. 4 are `no-deep-imports` into `features/settings/site-title-legacy.ts` from render sites; 1 is `tool-catalog-manifest → visitor-tools-agent-tools`. Making them barrel imports would mean growing the forwarding barrel, so I left them.
6. **Tovu architecture** (already failing at base): the propagation cost moved 3.26% → 3.33% (runtime). 2 new edges, `site-search/cms-search-rules.ts → members/index.ts, post/read-model.ts`: the host binding that replaces the moved file's own imports. NEW-edge count 58 → 57.
7. **api-baseline/jini-ai__admin.json** was rewritten in the generator's canonical order. The cherry-pick JSON union had reordered it; the semantic diff is 27 additions only.
8. **`mcp-ui-allowlist-completeness.test.ts:91`** still lists `features/settings/tool-registrations.ts` `toolId`. It is harmless (the test is BASE-RED 10/1 anyway); the owner can drop it.

## Gates (base = merge-15 worktrees; tip = branch heads above)
**Jini**
| gate | base | tip | new at tip |
|---|---|---|---|
| build | 0 (0 TS) | 0 (0 TS) | — |
| typecheck | 0 | 0 | — |
| guard | 1 (HW3 shell-failure-log) | 1 | 0 real; 3 rows on untracked setup leftovers `agent-plugins/core/commerce-server.*` |
| api:check | 0 | 0 | after `api:update` (`8496e279`): additions only, plus 12 cms / 2 search / 1 cookie-consent signature changes from the injected ports |
| XP `check-no-cross-package` | — (hard-coded base missing) | XP1/2/3/5 clean, XP4 760 = base | 0 |
| size / complexity | 1 / 1 | 1 / 1 | identical |
| hooks | 0 (2 debt) | 0 (0 debt: shrank) | — |
| log-safety | 1 | 1 | 2, owner item 4 (site-title rows fixed) |
| errors (WARN) | 0 (29) | 0 (32) | 3, owner item 4 |
| why-comments `--base merge-15` | — | ok, 0 lost | — |

**Tovu**
| gate | base | tip | new at tip |
|---|---|---|---|
| size | 1 | 1 | 0. AiAssistant restored to base by `581fe6745`; the consent-dictionary exception is gone |
| boundaries | 0, 106 warn | 0, 108 warn | +5/−3 warn (item 5) |
| complexity | 0 | 0 | — |
| hooks | ok 41 | ok 38 | — |
| errors (WARN) | 0 | 0 | 0 after `581fe6745` (debt rows followed the moved validator) |
| architecture | 1 | 1 | item 6 |
| typecheck | 0 | 0 | — |
| typecheck:scripts | 2 (3) | 2 (3) | identical |
| typecheck:tests | 0 | 0 | 0 after `e0ecca846` (was 9) |
| admin tsc | 0 | 0 | — |
| why-comments `--base merge-15 --other-root Jini` | — | ok: 106 lost, 106 allow-listed | — |

**Tests**
- **Jini vitest (changed dirs), all green:**
  - cms `settings/site,seo,redirects/site` 334/334
  - search 384/384
  - cookie-consent 276/276
  - analytics 255/255
  - admin `screens/{settings,seo,consent,analytics,redirects,content-analysis}` 415/415
  - core `settings` 363/363
- **Tovu node:** 250 files (every changed test plus importers of changed production files; hub fan-out skipped). 3378 pass, 70 fail, in 21 red files, **all 21 BASE-RED** (identical failing test names at merge-15).
  - Many failures in them are ENV: `RegExp.escape is not a function` on Node 22.
  - The red files are: automatic-agent-plugins 41/2, mail-send.golden 0/1, site-chat-stream.golden 8/1, wiring-identity 5/1, template-render.canary 4/8, share-database 37/1, seo-site-serving 7/2, publish-site-route 31/3, site-exporter 29/17, site-title.integration 6/3, member-pages.route 8/8, site-title-preservation 8/4, create-app-boot-work 4/1, domain-no-direct-tool-registration.boundary 6/1, mcp-ui static-publish 3/1, themes-trash-restore 19/7, preview-tool 9/2, composition-served-site-dir 9/1, app.consent-capture 5/3, pages-html-revisions-wiring 0/2, process-root-parity 6/1.
  - The 4 test files edited at the end: 22/22, 22/22, 10/10, 9/9.
- **Tovu admin vitest:** 103 files, 2242 pass, 1 fail. The failure is `seo-swap` heading lookup, a load flake: 12/12 alone at both tip and base.

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs`, `origin/plan/whats-left-1122`)
| tree | FILES-LEFT | excl. theme areas (111) |
|---|---|---|
| merge-15 (`bd89a2aa8`) | **2,269** | **2,158** |
| after ex4 re-apply + ex7 cherry-picks | 2,206 | 2,095 |
| tip | **2,181** | **2,070** |

That is 88 fewer files left. 130 Tovu files were deleted and 119 Jini source files added since merge-15 (all three lanes' work). The scanner counts the new host binding files (`site-title-legacy`, `site-title-reporter`, `settings-write-policies`, `cms-search-rules`, `consent/host-bindings`, `analytics/{warn,salt-context}`) as feature files, which is why moves this run net fewer than they removed.

| area | base | tip |
|---|---|---|
| settings | 25 | 11 |
| consent | 13 | 4 |
| analytics | 9 | 2 |
| redirects | 5 | 1 |
| seo | 5 | 1 |
| site-search | 4 | 2 |
| adm-other (admin screens) | 380 | 336 |

## Self-check (before every push)
1. **No forwarding files:** moved sources deleted. Forwarders removed: `redirects/index.ts`, `admin-ui/index.ts`, the seo/index forwarding block, the settings barrel lines for moved names, and the `settingsDerivedRisk` forward. The settings barrel itself stays (item above).
2. **Host hooks:** they reach Jini components as REQUIRED props (`useUserInterfaceTabHook`, the OAuth-connect port, `ConfirmDialog`, translators), with no default host hook in Jini. `pnpm check:hooks` debt went 2 → 0.
3. **No server-framework types or host loggers in Jini:** reporters are injected for consent, site-title, region-plugins and analytics.
4. **jini-\* classes only:** the interface switch, pinned by a host CSS parity test.
5. **No new size-exception rows:** the external-MCP dictionary was split, and the AiAssistant line count was restored to base.
6. **Shared wire types:** core owns the settings ports and `DetectedAgent`. The visitor-tools / site-search / seo structural port types are feature-owned. The admin types needing a core owner are listed as blocked rather than duplicated.
7. **Object args:** `(required, _optional = {})` throughout.
8. **Behaviour changes:** test first, with a named mutation per batch (table).
9. **Why-comments:** moved with the code; 47 reworded or retired comments recorded in debt rows naming their Jini file.
10. **`## Wiring`:** present in every touched Jini folder README (`cms/settings/site`, `cms/seo/site`, `cms/redirects/site`, `cookie-consent/site`, `analytics/site`, `search`, `admin/screens/settings`). Tovu INFO/README updated for settings, seo (new INFO.md), redirects, consent, analytics and site-search.

## Commits
Jini `codex/w3-settings-jini`, oldest first (non-merge):
```
f7c94c23 revert(w3-settings): re-apply ex4-settings-jini held by combine-15 (its review FIX 2/3 are applied on this bran
b2eb6be0 feat(admin): A-K2-redirects-1.J move the Redirects screen mount and dictionary from the host
d45a9373 feat(admin): A-K2-analytics-1.J move the Analytics screen, dictionary and port types from the host
c1199207 feat(admin): A-K2-content-analysis-1.J move the content-analysis card, rules, hooks and dictionary from the hos
e1863de5 chore(api): record the redirects, analytics and content-analysis screen entries in the admin API baseline
210ebe1d feat(admin): A-K2-consent-1.J move the cookie-consent screen, autosave, rules and dictionary from the host
5a6bf084 feat(cms): X-redirects-1.J move the redirects phase handler from the host with an injected registerResolvePhase
669f0f60 feat(cms): RT-K1-adm-seo-1.J SEO entry, analyze and sitemap admin routes as K1 specs with per-route deps
9b56dd17 fix(guard): hook-injection accepts a required host hook prop; consent and content-analysis call package hooks t
dff55594 feat(admin): A-K2-settings-1.J move the settings dictionaries, locale sync and the external-MCP shared choice f
7b170af9 feat(analytics,cms): K5-analytics-1 / K5-seo-1 (partial) move the analytics site contracts and the SEO capabili
cb85787f chore(api): record the consent, settings, seo-route, redirects phase-handler, analytics and capability-card ent
fcc00232 feat(cookie-consent): K5-consent-1 (partial) move the site consent config, validation, revisions, cookie and pr
b9061cc7 feat(admin): A-K2-settings-2..4 (partial) move the active-tab scroll, external-MCP dialog hooks and interface-s
f1af5c2a feat(analytics,cookie-consent): K5-analytics-1 / K5-consent-1 move analytics forwarding and site consent settin
5ba3f10c fix(admin): consent and content-analysis screens render only jini-* class names
19b2fe7a chore(api): record settings, forwarding, consent settings and class-sweep entries
f45d027a feat(cookie-consent): K5-consent-1 move the site consent readiness check (node entry; declares parse5)
de78d9ff feat(analytics): K5-analytics-1 move the site ingest adapters and daily salt with the host salt context and for
4b19e4de chore(api): record the cookie-consent readiness and analytics adapters/salt entries
7b56e336 fix(admin): consent preview frame background comes from a variable (theme-boundaries: no literal colours in pac
b06dbf5d feat(cms): K5-settings-1 move the UI-locales settings tool; the host injects its locale list and binds its tool
23e07859 chore(api): record the ui-locales settings tool entry
7a90f019 fix(admin,cms,cookie-consent): guard clean for the ex7 moves (L7 css tokens, SI-domain isolation, HW3 readonly 
7f5a07d4 fix(cms,search,core): rv1123c Settings FIX 2 — settings registrars and readers take ensureSettingDefinitions/
d6ac4368 feat(cms): K5-redirects-1.J move the redirects tool registrations and publish-content contribution from the hos
d161109e feat(admin): A-K2-settings-1.J move the external-MCP dictionary (split under 500 lines) and OAuth-connect hook;
a55d401b feat(cookie-consent,analytics): K5-consent-1 / K5-analytics-1 move consent service, region plugins, privacy def
a5007a3e feat(search): K5-site-search-1 move the CMS search document source and access port from the host (local posts t
432c7e7c feat(cms): X-settings-1.J move site-title from the host (rv1123c Settings FIX 3); the legacy title is a require
0a389cac feat(admin): A-K2-settings-2.J move the settings-execution dictionary, SettingsUi translators and the external-
05c361d0 feat(cms): K5-seo-1.J move the SEO site settings and tool registrations from the host; settings ledger function
fb20f389 feat(admin): A-K2-settings-2.J move the user-interface settings panel; the host's tab hook is a required prop, 
4c08fe40 chore(changeset): w3-settings lane changesets
6f92828b feat(cms): K5-settings-1/2.J move the settings write chokepoint (site-title-write), form-delivery/mail-provider
f5dab255 wip(cms): F2 visitor-tools move + site-title log-safety reporter (in progress; interrupted by a container resta
56fa9845 fix(cms): site-title failures reach injected reporters with a fixed message and error class, never the raw exce
cd169571 wip(cms): F2 visitor-tools checkpoint
8f6e87e5 feat(cms): K5-settings-2/3/4.J visitor-tools management and site-setting publishing from the host (completes th
8418b2b5 chore(changeset): settings write cluster, visitor tools, site-title reporters
19a94e82 feat(cms): K5-settings-4.J settingsConfirmWrite builder — the settings confirm-write card closure from the ho
8496e279 chore(api): record the w3-settings entries (additions only; 12 cms + 2 search + 1 cookie-consent signature chan
9ea24d37 fix(cms): restore the second line of the confirm-write options why-comment (moved verbatim)
```
Tovu `codex/w3-settings-tovu`, oldest first (non-merge):
```
4c0392a99 revert(w3-settings): re-apply ex4-settings-tovu held by combine-15 (its review FIX 2/3 are applied on this bra
9fde2e6f4 refactor(admin): A-K2-redirects-1.T mount the Jini Redirects screen and inject its host hooks
a8a33229c refactor(admin): A-K2-analytics-1.T mount the Jini Analytics screen with the host-bound controller hook
a2b7da417 refactor(admin): A-K2-content-analysis-1.T mount the Jini content-analysis card with the host port and locale 
f49e83459 refactor(admin): A-K2-consent-1.T mount the Jini cookie-consent screen with host ports, translate hook and sec
ff4277ecd refactor(redirects): X-redirects-1.T repoint the phase handler to @jini-ai/cms/redirects/site and inject the h
c493fd206 refactor(seo): RT-K1-adm-seo-1.T mount the Jini SEO admin route specs from the host seo module
c3354ae36 refactor(admin): A-K2-settings-1.T repoint settings dictionaries and locale sync to Jini; host binds the exter
cff116141 refactor(analytics,seo): K5-analytics-1 / K5-seo-1 (partial) repoint the analytics site contracts and SEO capa
5a46bac27 refactor(consent): K5-consent-1.T (partial) repoint the site consent config, validation, revisions, cookie and
acbd87f28 refactor(admin): A-K2-settings-2..4.T (partial) repoint active-tab scroll, external-MCP dialog hooks and inter
ffe9e6ef6 refactor(analytics,consent): K5-analytics-1 / K5-consent-1.T repoint forwarding and site consent settings to J
87eaf1840 fix(admin): host CSS paints the jini-* classes of the Jini consent and content-analysis screens
3adb86826 refactor(consent): K5-consent-1.T repoint the consent readiness check to @jini-ai/cookie-consent/site/readines
1b5c38667 refactor(analytics): K5-analytics-1.T repoint ingest adapters and salt to Jini; host injects its salt context 
0244824c8 refactor(settings): K5-settings-1.T repoint the UI-locales tool to Jini; the host binds its locale list and to
256280da7 chore(why-comments): record the comments that moved to Jini in ex7-settings-sec; restore the analytics barrel 
3150c2d77 test(consent): pass the host privacy-defaults reporter in the registration-failure readiness case (typecheck:t
cc2fd13c2 fix(admin): host maps its theme values onto the --jini-admin-* tokens the Jini consent and settings CSS reads
67c9a3a95 fix(settings): rv1123c Settings FIX 2.T — bind core ensureSettingDefinitions/getEffective into the Jini sett
d282c740a refactor(redirects): K5-redirects-1.T repoint tool registrations and publish contribution to @jini-ai/cms/redi
39a8a5720 refactor(admin): A-K2-settings-1.T use the Jini external-MCP dictionary and OAuth-connect hook; host binds por
62cc5389d refactor(site-search): K5-site-search-1.T use the Jini CMS search document source and access port; host binds 
d3d24ebc1 refactor(consent,analytics): K5-consent-1 / K5-analytics-1.T repoint consent service, region plugins, privacy 
48066d938 refactor(settings): X-settings-1.T / rv1123c Settings FIX 3 — site-title from @jini-ai/cms; LEGACY_SITE_TITL
08fc4daf1 chore(why-comments): record the 22 comments reworded or retired by the w3-settings moves (each row names the J
181f539f8 refactor(admin): A-K2-settings-2.T use the Jini settings-execution dictionary, SettingsUi translators and remo
c01d028df refactor(seo): K5-seo-1.T use the Jini SEO site settings and tool registrations; features/seo/index.ts keeps t
0f8137f44 chore(w3-settings): repoint comment/doc paths to the new Jini owners; drop architecture-baseline edges and err
7178227f3 refactor(admin): A-K2-settings-2.T mount the Jini user-interface settings panel with the host tab hook; host C
734dcce4f refactor(settings): K5-settings-1/2.T use the Jini settings write chokepoint and writers; the host binds its w
ee04d230a wip(settings): F2 visitor-tools repoint + site-title fixed-text reporter (in progress; interrupted by a contai
ee7dbfc8f fix(settings): host binds fixed-text site-title failure reporters (completes ee04d230a); INFO.md documents sit
d8bab22ad docs(admin): record why ai-agent-presentation and the external-MCP panel hooks stay (admin->ui is an L1 layer 
f0cbb55b2 wip(settings): F2 visitor-tools checkpoint
f8eadff6e refactor(settings): K5-settings-2/3/4.T use the Jini visitor-tools management and site-setting publish contrib
db04fd275 chore(why-comments): record 25 more comments reworded by the seo, settings-write, visitor-tools and admin sett
fa271f46b refactor(settings): K5-settings-4.T tool-registrations keeps its rule tables and card copy (SETTINGS_CONFIRM_C
581fe6745 fix(w3-settings): gates back to base — AiAssistant scope label via a host helper (size 611 -> base 610 lines
e0ecca846 test(w3-settings): typecheck:tests back to 0 — four tests follow the moved signatures (FormDeliveryBindingsC
```
The report commit follows on Tovu, with its copy on Jini.
