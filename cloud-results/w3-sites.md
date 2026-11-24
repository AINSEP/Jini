PARTIAL 2fbc03a5f6 11db7d0f88: the remaining Sites/Workspace/AI-Assistant files need owner decisions (K3 product copy in module-level tool catalogs, AdminExecutionMode kit slot, origin adapter), wait on other lanes (AX-38–41 agent-plugin tokens for CreateSiteOnboarding/Sites/Sites.hooks; w3-rtfnd for the sites/system/fs-files route registrars and native-folder-picker env), or are host policy (see Skipped)

# w3-sites — Sites, Workspace, AI Assistant (Tovu `codex/w3-sites-tovu`, Jini `codex/w3-sites-jini`)

This was an unattended cloud run. An Opus coordinator dispatched 22 builder batches (A–V, plus E2 and C2 follow-ups), at most 4 at a time. It also ran 3 helpers: a Sonnet base-gates helper, a Sonnet why-comments reconcile, and an Opus gate-fix pass (U/U2). Subagents never committed. The coordinator reviewed each report and diff, then committed and pushed per batch.

A container restart killed the first U and why-comments agents mid-run. Their partial edits were committed as `wip` (Tovu `f4946df47`) and then verified and finished by U2 and the retry.

The SHAs on the first line are the last content commits (both are merges of the latest `origin/integ/merge-15-2026-11-23`). The commit that adds this report, and its Jini copy, adds only the report.

**Programmer skills:** `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read before any work. Every builder brief (`BRIEF.md`) carried its rules: test-first for behaviour changes, a named mutation per moved unit, an architecture/self-check, and no weakened tests.

## Setup
- **Bases:** Jini `origin/integ/merge-15-2026-11-23` (`2e0cb890`) and Tovu `origin/integ/merge-15-2026-11-23` (`d3d674941`).
- **Prior branches:** `codex/ex6-sites-*` was merged into both (Jini `31027e6e`, Tovu `bc0ee3861`).
  - The Jini merge had generated conflicts: the `packages/cms/package.json` exports were union-merged, and the api-baselines were regenerated later.
  - The Tovu merge had a conflict in `why-comments-debt.json`, resolved as a union by id.
  - The latest merge-15 head was merged again before the final push: Jini `3a14b438`, Tovu `2fbc03a5f`.
- **Tooling:** Node v22.23.5 (no Node 24 in this sandbox, so `RegExp.escape` suites are ENV-red), pnpm 10.33.2. There is no PostgreSQL and no Playwright chromium binary, so those suites are ENV-red too.
  - Jini: `pnpm install --frozen-lockfile` 0, `pnpm --no-bail -r build` 0.
  - Tovu: `npm ci --ignore-scripts` ×4 0. `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs` 0. contracts tsc 0, sdk build 0.
- **Base gates:** run on clean worktrees `/home/user/base/{Jini,Tovu}` at the ex6-merged base, with the Tovu worktree linked to the base Jini.

## FIX items applied (Tovu `origin/plan/whats-left-1122:reviews/rv1123f.md`, ex6-sites)
| fix | status | where |
|---|---|---|
| 6 coercion after authorization (workspace create/update, assistant test-agent) | APPLIED. Tests written first; mutations M6a–c red | Jini `bc421785` |
| 7 own-property validator lookup (`assistant/shared.ts`) | APPLIED. Test written first; mutation M7 red | Jini `bc421785` |
| 8 workspace wire DTO to core `contracts/site/cms-workspace`; `toAdminWorkspaceResponse({ workspace }, _optional = {})`; pads on `readWebScreenshotInput` / `captureRelativePaths` | APPLIED | Jini `bc421785`, Tovu `a51c1e679` |
| 9 restore `site-profile.ts` why-wording | APPLIED: opening block restored, adjusted only for the injected seam. The remaining lost blocks were reconciled in the why-comments pass | Jini `bc421785`, Tovu `f50b047fc` |
| 10 Tovu admin `workspace-api.types.ts` duplicate DTO | APPLIED: deleted, all importers use core | Tovu `a51c1e679` |

## Batch table
| batch | model | files moved (Tovu → Jini) | importers | tests | status |
|---|---|---|---|---|---|
| A fixes + workspace screen | Opus | `Workspace.tsx`, workspace `rules` (dirty-state), `workspace-port` → admin `screens/workspace`; `workspace-api.types.ts` → core `cms-workspace` | Tovu `Workspace.tsx` is now the host binding; 6 importers | Jini cms 139/139, admin workspace 16; Tovu admin 620/620, website 174/174 | DONE (Jini `bc421785`, Tovu `a51c1e679`) |
| B assistant owner-grant / restart / visitor tools | Opus | `use-assistant-owner-grant`, `VisitorToolsPanel`, `use-visitor-tools` → admin `assistant-settings`; `ai-assistant-api.types.ts` → core; `use-assistant-daemon-restart` deduped onto `useProcessRestart` (+ port file deleted) | 11 files, plus new host bindings | Jini 65/65; Tovu 1629/1629 | DONE (Jini `5d23b69e`, Tovu `13ee3f327`) |
| C / C2 site-inspection, webmcp | Opus | `site-path-policy`, `published-page` → diagnostics `web-evidence`; `page-body` deleted (duplicate); webmcp `settings`, `webmcp-i18n` → cms `webmcp` | 11 importers, including import lines in consent / post / web / settings-registration / public-middleware | Jini diagnostics 457/466 (9 ENV `RegExp.escape`), cms webmcp 4; Tovu 41/41 + 73/76 (3 ENV) | DONE (Jini `79e3c4a8`, `61b00975`; Tovu `af1a7c17c`, `3d39ddfbb`) |
| D web-screenshot adapters | Opus | `capture-files`, `own-site-opener`, `screenshot-image`, `desktop-page-capture` → integrations `web-screenshot` | manifest + 4 tests | Jini +21 (2134 total); Tovu 139/140 (1 ENV chromium) | DONE (Jini `7463cfdd`, Tovu `dce5a7b6d`) |
| E / E2 visitor credential form | Opus | 709-line `use-visitor-credential-form` split into state/handlers/discovery/actions + rules; `visitor-credential-form-port`, `VisitorAssistantPanel` (+hooks) → `assistant-settings`; guard L5 fixed with local BYOK shapes and an injected `presetRules` | `AiAssistant.tsx`, `stored-credential-endpoint.ts`, tests | Jini 88/88; Tovu parity 64/64 + 111/111 | DONE (Jini `b8471665`, `4c27d659`; Tovu `035e5f326`, `ad55a661e`) |
| F workspace remainder | Opus | `use-workspace` → admin `screens/workspace`; `repo.sqlite.ts` → cms `workspace/site`; `features/workspace/index.ts` deleted (re-export only); `routes/workspace/deps.ts` folded into `modules/workspace.ts` | 17 importers | Jini 27 + 79; Tovu 123/123 + 125/125 | DONE (Jini `b591632f`, Tovu `9684932a3`) |
| G sites list / trash | Opus | `AllSitesTab` (split into `SiteCardView`), `SiteTrashTab` → admin `screens/sites`; `use-created-site-return` → ui `site-card` | new host binding `sites-list-tabs.tsx`; `Sites.tsx` | Jini 8 + 70; Tovu sites 508/508 | DONE (Jini `6719dfe8`, Tovu `06548d5ed`) |
| H assistant routes (K1) | Opus | `list-models`, `test-connection`, `detect-agents`, `stored-credential-probe`, `visitor-tools` → cms `admin-http/routes/assistant` specs; `deps.ts` and `execution-deps.ts` folded into the lane modules | `modules/assistant-{execution,settings}.ts`, 8 tests (import lines) | Jini 72/72 (49 new, written first); Tovu 87/87 | DONE (Jini `7914ab0d`, Tovu `962654f6e`) |
| I workspace tools + webmcp panel | Opus | `tool-metadata/workspace` → core; host `workspace/{agent-tools,tool-registrations}` folded into cms `workspace` (`workspace_list`, `workspaceId`), `contributeWorkspaceTools` → cms `workspace/site`; `BrowserAgentSettingsPanel`, `browser-agent-settings` hook → admin `screens/webmcp` | manifest, `SettingsUi`, `App.hooks`, AssistantDock (import / prop lines) | Jini 61 + 25 + 11; Tovu 58/58 + 638/638 | DONE (Jini `82102395`, Tovu `890e7e02c`) |
| J AI Assistant sections | Opus | `AssistantDaemonRestart`, `AdminAssistantSwitch`, `use-admin-assistant-switch`, `use-ai-assistant` (+port) → `assistant-settings` | `AiAssistant.tsx`, `AiAssistant.hooks.ts`; hook-injection debt −3 | Jini 114; Tovu 286/286 | PARTIAL: `AdminExecutionMode` skipped (Jini `b458f4db`, Tovu `33e384f6b`) |
| K fs-files | Opus | `custom-root-permission`, `custom-root-store` → cms `fs-files`; `use-native-folder-picker` → admin `screens/fs-files` | 12 importers (import lines) | Jini 21 + 9; Tovu 59/59 + 1087 (6 DockHeader, fixed in P) | PARTIAL (Jini `b60d28d2`, Tovu `bfafabbd9`) |
| L detect-agents pad, sites services | Opus | none moved (all 7 sites services STOP, see Skipped); `toExecutionTabAgent({ agent }, _optional)` | 3 stale comments | 14/14 | PARTIAL (Jini `8282ed6f`, Tovu `3cbd4e9b7`) |
| M site-dir writers + live-url | Opus | `live-url` → diagnostics `web-evidence`; `init-site` binds platform/fs; `platform/site-dir/atomic-write.ts` deleted (BX-28/29) | site-inspection importers | Jini +23; Tovu 36/38 + 52/53 (ENV / base-red) | DONE (Jini `e210957c`, Tovu `e7e411d60`) |
| N attachment route + request-guard | Opus | `get-chat-attachment` → cms `ServerRoute` (non-JSON), mounted via `mountJiniRoutes`; `web-screenshot/request-guard.ts` shell deleted | `modules/assistant.ts`, new `assistant-attachment-read.ts` | Jini 83/83 (11 new); Tovu 45/45 + 2 new + 97/98 (ENV) | DONE (Jini `bac6c7df`, Tovu `8e0da3baa`) |
| O admin page tools | Opus | `admin-page-tools` (+4 tests) → agentic `core/dom` | `App.hooks.ts` | Jini 43/43; Tovu 25/25 | DONE (Jini `870737d2`, Tovu `92956288f`) |
| P subagents / permanent deletes / tabs + fixes | Opus | `AdminSubagents`, `AdminPermanentDeletes` (+hook), `VisitorAssistantTabs` (+hook) → `assistant-settings`; DockHeader test fixed; 32 stale architecture-baseline edges dropped | `AiAssistant.tsx` | Jini 138; Tovu 1038 | DONE (Jini `fc27493a`, Tovu `35ccf17a1`) |
| Q sites rules / confirm | Opus | sites list resolvers, `use-site-confirm`, `LocalSiteConfirmDialog` → admin `screens/sites` | `Sites.tsx`, `sites-list-tabs.tsx`, `use-sites.hooks.ts` | Jini 20; Tovu 499/499 | DONE (Jini `edc8ceba`, Tovu `983529e64`) |
| R Playwright capture | Opus | `PageCapture*` types → core `contracts/site/web-screenshot`; `playwright-page-capture` (+3 tests, fixture) → diagnostics `web-evidence` | manifest + 4 tests; 2 error-gate debt entries dropped | Jini 39/39 + 30/30; Tovu 59/59 | DONE (Jini `3e1d7d79`, Tovu `f3cb77cf9`) |
| S sites DTOs + data hooks | Opus | `sites-api.types` → core `contracts/site/admin-sites`; `sites-port`, `use-sites-snapshot`, `use-local-sites` → admin `screens/sites` | 30 import lines, `SITES_LISTING` passed at 4 call sites | Jini 42; Tovu 1123 (+ harness fix) | DONE (Jini `476d5356`, Tovu `10d603f35`) |
| T folder drop | Opus | `use-folder-drop` (split + rules) → admin `screens/fs-files` | AssistantDock (import / mock paths) | Jini 55/55 (47 moved or new); Tovu 974/974 | PARTIAL: `layout.ts` STOP (Jini `45e07e35`, Tovu `6d71c6d3b`) |
| U / U2 Tovu gates | Opus | — | stale size / error-gate entries removed; `AiAssistant#1` 103 → ≤ 98; site-inspection no longer imports publish-content; workspace rank removed (folder is test-only) | see Gates | DONE (Tovu `f4946df47`, `4b141940f` (`create.test.ts` import fix)) |
| V rule-6 dedupes | Opus | admin workspace port → core DTO; website visitor-tools view → core; `use-sites-config` → admin `screens/sites` | settings visitor-tools (type imports), `SitesHomeSetting` | Jini 80/80; Tovu 42/42 + 79/79 | DONE (Jini `1405e9db`, Tovu `ef8202220`) |
| coordinator | — | complexity fix in `readWebScreenshotInput`; api baselines + changeset; why-comments allow entries | — | api:check 0 | Jini `e4ec9046`, `1fc4c1d4`, `11db7d0f`; Tovu `f50b047fc` |

**Totals.** About 75 Tovu production sources were moved into Jini or deleted as duplicates/shells (plus ~20 test files moved), and about 700 Jini tests were added or moved. Every moved unit has at least one named mutation: each was planted and seen red, then restored green, and is listed in the commit body.

### Self-check of the Codex failures (before every push)
1. No forwarding files. Deleted: `features/workspace/index.ts`, `web-screenshot/request-guard.ts`, `platform/site-dir/atomic-write.ts`, `site-inspection/page-body.ts`, and the sites/settings barrel lines. Integrations no longer re-exports the `PageCapture*` types. One deprecated alias remains: `AdminWorkspace = AdminWorkspaceResponse`, a type alias kept for the api-baseline.
2. Hooks are REQUIRED props or deps everywhere (`props.useXHook()`). Jini `check:hooks` ok; Tovu `check:hooks` ok, with debt down 3.
3. No express or host loggers in Jini. Diagnostics dropped `express`. Host copy, keys, product preference keys and policy tables come in through args or props (K3).
4. Classes are `jini-*`. Renames are listed per batch in the commit bodies. Old selectors are kept only where another lane still uses them.
5. No new size, complexity or debt entries. One complexity regression this lane introduced (`readWebScreenshotInput`, 11 after the args pad) was fixed. The Jini size and complexity lists are identical to base.
6. Shared wire types have one core owner: `cms-workspace`, `admin-sites`, `web-screenshot`, `tool-metadata/workspace`, and `api-ai-assistant-api-types` (extended). Both the admin and website duplicates were removed.
7. Object args with `_optional = {}` pads throughout, including `toExecutionTabAgent`, `toAdminWorkspaceResponse` and `useSitesConfig`.
8. Behaviour changes were written test-first: fixes 6/7, the X-workspace fold, the attachment ETag pin and the daemon-restart adapter. Named mutations are in every commit.
9. Why-comments moved with the code. The reconcile verified 154 moved or deduped blocks and 12 obsolete test-seam labels (entries name the Jini path and SHA). Tovu unallowed blocks are back to the base 129.
10. A `## Wiring` section exists in every touched Jini folder: admin `assistant-settings`, `workspace`, `sites`, `webmcp`, `fs-files`; cms `workspace`, `workspace/site`, `webmcp`, `fs-files`, `admin-http/routes/assistant`; diagnostics `web-evidence`; integrations `web-screenshot`; agentic `core/dom`; ui `site-card`.

## Skipped (exact reasons)
- **Owner decision (K3, product copy with no args object):**
  - `web-screenshot/agent-tools.ts` ("THIS Tovu site") and its `tool-registrations.ts`.
  - `sites/agent-tools.ts` ("`tovu init`"), `sites/tool-registrations.ts` ("tovu serve") and `contributeSites*Tools()`.
  - `fs-files/layout.ts` (`FS_ROOT_DESCRIPTORS` names the theme plugin, and is used from a module-level const).
  - **Recommendation:** make each catalog a factory that takes the host sentence (one new args object per catalog). Owner approval is needed because K5 forbids new args objects.
- **Owner decision: `AdminExecutionMode`.** It renders ui `ExecutionTab` plus 3 host BYOK components and carries `data-tovu-local-cli`. **Recommendation:** first add an execution-tab kit slot and a neutral `data-jini-local-cli` attribute.
- **Owner decision: `origin/{configured-origin,index}`.** After injecting `TOVU_PUBLIC_URL`, the warning copy, the env and the runtime mode, it would forward to core `resolveConfiguredOrigin`. **Recommendation:** inline the binding in `site-deps/events-origin.ts`, call core directly, and delete the adapter.
- **Host policy (stays):**
  - `site-admin.ts`, `warm-switch.ts`, `sites/deps.ts`, `sites/list-tool.ts` and `sites/index.ts`: `stays-in-tovu.md` lines 399–408. `site-admin` also needs `routes/system/sites.ts` call-body changes, which belong to lane w3-rtfnd.
  - `SitesHomeSetting.tsx` (`TOVU_SITES_*` env, cloud-sync remedy).
  - `use-sites.hooks.ts` (product controller).
  - `use-admin-execution-mode.hooks.ts`, `use-admin-subagents.hooks.ts` (subagent policy on `@tovu/contracts`).
  - `fs-files.ts` (the `.tovu` denylist), and therefore `write-files.ts`, `site-file-request.ts` and `fs-files/{agent-tools,tool-registrations}.ts`.
  - `admin fs-files-api.ts` (the host endpoint binding).
  - `site-inspection/{tool-registrations,deps,agent-tools,index}.ts` (host catalog adapters).
  - `admin-screens.generated.ts` (host data generated by a Tovu test generator).
  - `webmcp/published-html.ts`: cms cannot import agentic, and it would need 4 injections, leaving nothing in Jini.
- **Other lanes:**
  - `CreateSiteOnboarding.tsx`, `Sites.tsx`, `Sites.hooks.tsx` and `use-create-site-plugin-tokens` (AX-44/45 remainder) wait on AX-38–41, the agent-plugin tokens.
  - All site-transfer/export/import files belong to the site-transfer lane.
  - The sites/system/site-profile/fs-files route registrars (`RT-K1-adm-sites-1/2`, `system-14`, `site-1`, `fs-files-1`) are mounted from `http-app/mount-admin-system.ts`, which belongs to lane w3-rtfnd.
  - `fs-files/native-folder-picker.ts` was moved, then reverted because of guard HW9: `mount-admin-system.ts` must pass `env` (w3-rtfnd).
  - `site-preview/**` (AX-81–85) is not in this lane's step list.
- **Playground** stays in Tovu by dispatch.

## Notes and deviations
- **Attachment route (N).** A 20-scenario raw-header harness matched Express except for random 500 `errorId`s and the ETag on an authenticated OPTIONS, which the dispatcher now answers itself. `withExpressValidators` in the lane binding restores the weak ETag and the 304. The comment that says SVG is forced to octet-stream is false (code and behaviour serve SVG inline under the CSP); it moved verbatim and needs an owner fix.
- **Edits outside the lane folders.** `http-app/public-middleware.ts` got an import line only (webmcp). `features/import-export/hooks/use-import-export.hooks.ts` got import and `SITES_LISTING` lines. `features/settings/visitor-tools-*` got type-import lines. Consent, post and web get import plus `reservedSegments`/`trackFetch` injection lines.
- **`content-refresh-coverage.unit.test.ts`** now points at the linked package's built `use-sites-snapshot` (it depends on Jini admin `dist`).
- **Stale comments in other lanes' files**, left alone: `site-transfer-dependencies.hooks.ts` names `sites-port` (it was repointed in the U wip). `capability-inventory.ts` still names `SqliteWorkspaceRepo` (still valid).

## Gates (tip vs base; "base" = clean worktree at the ex6-merged base)
| gate | base | tip |
|---|---|---|
| Jini build | 0 | 0 |
| Jini typecheck | 0 | 0 |
| Jini guard | 1 (HW3 `shell-failure-log`) | 1 (same) |
| Jini api:check | 0 | 0, after `api:update`. One breaking change: the integrations `PageCapture*` exports moved to core (changeset `.changeset/w3-sites-lane.md`) |
| Jini check:cross-package (XP) | ENV: base commit `35c4961af` missing | same ENV |
| Jini check:size | 1 new, 2 worse, 3 stale (redirects, launch, json-ipc) | identical list |
| Jini check:complexity | 4 new (agent-runtime, chat, core reporter, ui ErrorNotice) | identical list |
| Jini check:why-comments | ENV: `origin/refactor/terra` absent in Jini | same ENV |
| Jini check:hooks | ok | ok |
| Jini vitest, changed packages | — | admin 0, core 0, agentic 0. cms: 30 red, all pglite timeouts under load, `RegExp.escape` (ENV) or base-red; `universal-entries.boundary` and `forms package-boundary` fail on base alone too. integrations: 7 postgres (ENV). diagnostics: 11 `RegExp.escape` (ENV) |
| Tovu typecheck (+e2e) | 0 | 0 |
| Tovu admin tsc / desktop tsc | 0 / – | 0 / 0 ×4 |
| Tovu typecheck:scripts | 2 (3 errors) | same 3 |
| Tovu typecheck:tests | — | 0, after the `create.test.ts` import fix |
| Tovu check:hooks | ok | ok (debt −3) |
| Tovu why-comments | 129 | 129 (same hashes) |
| Tovu check:size / complexity / errors | size red (base list), complexity 0, errors WARN | identical size list (`AiAssistant` fixed), complexity 0, errors WARN with the same 3 new/worse |
| Tovu check:boundaries | 0 errors | 0 errors |
| Tovu check-architecture | FAIL: runtime propagation 3.06 → 3.22 | FAIL: 3.24. Same 58 new edges set as base; edges 280 → 272; the module count drop raises the ratio |
| Tovu admin vitest, lane folders | 5 red (JiniMediaPicker ×3, admin-literal-copy, credential-autocomplete) | the same 5; 4572 pass |
| Tovu node tests, 223 lane files | 42 red on the 28 files | 41 red, every one also red on base (PostgreSQL, site-deps characterization, plugin-host, `RegExp.escape`…); 0 regressions |
| Route-table pin | 7/10 red (base drift) | not re-run after H/N. The route order and registrar names are unchanged, but the index shift was not compared to base |

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`; FILES-LEFT = moving + shells; themes excluded)
| commit | moving | shells | total | theme-area | excl. themes | keep (stays-in-Tovu set) |
|---|---:|---:|---:|---:|---:|---:|
| base (merge-15 + ex6, `bc0ee3861`) | 2,247 | 0 | 2,247 | 111 | 2,136 | 361 |
| tip `2fbc03a5f6` | 2,215 | 0 | 2,215 | 111 | 2,104 | 337 |

That is 32 fewer measured moving files, plus 24 fewer files in the scanner's keep set (assistant / dock screens the scanner counts as product, whose generic parts moved). The scanner does not count admin `hooks/`-level moves outside its areas, nor deleted test files.
