# cov-J1 REPORT — Jini lots 001..033

Wave J1, unattended. Base `b3c4144b` (cloud/integration-2026-10-21); result branch **`cloud/cov-J1`**.
Started 15:37 UTC, finished ~17:12 UTC (well inside the 4 h cap).

## Outcome
- **All 33 lots done.** All 296 lot files are at 100% lines, branches and functions, except the 11 below.
  - 9 Remotion/shadcn skill-asset files can't be tested in place (8 at 0%, plus `avatarLibrary.tsx` with 2 branches open).
  - 1 build script is excluded by the owner.
  - 1 dead file (`admin/src/media/styles.ts`) was deleted.
- Every number was re-measured on the **merged** `cloud/cov-J1` with scoped `--coverage.include=<lot files>`, using v8 `coverage-final.json`, not the text table.
- All touched packages' full suites pass on the merged branch:
  - admin: 207 files, 2783 tests
  - agent-plugins: 87 files, 1278 tests (2 skipped, pre-existing)
  - agent-runtime: 170 files, 4090 tests (1 skipped, pre-existing)
  - agentic: 1441
  - analytics: 125
  - artifacts: 204
  - capability-providers: 217
  - charts-recharts: 85
  - chat: 225 files, 3364 tests (1 skipped bench, pre-existing)
- `tsc --noEmit` is clean for every touched package.
- The complexity check (complexity ≤10 + sonarjs cognitive ≤10, temp flat config) is clean on every touched or added function.
- No coverage-ignore comments, no lowered thresholds and no softened assertions were added. No tests were deleted.
  - The only config edit widens agent-plugins' coverage `include` to measure `core/**` and `persistent-state.js`.

## Per lot: before → after (lines/branches/functions; "→100" means 100/100/100)
| lots | area | before (lot file / own baseline) | after |
|---|---|---|---|
| 001-003 | admin: agent-plugins, comments, consent, core, forms, media, playground, react/{components,entities,overlays,shell} | 74 files at 0–99%; worst: EntityIndex 2/13 L, forms rules 178/184 L 93/98 B, use-form-editor 153/161 L 53/64 B, providers.controller 70/74 L 12/17 B, the 0% barrels | 74 →100; `media/styles.ts` deleted (dead) |
| 004-006 | admin: shell theme, redirects, security, seo, source-control, widgets | 75 files; worst: MediaPickerBridge.hooks 11/100/0, seo http 72/73/18, WidgetInstanceNotices 38/60/50, CredentialFields B 33%, 9 barrels at 0 | 75 →100 |
| 007 | agent-plugins persistent-state.js, core/persistent-state.js | NEVER-LOADED (out of the include list); own run 99.2/77.6/100 | 2 →100 |
| 008 | agent-plugins admin-surfaces + lifecycle (18) | e.g. lifecycle/index 8/38 F, set-enabled 16/32 L, surface-client 139/156 L | 18 →100; 3 shadcn examples not testable (below) |
| 009 | agent-runtime core + defs (23) | small gaps, e.g. model-discovery-sdk 24/33 L 7/13 B | 23 →100 |
| 010-011 | agent-runtime defs (6) + providers (10) | defs F 50–75%; connection-test.ts NEVER-LOADED (vitest's default exclude matches `*-test.ts`); google-schema 88.6 B; operation-schema 89.6 B | 16 →100 |
| 011-012 | Remotion template | 0 | BubbleScene 100 through the existing harness; avatarLibrary lines/functions 100, branches 2 open; 5 files not testable (below) |
| 012-015 | web-clone asset-harvest, audit-clone, compare-recon, dna-scaffold, init-clone | all 0 (NEVER-LOADED) | 5 →100 (+ new lib/script-cli.mjs 100) |
| 016-019 + visual-diff | web-clone interaction-probe, playwright-loader, mirror-site, network-capture, od-preview-rewrite, recon-site, route-crawl, sourcemap-hunt, visual-diff | all 0 | 9 →100 (+ lib/cli-args.mjs, lib/main-guard.mjs 100) |
| 020 | agentic (7), analytics (2), artifacts stub-guard | e.g. agentic index 0/2; node-filesystem 72 B; live-registration 81.5 B; repo.memory 85.7/100/75 | 10 →100 |
| 021 | capability-providers visitor-auth (2), charts-recharts mount.tsx, chat (8) | lifecycle 91.8/82.5; mount 69.4 B; a2ui-action-poster 0 L; attachment-liveness 0 L; ag-ui-transport 61/60/35; ag-ui/entry 79/83/88 | all →100; build-artifact.mjs excluded |
| 022-026 | chat core/persistence/question-form/embed-widget/agent-bridge | durable-run-subscription 84/65/90; messages 57/67/33; small B gaps (title, page-actions, lazy-loader, state, dialog.hooks, embed) | 14 →100 |
| 027-033 | chat react components (24) | NEVER-LOADED only because of include scope; real gaps: ChatSettingsDialog 99/71/71, ConversationTitleEditor 79/86/83, ConversationList 96/93, A2uiSurfaceCard F 85, McpUiSurfaceCard B 94 | 24 →100 |

## Not at 100% (with reason)
- **`agent-plugins/ui-ux-design/skills/shadcn-ui/examples/{auth-layout,data-table,form-pattern}.tsx`**: skill example assets that import `@/components/ui/*`, which does not exist in this repo. Testing them would require fake components.
- **`agent-runtime/src/skills/chat-motion-overlay/assets/remotion-template/src/{Root.tsx,chatSpec.ts,index.ts,components/ChatMotionOverlay.tsx,components/DeviceFrame.tsx}`**: `remotion` cannot be resolved in the repo, so a test would have to module-mock it. `chatSpec.ts` is a data literal with no behaviour.
- **`charts-recharts/scripts/build-artifact.mjs`**: build script, excluded by the owner.

## Unreachable code removed (behaviour-preserving; each site has a comment naming what guarantees it)
- **admin:**
  - core/routing/rules.ts:61, :78, :117-118: `|| '/'` and `?? ''` after `split()` / a bounded index.
  - core/manifest/rules.ts:72-95: `groupOrder` and `groups.get() ?? []` (Map insertion order).
  - react/shell/model.ts:29 and AdminShell.tsx:59: `panelId ?? ''`.
  - media/styles.ts: whole file; it had no importer or export path.
  - edit-media/providers controllers, other-credentials.controller, seo.controller: try/catch fall-through ranges, now a single exit.
  - seo/rules.ts ~460: `?? 0`.
  - MediaRefField.hooks.ts:25: the fetch only runs while the query is enabled, which requires `list`.
  - WidgetInstanceEditor.tsx:62: a never-taken `if (!widgetType)`, replaced by a narrowing `widgetEditorGate`.
- **agent-plugins:**
  - set-enabled.ts:51: `?? input.enabled`.
  - package-paths.ts:94-96: a lexical escape check. `normalizePackageEntryPath` already refuses absolute, drive and `..` paths, and the realpath containment check still runs.
- **agent-runtime:**
  - model-discovery-adapters runProcess: a pre-aborted `killTree`, since the scheduler refuses an aborted signal first.
  - connection-guard: `statusCode ?? 0`.
  - connection-test: the non-string sample guard, the Google empty-base default, and `!validated.parsed`.
  - google-schema: the read and write walkers merged; the write-side guards could never fire.
  - web-clone: `split()[0] ?? ''`, always-matching regex fallbacks, `!current` / `'external'` in the route-crawl loop, `|| 'route'` / `|| '/'`, `match.index || 0`, a dead in-page helper, and an asset-harvest `if (kind)` check.
- **agentic:** node-filesystem writeFile flag is always `'wx'`, because the port types `exclusive` as `true`.
- **chat:**
  - ConversationList: `typeof window` in a click-only confirmer, and `createDisabled` re-checked inside a disabled button.
  - McpUiSurfaceCard: the empty-sanitize fallback (only `ui://` URIs reach it).
  - a2ui-action-poster: try/finally fall-through, now `postOnce` + `.finally`.
  - page-actions: `textContent ?? ''`.
  - title.ts: `split()[0] ?? cleaned` and `toTitleCase`'s empty-word branch.
  - user-text-redaction: the chat-level Slack rule. Core's base `slack_token` rule always pre-empts it; a test pins that Slack tokens are still removed.

## Refactors for testability (ports with defaults at the edge; tested with hand-written fakes)
- **agent-plugins:** surface-client gets a `browser` scope port.
- **agent-runtime:**
  - loadAnthropicLiveModels gets `{listModels}`.
  - Exported `createCopilotMetadataClient({importSdk})` and new `createEnvCredentialPort({importCatalog})`.
  - `pinnedFetch({idleTimeoutMs})`.
  - testProviderConnection gets `fetchFn` / `timeoutMs`.
- **artifacts:** new `createNodeArtifactStubFilesystem({openFile})`.
- **web-clone:** all 14 scripts are now side-effect-free on import.
  - Each exports `main(argv, deps)` with fs, console, cwd, clock, fetch and Playwright ports.
  - CLI usage, messages and exit codes are unchanged; outputs were diffed against the old scripts.
  - Exit is now via `process.exitCode` (wc1) or `process.exit` on failure (wc2).
- **admin:** `widgetEditorGate`, plus `ConfirmDialog/confirm-dialog-attrs.ts` extracted.
- **ui + chat:** `maxHeight` now passes straight through as `number | undefined`.
- **chat:** `ConversationList` captures its root node per open effect.

## Follow-ups for the owner (found, not fixed)
- web-clone has two parallel CLI helper libs, because two agents worked concurrently. `lib/script-cli.mjs` serves 5 scripts; `lib/cli-args.mjs` + `lib/main-guard.mjs` serve 9. Worth merging into one.
- agent-runtime vitest.config excludes `src/skills/**`, and vitest's default exclude drops `providers/connection-test.ts`. These files only count when measured explicitly, so the package gate doesn't hold them.
- admin: `redirects({})` and `seo({siteUrl})` return a copy but bind React to the singleton, so a host that registers the copy gets "Module scope unavailable".
- dna-scaffold strips quotes before splitting font stacks (`"Brand Sans", sans-serif` → `Brand Sans"`).
- model-catalog: a literal `null` provider body reports `unknown` with a TypeError message.
- agent-runtime/agent-plugins vitest needs `--minWorkers=1` alongside `--maxWorkers=2`, or tinypool throws.

## Setup / env
- Node 24.22.0.
- `pnpm install --frozen-lockfile` (27 s) and `pnpm -r build` both green.
- Per-subagent git worktrees use `pnpm install --offline` (3 s) and copied `dist/`.
- Postgres and Playwright browsers were not installed (owner override). No Postgres or browser tests were written. **LOCAL-RUN NEEDED: none.**
- The `code-inspection` persona does not exist in the vendored AI-Dev-Shop, so reviews used `agents/code-review/skills.md`.
- Every subagent confirmed reading tdd + programmer skills.

## Caps used
- 6 subagent sessions out of 15. At most 3 ran at once (4 workers counting the coordinator).
- The coordinator did lots 021 (chat files) to 033 itself.
- Wall clock was about 1 h 35 m of the 4 h cap.

## Branches (all pushed)
- `cloud/cov-J1` (merged result). Lot branches: `cloud/cov-J1-{001-003,004-006,007-009,010-011-020-021,012-015-wc,016-019-wc,021-026-chat,027-033}`.
