PARTIAL 3e11043843 d8ce84a40: check:hooks +1 (required hook prop ConversationChatPane::useConversationChatPaneHook needs an owner-approved hook-injection-debt row, edit was blocked in-run); AX-55/56 T `contracts/app-version.ts` bridge-type dedupe not done; scanner still counts `app-version-ipc.ts`/`find-in-page-ipc.ts` (thin host adapters, recommend KEEP rule)

# w4-desktop (2026-11-24): Desktop app lane, Jini `codex/w4-desktop-jini` + Tovu `codex/w4-desktop-tovu`

Unattended cloud run, Opus high coordinator. `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read before any work (confirmed); its root-cause-first, test-first-for-behaviour-change and fresh-evidence rules applied to every batch below.

- **Bases:** Jini `origin/integ/merge-16-2026-11-23` = `7490405a8`; Tovu `origin/integ/merge-16-2026-11-23` = `3a93322474` (re-fetched and merged before the final push: unchanged). Tovu linked to this Jini branch (`JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`). Jini `pnpm install --frozen-lockfile` 0, `pnpm --no-bail -r build` 0 (0 `error TS`); Tovu `npm ci --ignore-scripts` root/admin/desktop 0.
- **Heads (code):** Jini `d8ce84a40`, Tovu `3e11043843`; this report is committed on top of each. Plain pushes only; no force-push, no `--no-verify`, no tags/publish, no codebase-memory tools; never touched `main`/`integ/*`/`plan/*`/`release/*`.
- **Owned files:** the 164 in `origin/plan/whats-left-1122:inputs/w4/desktop.txt`. **17 MOVED/DEDUPED (deleted from Tovu, + 14 test files), 147 STAYS-HOST** (13 of them now thin host bindings over newly extracted Jini code). Full table at the end.
- **Owner questions taken at their plan recommendation** (P13-gaps §5; owner "inject everything" 11-22): OWNER-Q-9 (desktop React hooks → `@jini-ai/ui` feature folders, `desktop-host` stays framework-free; precedent `ui/find`, `ui/live-views` already existed), Q-10 (move WorkspaceChatPane), Q-11 (quote whitespace paths), Q-12 (no size-debt row: the 92-line component was split under 80 instead), Q-13 (fab test edit; `.runner-chat-pane` CSS stays host skin), Q-14 (`app-hooks.test-support.ts` STAYS), Q-15 (Spinner markup/a11y change, test first). ex4 owner decision 2 (shell-staleness message) resolved by K3: Jini keeps the short neutral message, the host injects its incident sentence via `{ consequence }`.

## Batches
| batch | model | files moved (Tovu → Jini) | importers | tests | status |
|---|---|---|---|---|---|
| B0 shell-staleness | Opus (coord.) | `shell-staleness.ts` DEDUPE → `@jini-ai/devops/packaging/electron`; Jini gains optional `{ consequence }` | `stage-payload-run.ts` (injects incident copy), `stage-payload-lib.ts`, `preload/preload-staleness.test.ts` (import lines); 2 HW5 hardwiring-debt rows retired | Test first: "an injected consequence sits between the age and the remedy…" red on base → green 8/8. **Mutation** `why = ''` → 1 red, restored. Tovu −1 file/10 tests (Jini policies.test covers the predicate + new case); stage-payload/preload-staleness 106/0 | DONE (J `295423bc2`, T `2510045f18`/`671b66f4e6`) |
| B1 find bar (AX-48/49/51) | Opus | `find-focus-clock`, `find-input-focus`, `find-target`, `use-find-{bar-effects,bar-state,focus-reclaim,input-binding}.hooks` → `@jini-ai/ui/find` (structural `FindableGuest`/`FindBridge`, scheduler injectable) | `use-find-in-page.hooks.ts` (6 import specifiers), `use-find-in-page.jsdom.test.ts`, `shell-bug-fixes.test.ts`, `app/SiteWorkspace.tsx`; `error-gate-debt.json` find-target row removed | Tovu −1 file/24 → Jini +24 (27/27 with scheduler). Coord. fix: duplicate `FindMatchResult` → new neutral **`@jini-ai/core/contracts/find-in-page` `FindInPageResult`**, used by ui and desktop-host. No behaviour change | DONE (J `c376a13ab`,`d590ce5a2`; T `64c00c3032`) |
| B2 conversation chat pane (P13-D1/D2) | Opus | `WorkspaceChatPane.tsx` + `use-workspace-chat-pane.hooks.ts` → `@jini-ai/chat/react/conversation-chat-pane` (split into 4 components < 80 lines; `labels` carry all copy; `jini-conversation-chat-pane*` classes only; folder drop injected as `captureFolderDrop` because chat may not import ui (guard L5)) | `App.tsx`, `app.css`, `global-chat.desktop.ts`, `coverage-floors.json` (comments), `one-chat-fab-wiring.test.ts` (asserts App.tsx does not import the Jini pane); `size-debt.json` row `WorkspaceChatPane#1` removed | D1 test first ("a dropped folder whose path contains a space is inserted quoted") red on base; **mutation** unquoted `formatDroppedFolderPaths` in linked ui dist → red, restored (`cmp`). D2: Tovu −3 files/21 tests, Jini +14 (+6 ui folder-drop tests already covering the plain drop cases); new "every visible string comes from labels…". **Mutation** swap `confirmed` on Cancel/Delete → 1 red, restored. Coord. fix: the pane state hook is now a REQUIRED prop (no default hook) | DONE except check:hooks row (see Open) (J `d590ce5a2`; T `905859268f`) |
| B3 chat conversations + transport (AX-69/71 renderer) | Opus | `runner-conversation-controller.ts` → `@jini-ai/chat/react/conversations` (`createConversationController`, `useStoredConversations`, `useConversationDeleteConfirmation`); `chat-attachments.ts` → `@jini-ai/chat/react/bridged-chat` (`createStagedAttachmentUploader`, `useBridgedChatTransport`) | `use-runner-conversations.hooks.ts`, `use-workspace-chat-transport.hooks.ts` become host bindings; `App.hooks.ts` barrel: coord. removed a new Jini re-export (0 consumers) + `App.hooks.test.ts` HOMES | Tovu −4 files/62 tests → Jini +62 (62/62). No behaviour change (log text neutral; host prefixes its label) | DONE (J `c376a13ab`; T `64c00c3032`) |
| B4 desktop hooks (AX-53/55/64/105/118/120) | Opus | `use-webview-load-failure.hooks.ts`, `use-site-view-preference.hooks.ts` → `@jini-ai/ui/live-views`; logic of `use-zoom`, `use-app-version`, `use-update-check`, `use-live-views`, `use-import-handoff`, `nav-availability` → `@jini-ai/ui/{zoom,app-version,live-views,import-handoff,core}` (host keeps bindings) | `use-loaded-sites.hooks.ts` (bounds), `SiteWorkspace.tsx` (type), `use-site-workspace.hooks.ts` (coord.: imports the Jini hook directly instead of a new `App.hooks` forward), tests repointed; `error-gate-debt.json` use-zoom row removed | Tovu −2 files/24 → Jini +42 (50/50 incl. existing). Coord. fix: duplicate `ZoomDirection` → new **`@jini-ai/core/contracts/desktop-zoom`** (desktop-host `ZoomCommandDirection` aliases it) | DONE (J `49fe7cbef`; T `01e82a677a`) |
| B5 small rows (AX-41/57/106) | Opus | `app/Spinner.tsx` DEDUPE → `@jini-ai/ui` `Spinner`; `tokensForCreate` → `@jini-ai/agent-plugins/connect`; error-listener lifecycle → `@jini-ai/diagnostics/observability` `installGlobalErrorReporting` | `SiteStartPanel.tsx`, `SiteWorkspace.tsx` (+2 test selectors); coord. retargeted dead `.spinner` CSS to `.jini-loading-spinner .icon-spin` in `app.css` | Spinner test first red 2/11; **mutation** drop `role=status` in linked dist → red, restored. Mutations "whitespace-only token" and "reporting teardown" both killed. Jini +7 | DONE (wip `b0ad22d186`, T `55d78f3392`) |
| B6 resources + preview (AX-78/79/87) | Opus | `ResourcesPanel.hooks.ts` → `@jini-ai/ui/resource-monitor` (`createResourceStop`); hook bodies of `use-resources`, `use-site-preview` → `ui/resource-monitor` / `ui/site-card` | `ResourcesPanel.tsx` (import line); 2 host bindings | Tovu −15 preview + 8 resource tests → Jini +26 (new "a reply that lands while hidden arms no timer" killed the hidden-panel mutation that the ported tests missed) | DONE (J `c536c8142`; T `b0ad22d186`) |
| B7 main-process sweep | Opus | `supervised-site-url.ts` verbatim → `@jini-ai/desktop-host/shell/supervised-site-url`; 12 others classified (already bound to Jini; residue is TOVU_* env, copy, policy) | `main/index.ts` (import line) | Tovu −3 → Jini +3 | DONE (J `49fe7cbef`; T `01e82a677a`) |

The `wip(...)` commits are 5-to-10-minute snapshots of builder work in progress (standing cloud rule 2); each batch was reviewed afterwards and its fixes landed in the named commits.

## Gates (base = merge-16 unmodified, same machine)
- **Jini:** build 0 (0 `error TS`) · typecheck 0 · `api:check` 0 after `api:update` (new subpaths `ui/{find,zoom,app-version,live-views,import-handoff,resource-monitor}`, `chat/react/{conversations,bridged-chat,conversation-chat-pane}`, `core/contracts/{find-in-page,desktop-zoom}`, `desktop-host/shell/supervised-site-url`; only intended hash changes on `FindInPageResult`, `ZoomCommandDirection`, `shellStalenessFailure`) · guard 1 = base (HW3 `admin/shell-failure-log`) · size = base · complexity = base · why-comments 10 = base · **check:hooks +1** (Open 1) · changed vitest: devops 8/8, ui 168/168, chat 76/76, diagnostics 138/138, agent-plugins 41/41, desktop-host 242/242. Changesets: one per batch/package.
- **Tovu:** desktop tsc preload 0/0, renderer 0/0, main 4/4 (= base, `@tovu/sdk`), live-verify 0/0 · root `npm run typecheck` 12 errors = base 12 (identical set) · admin tsc 0 = base 0 · desktop renderer suite 760/763 fail 1 vs base 912/916 fail 2, main suite 2092/2107 fail 5 vs base 2098/2115 fail 6: **no failing test that is not failing on base** (`use-site-folders.hooks.test` "closing the settings dropdown…" is BASE-RED) · `check:why-comments` 78 = base (115 moved blocks recorded in `development/why-comments-debt.json`, one row each naming its Jini destination; 8 more for B0).
- SELF-CHECK: no forwarding files (two new `App.hooks` re-exports removed by the coordinator); hooks reach Jini components only as required props; no server-framework types or host log formatters in Jini; `jini-*` classes only; no new size/complexity exception rows; shared wire types in Core (`find-in-page`, `desktop-zoom`); object args with optional pads; behaviour changes test-first with named mutations; `## Wiring` READMEs in every new/touched feature folder.

## Open / skipped (exact reasons)
1. **check:hooks +1:** `ConversationChatPane::useConversationChatPaneHook`. The hook is a REQUIRED prop (Codex rule rv1123k FIX 3: no default hook). The checker only recognises the older defaulted-prop form. Precedent: the two base rows `MenuPageLinkFields`/`TaxonomyRowMenu` carry the same reason. Adding the third row was **blocked by the run's permission classifier**, so it is left for the owner. **Recommendation:** add the row with the same reason, or teach the checker that a required `use*Hook` prop counts as injected.
2. **AX-55/56 T:** `contracts/app-version.ts` should replace its duplicate bridge types with Jini `AppVersionBridge`/`UpdateCheckBridge`. This was not done in this run (budget).
3. **`app-version-ipc.ts`, `find-in-page-ipc.ts`:** STAYS-HOST. Both are already thin adapters over Jini bridges and hold Tovu's release-tag convention and the deployed Find channels. The scanner still counts them as moving, so the recommendation is to add them to `plan.mjs` KEEP_RULES.
4. **Window bounds JSON store:** STAYS. Moving it back would reverse the deliberate retirement of Jini's `shell/window-bounds-store`.
5. **`shell-staleness`:** the edge-case difference in `isBundleInput` for a leading `__measurements__/` has no effect on the Tovu walker. Each file is re-checked by its absolute path, so the excluded files stay excluded.
6. **Follow-ups outside this lane's files:**
   - Admin `use-site-card-preview.hooks.ts` could use `@jini-ai/ui/site-card` `useSitePreview`.
   - The admin twin of `tokensForCreate` belongs to AX-40.
   - `@jini-ai/admin/browser` `installBrowserErrorListeners` could be deduped onto `installGlobalErrorReporting`.
   - Stale path citations remain in non-owned files: `use-find-in-page.hooks.ts:57`, `use-find-in-page.jsdom.test.ts:5`, `workspace-chat-transport.ts:300`, `runner-api.ts:94`, `SiteGrid.tsx:227,261`.

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`, themes = `theme` 86 + `adm-themes` 25)
| tree | moving | FILES LEFT | excl. themes | desktop area: moving / keep |
|---|---|---|---|---|
| base (merge-16 `3a93322474`) | 2,187 | **2,187** | **2,076** | 11 / 227 |
| after (T `3e11043843`) | 2,186 | **2,186** | **2,075** | 10 / 211 |

The scanner counts only 11 desktop files as moving; every other desktop file sits in its KEEP rules. The lane deleted 17 Tovu desktop production files. One of them (`shell-staleness.ts`) was a counted file; the other 16 came off the scanner's keep side (227 → 211).

## Per-file classification (164 owned)
| file | decision | detail |
|---|---|---|
| `apps/desktop/bin/tovu-desktop.ts` | STAYS-HOST | packaging/build/smoke script (release/packaging config must not change) |
| `apps/desktop/scripts/adapters/live-electron.ts` | STAYS-HOST | packaging/build/smoke script (release/packaging config must not change) |
| `apps/desktop/scripts/check-coverage.ts` | STAYS-HOST | packaging/build/smoke script (release/packaging config must not change) |
| `apps/desktop/scripts/clean-preload.ts` | STAYS-HOST | packaging/build/smoke script (release/packaging config must not change) |
| `apps/desktop/scripts/merge-latest-mac.ts` | STAYS-HOST | packaging/build/smoke script (release/packaging config must not change) |
| `apps/desktop/scripts/one-react.ts` | STAYS-HOST | packaging/build/smoke script (release/packaging config must not change) |
| `apps/desktop/scripts/resolve-ts-ext.ts` | STAYS-HOST | packaging/build/smoke script (release/packaging config must not change) |
| `apps/desktop/scripts/smoke-bridge.ts` | STAYS-HOST | packaging/build/smoke script (release/packaging config must not change) |
| `apps/desktop/scripts/smoke-native.ts` | STAYS-HOST | packaging/build/smoke script (release/packaging config must not change) |
| `apps/desktop/scripts/smoke-packaged-chat.ts` | STAYS-HOST | packaging/build/smoke script (release/packaging config must not change) |
| `apps/desktop/scripts/stage-payload.ts` | STAYS-HOST | packaging/build/smoke script (release/packaging config must not change) |
| `apps/desktop/scripts/stage-website-shared.ts` | STAYS-HOST | packaging/build/smoke script (release/packaging config must not change) |
| `apps/desktop/scripts/verify-staged-closure.ts` | STAYS-HOST | packaging/build/smoke script (release/packaging config must not change) |
| `apps/desktop/src/add-site-pointer.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/admin-dev-proxy.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/agent-plugin-tokens.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/app-version-ipc.ts` | STAYS-HOST | thin adapter over Jini `registerAppVersionBridge`; keeps `desktop-v*` release-tag convention + channel |
| `apps/desktop/src/contracts/app-version.ts` | STAYS-HOST | deployed IPC channel/contract ABI (host) |
| `apps/desktop/src/contracts/chat-attachments.ts` | STAYS-HOST | deployed IPC channel/contract ABI (host) |
| `apps/desktop/src/contracts/owner-store.ts` | STAYS-HOST | deployed IPC channel/contract ABI (host) |
| `apps/desktop/src/contracts/product-telemetry.ts` | STAYS-HOST | deployed IPC channel/contract ABI (host) |
| `apps/desktop/src/contracts/project.ts` | STAYS-HOST | deployed IPC channel/contract ABI (host) |
| `apps/desktop/src/contracts/sections.ts` | STAYS-HOST | deployed IPC channel/contract ABI (host) |
| `apps/desktop/src/contracts/site-name.ts` | STAYS-HOST | deployed IPC channel/contract ABI (host) |
| `apps/desktop/src/contracts/site-theme-preview-bridge.ts` | STAYS-HOST | deployed IPC channel/contract ABI (host) |
| `apps/desktop/src/contracts/site-view-preference.ts` | STAYS-HOST | deployed IPC channel/contract ABI (host) |
| `apps/desktop/src/contracts/working-directory.ts` | STAYS-HOST | deployed IPC channel/contract ABI (host) |
| `apps/desktop/src/contracts/workspace-conversations.ts` | STAYS-HOST | deployed IPC channel/contract ABI (host) |
| `apps/desktop/src/coverage-floors.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/desktop-agent-tools.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/desktop-capture.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/desktop-host-signals.ts` | STAYS-HOST | imports website internals + Tovu payload path |
| `apps/desktop/src/desktop-mcp-http.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/desktop-user-data-dir.ts` | STAYS-HOST | uses Jini `resolveElectronUserDataDir`; TOVU_* override + app name |
| `apps/desktop/src/dist-import-check.ts` | STAYS-HOST | walk already Jini `undeclaredDistImports`; keeps `#src/` alias + boot copy |
| `apps/desktop/src/external-site-stop.ts` | STAYS-HOST | dev.mjs launcher lease + copy |
| `apps/desktop/src/find-in-page-ipc.ts` | STAYS-HOST | thin adapter over Jini `registerFindInPageIpc`/`relayFindResults`; deployed Find channels stay (K01/D1) |
| `apps/desktop/src/main/boot/own-server-boot.ts` | STAYS-HOST | Electron main composition (windows/boot) over Tovu site lifecycle |
| `apps/desktop/src/main/boot/site-backend.ts` | STAYS-HOST | Electron main composition (windows/boot) over Tovu site lifecycle |
| `apps/desktop/src/main/boot/site-preview-guests.ts` | STAYS-HOST | Electron main composition (windows/boot) over Tovu site lifecycle |
| `apps/desktop/src/main/boot/site-preview.ts` | STAYS-HOST | Electron main composition (windows/boot) over Tovu site lifecycle |
| `apps/desktop/src/main/windows/site-folder-prompt.ts` | STAYS-HOST | Electron main composition (windows/boot) over Tovu site lifecycle |
| `apps/desktop/src/main/windows/site-open-actions.ts` | STAYS-HOST | Electron main composition (windows/boot) over Tovu site lifecycle |
| `apps/desktop/src/main/windows/site-window.ts` | STAYS-HOST | Electron main composition (windows/boot) over Tovu site lifecycle |
| `apps/desktop/src/main/windows/window-bounds-json-store.ts` | STAYS-HOST | geometry already Jini; keeps storage location + legacy filename (Jini twin deliberately retired) |
| `apps/desktop/src/move-site-home.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/nested-sites-migration.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/owner-store-cli.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/owner-store-ipc.ts` | STAYS-HOST | Tovu project/site IPC handlers over Tovu channels |
| `apps/desktop/src/packaged-gate-isolation.ts` | STAYS-HOST | uses Jini `withIsolatedPackagedTree`; injects release-gate prefix |
| `apps/desktop/src/product-telemetry-preference.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/project-ipc.catalog.ts` | STAYS-HOST | Tovu project/site IPC handlers over Tovu channels |
| `apps/desktop/src/project-ipc.create.ts` | STAYS-HOST | Tovu project/site IPC handlers over Tovu channels |
| `apps/desktop/src/project-ipc.delete.ts` | STAYS-HOST | Tovu project/site IPC handlers over Tovu channels |
| `apps/desktop/src/project-ipc.import.ts` | STAYS-HOST | Tovu project/site IPC handlers over Tovu channels |
| `apps/desktop/src/project-ipc.records.ts` | STAYS-HOST | Tovu project/site IPC handlers over Tovu channels |
| `apps/desktop/src/project-ipc.rename.ts` | STAYS-HOST | Tovu project/site IPC handlers over Tovu channels |
| `apps/desktop/src/project-ipc.server.ts` | STAYS-HOST | Tovu project/site IPC handlers over Tovu channels |
| `apps/desktop/src/project-ipc.site-lifecycle.ts` | STAYS-HOST | Tovu project/site IPC handlers over Tovu channels |
| `apps/desktop/src/renderer/CreateWebsiteOnboarding.tsx` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/ResourcesPanel.hooks.ts` | MOVED | B6 → `@jini-ai/ui/resource-monitor` |
| `apps/desktop/src/renderer/SharedKeys.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/SharedKeys.tsx` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/SiteGrid.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/SitesFolders.tsx` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/WorkspaceChatPane.tsx` | MOVED | B2 → `@jini-ai/chat/react/conversation-chat-pane` (P13-D2) |
| `apps/desktop/src/renderer/app-hooks.test-support.ts` | STAYS-HOST | Tovu node:test/jsdom harness (OWNER-Q-14 rec) |
| `apps/desktop/src/renderer/app-render-harness.ts` | STAYS-HOST | Tovu node:test/jsdom harness (OWNER-Q-14 rec) |
| `apps/desktop/src/renderer/app-shell-source.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/app/CreateWebsiteHost.tsx` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/app/MainArea.tsx` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/app/MainContent.tsx` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/app/MainHeader.tsx` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/app/SiteStartPanel.tsx` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/app/Spinner.tsx` | MOVED | B5 DEDUPE → `@jini-ai/ui` `Spinner` (OWNER-Q-15 rec) |
| `apps/desktop/src/renderer/app/TabCloseAsk.tsx` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/app/TabStrip.tsx` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/app/component-harness.ts` | STAYS-HOST | Tovu node:test/jsdom harness (OWNER-Q-14 rec) |
| `apps/desktop/src/renderer/chat-attachments.ts` | MOVED | B3 → `@jini-ai/chat/react/bridged-chat` |
| `apps/desktop/src/renderer/create-website-onboarding-policy.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/dom-hook-harness.ts` | STAYS-HOST | Tovu node:test/jsdom harness (OWNER-Q-14 rec) |
| `apps/desktop/src/renderer/find-bar-state.ts` | STAYS-HOST | B1: logic → `@jini-ai/ui/find`; keeps English counter copy injected as labels |
| `apps/desktop/src/renderer/find-focus-clock.ts` | MOVED | B1 → `@jini-ai/ui/find` |
| `apps/desktop/src/renderer/find-input-focus.ts` | MOVED | B1 → `@jini-ai/ui/find` |
| `apps/desktop/src/renderer/find-target.ts` | MOVED | B1 → `@jini-ai/ui/find` |
| `apps/desktop/src/renderer/import-drop.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/import-site-entry.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/jini-kits.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/jini-surfaces.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/nav-availability.ts` | STAYS-HOST | B4: function → `@jini-ai/ui/core` `navAvailability`; keeps "Coming soon" copy |
| `apps/desktop/src/renderer/product-telemetry.ts` | STAYS-HOST | B5: lifecycle → `@jini-ai/diagnostics/observability` `installGlobalErrorReporting`; keeps telemetry vocabulary + bridge |
| `apps/desktop/src/renderer/runner-conversation-controller.ts` | MOVED | B3 → `@jini-ai/chat/react/conversations` |
| `apps/desktop/src/renderer/site-port.rules.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/site-shell-policy.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/site-status.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/site-theme-preview.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/sites-home-view.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/source-test-harness.ts` | STAYS-HOST | Tovu node:test/jsdom harness (OWNER-Q-14 rec) |
| `apps/desktop/src/renderer/use-app-version.hooks.ts` | STAYS-HOST | B4: hook → `@jini-ai/ui/app-version`; keeps bridge lookup |
| `apps/desktop/src/renderer/use-create-site-plugin-tokens.hooks.ts` | STAYS-HOST | B5: `tokensForCreate` → `@jini-ai/agent-plugins/connect`; keeps bridge, CreateSiteInput, product copy |
| `apps/desktop/src/renderer/use-create-website-form.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-find-bar-effects.hooks.ts` | MOVED | B1 → `@jini-ai/ui/find` |
| `apps/desktop/src/renderer/use-find-bar-state.hooks.ts` | MOVED | B1 → `@jini-ai/ui/find` |
| `apps/desktop/src/renderer/use-find-focus-reclaim.hooks.ts` | MOVED | B1 → `@jini-ai/ui/find` |
| `apps/desktop/src/renderer/use-find-input-binding.hooks.ts` | MOVED | B1 → `@jini-ai/ui/find` |
| `apps/desktop/src/renderer/use-import-handoff.hooks.ts` | STAYS-HOST | B4: hook → `@jini-ai/ui/import-handoff`; keeps bridge + websiteAddress validator |
| `apps/desktop/src/renderer/use-live-views.hooks.ts` | STAYS-HOST | B4: hook → `@jini-ai/ui/live-views`; keeps RELEASE_PROBE, INNER_SCROLLER, bounds, bridge |
| `apps/desktop/src/renderer/use-new-site-dir.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-product-screen.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-project-mutations.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-project-tabs.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-resources.hooks.ts` | STAYS-HOST | B6: hook → `@jini-ai/ui/resource-monitor`; keeps browser ports |
| `apps/desktop/src/renderer/use-runner-conversations.hooks.ts` | STAYS-HOST | B3: hook → `@jini-ai/chat/react/conversations`; keeps bridge lookup + log label |
| `apps/desktop/src/renderer/use-section-nav.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-site-actions.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-site-folders.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-site-locate.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-site-power.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-site-preview.hooks.ts` | STAYS-HOST | B6: hook → `@jini-ai/ui/site-card`; binds `getBridge` to the preload bridge |
| `apps/desktop/src/renderer/use-site-rename.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-site-start.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-site-storage-settings.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-site-view-preference.hooks.ts` | MOVED | B4 → `@jini-ai/ui/live-views` |
| `apps/desktop/src/renderer/use-site-workspace.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-sites-folders-dialog.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-sites-inventory.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-tab-close-ask.hooks.ts` | STAYS-HOST | product shell / site management / onboarding composition (P13 §4.1 STAYS) |
| `apps/desktop/src/renderer/use-update-check.hooks.ts` | STAYS-HOST | B4: hook → `@jini-ai/ui/app-version`; keeps bridge lookup + host log line |
| `apps/desktop/src/renderer/use-webview-load-failure.hooks.ts` | MOVED | B4 → `@jini-ai/ui/live-views` |
| `apps/desktop/src/renderer/use-workspace-chat-pane.hooks.ts` | MOVED | B2 → same (P13-D1 dedupe onto `captureFolderPathDrop`, then D2) |
| `apps/desktop/src/renderer/use-workspace-chat-transport.hooks.ts` | STAYS-HOST | B3: hook → `@jini-ai/chat/react/bridged-chat`; keeps bridge + IPC transport binding |
| `apps/desktop/src/renderer/use-zoom.hooks.ts` | STAYS-HOST | B4: logic → `@jini-ai/ui/zoom`; keeps `tovu:zoom:` storage key + bridge lookup |
| `apps/desktop/src/resources-ipc.ts` | STAYS-HOST | Tovu project/site IPC handlers over Tovu channels |
| `apps/desktop/src/runner-ipc-stubs.ts` | STAYS-HOST | Tovu project/site IPC handlers over Tovu channels |
| `apps/desktop/src/shared-sites.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/shell-staleness.ts` | MOVED | B0 DEDUPE → `@jini-ai/devops/packaging/electron` (`isBundleInput`, `shellStalenessFailure` + injected `consequence`) |
| `apps/desktop/src/site-archive-import.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/site-child-registry.ts` | STAYS-HOST | site lifecycle policy (tovu serve argv identity); uses Jini child registry |
| `apps/desktop/src/site-config.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/site-dir-store.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/site-directory-identity.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/site-discovery-scan.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/site-discovery-worker.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/site-discovery.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/site-folders.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/site-name-policy.ts` | STAYS-HOST | Jini twin is async/1000-cap; sync case-insensitive Tovu contract + copy (behaviour change → not deduped) |
| `apps/desktop/src/site-name.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/site-power-verify.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/site-preview-store.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/site-scan-policy.ts` | STAYS-HOST | Tovu discovery policy + copy |
| `apps/desktop/src/site-theme-preview.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/sites-mcp-identity.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/sites-mcp-tools.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/smoke-native.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/smoke-packaged-chat-gate.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/smoke-packaged-chat.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/stage-payload-run.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/staged-closure-scan.ts` | STAYS-HOST | uses Jini `walkPayloadFiles`; keeps payload layout rule (packaging config) |
| `apps/desktop/src/startup-env.ts` | STAYS-HOST | TOVU_DESKTOP_* env contract + copy |
| `apps/desktop/src/supervised-site-url.ts` | MOVED | B7 → `@jini-ai/desktop-host/shell/supervised-site-url` |
| `apps/desktop/src/tracked-site-relocation.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/tracked-sites.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
| `apps/desktop/src/update-policy.ts` | STAYS-HOST | uses Jini `updaterSkipReason`; keeps release platforms, copy, TOVU_* env |
| `apps/desktop/src/verify-package-cli.ts` | STAYS-HOST | Tovu site lifecycle / packaging / product policy (stays-in-tovu.md) |
