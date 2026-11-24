PARTIAL 14b4de5830 71002fd75: K5-observability-1, K5-server-logs-1 (tool-registrations, agent-tools, process-source), K5-tool-audit-1, K5-pages-1, RT-K1-adm-pages-1/2, A-K2-pages-1/2/3 editor half (PageEditor, use-page-editor, theme files), RT-K1-adm-system-2 browser-telemetry, RT-K1-pub-ops-1, observability tab/error-item hooks, Activity Log placeholder (all blocked: in-flight importers, missing prerequisites or owner decisions — see "Skipped"); gate red left: Tovu check:why-comments +71 reworded-move blocks (owner call on debt reasons)

# ex6-pages-dash — Pages + Dashboard, Activity Log, Observability (2026-11-23, unattended)

Unattended cloud run. Opus coordinator plus 7 Opus-high batch subagents in two waves (at most 4 at a time, each in its own pair of git worktrees `/home/user/wt/j<N>`, `t<N>`), and 4 Sonnet helpers (strict-typing fixes, i18n split, two report-only gate runners). Subagents never committed, built or ran gates. The coordinator reviewed each diff, applied it to the branch, added `package.json` exports, built, ran the affected tests and named mutations, committed per batch and pushed.

- **Branches:** Jini `codex/ex6-pages-dash-jini`, Tovu `codex/ex6-pages-dash-tovu`. Plain `git push` after every batch; no force, no `--no-verify`, no tags, nothing published, no RemoteTrigger, no codebase-memory tools. `main`/`integ/*`/`plan/*`/`release/*` were only fetched.
- **Bases:** Jini `origin/integ/merge-14-2026-11-22` `4902a6a1a`; Tovu `origin/integ/merge-13-2026-11-22` `f7185f153`.
- **Provisional foundation merged** (merge commits on each branch; rebase at combine-15 will drop them):
  - Jini: `codex/ex5-fnd-kit-jini`, `codex/ex5-fnd-seams-jini`, `codex/ex5-fnd-routes-jini`, `codex/ex3-c0b-jini` (one `api-baseline/jini-ai__core.json` conflict: 3-way key union). Working base `8fdc482e0`.
  - Tovu: `codex/ex2-tovu-halves`, `codex/ex2-holds-tovu`, `codex/ex5-fnd-kit-tovu`, `codex/ex5-fnd-routes-tovu`, `codex/ex5-fnd-seams-tovu` (conflicts resolved toward the later fix: `why-comments-debt.json` array unions; import-line conflicts kept the halves' `lib/admin-http/*` paths with kit's `@jini-ai/admin/shell/lib/*` repoints; seams' 9 tool-metadata deletions taken). Working base `dab5d4127`.
  - **Skipped (non-trivial):** `codex/ex5-fnd-inject-jini` and `codex/ex5-fnd-inject-tovu`. Both redo K4-contracts-core-5 that seams also did, so they conflict on ~20 core contract files (Jini, add/add) and ~60 tool-metadata files (Tovu, modify/delete). Taken consistently on neither side.
- **Setup:** as combine-13: Node 24.22.3, pnpm 10.33.2 (corepack + a `pnpm` shim so nested `pnpm -r` runs use it); Jini frozen install 0, `pnpm --no-bail -r build` 0; Tovu `npm ci --ignore-scripts` root/admin/desktop/site-chat 0/0/0/0, `link-jini.mjs` against this Jini checkout, contracts tsc 0, sdk build 0. Clones deepened (`--deepen=400`) and `origin/refactor/terra` fetched for why-comments. Baseline gates recorded on the merged, unmodified trees first.
- **Codex review:** pending for every diff below.

## Batches

| batch | subagent | steps | files moved (Tovu prod deleted → Jini) | importers / wiring | tests | status | Jini | Tovu |
|---|---|---|---|---|---|---|---|---|
| 1 | opus-high | K5-server-logs-1 (slice) | `features/server-logs/read-server-logs.ts` → `@jini-ai/diagnostics/server-logs/read-server-logs` | 4 importers + route repointed | 7 moved (node:test→vitest) + 6 characterization; Tovu server-logs tool/route/contracts tests green | DONE (slice) | `96d7fa838` `17b1619e9` | `244e5804f2` |
| 2 | opus-high | RT-K1-adm-system-2/3 (slices) | `routes/system/{observability-status,tool-gaps,server-logs}.ts` → `@jini-ai/cms/admin-http/routes/system/*` (`defineJsonRoute` specs, small deps) | `mount-admin-system.ts` binds deps via `mountAdminJsonRoute` (same failure options, same order); 5 test importers repointed | 3 Jini spec suites (18 tests); Tovu 8 route/test files green | DONE (3 of 5 routes) | `b9fc978ac` | `dd1c410c23` |
| 3 | opus-high | A-K2-observability-1 + A-adm-other-2/5 observability rows | 17 files (screen, panels, rules, visuals, API factory, ports, state hooks, i18n, CSS) → `@jini-ai/admin/screens/observability/*` | `features/observability/index.ts` host wiring (product name, wired hooks, tab/error-item hooks, theme boundary, devtools panel, tool-gap reader, CSS); `api/observability-api.ts` binds the admin request; new `hooks/observability-wiring.hooks.ts` | 3 pure suites moved; host render/hook suites stay, repointed | DONE (2 hooks stay: kit lacks facades) | `a3789a0d7` | `ebf1c83a0c` |
| 4 | opus-high | X-pages-1, A-adm-pages-1 + A-K2-pages-1 (leaves) | 9 files: cms `pages/{authoring-html,hidden-until-script}`; admin `pages/{api/pages-api.types,hooks/pages-tab-url.hooks,Pages.hooks,lib/page-preview-youtube,lib/prettify-html,lib/embed-placeholder,pages-i18n}` | 13 importers repointed; `use-page-editor` passes the cms marker readers | 4 moved + 3 characterization suites; Tovu pages vitest 649/649 | DONE | `bab9a6b25` `11fdc8d03` | `a6397a033c` |
| 5 | opus-high | shared-shell notices (A-adm-shell-components-1/2 lane rows) | `components/AdminFailureNotice/*`, `components/ServerRestartingBanner/*` (5 files) → `@jini-ai/admin/shell/components/*` | new `lib/shell-notices-wiring.tsx` (channel, reconnect store, status hook, copy, Dismiss label); `main.tsx` mounts it; z-order test reads the Jini CSS | 2 Jini suites (5 tests); Tovu wiring suite + z-order green | DONE | `c2f3112ca` | `2de42a64fc` |
| 6 | opus-high | AX-12/13/14 Dashboard | `Dashboard.tsx`, `rules.ts`, `hooks/dashboard-port.hooks.ts` (+ i18n body, fake port) → `@jini-ai/admin/screens/dashboard/*` | `features/dashboard/index.ts` wiring (useWiredDashboard, publish availability/request, disclosure hook, links, CSS); `use-dashboard.hooks.ts` keeps the host binding; `dashboard-i18n.ts` binds host common dict | 5 Jini suites (89 tests); Tovu dashboard/publish suites green | DONE | `037e47a23` | `85c487e554` |
| 7 | opus-high | A-K2-pages-2/3 list half | `Pages.tsx` screen, `usePages`, `hooks/pages-port.hooks.ts` (narrow `PageListRow`), list-only rules → `@jini-ai/admin/pages/*` | `features/pages/Pages.tsx` host wiring (theme tab, publish button, labels, sort, paths, hook); `use-pages.hooks.ts` keeps the wired half | 3 Jini suites; Tovu pages+menus+dashboard vitest 896/896 | DONE | `9341328c6` | `1fb90542fb` |
| fix | coordinator + sonnet | gates | — | hooks via `props.useX()`; `--jini-space-*` / `--jini-admin-*` CSS tokens bound by Tovu `admin-themes/jini-admin-tokens.css`; isolation map entries; ReadonlySet; theme-boundary colours; i18n split by locale group; guard-test repoints; devtools-bundle entry; stale size-debt row | — | — | `c6c5353d8` `f073e05e3` `8f78ebc20` `71002fd75` | `9364551a05` `22797cf615` `422c43ee1a` `14b4de5830` |

## Named mutations (behaviour-changing slices; red, then restored green, `cmp` checked)
- embed-placeholder injected `embedMarkerTarget` → `undefined`: 5 Jini tests red; restored 39/39.
- tool-gaps spec owner check `!==` → `===`: 3 red; restored 4/4. server-logs spec filter-error branch disabled: 1 red; restored 6/6. observability-status POST `!deps.sendTelemetryTest` negated: 2 red; restored 8/8.
- AdminFailureNotice Dismiss `channel.reset()` → no-op: 2 red; restored 4/4.
- Dashboard `mergeRecent` order flipped: 2 red; empty-state check broken: 1 red; restored 89/89.
- Pages `ThemePagesTab` prop render → `null`: 1 red; restored 8/8.
- Verbatim moves (read-server-logs, pages leaves, CSS) carry their moved tests; no per-step mutation.

## Skipped steps and why
- **K5-observability-1** (`features/observability/tool-registrations.ts`), **server-logs `tool-registrations.ts` / `agent-tools.ts`**: importers `server/runtime/composition/tool-catalog-manifest.ts`, `assistant/tool-registrations.ts`, `assistant/__tests__/tool-registrations.contracts.test.ts` are on in-flight branches.
- **server-logs `process-source.ts`**: it is the host binding of `readProcessServerLogs`; moving it needs a new args object (K5 STOP).
- **K5-tool-audit-1**: `repo.memory.ts`/`repo.sqlite.ts`/`tool-gaps.repo.ts` importers are in-flight (`composition/app.ts`, `memory-deps/route-deps/context.ts`, `site-deps/route-deps-comments-plugins.ts`); `repo.ts` needs an owner decision (Kysely-typed query in vendor-neutral diagnostics, `console.error` default, host table name); `tool-gaps.ts` no longer exists.
- **K5-pages-1**: `html-document-store{,.memory}.ts` are on an in-flight branch.
- **RT-K1-adm-pages-1/2**: prerequisites `RT-K1-adm-posts-1` and `K5-agent-plugins-6` not landed; `routes/pages/{create,update,update-html,get-by-id}.ts` also touched by ex5-fnd-inject (skipped).
- **A-K2-pages editor half** (PageEditor, use-page-editor, page-editor-port, page-editor-i18n, use-editor-html-jump, use-interactive-flush, theme-page files, pages-port's AdminPost): Posts lane in flight (`posts-i18n`, `AdminPost`), no kit facades for `findEditorBlockOpening` / `isEditorSourceError`, Themes stay in Tovu. `api/pages-api.ts` is FOUNDATION-shared.
- **RT-K1-adm-system-2 `browser-telemetry.ts`**: a JSON spec cannot set `Retry-After` on its 429, and it reads the credential kind from `res.locals`; no admin `ServerRoute` port exists yet.
- **RT-K1-pub-ops-1 `ops/health.ts`**: no public `defineJsonRoute` pattern landed yet.
- **Observability `use-observability-tab.hooks.ts`, `use-recent-error-item.hooks.ts`**: need `findActiveTab`/`useTabbedDialog`/`useCopyToClipboard` facades the kit lacks (STOP rule); injected as required props, stay in Tovu.
- **Activity Log placeholder route**: lives in `panels.tsx` (in-flight); unchanged.
- **Pages public render** (`render/page-body.ts`, home/virtual-page handlers, `contracts/core/page-html.ts`), `EmbedInsertControl`: FOUNDATION theme-content prerequisites, runtime-in-contracts (XP4) and in-flight importers.

## Self-check against the 11-22 failures
1. **No re-export/forwarding files:** the Jini barrel `screens/observability/index.ts` was deleted; every Tovu module left at a panel-imported path binds real host values (hooks, ports, copy, links, CSS).
2. **Hooks as required props:** all host hooks reach Jini components as required props called through `props` (no import, no default); `check:hooks` ratchet ok. The kit-values accessor is a defaulted Jini prop.
3. **No server-framework types / host loggers in Jini:** specs are `defineJsonRoute` with core types; refusals via core `rejectRoute`.
4. **`jini-*` classes:** observability, dashboard, shell notices renamed; their host stylesheet rules moved into Jini CSS (old `styles.css` rules are dead; `styles.css` is on an in-flight branch — lines ~2075-2201, 4406-4418, 6476-6540 for the styles.css owner). Pages list uses only shared shell classes.
5. **No new debt-list entries:** none added (one stale size-debt row and one same-as-English allowance removed).
6. **Shared wire types:** dashboard/pages use narrow structural view types local to the screen; the observability admin DTOs mirror core `platform-server-logs`/`daemon-tool-audit` types (candidate for a core owner — reviewer call).
7. **Named mutations:** listed above.
- Owner pads/args, function ≤80, complexity ≤10: `complexity:strict` has no violations in the moved paths (warnings: `Observability` 73 lines > 50 warn).
- **Foundation-touched files:** several lane files this run moved or edited had import repoints from the foundation branches (`features/observability/api/*`, `use-queries-tab`, `observability-visuals`, dashboard, `Pages.tsx`, `use-pages`, `mount-admin-system.ts`, `main.tsx`, `packages/*/package.json`). Their foundation changes are already in this base; expect rebase conflicts at combine-15 only if those branches change the same lines again.

## Gates (base-diff; raw under the run's scratch `g/`, summarized)
Base = merged unmodified trees (Jini `8fdc482e0`, Tovu `dab5d4127`); tip = after all batches and fixes.

**Jini** (exit base→tip): guard 0→0 (ok); typecheck 0→0; api:check 0→0 (additive: +48 subpaths reported as added); check:cross-package 1→1 (identical); check:size 1→1 (no new findings after the i18n split; base reds in daemon/sidecar); check:complexity 1→1 (same 5 base violations); check:why-comments 1→1 (same 18 base blocks); check:hooks 0→0; check:errors 0→0. Builds of admin/cms/diagnostics 0. Vitest: diagnostics 1104/1104; admin all green after the theme-boundary fix (3709+); cms 2 failures, both base/unrelated (`forms` CHANGELOG version check `0.7.2` vs `0.7.3-next.2`, untouched since 2026-10-20; `create-tables.reference` 5 s timeout under load, passes alone).

**Tovu** (exit base→tip, all 12 identical): check:size 1→1 (only new line was the stale `Pages#1` debt row, now removed); check:boundaries 0→0; typecheck 2→2, typecheck:tests 2→2 (same 2 base errors in `plugin-tier2/worker.ts`); typecheck:scripts 2→2 (same 3); check:errors 0→0; check:complexity 1→1 (same `App.tsx` base violation); check:hooks 0→0; check:architecture 1→1 (no new cross-feature edges); admin tsc 0→0; desktop tsc 0→0.
- **check:why-comments 1→1, NEW RED:** 82 more deleted comment blocks than base; 11 were restored verbatim beside their code; **71 remain**. They were reworded host-neutral in Jini, or the code they explained changed with the injection (required hooks, injected translators/ports, narrow types), or they name the product. Fixing them needs either `why-comments-debt.json` reasons (an owner call; the run did not add debt entries) or a checker that matches reworded moves. Ids and reasons are in the run's scratch `blocks.json`.
- Admin vitest (862 files): all green except base-red `JiniMediaPicker.hooks`, `admin-literal-copy`, `credential-input-autocomplete`, `panel-access` (database/redirects evidence paths from fnd-routes) and a load flake in `use-trash`. The new `devtools-bundle` failure (stale entry) is fixed.
- Node tests (65 files across pages, server-logs, tool-audit, routes/system, observability/server-logs routes, contracts, tool-catalog observability): 64 green; `site-backups.integration` is base-red.

## FILES LEFT (`scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`, clean worktrees)

| tree | moving | shells | **FILES-LEFT** | excl. theme areas (111) |
|---|---|---|---|---|
| base `dab5d4127` (merge-13 + provisional foundation) | 2,385 | 0 | **2,385** | **2,274** |
| tip `14b4de5830` | 2,352 | 0 | **2,352** | **2,241** |

−33 net: 39 Tovu production files deleted (moved), 3 host wiring/binding files added (`lib/shell-notices-wiring.tsx`, `features/observability/hooks/observability-wiring.hooks.ts`, `admin-themes/jini-admin-tokens.css`), minus files the scanner no longer counts.

## For the reviewer (Codex)
- `api:check` passes (additive); the new subpaths are not yet recorded in `api-baseline/` (`pnpm api:update` left for combine to avoid baseline conflicts).
- `ServerRestartingBanner`/`AdminFailureNotice` CSS and the Dashboard CSS read `--jini-admin-*`; Tovu binds them on `:root` beside the admin themes.
- The kit's `ErrorNoticeProps` has no clipboard ports, so the failure notice's clipboard now belongs to the host's kit `ErrorNotice` binding.
- `pages-i18n` in Jini falls back to `ADMIN_COMMON_I18N`; the host's product-named publish-dialog key is not used by Pages.
- Activity Log done-when is unchanged (placeholder route in in-flight `panels.tsx`).
