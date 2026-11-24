PARTIAL c95e22c2a4 9db4a5c1f: 14 owned files STOP (owner decisions or prerequisites listed below): use-assistant-chats.hooks, use-chat-display-preferences.hooks, byok-runtime.hooks, assistant-mcp-ui, DockHeaderTip.tsx, DockHeader.tsx, HtmlAttributeRows.tsx, ConfirmActionDialog, MediaEditDialog.tsx, block-atom-insert, post-title-extension, media-image-extension.tsx, media-embed-extension.tsx, assistant-daemon-activation

# w4-admin-shell — Admin shell lane (wave 4, 2026-11-24)

Unattended cloud run. Opus coordinated; 10 opus-high builder subagents ran in 3 waves, at most 4 at a time, on disjoint files. Subagents never committed. The coordinator reviewed every report and diff, staged each batch separately, wrote the shared files (`package.json` entries through one lock-guarded helper, api-baseline, changeset, READMEs, debt files), ran the gates and pushed.

**Programmer role:** `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read before any work. Every builder got it in its brief.

**Result.** Every one of the 72 owned files has a verdict. 70 are non-theme files; the 2 `admin-themes/*` files are excluded by the dispatch.

| verdict | files |
|---|---:|
| MOVE (the whole file leaves Tovu) | 24 |
| SPLIT (the generic core moved; the host wiring stays at the same path) | 3 |
| STAYS-HOST (with a one-line reason each) | 29 |
| STOP (exact reason and a recommendation each) | 14 |

**FILES LEFT** (`scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`, themes = `theme` + `adm-themes` areas):

| | FILES LEFT | excl. themes | adm-shell-components / hooks / lib |
|---|---:|---:|---|
| before (merge-16 `3a9332247`) | 2,187 | 2,076 | 112 / 19 / 59 |
| after (`c95e22c2a4`) | **2,163** | **2,052** | 93 / 16 / 57 |

That is **−24** in both columns. The base value reproduces combine-16's final.

**No new red on either side.** Every gate equals base (tables below). Codex review is still required before merge.

## Branches and setup
- **Jini** `codex/w4-admin-shell-jini` from `origin/integ/merge-16-2026-11-23` `7490405a`. Tip `9db4a5c1f`; the report copy is committed after it.
- **Tovu** `codex/w4-admin-shell-tovu` from `origin/integ/merge-16-2026-11-23` `3a9332247`. Tip `c95e22c2a4`; this report is committed after it.
- The base did not move during the run. I re-fetched before the final push and found 0 new commits on both, so no merge was needed.
- **Setup:**
  - Node 22.23.5, pnpm 10.33.2.
  - Jini `pnpm install --frozen-lockfile` and `pnpm --no-bail -r build`: 0 / 0, with 0 `error TS`.
  - Tovu `npm ci --ignore-scripts` in root and admin: 0 / 0.
  - `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`: 0.
  - `packages/contracts` tsc and `packages/sdk` build: 0.
- **Clean worktrees:**
  - Base gates ran in worktrees at the merge-16 heads (Tovu `node_modules` symlinked; Jini installed and built separately).
  - Tip gates ran in a Tovu worktree at the tip and in the built Jini main tree.
- **Not touched:** no force-push, no `--no-verify`, no tags, no publish, no codebase-memory tools, no RemoteTrigger. `main`, `integ/*`, `plan/*` and `release/*` were only fetched.

## Batch table

| batch | model | files moved (Tovu → `@jini-ai/admin/shell/...`) | importers edited | tests | status |
|---|---|---|---|---|---|
| **A** assistant chats | opus-high | `hooks/assistant-chats-port.hooks`, `AssistantDock/hooks/{chat-package-kind, conversation-refresh.hooks}`. `hooks/use-admin-telemetry.hooks` was **deleted as a duplicate** of the existing `@jini-ai/admin/react` `useBrowserTelemetryFeed`. | App.tsx, AssistantDock.state.hooks, composer-files.hooks, assistant-chats-dependencies, use-assistant-chats + 4 tests, browser-telemetry test | moved chat-package-kind (34), conversation-refresh (3). Mutation: legacy-marker condition negated → 14/34 RED | DONE 4 / STAYS 4 / STOP 2 |
| **B** dock preferences | opus-high | `AssistantDock/{chat-agent-plugin-preferences, SubagentsIndicator, hooks/use-chat-agent-plugins.hooks, hooks/use-assistant-runtime-preferences.hooks, hooks/use-selected-agent-auth-warning.hooks}` | 2 adapters, DockHeader, AssistantDock.state.hooks, 6 tests | moved chat-agent-plugin-preferences (2 + 1 new). Mutation `=== 'ask'`→`!==` → 2/2 RED | DONE 5 (rest went to G/J or STOP) |
| **C** editor/media | opus-high | `lib/{live-tiptap-editor, media-image-extension.hooks}`. SPLIT: `lib/agent-screenshot` (the html2canvas adapter stays), `MediaEditDialog/MediaEditDialog.hooks` (`useWiredMediaEditDialog` stays), `lib/media-embed-extension.hooks` (`useWiredMediaEmbedNodeView` stays) | posts hooks ×3, App.hooks, media extensions, widget-embed hooks, 4 tests | moved agent-screenshot (19 of 20; 1 adapter test stays). Mutation `!element.isConnected` flipped → 17/19 RED | DONE 5 / STOP 8 |
| **D** small components | opus-high | `TemplateSource/ViewTemplateButton`, `hooks/use-desktop-view-release.hooks` | PageEditor, PostEditorTemplatePicker, App.tsx, styles.css (alias) | moved 2 files (6). Mutation `!signedIn` flipped → 2/4 RED | DONE 2 / STAYS 11 / 7 to later batches or STOP |
| **E** dock i18n | opus-high | `AssistantDock/assistant-dock-i18n` (2,197 lines → a 171-line entry + 14 locale-group modules, as in the `admin-nav-i18n` precedent). The 42 product entries move into Tovu `app-i18n.ts`. | dock-chrome.hooks, App.hooks, 11 tests, dictionary-lookup-sinks allow-list, untranslated-copy check | new Jini 7, new Tovu 3 (all 21 locales of the product keys pinned). Equivalence run: 3,588 key×locale pairs (details below). Mutation on settings-key scoping → 1/7 RED | DONE |
| **F** folder drop | opus-high | `AssistantDock/{FolderDropConfirmation, FolderDropError, FolderDropPathHint, FolderPathButton}` | FolderDropNotice, assistant-dock-props, DockLeadingAccessory, assistant.css, 4 tests | moved 3 files (13). Mutation on replacedPreviousPath → 2/4 RED | DONE |
| **G** header rules | opus-high | `AssistantDock/{dock-header-rules, DockHeaderTip.hooks}`, `WidgetConfigFields/HtmlAttributeRows.hooks` | DockChatPane, DockHeader, DockHeaderTip, HtmlAttributeRows, 6 tests | 2 `it` moved + 1 new (3). Mutation `closest(...) === null` flipped → 1/3 RED | DONE |
| **H** media picker | opus-high | `MediaPickerDialog/JiniMediaPicker.hooks` | MediaPickerDialog, 2 tests | new Jini 3. Mutation `status === 'active'` flipped → 1/3 RED | DONE |
| **I** placement content | opus-high | `WidgetConfigFields/PlacementContentFields` | widget-embed-extension, styles.css, media-content-editor.css, 1 test | new Jini 5. Mutation `custom ?` negated → 3/5 RED | DONE 1 / STOP 1 (HtmlAttributeRows.tsx) |
| **J** gear menu | opus-high | `AssistantDock/DockSettingsMenu` | DockHeader, assistant.css, 6 tests | moved 5 of 15 (10 stay in Tovu). Mutation `placement === "above"` flipped → 3/5 RED | DONE |

**Batch E equivalence run.** The old Tovu module and the new Jini module were compared side by side over 156 keys × 23 locales (3,588 pairs).
- Chat adapter: 0 differences.
- Dock `t`: 21 differences, all on one Tovu-only `COMMON_I18N` key ("is on an older Tovu…"). That key belongs to the Publish dialog, and no dock `t` caller ever passes it. The Jini fallback is `ADMIN_COMMON_I18N`.

### Commits
- **Jini:**
  - `4b11cb6cd` D, `04cff2ec0` B, `3db9693a8` A+C
  - `034175ce3` docs
  - `2f31c6395` F, `7f1a100a4` H, `765de0f01` E
  - `4eb260069` G, plus isolation shared rows and an R11 fix
  - `1e572fd74` I, `90787d6d8` J
  - `9db4a5c1f` api baseline, changeset, Wiring
- **Tovu:**
  - `b1cbb8ceb7` D, `5b2f326996` B, `7c9a117a40` A+C
  - `c7770f8dec` F, `2b553ea78f` H, `25ec8d025f` E+G
  - `df2c7405e1` why-comments rows
  - `a0c9b3f8df` I + untranslated-copy fix, `08376add11` J
  - `8575c0d955` Wiring READMEs
  - `c95e22c2a4` gate follow-ups

## Injected collaborators (K3/K5; all required fields or props, no Jini defaults)

| Jini unit | field / prop | what Tovu passes |
|---|---|---|
| `partitionChatPackages` / `chatPackageKind` | `legacyManifestNames` | `["tovu.plugin.json"]` |
| `useConversationRefreshSignal` | `port` | `defaultAssistantChatsPort` |
| `load/saveChatAgentPlugins`, `useChatAgentPlugins` | `namespace` | `CHAT_DISPLAY_NAMESPACE` |
| `useAssistantRuntimePreferences` | `namespace`, `defaults` | `CHAT_DISPLAY_NAMESPACE`, `DEFAULT_ASSISTANT_RUNTIME_PREFERENCES` |
| `useSelectedAgentAuthWarning` | `createPort`, `selectWarning` | `createExecutionPort`, `selectedAgentWarning` |
| `SubagentsIndicator` | `useSettings` (hook prop) | `useWiredAssistantSubagentsSettings` |
| `captureAdminScreenshotToolResult` | `renderElementToCanvas` (already a field) | the host html2canvas-pro adapter |
| `useMediaEditDialog` | `translate`, `describeHtmlAttributeError`, `htmlAttributePolicy` | media `t`, its describer, `embedPolicy` |
| `useMediaEmbedNodeView` | `translate`, `mediaOriginalUrl` | media `t`, `mediaApi.mediaOriginalUrl` |
| `createMediaImageTranslator` | `translate` | `app-i18n` `t` |
| dock `t` / `createChatI18nAdapter` | `hostDictionary`, `settingsDialogKeys`, `settingsDialogDictionaries` | `ASSISTANT_DOCK_HOST_FIELDS` / `CHAT_I18N_HOST_FIELDS` (`app-i18n.ts`) |
| Folder* components | `useTHook` (hook prop) | `useT` from `@jini-ai/chat/react` |
| `useJiniMediaPicker` | `picker`, `port`, `errorRedaction`, `errorIdOf` | `useHostMediaPicker()`, `defaultMediaPickerPort`, `TOVU_ERROR_REDACTION_OPTIONS`, `ApiError` errorId reader |
| `dockSettingsMenuSections` | `toolCallOptions`, `replyLengthOptions` | `CHAT_TOOL_CALL_OPTIONS`, `REPLY_LENGTH_OPTIONS` |
| `useDockHeaderTip` | `useTip` | `useInfoTip` |
| `useHtmlAttributeRows` | `htmlAttributesToRows`, `rowsToHtmlAttributes`, `isDroppedAttributeRow` | the `media-content-rules` functions |
| `PlacementContentFields` | `ContentEditor` (component) | `MediaContentEditor` (+ its CSS imported at the mount) |
| `DockSettingsMenu` | `useTaxonomyRowMenuHook`, `ChatSettingsSegmented` | `useTaxonomyRowMenu`, `ChatSettingsSegmented` |

**CSS renames.** Every rename is paired with its Tovu selectors and tests. No theme targets any of these classes.
- `tovu-folder-drop-notice*` → `jini-folder-drop-notice*`
- `tovu-composer-folder-path` → `jini-composer-folder-path`
- `dock-settings-menu*` → `jini-dock-settings-menu*`
- `assistant-dock-icon-button` → `jini-assistant-dock-icon-button`
- `widget-embed-content-choice` → `jini-widget-embed-content-choice` (its legend uses `jini-field-label`, aliased in `styles.css`)
- `view-template-btn` → `jini-view-template-btn`. This one is aliased rather than renamed, because `PostEditorActions` (not owned) still renders the old class. The PostEditor DOM snapshot was updated for the class only.
- `DockSettingsMenu` keeps `row-menu-*`: Jini's own `RowMenu` already renders those exact classes.

**Shared files written centrally (union-merge on conflict):**
- Jini:
  - `packages/admin/package.json`: 26 new subpaths, plus 2 `jini.isolation.shared` rows (`chat-agent-plugin-preferences.ts`, `media/html-attributes.ts`) that clear SI-domain.
  - `api-baseline/jini-ai__admin.json`: additions only.
  - `.changeset/p9-w4-admin-shell.md`.
  - `packages/admin/README.md` `## Wiring`.
  - `scripts/hook-injection-debt.json`: 6 rows of the established "REQUIRED prop" kind: `SubagentsIndicator::useSettings`, 4× `Folder*::useTHook`, `DockSettingsMenu::useTaxonomyRowMenuHook`.
- Tovu:
  - `development/why-comments-debt.json`: 36 rows, each naming the Jini destination of a moved comment block.
  - `## Wiring` READMEs in `components/`, `components/AssistantDock/`, `lib/`, `hooks/`.

## STAYS-HOST (counted as done)

| file | reason |
|---|---|
| `apps/admin/dev-jini-deps.ts`, `dev-proxy-upstream-close.ts`, `dev-tls-disable-flag.ts`, `jini-core-version.ts` | host Vite/vitest config helpers. They carry the host wire header `x-tovu-upstream-status` and `TOVU_DISABLE_DEV_TLS`. |
| `src/vite-env.d.ts` | host build-define declarations |
| `src/App.chrome.tsx` | app root chrome composition (host kit, publish dialog, dock) |
| `src/app-i18n.ts` | Tovu product dictionary; it now also holds the dock product overlays (K3) |
| `src/media-panel.ts` | panel registry composition |
| `integrations/jini-admin/kit.ts` | Tovu's kit instance (`createKit(..., { id: 'tovu' })`) |
| `integrations/jini-admin/{ModulePanel, embed-policy-ports, forms-catalog-ports, module-context}.ts(x)` | host adapters binding Jini modules (cms → admin ports, module runtime context) |
| `integrations/jini-surfaces.ts` | binds ui/agentic implementations to chat's `ChatSurfaces` port |
| `integrations/chart-providers/{ChartRegistryProvider, chart-registry-context}` | binds the host's wired chart registry; its default is `@jini-ai/ui`'s registry |
| `lib/tovu-execution-policy.ts`, `hooks/use-tovu-execution-adapters.hooks.ts` | Tovu product execution policy and its adapters (stays list) |
| `lib/admin-http/config.ts`, `lib/admin-http/urls.ts` | host API base path and workspace id (61 importers); `check-admin-api-routes.ts` reads `urls.ts` from disk |
| `lib/admin-dev-origin.ts`, `lib/app-version.ts`, `lib/site-url.ts` | read the host build defines `__TOVU_ADMIN_DEV_PORT__`, `__TOVU_ADMIN_VERSION__`/`__JINI_CORE_VERSION__` and `VITE_TOVU_SITE_URL` |
| `lib/assistant-chats.ts` | host `AssistantChatsPort` implementation (`HttpError extends ApiError`, a module singleton) |
| `lib/retry-unreachable.ts` | binds the host `ApiError` classifier to the UI library's retry; injecting both would leave a forwarder |
| `lib/chat-attachment-liveness.ts` | the host's `/api/attachments/` read-back route and `attachment:` grammar |
| `hooks/assistant-chats-dependencies.hooks.ts` | binds Tovu implementations and `@tovu/contracts/content-chat-title` |
| `components/AssistantDock/AssistantDock.tsx` | dock composition root: wires about 15 host hooks, adapters and stylesheets into `DockChatPane` |
| `components/AssistantDock/hooks/dock-chrome.hooks.ts` | binds `useWiredAssistantChats`, `useWiredAdminLocale` and the `app-i18n` host fields into the dock seams |

## STOP (exact reason → recommendation)

### Need an owner decision
1. **`lib/block-atom-insert.ts`, `lib/post-title-extension.ts`, `lib/media-image-extension.tsx`, `lib/media-embed-extension.tsx`**
   - **Reason:** they import TipTap values. Two have module-scope `Node.create`/`.extend`; `placeCursorAfterSelectedAtom(tr)` uses `NodeSelection`/`TextSelection` values and is positional. `@tiptap/*` is not an admin peer.
   - **Recommendation:** allow `@tiptap/*` as optional peer deps of `@jini-ai/admin`, under an editor subpath. The alternative is to keep editor extensions host-side.
2. **`components/WidgetConfigFields/HtmlAttributeRows.tsx`**
   - **Reason:** its buttons render the generic `btn-ghost`, which has 12 host rules.
     - A global `.jini-btn-ghost` alias would restyle ui-kit ghost buttons outside `.jini-page`/`.jini-dialog`.
     - A scoped alias changes the remove icon's colour through specificity.
   - **Recommendation:** add a kit "ghost icon button" slot and do a visual review. The rest of the plan is ready: `Tip` component prop, required `useRows`, kit `Icon`, and aliases for `field-mono`/`field-error`.
3. **`components/AssistantDock/DockHeaderTip.tsx`**
   - **Reason:** it renders `info-tip-bubble*`. Those are the classes `@jini-ai/ui`'s own InfoTip renders, styled by ui `admin.css` and Tovu `styles.css`. It also needs `infoTipBubbleStyle`, which is not in the kit.
   - **Recommendation:** decide a policy for classes the kit implementation already owns (for example, let Jini render the kit's own class names). Then inject `bubbleStyle` and move the component.
4. **`components/ConfirmActionDialog.tsx`**
   - **Reason:** it renders only generic host classes (`settings-dialog*`, `editor-actions`, `btn-*`), about 150 rules across 20 stylesheets. The kit `ConfirmDialog` lacks `dialogRef`, `titleId`, per-action attrs and the `extra` line.
   - **Recommendation:** extend `KitConfirmDialogProps` with those four fields, then move the three callers (ExternalMcpRemove, AgentPluginDisable, PluginRemove) onto the kit dialog.
5. **`lib/assistant-daemon-activation.ts`**
   - **What happened:** it was moved, then reverted. The website node test `server/runtime/lifecycle/__tests__/assistant-daemon-connection.test.ts` imports it, and the Tovu root `package.json` does not depend on `@jini-ai/admin`, so `link-jini` gives the root no `admin` link and the test failed with ERR_MODULE_NOT_FOUND.
   - **Recommendation:** add `@jini-ai/admin` to the root devDependencies. That is a manifest and lockfile change, which is why it needs the owner. Then re-apply the move: a structural `PageBindingBridge`, which was ready.

### Rule 4 (no args object to inject into)
6. **`components/AssistantDock/hooks/use-chat-display-preferences.hooks.ts`**
   - **Reason:** `useChatDisplayPreferences(port)` is positional, and it needs `CHAT_DISPLAY_NAMESPACE`, `DEFAULT_CHAT_DISPLAY` and `sameChatDisplay` from the Tovu-kept `chat-display-preferences.ts`.
   - **Recommendation:** move it in the same step as `chat-display-preferences.ts`, as `({ port, namespace, defaults }, _optional = {})`.
7. **`hooks/use-assistant-chats.hooks.ts`**
   - **Reason:** `useAssistantChats(port, options)` is positional. It holds a module-level `createAssistantChatsClient` singleton bound to the host `HttpError` and an `[admin]` console reporter, and the same file holds `useWiredAssistantChats`.
   - **Recommendation:** split `useWiredAssistantChats` out first and take the client as a `client` field. Otherwise it stays: the shared logic is already in `@jini-ai/chat`.

### Prerequisite not landed
8. **`components/AssistantDock/hooks/byok-runtime.hooks.ts`**
   - **Reason:** `resolveSelectedPreset`/`ExecutionConfig` are not in the kit, and the `DEFAULT_PROVIDER_PRESETS` type is not in core until K4-seam-20. It would also need 5 collaborators threaded through `useByokRuntimeSeam`'s defaults.
   - **Recommendation:** redo it after K4-seam-20, with a kit `resolveSelectedPreset`.
9. **`components/AssistantDock/hooks/assistant-mcp-ui.ts`**
   - **Reason:** it wraps `@jini-ai/ui/mcp-ui/surfaces` `buildSandboxProxyDataUrl`, which is not in the kit. The website test `mcp-ui-sandbox-proxy-route.test.ts:63` pins the caller line verbatim.
   - **Recommendation:** add `buildSandboxProxyDataUrl` to the kit, or allow moving the generic `openMcpUiLink` on its own.
10. **`components/MediaEditDialog/MediaEditDialog.tsx`**
    - **Reason:** it renders about 10 generic host classes (`settings-dialog`, `field*`, `btn-*`, `widget-picker-footer`, …) and `native-domain-dialogs.css`, and its default `useDialog` would have to become a required prop.
    - **Recommendation:** kit `Dialog` slot, plus `jini-*` aliases like the `jini-field-label` precedent, in its own batch.
11. **`components/AssistantDock/DockHeader.tsx`**
    - **Reason:** it renders the host `DockHeaderTip` (STOP 3), reads `ai-assistant-i18n` (K3), `use-chat-display-preferences` (STOP 6) and `UseAssistantChats` (STOP 7), and composes `assistant-dock-props`.
    - **Recommendation:** after STOPs 3, 6 and 7, re-evaluate. It is likely host composition (STAYS).

Not a STOP, but worth a decision: `useJiniMediaPicker`'s 3 Tovu tests that expect "Unable to choose media. Please try again." are **BASE-RED** at merge-16. The hook returns a `UserFacingError` with different wording. Their assertions were not touched.

## Gates (tip vs merge-16 base; base and tip both measured in this run)

**Jini** (built main tree vs a built base worktree):

| gate | base | tip |
|---|---|---|
| `pnpm -r build` | 0 | **0** (0 `error TS`) |
| `pnpm typecheck` | 0 | **0** |
| `pnpm guard` | 1 (HW3 `shell-failure-log.ts`) | **1, the same single row** |
| `pnpm api:check` | 0 | **0**; baseline updated, admin additions only (1,079 → 1,105 entries) |
| `check:cross-package` (XP) | XP1 36, XP2 33, XP3 2,102 (no declaration snapshot in a cloud clone), XP4 769, XP5 5 | **identical**: same rows, sorted diff empty |
| `check:size` / `check:complexity` / `check:why-comments` / `check:errors` | 1 / 1 / 1 / 0 (WARN) | **identical output** (sorted diff empty) |
| `check:hooks` | 0 | **0** (+6 required-prop debt rows) |
| admin vitest | 307 files, 3,634 passed | **321 files, 3,734 passed, 0 failed** |

**Tovu** (clean worktrees at base `3a9332247` and tip):

| gate | base | tip |
|---|---|---|
| `npm run typecheck` (+e2e) | 0 | **0** |
| admin `tsc --noEmit` | 0 | **0** |
| `check:why-comments` | 1, 78 open | **1, 78 open**, the same set (+36 allow rows) |
| `check:hooks` | 0 | **0** |
| `check:size` | 1, 10 worsened | **1, the same 10** (diff empty) |
| `check:complexity` | 0 | **0** |
| `check:boundaries` | 0, 113 warnings | **0** |

**Tovu admin vitest (full):**
- Base: 3 files / 5 tests red: `JiniMediaPicker.hooks.unit` 3, `admin-literal-copy.unit` 1, `credential-input-autocomplete.unit` 1.
- Tip: the same 3 files and 5 tests after the follow-up commit. 858 files passed.
- The tip run before `c95e22c2a4` had 2 more reds, in `PostEditor.dom.characterization`. That was the snapshot's class name; it was fixed and re-run at 76/76.

**Node tests on changed files and importers:**
- No website or desktop production file changed. The `apps/website` test edit was reverted along with the assistant-daemon-activation move.
- Website/desktop files that cite changed admin paths:
  - `tiptap-render-contract.test.ts`: 73/1, identical at base (BASE-RED).
  - `shell-staleness.test.ts`: path strings only.
  - `criteria.ts` and `frontend-control-capabilities.ts`: comments only.

## Self-check (Codex failure list)
- **No re-export or forwarding files.**
  - The 3 SPLIT files keep only host wiring (`useWired*`, the html2canvas adapter); none re-exports Jini.
  - `use-admin-telemetry` was deleted, not forwarded.
- **Hooks reach Jini components as REQUIRED props:** `useSettings`, `useTHook`, `useTaxonomyRowMenuHook`, `useTip`. There is no default hook in Jini.
- **Imports:** Jini admin files import only `react`, `react-dom`, `@jini-ai/core*` and admin-internal modules. UI and chat names come through the kit or by injection. No server-framework types and no host log formatters.
- **Classes:** `jini-*` only, except reused Jini `row-menu-*`.
- **Exceptions and args:** no new size or complexity exceptions. Object args keep the `_optional = {}` pads, and no positional parameter was added.
- **Behaviour:**
  - No behaviour changes.
  - The type-only strictness edits (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) are listed in the subagent reports.
  - One edit drops an `errorId: undefined` key that core never reads.
- **Why-comments** moved with the code, with product names and host paths reworded.
- **`## Wiring`** is in Jini `packages/admin/README.md` and in the 4 Tovu folder READMEs.
- Every batch has a named mutation that went RED and back to GREEN.

## For the reviewer
- `dictionary-lookup-sinks.unit` allow-list: its stale `assistant-dock-i18n.ts:CHAT_PANE_I18N_DICT` row is replaced by the two `app-i18n.ts` host-overlay rows.
- `untranslated-copy.unit` now names the Jini dock dictionary under its former path (the `admin-nav-i18n` precedent). Without that, its `Chats` SAME_AS_ENGLISH allowance went stale.
- `MediaPickerDialog` reads the host picker context through a defaulted `useHostMediaPickerHook` prop. That is the Tovu hook-injection rule; the no-default rule applies only to Jini.
