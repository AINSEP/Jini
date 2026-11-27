# X4 admin — Jini fix-pass handoff (uncommitted)

PARTIAL. Baseline `e94eb872f` (`codex/x4-adminj` first pass). Dispatch overrides startup/pipeline, subagent, test-running and approval defaults. Read the dispatched programmer skills, pattern/guardrail foundations, review workflow and honest-testing instructions. No subagents, MCP graph, package intake, tests, mutation execution, builds, installs, typechecks, linters, commits or pushes. Git metadata and Tovu are untouched. Coordinator commits and runs validation.

## Boundaries and evidence

No new runtime dependency edges. New UI dependencies arrive as required kit members/hook props; undeclared package types are structural in the changed targets or use the existing core contracts. Persisted strings/headers, feature switches and theme files were not changed. Why-comments move with their code. Existing first-pass violations outside completed cuts remain explicitly open below. No sheet is declared DONE under the Tovu deletion/G3 rule; this is a Jini-only handoff.

## Ordered logical commits and files

### A03 — PARTIAL: painter correction built; settings slice/screen stopped

Test first: `packages/admin/src/shell/lib/__tests__/paint-admin-accent.unit.test.ts` (one case). Mutation `paint-skip-ink-variable`: omit either primary-ink write; assertions cover both ink variables plus the existing clear behavior.

Created `packages/admin/src/shell/lib/paint-admin-accent.ts`; API `paintAdminAccent({ accent, root, deps: { readableTextColor } }, _optional = {})`. Moved the painter statements/comments, with only the requested name/argument and G1 injection changes. Added its browser export, entry and typesVersions in `packages/admin/package.json`; created `.changeset/x4-a03.md`.

STOP typed settings entry: current `lib/settings-tabs.ts:284–321` includes localStorage writes and CustomEvent dispatch in `savePrivacy` (`:308–318`), while the specified entry is universal. The named inputs/cuts do not place these consent effects at a host seam. Did not silently drop them or add an unnamed effects abstraction. `SettingsUi` remains dependent; its 11 copy hits and settings defaults are not claimed fixed. `deps.normalizeAccentColor` / `deps.notificationDefaults` are still required when that entry is implemented.

### A04 — Jini corrections built

Existing `packages/chat/src/core/assistant-client/__tests__/assistant-transport.ag-ui.approvals.unit.test.ts` has the one-use original-parent and unmatched-fallback pins (`agui-drop-one-use-claim`). Changed `packages/chat/package.json` to replace the obsolete `./transports/ag-ui/approval-relay` entry with `./core/assistant-client/ag-ui-approval-relay`, including entries/typesVersions. No alias or forwarding file.

Test first: `packages/admin/src/shell/lib/__tests__/durable-run-subscription.unit.test.ts` (one case), asserting original read args, missing-row release without onDone, and stop-before-release. Mutation: omit the `message === "gone"` release. Added `followDurableRun` next to `subscriptionEnded` in `packages/admin/src/shell/lib/stream-activity.ts`. Its required `deps.follow` is already bound by Tovu to notices and the shared bindings map; the wrapper preserves the read/disposal sequence and acquires no chat dependency. Existing A04 changeset already declares chat/admin minor.

### A05 — existing implementation and pins retained

No production delta. Jini already receives required `client`; it contains no Tovu chats import. Existing `chat-cleanup.unit.test.tsx` asserts no delete on cancel, one delete on accept and exact IDs `[b,a]`. That kills both `chat-cleanup-delete-before-confirm` and `chat-cleanup-delete-unselected` (append an unselected ID). These are source-reviewed mutation mappings, not executed results.

### A06 — PARTIAL: discovery lifetime, prop builders and dependency fixes built

Changed:
- `packages/admin/src/shell/components/AssistantDock/hooks/composer-discovery.hooks.ts`: moved the existing focus/visibility/skills/dock subscriptions and 60,000 ms polling into the existing watcher; no second resolver/cache. Required window/document, event name, dock subscription/read, source factories, error reporter, boot hook and `deps.startVisibleInterval`.
- `.../hooks/messages-change.hooks.ts`: required `deps.isTerminalRunStatus`; message types from the existing admin kit. The `publishMessages` sink remains the injection point for the original `__tovuAssistantMessages` name.
- `.../hooks/agents-inventory.hooks.ts`, `.../hooks/runtime-access.hooks.ts`: use existing admin structural chat shapes; query-hook type from core instead of undeclared UI.
- `.../__tests__/use-messages-change-handler.unit.test.tsx`: thread the real terminal predicate through the existing replay case; no assertion weakening.

Created `packages/admin/src/shell/components/AssistantDock/assistant-dock-props.tsx` and its browser export/entry/typesVersions in admin. Existing prop builders moved with required mic view, `kit.chat.useT` and deferred `deps.isDesktopAdmin`. Read the existing Tovu sheet injection and prop-builder characterizations before moving; `dock-cache-empty-inventory` / `dock-republish-tool-result` remain the named mutation pins. Original ChatPane optional-prop/spread behavior retained.

STOP refresh correction: current Tovu `hooks/execution-config.hooks.ts` has neither `subscribeExecutionConfigRefresh` nor `storedKeyIo`; lines 62–93 contain interface fields/default-port wiring. No fabricated `execution-config-refresh` entry. `exec-config-skip-visibility-revalidate` remains pending with that cut. `execution-config-write.ts` remains untouched and uncounted.

STOP composition files: `AssistantDock.state.hooks.ts` directly binds more than 15 host collaborators (native folder deps, three preference hooks, permission hook, two deep-link ports, chats port, renderer hook, approval poster, execution adapter, browser-agent hook, skills hook, voice hook, execution-port creation, reasoning reader, etc.). G1 requires STOP rather than adding an oversized injected bag. `AssistantDock.tsx` / `DockChatPane.tsx` depend on that state contract. Their product copy and local-CLI data attribute are not claimed moved/fixed.

### A07 — PARTIAL: media writes and existing-leaf isolation built

Created `packages/cms/src/react/media/hooks/use-media-writes.hooks.ts` plus browser export/entry in CMS. Moved mutation calls, restore refusal, row ownership, purge and error reset unchanged; required `deps.KEYS`, `deps.translate`, query mutation hook and structural port. Read existing Tovu `Media.unit.test.tsx` before the move: cancel-purge asserts zero DELETEs (`:709–724`), so mutation `media-delete-before-confirm` is the G5 dangerous-decision pin. Existing cursor/provider cases retain `media-accept-old-cursor` and `media-count-from-pinned-catalog`.

Changed CMS `react/media/ExternalProvidersPanel.tsx` to required kit members `I18nProvider`, `MediaProvidersTab`, `SETTINGS_DIALOG_DICTIONARIES`, with structural transport shapes; changed `use-media-provider-catalog.hooks.ts` to a structural catalog port. Changed admin `screens/media/hooks/media-port.hooks.ts` to accept the source's explicit `alt: undefined` without rewriting the upload statement. Updated `.changeset/x4-a07.md` to include admin minor.

STOP `Media.tsx`: 25 undeclared value members when targeting CMS, above G1's 15 cap; `EditMediaPanel` (`:314–514`) also exceeds 80 lines after the named file cut. Q2's answer authorizing an admin retarget is absent from the supplied material. `useMedia` (`:171–312`) and `useEditMediaPanel` (`:183–338`) still exceed 80 lines; no additional named function cuts supplied for those bodies. No screen/count completion, storage-key rename or ≤60-line Tovu claim.

### A09 — PARTIAL: picker/controller built; media editor held

Test first: `packages/cms/src/react/widgets/WidgetPickerDialog/__tests__/WidgetPickerDialog.hooks.unit.test.tsx` (one case). Pins select → cancel without creation and unmount/reopen with empty selection/title and baseline config; mutation `widget-create-on-select` invokes create when the existing-selection setter runs.

Created:
- `packages/cms/src/react/widgets/WidgetPickerDialog/WidgetPickerDialog.hooks.tsx`: `useExistingInstances`, named `useWidgetPickerDraft`, `useWidgetPickerDialog`, `useWidgetAddControl`; required `{ props, deps }`. Kept query/state/ID/ref/effect order and create→placement/error order. Live wrappers remain host-owned.
- `packages/cms/src/react/widgets/WidgetPickerDialog/WidgetPickerDialog.tsx`: picker, add control and selection dialog with required controller hooks, Dialog/Select/config kit and catalog/copy deps. Host stylesheet stays at the host mount. No default real hooks or hook re-export from the view.

Added both browser exports/entries to CMS. Existing `.changeset/x4-a09.md` covers CMS minor.

STOP existing first-pass `MediaContentEditor.hooks.ts`: 18 admin value members (appendMediaSlugs, inactiveTabWillBeDropped, insertAtSelection, isValidMediaSlug, layoutUsesColumns, lineCount, both MAX constants, mediaKindOf, mediaLayoutsFor, mediaSlugProblem, mediaSnippetFor, moveMediaItem, readMediaContent, slugCanShowEnd, switchMediaContentMode, toMediaConfig, viewedMediaContent), above G1 cap. Its view remains dependent; existing `widget-reset-html-on-mode-switch` pin retained, not claimed validated.

### A12 — PARTIAL: static-export type isolation built

Changed `packages/devops/src/deploy/react/hooks/use-static-export.hooks.ts`: core FetchQueryAdapter and structural refresh subscription replace undeclared UI/admin type imports. No polling/trigger behavior changed; existing Dockerfile ordering pin retained.

STOP view cut: `GettingItOnlineCard` (`StaticSiteTab.tsx:515–615`) remains >80 lines after the named component/file cuts; further view helper names are not supplied. Credential controller (`usePublishCredentials:238–437`) and static-publish controller (`useStaticPublish:144–373`) also need more precise function cuts to satisfy the strict named-helper rule. No unreviewed oversized functions moved. Saved-secret pin `deploy-render-saved-secret`, stale-preview and same-tick-trigger mutations remain pending with those controllers/views. Tovu must eventually fold bindings into deployment-panel and DELETE StaticSiteTab plus all three hooks, including the prior static-export residual.

### A13 — PARTIAL: segments and template editor built

Test first: `packages/admin/src/screens/email/__tests__/EmailTemplateEditor.unit.test.tsx` (one case). Actual editor + real dirty-guard hook; a plain same-window anchor click is canceled, prompts once and leaves HTML/URL intact. Mutation `email-ignore-dirty-leave`: bypass confirmLeave/preventDefault.

Created `packages/admin/src/screens/email/EmailSegments.tsx` and `EmailTemplateEditor.tsx`; browser exports/entries/typesVersions and `.changeset/x4-a13.md` (admin minor). Segments gets the chat control in required kit. Template editor takes zero-argument editor/locale hooks, required view/keyboard/dirty-guard hooks, bound pageEditorT and Icon/tabindex kit. The host captures the route ID in its editor-hook binding; no unused ID prop retained. Private guard helpers and effect order are preserved. No user-management mail destination.

STOP Provider contract: current `EmailProviderTab.tsx:210,213` calls `agentPluginDisplayName(plugin)` twice, and the existing implementation (`admin/screens/plugins/rules.ts:458–459`) reads BOTH `pluginId` and optional `displayName`. Appendix A's `(r: {id:string}) => string` cannot preserve a custom per-choice displayName through the indicated direct binding. No silent loss of custom labels. `Email.tsx` remains dependent on that missing Provider view; five-tab / replace-history mutation `email-mount-inactive-tab` and saved-key `M-reveal-provider-key-in-status` remain at the host/held view. All four Tovu deletions still pending.

### A18 — STOPPED controller/view; first-pass leaves retained

Current `usePageEditor` starts at line 590, not 593. Prescribed 593 starts inside a comment; range 639 starts with title state; 704 starts inside the load effect; 863 starts inside runSave; 1044 starts inside a useExternalEntryRefresh argument; 1162 is a closing brace; 1212 is inside the final object. The anchored 5087e8fd cut cannot be applied verbatim. Did not shift boundaries/reorder hooks by judgment. Existing CMS surface/embed leaves remain; their undeclared admin/UI type imports still need G1 structural correction. `PageEditorHeader/Notices/Pane` and controller remain unbuilt. `page-save-before-interactive-flush` / `page-apply-stale-embed-ids` require coordinator validation after corrected cuts.

### A19 — PARTIAL: explicit-undefined contract blocker fixed

Changed `packages/admin/src/screens/plugins/PackageFilesModal.tsx` so initialViewId accepts the original explicit undefined. Updated `.changeset/x4-a19.md` to include admin minor. No default-view behavior changed. Remaining views require the absent Q2 target decision and structural contracts; current first-pass agent-plugin hook also still has undeclared admin/UI types. Expected-old-digest mutation `agent-plugins-drop-expected-old-digest` belongs to the still-unmoved AgentPlugins update flow. Existing toggle-race pin retained; no drop claimed.

### A20 — STOPPED remaining bodies; rich-text hold retained

`Posts` begins at :59 and owns the remaining long list JSX; the sheet gives no named view children to reduce that >80-line function. `usePosts` still needs its named writes cut plus an under-limit parent. Existing first-pass notices function is 94 lines; type edges to admin/UI also remain. No unnamed view/helper cuts added. `rules.ts` keeps concrete TipTap behavior, explicitly UNCOUNTED (−3 scope, never −4). Existing stale-notice pin retained; stale-list pin stays with the held controller.

### A22 — STOPPED literal cut recipe, not awaiting a new Opus ceremony decision

Source length/ranges match the supplied 1,289-line anchor. However range 552–745 becomes a 194-line `usePublishPlanSelection`: state/refs plus four useCallback declarations. Merely applying the named range violates the ≤80 rule. Common recipe item 4 permits moving plain function declarations, while these are hook declarations; item 6 permits splitting over-limit callbacks, but the individual callbacks are already below 80 lines. Additional named hook/factory cuts are needed rather than silently inventing them. The row renderer in PublishContentDialog.hooks.tsx is also over 80 lines with no named leaf cut. Did not ship a long hook in another file or create an unused rules owner. Entire peer→replan→confirm→execute behavior remains host-owned; `publish-execute-unconfirmed` and `publish-confirm-during-replan` remain pending. No new `@tovu/publish-content-ui` import was introduced in Jini.

### A24 — PARTIAL: forms isolation and RecoveryCodesCard export built

Updated the existing blank-replacement form test FIRST with real injected helpers. Changed `packages/integrations/src/react/credentials/access-token-forms.ts` to structural form/provider/row types, existing core wire contracts, and required per-function deps for the undeclared admin/devops values. Kept byte-for-byte form decisions, blank-token omission and builders; `security-serialize-blank-replacement` remains the named mutation. Changed `other-credential-stores.ts` to core's exact six-category type, including general.

Strengthened existing `packages/user-management/src/react/auth/__tests__/RecoveryCodesCard.test.tsx` dismissal assertion to require absence of the private pre element, without deleting/weakening any case. Mutation `recovery-codes-shown-after-dismiss`: retain displayed codes after dismissal. Added browser export/entry `./react/auth/RecoveryCodesCard` in user-management and included user-management minor in `.changeset/x4-a24.md`. Existing Security already has pre-tab slots in the original order.

STOP controller: 26 undeclared value members in current use-access-tokens, over G1's 15 cap. The three seed effects must stay in order when the coordinator supplies compliant sub-hook dependency cuts. STOP view: TokenInputFields :492–608 and AddCustomCredentialDialog :946–1070 remain >80 lines after moving top-level components to the three named files. `useOtherCredentials` :190–285 also exceeds 80 without a named further controller cut. No current-state credential behavior changed. `access-token-keep-token-after-save` and `access-token-send-token-on-make-default` remain pending characterization against the live controller, not presumed behavior; no open-bug entry fabricated. TOVU_SITE_KEY / removal copy remain in Tovu.

### A25 — STOPPED remaining view; baseline admissions retained

Current ExternalMcpSettingsPanel imports 23 undeclared value collaborators into MCP, above G1's 15 limit. Providers retarget is conditional on Q2, whose answer is absent. First-pass admissions already injects runtime values, but still imports undeclared admin/UI types and has 16 required collaborators; not claimed G1-complete. Existing retry-cap pin remains. No connection/auth/credential policy change, no direct package intake.

### A28 — Jini kit correction built

Changed `packages/admin/src/screens/storage/StorageScreen.tsx` to required `kit.Button`, and threaded it through the existing screenshot section. Updated existing `__tests__/Storage.unit.test.tsx` input before production change; exact measured-class/token assertion retained (`storage-send-unmeasured-class`). Screenshot explicit-confirm test retained (`screenshots-apply-on-preview`). Existing A28 changeset covers admin minor. No platform runner import was added (retention remains type-only as requested).

### Reuse/host-only sheets

A01/A02/A08/A10/A11/A14/A15/A16/A17/A21/A23/A26/A27/A29: no additional Jini implementation needed by their approval/fix rows. Prior A17/A21 implementations retained. A01 existing API takes one args object. A27 source-control/react and react/ProvidersTab entries already exist. A11's claimed schema-state view does not exist (always-mounted banner instead); no migration control added to manufacture it. A11 migrate-forward availability and A29 permission/deletion-floor pins are host work. Current TrashController has no separate canPurge permission field; do not invent UI permission behavior in this pass.

## Tovu integration contract

New browser paths:
- admin/shell/lib/paint-admin-accent (required deps.readableTextColor).
- admin/shell/components/AssistantDock/assistant-dock-props.
- admin/screens/email/EmailSegments and EmailTemplateEditor.
- cms/react/widgets/WidgetPickerDialog/WidgetPickerDialog and WidgetPickerDialog.hooks.
- cms/react/media/hooks/use-media-writes.hooks.
- user-management/react/auth/RecoveryCodesCard.

Corrected universal path: chat/core/assistant-client/ag-ui-approval-relay; replace imports of the removed transports/ag-ui/approval-relay entry. No alias retained.

Existing APIs changed: admin stream-activity.followDurableRun requires deps.follow bound to the original notices/map; message hook/predicate requires deps.isTerminalRunStatus; composer discovery requires the live lifetime inputs listed above; CMS ExternalProvidersPanel requires its three-member kit; credential form helpers require their used deps (see function parameter types); StorageScreen now receives kit={{Button: KitButton}}. Picker view hooks bind via one-expression calls to useWidgetPickerDialog/useWidgetAddControl({props,deps}); import the latter from the hook entry, not a view re-export. Keep CSS at the original host bindings. No dependency/version intake performed.

All source file deletions, remaining host bindings, importer/mock repoints and counter/keep writes are left to the Tovu lane. K0 cannot be reconstructed here: Appendix B's exact 177 paths and the five counter reports are not supplied in this checkout. No broad keep regex, counter result or DONE/deletion count is claimed.

## Source review / function quality / limitations

Source-only review: changed/new functions inspected against the requested branches and order. New painter/follower, discovery watcher, prop builders, media writes, picker hooks/views, template editor and form helpers fit within 80-line functions and 500-line files by source inspection; no automated complexity score or validation claimed. No recorded new dependency cycle. No runtime validation because dispatch forbids it. Architecture audit: WARNING/PARTIAL because the named held files and existing first-pass type/value edges remain open.

Test integrity: four new single-case files; existing cases retained, with only DI input changes and one stronger recovery assertion. No tests skipped/deleted, no exclusions/thresholds/coverage suppressions, no production guards removed. These are authoring/source-review claims, not green test results. Mutations are recorded for coordinator execution; none ran.

Deletions from own proposed diff during review: removed an uncommitted Media.unit.test.tsx harness because its synthetic count was not the production Media counter and could not kill media-count-from-pinned-catalog; removed accidental JSON Unicode escaping/reordering; removed an accidental doc-comment insertion; omitted the old unused UseAssistantChats type import in moved prop builders; removed template editor's now-unused ID prop and the picker's view-to-hook re-export. No pre-existing source or tests deleted.

## Exact file inventory for this pass

Changed:
- `.changeset/x4-a07.md`
- `.changeset/x4-a19.md`
- `.changeset/x4-a24.md`
- `packages/admin/package.json`
- `packages/admin/src/screens/media/hooks/media-port.hooks.ts`
- `packages/admin/src/screens/plugins/PackageFilesModal.tsx`
- `packages/admin/src/screens/storage/StorageScreen.tsx`
- `packages/admin/src/screens/storage/__tests__/Storage.unit.test.tsx`
- `packages/admin/src/shell/components/AssistantDock/__tests__/use-messages-change-handler.unit.test.tsx`
- `packages/admin/src/shell/components/AssistantDock/hooks/agents-inventory.hooks.ts`
- `packages/admin/src/shell/components/AssistantDock/hooks/composer-discovery.hooks.ts`
- `packages/admin/src/shell/components/AssistantDock/hooks/messages-change.hooks.ts`
- `packages/admin/src/shell/components/AssistantDock/hooks/runtime-access.hooks.ts`
- `packages/admin/src/shell/lib/stream-activity.ts`
- `packages/chat/package.json`
- `packages/cms/package.json`
- `packages/cms/src/react/media/ExternalProvidersPanel.tsx`
- `packages/cms/src/react/media/use-media-provider-catalog.hooks.ts`
- `packages/devops/src/deploy/react/hooks/use-static-export.hooks.ts`
- `packages/integrations/src/react/credentials/__tests__/access-token-forms.unit.test.ts`
- `packages/integrations/src/react/credentials/access-token-forms.ts`
- `packages/integrations/src/react/credentials/other-credential-stores.ts`
- `packages/user-management/package.json`
- `packages/user-management/src/react/auth/__tests__/RecoveryCodesCard.test.tsx`

Created:
- `.changeset/x4-a03.md`
- `.changeset/x4-a13.md`
- `packages/admin/src/screens/email/EmailSegments.tsx`
- `packages/admin/src/screens/email/EmailTemplateEditor.tsx`
- `packages/admin/src/screens/email/__tests__/EmailTemplateEditor.unit.test.tsx`
- `packages/admin/src/shell/components/AssistantDock/assistant-dock-props.tsx`
- `packages/admin/src/shell/lib/__tests__/durable-run-subscription.unit.test.ts`
- `packages/admin/src/shell/lib/__tests__/paint-admin-accent.unit.test.ts`
- `packages/admin/src/shell/lib/paint-admin-accent.ts`
- `packages/cms/src/react/media/hooks/use-media-writes.hooks.ts`
- `packages/cms/src/react/widgets/WidgetPickerDialog/WidgetPickerDialog.hooks.tsx`
- `packages/cms/src/react/widgets/WidgetPickerDialog/WidgetPickerDialog.tsx`
- `packages/cms/src/react/widgets/WidgetPickerDialog/__tests__/WidgetPickerDialog.hooks.unit.test.tsx`
- `COMMIT-PLAN.md` (this uncommitted ledger)

## G3 residual LOC (read-only first-pass Tovu snapshot)

Snapshot path: c-tv-x4-admin. No residual was edited or newly certified by this Jini pass; all rows are UNCOUNTED here pending Tovu final review/repointing. LOC includes comments/blank lines. No keep entries added.

- `hooks/use-admin-appearance.hooks.ts`: 74 LOC; UNCOUNTED.
- `lib/durable-run-subscription.ts`: 33 LOC; UNCOUNTED.
- `components/AssistantDock/AssistantDock.tsx`: 236 LOC; UNCOUNTED.
- `components/AssistantDock/assistant-dock-props.tsx`: 117 LOC; UNCOUNTED.
- `components/AssistantDock/hooks/agents-inventory.hooks.ts`: 82 LOC; UNCOUNTED.
- `components/AssistantDock/hooks/composer-discovery.hooks.ts`: 145 LOC; UNCOUNTED.
- `features/media/Media.tsx`: 1577 LOC; UNCOUNTED.
- `features/media/hooks/use-media-writes.hooks.ts`: 135 LOC; UNCOUNTED.
- `components/WidgetPickerDialog/WidgetPickerDialog.tsx`: 324 LOC; UNCOUNTED.
- `components/WidgetPickerDialog/WidgetPickerDialog.hooks.tsx`: 297 LOC; UNCOUNTED.
- `features/email/EmailSegments.tsx`: 24 LOC; UNCOUNTED.
- `features/email/EmailTemplateEditor.tsx`: 306 LOC; UNCOUNTED.
- `features/security/RecoveryCodesCard.tsx`: 14 LOC; UNCOUNTED.
- `features/security/other-credential-stores.ts`: 46 LOC; UNCOUNTED.
- `features/storage/Storage.tsx`: 93 LOC; UNCOUNTED.
