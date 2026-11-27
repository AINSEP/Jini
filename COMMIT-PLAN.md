# M26SI — sheet 9 (Jini assistant dock)

Scope: sheet 9 only. No commits; coordinator owns commits. No installs, builds,
tests, typechecks, linters, or guard runs, as dispatched. Other sheets are out of
scope (sheet 11 explicitly belongs elsewhere).

## Completed work in intended commit order

1. `test(admin): characterize assistant dock dependency bindings`
   - `packages/admin/src/shell/components/AssistantDock/__tests__/y5-dock.test.tsx`
   - `packages/admin/src/shell/components/AssistantDock/__tests__/DockHeader.unit.test.tsx`
   - Tests written before production changes; existing binder fixtures receive
     the real newly required implementations.
   - Named mutations:
     - Replace `hooks.useAssistantTransportSeam` with the direct imported seam;
       bypass the override selection or drop the daemon-start callback.
     - Replace either injected runtime visibility/skill-availability function
       with its direct imported implementation.
     - Bypass the injected failure provider, settings builder, option arrays,
       leading accessory, or display helper in the pane.
     - Replace the injected footer folder button with its direct import, drop
       its translator hook, or render the mic before the folder button.
     - Replace the injected cleanup DockHeader with its direct import, or leave
       DockHeader in the forwarded header props.
2. `fix(admin): inject assistant dock state and pane dependencies`
   - `packages/admin/src/shell/components/AssistantDock/AssistantDock.state.hooks.ts`
   - `packages/admin/src/shell/components/AssistantDock/DockChatPane.tsx`
   - `packages/admin/src/shell/components/AssistantDock/dock-pane-props.tsx`
   - `packages/admin/src/shell/components/AssistantDock/assistant-dock-props.tsx`
   - `packages/admin/src/shell/components/AssistantDock/DockCleanupHeader.tsx`

## Binding checklist

Required hooks stay required. Existing signatures are referenced with type-only
imports. Keep the existing FailureSurfaceContext provider identity, footer order,
conversation remount key, transport override and daemon callback. Keep original
implementations and public subpaths; no new exports, helpers, comments, theme
changes, or guard configuration changes.

The approved sheet supplies the binding pattern; no separate pattern approval is
needed. Dispatch prohibits runtime verification, so RED/GREEN and mutation
execution remain for the coordinator.

## Completion and review

- Sheet 9 implemented in the working tree; no blocked steps or behavior
  mismatches found. Sheets 1–8, 10, and 12 were not assigned. Sheet 11 was
  explicitly excluded by the coordinator.
- Tests were written before production edits. Six regression cases added:
  transport default/override (two), runtime/skills rules, pane bindings,
  footer order/translator, and cleanup-header binding. Existing tests retained:
  `y5-dock.test.tsx` 6 -> 11 cases; `DockHeader.unit.test.tsx` 9 -> 10 cases;
  combined 15 -> 21. Counts are from source, not an executed test report.
- Existing first-turn persistence and conversation-remount assertions are
  unchanged. The existing pane fixture was lifted to `paneInput` for the new
  pane case; newly required fields use the original implementations.
- Required deletions: removed the direct runtime imports replaced by injection;
  removed the existing DockLeadingAccessory module mock so the fixture supplies
  the real component. No tests, assertions, why-comments, or production
  capabilities were deleted. No other review cleanup was necessary.
- Manual architecture review: all named runtime edges in the five production
  files now use required hooks/kit/deps fields and type-only signatures. No new
  helpers, wrappers, contexts, exports, validation, defaults, comments, themes,
  guard exceptions, or configuration changes. Provider identity remains the
  host's existing FailureSurfaceContext.Provider; the regression reads that
  same context. Header binding fields are destructured out before forwarding.
- Function review: useDockTransport, useDockAgent, useDockComposer,
  DockChatPane, chatPaneChromeProps, chatPaneLeadingAccessory,
  chatPaneComposerDisplayProps, composerFooterLeading, and DockCleanupHeader
  only change dependency sourcing; branch and effect order remain intact.
  No new algorithms, I/O, or retained state. Variable names match the injected
  implementations. The existing optional transport override selection, actual
  daemon callback implementation, composer slot order, and remount key remain.
- Verification: diff and source inspection only. No installs, builds, tests,
  mutations, typechecks, linters, guards, commits, or Git writes performed.
  Runtime/type correctness and the 13-row isolation re-check await coordinator
  execution; no passing status is claimed.

## Tovu follow-up (existing public subpaths only)

All paths below are under `@jini-ai/admin/shell/components/AssistantDock/`:

- `bindAssistantDockState`: add `hooks.useAssistantTransportSeam` from
  `hooks/assistant-transport.hooks`; add `deps.visibleAssistantRuntimePreferences`
  from `assistant-runtime-preferences` and `deps.resolveSkillsAvailable` from
  `hooks/composer-files.hooks`.
- `bindDockChatPane`: add `kit.FailureSurfaceProvider` as
  `AgentFailureCard.hooks`'s existing `FailureSurfaceContext.Provider`,
  `kit.DockLeadingAccessory` from `DockLeadingAccessory`, and
  `kit.FolderPathButton` from `FolderPathButton`.
- Pane deps: add `dockSettingsMenuSections` from `dock-header-rules`,
  `toolCallOptions` as `chat-display-preferences`'s `CHAT_TOOL_CALL_OPTIONS`,
  `replyLengthOptions` as `assistant-runtime-preferences`'s `REPLY_LENGTH_OPTIONS`,
  and `chatPaneDisplayProps` from `chat-display-preferences`.
- Prebind `DockCleanupHeader`'s new required `DockHeader` prop to the original
  `DockHeader` in the existing cleanup-header adapter. The pane slot accepts
  `Omit<DockCleanupHeaderProps<DockChatCleanup>, "DockHeader">`.
- Pass the bound state hook and pane to `bindAssistantDock` as before.
  No new subpaths or exports are needed.
