PARTIAL 1a3ef34888 b7f1102f0: most of the lane is blocked by files owned by in-flight branches (ex4-*, ex5-{collections,small}, bugs-medium, ex5-fnd-{seams,inject}) or by unlanded prerequisites (K4-seam-11/21/22, C-contracts-core-6, V-contracts-core-9) — see "Skipped". The why-comments gate has a +51 delta that needs an owner decision (see Gates).

# ex6-sites — Sites, Workspace, AI Assistant lane (Tovu `codex/ex6-sites-tovu`, Jini `codex/ex6-sites-jini`)

This was an unattended cloud run at Opus high. A coordinator ran 10 batch subagents in three waves (4 + 3 + 3), plus one Sonnet helper for comment restores. Each batch was disjoint, and no subagent committed. Every batch was reviewed, built and tested by the coordinator, then committed per batch and pushed.

The SHAs on the first line are the last content commits. The commit that adds this report (and its Jini copy) adds only the report.

## Setup
- **Bases:**
  - Jini is `origin/integ/merge-14-2026-11-22` (`4902a6a1a`).
  - Tovu is `origin/integ/merge-13-2026-11-22` (`f7185f153`).
- **Provisional foundation, merged into the working base:**
  - **Jini** merged `ex5-fnd-kit-jini`, `ex5-fnd-seams-jini`, `ex5-fnd-routes-jini` and `ex3-c0b-jini`. The c0b merge had one generated conflict in `api-baseline/jini-ai__core.json`, resolved with a 3-way key merge (0 real conflicts).
    - **Skipped:** `ex5-fnd-inject-jini`, a non-trivial conflict across 23 core/chat/diagnostics files. Jini base is `06a816f39`.
  - **Tovu** merged `ex2-tovu-halves`, `ex2-holds-tovu` and `ex5-fnd-kit-tovu`. The holds↔kit conflict covered 3 files: `settings-api` moved to `lib/admin-http` (holds) while its imports went to Jini (kit), and both were kept. Tovu also merged `ex5-fnd-routes-tovu`.
    - The `why-comments-debt.json` conflicts were resolved by a 3-way merge keyed on entry id.
    - **Skipped:** `ex5-fnd-seams-tovu` (13 conflicts: modify/delete on 9 tool-metadata files and 4 admin hooks) and `ex5-fnd-inject-tovu` (≈60 conflicts). Tovu base is `009dda7d1`.
  - The skipped branches' files were still treated as off limits.
- **Tooling:** Node 24.22.3 (`/opt/node24`) and pnpm 10.33.2.
  - Jini: `pnpm install --frozen-lockfile` exited 0, and `pnpm --no-bail -r build` exited 0 at base and again at the tip.
  - Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat exited 0 for all four. `link-jini.mjs` (pointing at this Jini checkout) exited 0. `packages/contracts` tsc and the `packages/sdk` build both exited 0.
  - There is no PostgreSQL in this run, so `*.postgres.test.ts` is ENV-red.
- **Avoid lists:** for every in-flight branch named in the dispatch and every foundation branch, I took `git diff --name-only <merge-base> <branch>`. That gave 2,943 Tovu rows and 1,058 Jini rows. Every source, importer and composition edit was checked against them.
  - **Manifest exception:** `packages/{cms,admin,integrations,ui}/package.json` and `api-baseline/*` are on these lists via ex4/ex5 branches. Without them nothing could be exported, so additive export entries were made there. They are kept in their own `chore(api)` commits so combine-15 can rebase them easily.
- **Baselines:** gates ran on clean `git worktree`s at both bases, sharing `node_modules`/`dist`.

## Batch table

| batch | subagent | files moved (Tovu → Jini) | importers repointed | tests | status |
|---|---|---|---|---|---|
| W1 workspace routes | Opus | `http/workspace.ts`, `routes/workspace/{get,list,update,delete}.ts` → `@jini-ai/cms/admin-http/{http,routes/workspace}/*` (+ neutral `deps.ts`) | composition `modules/workspace.ts` now mounts the specs via `mountAdminJsonRoute`; 6 tests repointed | Jini 15 new; Tovu b07 7/7, read-update 5/5, route-guards 7/7, workspace-routes 8/8, lost-update 4/4 | DONE (Jini `f7cdcc1fa`, Tovu `357ed211c9`) |
| W8 workspace create | Opus | `routes/workspace/create.ts` → `@jini-ai/cms/admin-http/routes/workspace/create` (outbox flush injected as `flushOutbox`) | composition `modules/workspace.ts`; 2 tests | Jini 8 new (23/23); Tovu create 6/6 | DONE (Jini `d9470774b`, Tovu `1636ca4ad7`) |
| W2 site inspection | Opus | `section-collector.ts`, `site-capabilities.ts`, `site-profile.ts` → `@jini-ai/cms/site-inspection/*`. The console log became an injected `reportFailure`, and the theme id alias and no-theme id are injected. | `deps.ts`, `agent-tools.ts`, `tool-registrations.ts`, `index.ts` (re-exports dropped), `site-guide/facts.ts`, `routes/site/profile.ts`, 5 tests | Jini 8 + 19 + 3; Tovu site-inspection 12 files green, site-profile-route 9/9, facts-profile 1/1 | PARTIAL, 3 of 12 (Jini `feacc8c59`, Tovu `f214966ee9`) |
| W3 web screenshot | Opus | `web-screenshot.ts` → `@jini-ai/integrations/web-screenshot/web-screenshot` | 15 import lines in `features/web-screenshot/**` | Jini 9 new; Tovu 10 files, 112 pass (1 base-red, see Tests) | PARTIAL, 1 of 9 (Jini `bc861428f`, Tovu `bb98e2ba69`) |
| W4 fs-files | Opus | admin `folder-drop-port.ts` → `@jini-ai/admin/screens/fs-files/folder-drop-port` (the product global is now the required `bridgeKey`) | `use-folder-drop.hooks.ts`, `settings/ai-agent-presentation.ts`, 1 test, 3 comment cites | Jini 5; Tovu admin 4 files, 56/56 | PARTIAL, 1 of 15 (Jini `243021b11` + fix `d4d477241`, Tovu `c687d4cdf8`) |
| W5 assistant routes | Opus | `resolve-test-agent-outcome`, `{get,put,delete}-execution-credential`, `{get,put,delete}-site-credential`, `{get,put}-settings`, `test-agent` → `@jini-ai/cms/admin-http/routes/assistant/*` (+ `shared.ts`). Host services, permission and the secret-store copy are injected. | composition `modules/assistant-settings.ts` and `modules/assistant-execution.ts` now hold the registrars; 5 tests repointed | Jini 21/21; Tovu assistant routes 11 files green, ranked-errors 8/8, execution-routes 22/22 | PARTIAL, 10 of 17 (Jini `f11485897` + `b7f1102f0`, Tovu `9935ca6512`) |
| W6 webmcp | Opus | admin `webmcp-i18n.ts` → `@jini-ai/admin/screens/webmcp/webmcp-i18n`. The host builds the translator. | `BrowserAgentSettingsPanel.tsx`, 1 test | Jini 3; Tovu admin green | PARTIAL, 1 of 5 (Jini `d46cb0b8e`, Tovu `f11c7fb0f3`) |
| W7 sites/exec hooks | Opus | `use-site-card-preview.hooks.ts` → `@jini-ai/ui` `site-card` (`urlFor` injected) | `AllSitesTab.tsx`, 1 test | Jini 3; ui 68/68 | AX-27 DONE; A-K2-shell-hooks-4 and AX-26 SKIPPED (Jini `be939b997`, Tovu `9f7cf3663a`) |
| W9 assistant settings | Opus | `AssistantToggleRow.tsx`, `OwnerGrantStatus.tsx`, the injected half of `use-ai-assistant-locale-sync` → `@jini-ai/admin/screens/assistant-settings/*`. Uses `jini-assistant-toggle*` classes, and `InfoTip` is a required prop. | `AdminPermanentDeletes`, `AdminSubagents`, `AiAssistant`, `VisitorAssistantPanel`, `ai-assistant.css`, 1 CSS test | Jini 14; Tovu admin 55 files, 909/909 | PARTIAL: AX-1/2 part; AX-4/7/8/10/11 SKIPPED (Jini `8b4bfdca2`, Tovu `aaf531de0f`) |
| W10 site-dir writers | Opus | none moved: Tovu-only inject. 5 site-dir writers + `move-site-storage` now bind `@jini-ai/platform/fs` directly. | `active-site`, `boot-site-dir`, `duplicate-site`, `key-only-site-meta`, `repair-site`, composition `move-site-storage.ts`, 1 integration test | active-site 19/19 (2 new), boot-site-dir 12/12, duplicate ×5, key-only 18/18, repair 11/11, move-site-storage l058a 4/4, site-title 12/12 | BX-28 PARTIAL (5 of 6); BX-29 blocked (Tovu `783be58954`) |
| helper | Sonnet | why-comments: 53 lost blocks classified, 7 restored (2 Tovu, 5 Jini) | — | — | Tovu `1a3ef34888`, Jini `b7f1102f0` |
| exports | coordinator | `@jini-ai/cms` 21 subpaths, `@jini-ai/admin` 5, `@jini-ai/integrations` 1. Workspace route entries joined the `workspace` isolation domain, like redirects. | — | `pnpm api:check` 0 | Jini `8c89deb6e`, `08aa11f40`, `d4d477241` |

**Totals:** 25 Tovu production sources moved to Jini and deleted from Tovu, plus the injected half of one hook. 3 Tovu test files were deleted after moving into Jini vitest suites, other tests were split, and there are about 110 new Jini tests.

### Named mutations (each planted red, then restored green; run by the coordinator unless noted)
- **W3:** negated the first `if` in `readWebScreenshotInput`. 4 Jini tests went red, back to 9/9.
- **W4:** `targetWindow !==` → `===`. 3 of 5 went red, back to 5/5.
- **W8:** `flushOutbox()` moved before `createWorkspace`. 2 Jini tests went red, back to 23/23.
- **W10:** active-site overwrite `{ mode: 0o644 }`. The "0600 fresh / keeps 0640" test went red, back to 19/19.
- **W9** (by the subagent): `describedBy` ordering, and dropping `activeLocale` from the effect dependencies. Both went red, back to 14/14.
- **W1, W2, W5:** each subagent named its plants with the expected red tests (in the commit messages). These were not separately planted by the coordinator; their route/port tests cover each injected seam.

### Self-check of the 11-22 Codex failures
1. **No forwarding files.** The site-inspection `index.ts` re-export blocks for the moved modules were removed. Registrars moved into composition modules; no shells were left.
2. **Hooks as required props.** The site-card preview hook takes a required `urlFor`. The locale-sync hook is bound by the host wrapper. `InfoTip` is a required prop. No Jini component imports a hook.
3. **No Express types or host loggers in Jini.** The site-inspection `console.error` became the injected `reportFailure`. The specs carry no Express types.
4. **`jini-*` classes.** `jini-assistant-toggle*` and `jini-save-error`.
5. **No new debt or exception entries.** Nothing was added to size, complexity or why-comments debt; see Gates for the why-comments consequence.
6. **Shared wire types.** No new shared wire type; existing core types were used (`DetectedAgent`, `RouteRefusalError`, `JsonRouteSpec`).
7. **Mutations.** See the list above.

## Steps skipped and why
- **K5-workspace-1** (`repo.sqlite.ts`, `index.ts`): callers `site-deps/route-deps-content-chat.ts` and `peer-site-reads.ts` belong to ex4-deploy, and `lane-su-pins/p1-lock-keys.test.ts` belongs to ex4-integrations.
- **X-workspace-1:** C-contracts-core-6 has not landed. The Tovu `agent-tools`/`tool-registrations` are host extensions of the existing Jini `cms/workspace` (they add `workspace_list` and a `workspaceId` input), not duplicates.
- **K5-site-inspection-1 remainder:**
  - `page-body`: its importer `web/tool-registrations.ts` belongs to ex5-fnd-inject.
  - `site-path-policy` and `published-page`: their importer `composition/site-consent.ts` belongs to ex5-fnd-seams.
  - `live-url` depends on those.
  - `agent-tools` and `deps` are a host adapter and const catalog that depend on staying files.
  - `admin-screens.generated.ts` is host data written by a Tovu test generator at its current path. Owner decision.
- **K5-site-inspection-2:** importers `assistant/tool-registrations.ts`, `composition/site-guide.ts` and `tool-catalog-manifest.ts` belong to ex5-collections/inject/seams. Its tool-metadata belongs to ex5-fnd-inject.
- **RT-K1-adm-site-1** and **RT-K1-adm-fs-files-1:** the mount `http-app/mount-admin-system.ts` belongs to ex5-fnd-routes.
- **K5-web-screenshot-1 remainder and -2:**
  - `capture-files`, `own-site-opener`, `screenshot-image`, `desktop-page-capture` and `tool-registrations`: imported by `tool-catalog-manifest.ts`, which belongs to ex5-collections.
  - `agent-tools`: imported by `tool-registrations.contracts.test.ts`, which belongs to ex4-settings and ex5-fnd-inject.
  - `request-guard` and `playwright-page-capture`: K4-seam-22 (web-evidence types in core) has not landed.
- **X-fs-files-1, K5-fs-files-1, A-K2-fs-files-1 remainder:** every source has an importer in ex5-fnd-inject, ex4-media, ex5-fnd-routes, ex2-holds or ex5-fnd-kit. Per-file detail is in the W4 commit body.
- **X-webmcp-1, K5-webmcp-1, A-K2-webmcp-1 remainder:**
  - `settings/index.ts` belongs to ex4-settings, and `published-html.ts` to bugs-medium.
  - `BrowserAgentSettingsPanel` is mounted by `SettingsUi.tsx` (ex5-fnd-kit).
  - `admin-page-tools` is imported by `App.hooks.ts` (ex5-fnd-kit and ex5-fnd-seams).
- **RT-K1-adm-assistant remainder:**
  - `deps.ts` and `execution-deps.ts` are the host registrar slices and hold Express types.
  - `stored-credential-probe`, `list-models`, `test-connection` and `execution-request-fields` belong to ex5-fnd-routes.
  - `detect-agents`: K4-seam-21 has not landed.
  - `visitor-tools`: K4-seam-11 has not landed.
  - `get-chat-attachment`: streams bytes and needs the Media lane.
- **RT-K1-adm-sites-1/2, RT-K1-adm-system-14:**
  - `system/sites.ts` belongs to ex5-fnd-seams and ex5-fnd-routes.
  - `warm-site-control.ts` belongs to ex5-fnd-seams.
  - `sites-home.ts` is a pure JSON route, but its only mount is that avoided registrar.
- **K5-origin-1:** `configured-origin.ts` belongs to ex5-fnd-seams and ex5-small.
- **A-K2-shell-hooks-4:** importers in `AssistantDock.state.hooks.ts` and `SettingsUi.tsx` belong to ex5-fnd-kit and ex5-fnd-seams.
- **AX-26:** `Sites.tsx` belongs to ex5-fnd-kit.
- **AX-35–37:** `Workspace.tsx` belongs to ex5-fnd-kit.
- **AX-42–45:** the Sites screens belong to ex5-fnd-kit.
- **AX-4, AX-7/8, AX-10/11:** `ai-assistant-api*` belongs to ex5-fnd-seams. The visitor credential form hooks belong to ex5-fnd-seams, and `VisitorToolsPanel` and `use-visitor-tools` to ex5-fnd-kit.
- **AX-1/2 owner-grant hook:** ex5-fnd-kit.
- **BX-29:** `init-site.ts`, the last caller of `platform/site-dir/atomic-write.ts`, belongs to ex5-fnd-seams. Once it rebinds the same way as the other five, delete `atomic-write.ts` and its unit test.
- **BX-33, AX-2/3/5/6/9, BX-32, AX-28–34:** not attempted. Their files sit in the ex5-fnd-kit/seams-owned `ai-assistant` and AssistantDock sets, or wait on AX-4/6/9.
- **Follow-up for ex5-collections/ex5-small/ex5-posts (owners of `apps/admin/src/styles.css`):** rename `.assistant-toggle--switch input[role="switch"]` in the phone block (line ≈6707) to `.jini-assistant-toggle--switch …`, together with `phone-touch-targets-css.unit.test.ts:65`. Until then, the 44px ring is restated in `ai-assistant.css`.

## Gates (base = provisional-foundation base; tip = Tovu `1a3ef34888` / Jini `d4d477241`; raw files in `cloud-results/ex6-sites-raw/`)

**Jini:** build 0 (base 0).
- These are the same exit code and output as base: typecheck (2), guard (1, the same 7 lines), api:check (0), size (1), complexity (1), hooks (0), why-comments (1), cross-package/XP (1) and error-gate (0).
  - Guard and XP briefly showed admin→`@jini-ai/ui/core` and SI-domain findings. Both were fixed in `d4d477241`.
- **log-safety (1 → 1, +5 lines).** `[stored-error-text]` in the workspace `create`/`delete`/`update` routes and the assistant `put-settings`/`shared` routes. These are the same typed-domain-refusal pattern (`error: err.message` of a typed validation error, sent to the client as before) that base already carries for the foundation's `redirects/shared.ts`, `redirects/tombstone.ts` and `database/restore-points.ts`. No debt entry was added. Codex/owner should decide between a ratchet entry and a shared core helper for typed refusal text.
- **Package vitest:**
  - admin 3,505/3,505, ui 8,821/8,821, integrations 2,086/2,086.
  - cms 5,179/5,182. The 3 failures are in `forms/src/__tests__/package-boundary.test.ts` and `tests/forms/optional-platform.test.ts`, which also fail on the base worktree (forms packing). The routes/site-inspection/workspace suites are green.

**Tovu:** these are the same exit code and normalised output as base: size (1), boundaries (0), admin tsc (0), desktop tsc ×4 (0), typecheck (2), hooks (0), worker-import-graph (0), errors (0), complexity (1), typecheck:scripts (2), typecheck:tests (2), architecture (1; propagation 3.30 → 3.26, slightly better), and the route-table pin (1, same 7 failing cases, identical assertion diff).
- **why-comments: +51 lost blocks versus base.** These are the comments of the 25 moved files and the rewritten tests. Classification is in `ex6-sites-raw/why-comments-classified.jsonl`:
  - 40 moved to Jini, reworded neutral.
  - 5 restored into the Jini route files.
  - 2 restored in Tovu.
  - 3 obsolete, because the helpers were deleted.
  - The checker clears a block only on a verbatim 3-word match, so neutral rewording in Jini still counts as lost.
  - The precedent (ex5-fnd-routes, ex5-fnd-kit) recorded such moves as `"Moved to Jini …"` entries in `development/why-comments-debt.json`. **This run did not add them: the entry write was refused in this environment as a debt-list addition.** The owner should either approve those 51 ledger entries or ask for verbatim wording in Jini.

**Tovu tests:**
- 35 changed or importer node-test files all pass. The one exception is `playwright-page-capture.unit.test.ts` "the default launcher resolves the host Playwright module": base-red ENV (`chromium_headless_shell-1228` not installed), and it fails identically at base.
- `move-site-storage.postgres.test.ts` is ENV-red (no PostgreSQL).
- Admin vitest: ai-assistant, settings, webmcp, sites, fs-files and CSS tests pass, 55 + 32 files, 909 + 562 tests.

## Files left (`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122` `ad8362919`; FILES-LEFT = moving + shells)

| commit | moving | shells | total | theme-area files | excl. themes |
|---|---:|---:|---:|---:|---:|
| base `009dda7d1` | 2,401 | 0 | 2,401 | 111 | 2,290 |
| tip `1a3ef34888` | 2,379 | 0 | 2,379 | 111 | 2,268 |

That is a net drop of 22 measured files. The scanner does not count 5 more moves because they sit outside its areas: the admin hooks/i18n and the `http/workspace.ts` projection.

## Wiring docs
Each moved feature got a Jini `## Wiring` section that links `docs/decisions/DR-005-portable-package-boundaries.md`:
- `packages/cms/src/{site-inspection,admin-http/routes/workspace,admin-http/routes/assistant}/README.md`
- `packages/integrations/src/web-screenshot/README.md`
- `packages/admin/src/screens/{fs-files,webmcp,assistant-settings}/README.md`
- `packages/ui/src/features/site-card/README.md`

On the Tovu side, `apps/admin/src/features/webmcp/README.md` now notes where the dictionary lives.
