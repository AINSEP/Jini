PARTIAL 284f95502 efdf9d6f9: A-K2-shell-lib-4 (request.ts, K5 design), A-K2-shell-lib-6/7, A-K2-shell-hooks-2/3/4, A-K2-shell-components-3..11, A-adm-shell-components-2, B5 CSS pairing, A-K2-0a.chip; skipped files of A-adm-shell-lib-1..4, A-adm-shell-hooks-1, A-adm-shell-components-1, A-K2-shell-lib-1/2/3/5, A-K2-shell-hooks-1, A-K2-shell-components-1/2 (owner literals / module-state design / deps not landed, listed)

# ex5-fnd-kit — FOUNDATION: admin kit (A-K2 base) + admin shell (2026-11-22/23)

Unattended cloud run. Opus as coordinator, with 13 opus-high subagents in 4 waves (at most 4 at a time, each on disjoint destination files). Subagents only wrote the Jini halves of verbatim/K2 moves and committed nothing. I reviewed every report and diff and did all of the following myself:
- the kit host assignment;
- the Tovu repoint, with one codemod per wave (Tovu importers overlap heavily across sheets, so one writer);
- the export, ledger and baseline edits, builds, gates, commits and pushes.

- **Bases:**
  - Jini `origin/integ/merge-14-2026-11-22` `4902a6a1a`.
  - Tovu `origin/integ/merge-13-2026-11-22` `f7185f153`. This is `0d7f78fa4` plus one docs-only commit, the combine-13 report.
- **Branches:** Jini `codex/ex5-fnd-kit-jini`, Tovu `codex/ex5-fnd-kit-tovu`. Plain `git push` after every batch; no force, no `--no-verify`, no tags, nothing published.
- **Setup:** as in combine-13:
  - Node 24.22.3, pnpm 10.33.2.
  - Jini: `pnpm install --frozen-lockfile` 0, `pnpm --no-bail -r build` 0.
  - Tovu: `npm ci --ignore-scripts` in root, admin, desktop and site-chat 0/0/0/0; `link-jini.mjs` against this Jini branch 0; `packages/contracts` tsc 0, `packages/sdk` build 0.
- **Codex review:** pending. Every diff below is for Codex to review before merge.

## Batches

**Totals:**
- Jini: 62 production files under `packages/admin/src/shell/**` and 39 tests.
- Tovu: 63 production files deleted (62 moved, plus `lib/query-suffix.ts`, which repoints to its existing Jini twin `@jini-ai/core/admin-runtime`) and 38 moved tests deleted.
- One codemod per wave rewrote every Tovu importer, including `vi.mock` specifiers: 380 + 115 + 52 + 8 specifiers.

| # | steps | Jini | Tovu | what moved / changed | tests |
|---|---|---|---|---|---|
| 1 | **A-K2-0a.T** (host) | – | `6c25f434c` | `jini-kits.ts` binds `Icon`, UI `useT` and the `values` group. **Admin tsc 0 again with merge-14** (it was BASE-RED, 4 errors, in every ex4 lane). | admin tsc 0 |
| 1 | **A-K2-0b.J/.T**, **TabBarTab** | `e6468e055` | `6c25f434c` | New `AdminKit.chat`: chat `useT` via `useChatT`, plus `createMidRunMessagePoster`, `createTypedAnswerPoster` and `createA2uiActionPoster` via `useAdminKitChatPosters`. Shapes are restated; the A2UI `path`/`fetch`/`reportFailure` stay required. `TabBarTab` gains `disabled`, `dot` and `dotLabel`. | kit tests 13/13. Mutation `useChatT`→`hooks.useT`: **RED** |
| 1 | **A-adm-shell-lib-1/2/3, A-adm-shell-components-1** | `e6468e055` | `6c25f434c` | 33 files moved verbatim to `shell/lib` and `shell/components`; type-only strictness fixes. | 19 tests moved, 182/182. Mutations RED (addons-routes, external-entry-refresh, queued-daemon-start, send-stop-guard) |
| 2 | **A-K2-0a rest + A-K2-0.J (0c) "B5 kit"** | `255f73935`, `730d3e8e1`, `efdf9d6f9` | `2c8b570ea` | Component slots: `RemixIcon`, `Toast`, `I18nProvider`, `SettingsDialogShell`, `CodeWithLines`, `CodeWrapToggle`, `PreviewModalShell`. Hooks: `useTabBarKeyboard`, `useSerialWrites`, `useCodeWrap`, `useInfoTip`, `usePanelPosition`, `useSelectDropdown`. 8 values (lightbox, tab index, `hasPermission`, standing-draft/failure-channel factories, sandbox URL). 4 chat entries. About 30 restated chat/UI types. `InfoTipProps` gains placement/icon/triggerLabel/descriptionId. The restated chat types were split into `react/kit-chat-types.ts` to stay under the size cap. | kit tests 19/19. Mutation `useCodeWrap`→`useSerialWrites`: **RED** |
| 2 | **A-adm-shell-lib-4, A-adm-shell-hooks-1** | `255f73935` | `2c8b570ea` | 15 files moved. Guard: `./shell/*` entries join the browser isolation domain; HW3 ledger rows for the moved browser-tab singleton buses. | 8 tests moved, 80/80. Mutations RED |
| 2b | page-lifecycle node test | `94963207b` | `4542f97bc` | The test spawns node on the module path, so it moved with the module. | Mutation `target: window`: **RED** |
| 3 | **A-K2-shell-lib-1/2, A-K2-shell-components-1/2** (slices) | `5615ba660` | `6658f28a8`, `204f9e534` | 12 files moved onto the kit. **K5:** `isSelectionNormalizationEcho` now takes `resolveChatPaneSelection`, and `useFolderUpload` takes a `folderZip` port. The Tovu callers (local-cli-selection hook and its echo test, both plugin install hooks) pass them. 2 Tovu test harnesses were fixed (details below). | 8 tests moved, 89/89. Tovu affected 36 files, 1031/1031 |
| 4 | **A-K2-shell-lib-5 / A-K2-shell-hooks-1** (slices) | `76cf3f8a5`, `fcef92f59` | `d201e0ed1` | `tab-event-source` and its 2 tests moved. `use-external-entry-refresh` now reads `useSettlementGeneration` from the kit; `fqfix-editor-reopen` renders under the host kit. | 5/5 and 24/24. Tovu: 90 editor/stream files green |
| 5 | why-comments ledger | – | `bacfff091` | 13 "moved to Jini" rows (the moved blocks were reworded per N1/N2). | why-comments = base |
| 6 | **K4-i18n-common.T** | – | `284f95502` | `COMMON_I18N` = Jini `ADMIN_COMMON_I18N` + the one product entry (716 → 47 lines). Same entries in all 21 locales; only that key's position changed. | 30 i18n files 905/906 (BASE-RED one) |

**Two Tovu test harness fixes (`204f9e534`, assertions untouched):**
- `untranslated-copy` lists the moved `admin-nav-i18n` and `editor-failure-i18n` dictionaries explicitly. Its glob cannot reach a package, and without them 5 `SAME_AS_ENGLISH` allowances read as stale.
- `OverflowAwareMcpUiSurfaceCard` renders `MessageOverflowModal`, which is now kit-backed, under a `fakeAdminKit` with the real lightbox helpers.

## Steps / files skipped, and why

**Owner decisions needed:**
- **`lib/server-reconnect.ts`:** the `x-tovu-upstream-status` wire header. Only Tovu's Vite dev proxy (`dev-proxy-upstream-close.ts:7,53`) sets it and only `admin-http/request.ts:347` reads it. Renaming it needs a paired dev-proxy change and 3 Tovu test assertions.
- **`components/AssistantDock/hooks/chat-package-kind.ts`:** the `tovu.plugin.json` legacy alias in code.
- **`lib/admin-dev-origin.ts`:** the `__TOVU_ADMIN_DEV_PORT__` build define.
- **`lib/site-url.ts`:** `VITE_TOVU_SITE_URL`.
- **`ChatFab.hooks.tsx`:** localStorage key `tovu-admin-fab-position`. Suggestion: a K3 `storageKey` option.
- **`assistant-agents-snapshot.ts`, `browser-working-directory-access.ts`:** `tovu.*` storage keys.
- **`assistant-dock-i18n.ts`:** 42 dictionary keys name the product. It needs the K4i split (Jini dictionaries minus those keys; the host composes) plus K5 fields on `createChatI18nAdapter`.

**Design needed (K5 with module state):**
- **`lib/admin-http/request.ts` (A-K2-shell-lib-4).** This is the largest remaining blocker; 293 Tovu importers. It holds module-level unauthenticated listeners, the failure-channel singleton, the reconnect singleton and `@tovu/contracts/secret-redaction`.
- **`admin-failure-channel.ts`:** module singleton plus product vocabulary.
- **`standing-draft-local-backup.ts`, `assistant-transport-ag-ui.ts`, `typed-answer-poster.ts`, `a2ui-action-poster.ts`:** module-scope factory calls or host composition.
- **`durable-run-subscription.ts`, `sse-frames.ts`:** import the host module `@tovu/assistant-run-events`.
- **`fetch-query/provider.tsx`:** needs two FetchQueryProvider kit slots, and the root order (`AdminKitProvider` above it) must be checked.
- **`assistant-mcp-ui.ts`:** a module-scope caller, pinned as text by a website test.

**Third-party dependency not declared by `@jini-ai/admin`:**
- tiptap: `block-atom-insert`, `live-tiptap-editor`, `post-title-extension`, `media-image-extension.hooks`.
- html2canvas-pro: `agent-screenshot`.

**Prerequisite not landed:**
- `A-adm-posts-1`: `admin-post-list-sort`.
- K4-seam-8/14/17: `admin-execution-credential-port`, `use-sites-sidebar-nav`.
- Not in the kit: `useStandingDraftAutosave`, `useSettingsSlice` (module-scope re-exports), `AssistantConversation`/`createLastConversationStore`, `FrontendSessionBridge`, `ChatPaneWorkingDirectoryAccess`, `createChatAttachmentValidator`.
- Every file that imports `admin-http/request`: `browser-telemetry`, `credential-submit-error`, `retry-unreachable`, `assistant-chats`, `assistant-subagents`, `use-admin-telemetry`.
- `descriptor-i18n`: feature API types.
- `credential-copy.ts`: K3/K5j into optional args.

**Host composition (stays):**
- `*-dependencies.hooks.ts` files that wire Tovu implementations: `admin-execution-credential-dependencies`, `assistant-chats-dependencies`, `admin-locale-dependencies`.
- `lib/admin-http/urls.ts`: `development/scripts/check-admin-api-routes.ts` reads it from disk.
- `__tests__/browser-stream.fakes.ts`: shared by 3 Tovu tests (a copy also lives in Jini).

**B5 CSS pairing (host classes styled by Tovu CSS):**
- The 4 shell stylesheets: `admin-failure-notice`, `install-tab-card`, `mail-status-banner`, `server-restarting-banner`.
- `ConfirmActionDialog`, `ViewTemplateButton`, `SubagentsIndicator`, `FolderDrop*`, `FolderPathButton`.
- These need `jini-*` renames paired with Tovu CSS and theme selectors. Themes stay in Tovu.

**Other lanes (excluded):**
- `app-version.ts`, `use-desktop-view-release.hooks.ts`: Desktop.
- `boot-token-fragment.ts`, owner MFA/passkey/recovery/sign-in clients: Users/Authentication.

**Not started:**
- `A-adm-shell-components-2`: needs `A-adm-other-1/2/3`, which have not landed.
- `A-K2-shell-lib-6/7`, `A-K2-shell-hooks-2/3/4`, `A-K2-shell-components-3..11`: their chains go through request.ts and K4 seams.
- B5 CSS.
- `SEC` kit chip slot (`A-K2-0a.chip`): no multiselect/chip shape was specified.

## Which ex4 lane steps are now unblocked
- **All lanes:** Tovu admin tsc against Jini merge-14+ is green again. The ex4 reports called it BASE-RED (4 `AdminKit` errors, from A-K2-0a.T missing). The kit now has the `chat` group, `values` and the B5 names their K2 sheets list.
- **Settings lane:**
  - **A-K2-redirects-1** and the SEO screen slices now import nothing from the Tovu admin shell. They needed `lib/merge-locale-overlays` (A-adm-shell-lib-2), now in Jini, and `lib/i18n-common` (K4-i18n-common.T, now done; use `ADMIN_COMMON_I18N`).
  - **A-K2-consent-1** still needs `hooks/use-admin-locale` (A-K2-shell-hooks-3).
  - content-analysis and analytics still need request.ts.
- **Media, Add-ons, Deploy, Integrations, Settings lanes:** their A-adm-shell-lib-1/2/3/4, A-adm-shell-hooks-1 and A-adm-shell-components-1 prerequisites are landed (minus the skips listed above). They are still blocked on **A-K2-shell-lib-4 (request.ts)**, **A-K2-shell-hooks-3 (use-admin-locale)** and the `A-adm-other-*` sheets. Every screen dir except redirects/seo still imports `@/lib/admin-http/request` or `@/hooks/use-admin-locale.hooks`.
- **Security SEC-10/11:** still blocked. The kit has no chip/multiselect slot.

## Gates (base-diff)

**Jini, at `efdf9d6f9` vs merge-14 (combine-14):**
- **Equal to base or green:**
  - guard 0, api:check 0 (baseline updated: +29 entries), hooks 0, typecheck 0, check:errors 0 (WARN mode).
  - admin vitest **3,477/3,477**.
  - XP (no declaration snapshot) XP1 39 / XP2 33 / XP3 2050 / XP4 760 / XP5 6: identical to base.
  - complexity: no admin rows.
  - why-comments: no row in moved files.
- **NEW ratchet rows, LISTED (not fixed):**
  - **size:** `packages/admin/src/shell/lib/admin-nav-i18n.ts` at 1,360 lines. It is a dictionary moved verbatim; Tovu carried it.
  - **log-safety:** 11 raw `console.error` paths moved verbatim in the shell buses (`acceptance-cancellation`, `agent-screenshot-bus`, `assistant-dock-bus`, `content-refresh-bus`, `playground-render-target-bus`, `settings-refresh-bus`). The ratchet refuses growth even with a ledger update. Fixing it means routing them through a core `Logger` port, which is a named behaviour change for a follow-up.
  - **error gate WARN:** `browser-stream.ts` catch-reads-error.
- **HW3 module-state:** 17 ledger rows for the moved browser-tab singleton buses, each with an explicit reason.

**Tovu, at `d201e0ed1`/`bacfff091` vs combine-13 final:**
- **Every exit code matches combine-13 final:**
  - Exit 0: boundaries, admin tsc, desktop tsc ×4, typecheck(+e2e), hooks, worker-import-graph, errors, complexity, typecheck:tests.
  - Exit 1 or 2, with findings identical to base: size, typecheck:scripts (the same 3), architecture.
  - why-comments: exit 1, identical to base after `bacfff091`.
- **Admin full suite:** 3,435 files, 14,536 passed, 6 failed.
  - All 6 failing tests are BASE-RED: `JiniMediaPicker.hooks` 3, `admin-literal-copy` 1, `credential-input-autocomplete` 1, each red at `0d7f78fa4`.
  - The 6th, `widgets-swap` 1, was a one-off: Jini dist was rebuilt mid-run. Re-run: 15/15 at tip and at base.
- **Node tests:** every change is under `apps/admin`. The only node script that reads an admin path (`check-admin-api-routes.ts`, which reads `urls.ts`) is unchanged, because that file stays.

## FILES-LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs`, plan branch)

| tree | moving | shells | FILES-LEFT | excluding the scanner's theme areas (111) |
|---|---|---|---|---|
| base `f7185f153` (= combine-13 final) | 2,483 | 3 | **2,486** | **2,375** |
| final `284f95502` | 2,420 | 3 | **2,423** (−63) | **2,312** (−63) |

## For the next run
1. **request.ts:** decide the K5 shape for `lib/admin-http/request.ts` and `admin-failure-channel.ts`, for example a host-composed `createAdminHttp({ decodeApiError, redact, vocabulary, reconnect })` whose bindings the host exports. This single decision unblocks the most screen steps.
2. **Product strings:** decide the listed literals (wire header, storage keys, plugin alias, build defines).
3. **Log-safety:** fix the 11 moved `console.error` rows with a `Logger` port in a named-mutation step.
4. **B5 CSS:** pair the `jini-*` class renames with Tovu theme CSS.
