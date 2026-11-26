import type { KitChatPaneProps } from "../../../react/kit.js";
import type { DockChatPane } from "./DockChatPane.js";
import { composerFooterLeading, executionChatPaneProps, folderWindowOpenElsewhere, optionalChatPaneProps, voiceFooterAccessory } from "./assistant-dock-props.js";

type PaneProps = Partial<KitChatPaneProps>;

        // What the picker names as the runtime while BYOK is the active mode. Without it the
        // popover described the DETECTED CLI in both modes — an agent list with one row marked
        // "selected", a model reading "Default (CLI config)", and a Rescan PATH button — none of
        // which has any bearing on an API turn, and all of which named the wrong provider. The
        // model is the one `assistant-transport.ts` will actually send (`byok.model`), read from
        // the same config object that decides the branch, so the two cannot disagree.
/** The pane's transport, session selection and runtime-picker wiring. */
export function chatPaneSessionProps({ dock, deps }: Parameters<typeof DockChatPane>[0], _optional = {}) {
  const { typedAnswerPoster, midRunMessagePoster, onSecretRedacted, subscribeToAdminPageSurfaces, hasUsableAdminKey } = deps;
  const { principalId, t, agentPermissions, executionConfig, hasStoredAdminKey, handleExecutionModeChange, byokRuntime, handleByokModelChange, localCliSelection, chats, daemonStarting, agentsPlaceholder, handleSelectionChange, failureSurface, refreshSignal } = dock;
  return {
        transport: failureSurface.transport,
        sendingLabel: daemonStarting ? t({ key: "Starting assistant…" }) : undefined,
        deliverTypedAnswer: typedAnswerPoster,
        deliverMidRunMessage: midRunMessagePoster,
        onSecretRedacted,
        runtimeAccess: failureSurface.runtimeAccess,
        // Fully controlled (`selection`/`onSelectionChange`), not `initialSelection` — see
        // `useLocalCliSelection`'s own doc for why an uncontrolled prop can't be hydrated from
        // the ledger's async load. `useLocalCliSelection` starts at the same `{agentId: "claude"}`
        // this literal used to hardcode, then follows saved changes after the ledger settles.
        selection: localCliSelection,
        onSelectionChange: handleSelectionChange,
        initialMessages: failureSurface.initialMessages,
        subscribeToSurfaces: subscribeToAdminPageSurfaces,
        // `agents`, `conversationId`, `refreshSignal` and `composerHistoryScope` are passed only
        // when they hold a value — see `optionalChatPaneProps`. Recent prompt recall
        // (`composerHistoryScope`) is local to this signed-in admin, including in a new chat.
        ...optionalChatPaneProps({ agents: agentsPlaceholder, conversationId: chats.activeId, refreshSignal, composerHistoryScope: principalId }),
        // The Local CLI / API · BYOK row (`AgentRuntimePicker`, `@jini-ai/chat`) — previously
        // hardcoded to `executionMode: 'local'` / `apiModeAvailable: false` (never passed at all),
        // which made "API · BYOK" permanently disabled with a "not configured" label that was
        // literally true: nothing wired it. `apiModeAvailable` is now a real fact — not a hardcoded
        // default — and selecting the row genuinely changes where a message goes
        // (`assistant-transport.ts`'s `startRun` branches on this same `executionConfig`).
        //
        // `hasUsableAdminKey`, not `executionConfig.byok.apiKey.trim().length > 0` alone (2026-08-05):
        // the admin's own BYOK credential is encrypted server-side and write-only now
        // (`execution-settings.ts`'s header), so `byok.apiKey` is empty on every fresh load even
        // when a credential IS stored — gating on it alone would make this row permanently disabled
        // for exactly the case the server-side store exists to support. `hasStoredAdminKey` is
        // `null` until its own GET settles, which `hasUsableAdminKey` treats as "nothing confirmed
        // stored yet" (same as `false`) — a brief false-negative on first paint, never a
        // false-positive, and it corrects itself the moment the GET resolves.
        ...executionChatPaneProps({ mode: executionConfig.mode, nativeToolPolicy: agentPermissions.nativeToolPolicy }),
        apiModeAvailable: hasUsableAdminKey({ apiKey: executionConfig.byok.apiKey, stored: { isSet: hasStoredAdminKey === true } }),
        onExecutionModeChange: handleExecutionModeChange,
        byokRuntime: byokRuntime,
        onByokModelChange: handleByokModelChange,
  } satisfies PaneProps;
}

        /**
         * Replaces `ChatPane`'s default header, which is not merely a styling preference.
         *
         * That default ships a "New thread" button wired to the pane's own `onReset`, which
         * clears the local transcript and nothing else. With durable history that is actively
         * wrong: the pane would empty while `activeId` still pointed at the previous
         * conversation, so the next message would silently append to the chat the user thought
         * they had just left. `chats.create` makes a real conversation row and switches to it.
         *
         * The switcher belongs here rather than in `leadingAccessory` for the same reason — that
         * slot sits above the composer, so the dropdown opened over the input instead of below
         * the title where a history control is looked for.
         */
/** The header, copy, run context and agent-control wiring. */
export function chatPaneChromeProps({ dock, kit, hooks, deps }: Parameters<typeof DockChatPane>[0], _optional = {}) {
  const { DockCleanupHeader, ChatCleanupPanel, ConversationTitle } = kit;
  const { useDockChatCleanup, useWiredAssistantSubagentsSettings } = hooks;
  const { translateAiAssistant, assistantTitleKey, toolCallOptions, replyLengthOptions } = deps;
  const { agentBridge, webMcpEnabled, locale, t, chatI18n, conversationDelete, chatDisplay, agentPlugins, runtime, agentPermissions, executionConfig, localCliSelection, chats, runContext, activeTitle, emptyState } = dock;
  return {
        header: <DockCleanupHeader ChatCleanupPanel={ChatCleanupPanel} chats={chats} activeTitle={activeTitle} mode={executionConfig.mode} agentId={localCliSelection.agentId}
            locale={locale} t={t} chatI18n={chatI18n} conversationDelete={conversationDelete} chatDisplay={chatDisplay}
            agentPlugins={agentPlugins} runtime={runtime} onMoreSettings={agentPermissions.onMoreSettings} empty={emptyState.empty}
            toolCallOptions={toolCallOptions} replyLengthOptions={replyLengthOptions}
            translateAiAssistant={translateAiAssistant} useSubagentsSettingsHook={useWiredAssistantSubagentsSettings} ConversationTitle={ConversationTitle}
            useChatCleanup={useDockChatCleanup} />
        ,
        title: t({ key: assistantTitleKey }),
        placeholder: t({ key: "Ask the assistant to do something…" }),
        onMessagesChange: emptyState.handleMessagesChange,
        runContext: runContext,
        // Wires the daemon-relayed `chat.*` capability channel to THIS live pane instance — see
        // `useChatPaneAgentControl`'s own doc in `@jini-ai/chat/react` for the handler side. Without
        // this, `chat.*` (`chat.get_state`, `chat.send_message`, …) is still claimed at attach time
        // (`createFrontendSessionBridge`'s `claimedCapabilities` claims all of `CHAT_CAPABILITIES`
        // unconditionally, unlike `page.*`, which is gated on `pageDriver`), so the daemon happily
        // delivers a `chat.*` invocation here — but with no `subscribe`r, the browser's own dispatch
        // (`frontend-session-bridge.ts`'s `chatListeners` loop) silently drops it, and the call parks
        // until `ToolExecutor`'s 30s `descriptor.timeoutMs` reports it `timed-out` with no real error
        // anywhere. `enabled: true` is safe even before the tab attaches — `bridgeAccess` is only
        // `agentBridge?.bridgeAccess`, `undefined` until `useAgentPageBridge`'s effect runs, and
        // `useChatPaneAgentControl` is a no-op when `bridgeAccess` is absent. `webmcp: true` wires
        // this pane's own WebMCP tools on top of the always-on daemon-relayed channel above — the
        // owner's 09-22 decision (publish-criteria plan §4 S5) that WebMCP stays on by default, now
        // that plan §3 has closed the hole it would otherwise reopen: the Publish button carries no
        // agent handle (`PublishContentDialog.tsx`), so neither this in-page WebMCP surface nor the
        // daemon-relayed one above can press it — see plan §3 for the full gate. Nothing here makes
        // the Publish button agent-proof by keeping WebMCP off; it already is, regardless.
        // The owner's default now has a browser-local opt-out in Settings → Privacy.
        agentControl: { enabled: true, bridgeAccess: agentBridge?.bridgeAccess, webmcp: webMcpEnabled },
  } satisfies PaneProps;
}

/** The composer's attachments, slots, accessory, voice handle and display preferences. */
export function chatPaneComposerProps({ dock, kit, hooks, deps }: Parameters<typeof DockChatPane>[0], _optional = {}) {
  const { uploadAttachments, validateAttachments } = dock;
  return {
        uploadAttachments: uploadAttachments,
        // Restores a persisted draft's ATTACHMENTS, not just its text. `@jini-ai/chat` caches the
        // references but hands back only the subset a host confirms is still served — the staged
        // bytes sit under the daemon's `retentionMs` (one hour, not overridden here), and a chip for
        // a pruned file looks intact and fails at send. Absent, the package restores text only.
        validateAttachments: validateAttachments,
        composerSlots: chatPaneComposerSlots({ dock, kit, hooks, deps }),
        leadingAccessory: chatPaneLeadingAccessory({ dock, kit, hooks, deps }),
        ...chatPaneComposerDisplayProps({ dock, kit, hooks, deps }),
  } satisfies PaneProps;
}

function chatPaneComposerSlots({ dock, kit, deps }: Parameters<typeof DockChatPane>[0], _optional = {}) {
  const { discoveryDraft, handleComposerDiscoverySelect, folderPicker, voiceInput } = dock;
        // Host-owned, data-only inventory, now an async projection (debate 2) instead of a static
        // import. Jini renders/filter/selects it generically; these rows describe source-backed
        // resources and do not claim that Agent Plugin installation or execution exists. The same
        // catalog drives the grouped plus menu and `/` autocomplete.
  return {
          discoveryGroups: discoveryDraft.groups,
          onDiscoverySelect: handleComposerDiscoverySelect,
          // Renders next to the composer's "+" trigger in the footer action row, not above the
          // input — owner report: the mic previously rode `leadingAccessory` below (the pinned-
          // context zone) and read as a stray circular badge half-overlapping the input's top
          // edge. `footerLeadingAccessory` (`@jini-ai/chat` 2026-09-06) is a new footer-row slot
          // added for exactly this: unlike `footerAccessories` (reserved for `AgentRuntimePicker`,
          // pushed to the row's far end) or `plusMenuItems` (plain click-to-select buttons, no room
          // for this button's press-and-hold/recording-indicator UI), it renders host content
          // immediately after the attach/discovery button with no change to the button itself.
          //
          // Owner report, 2026-09-13: the button should not show at all in Workspace chat.
          // `VOICE_INPUT_ENABLED` (`voice-input-config.ts`) is the reversible switch, and flipping
          // that one constant back to `true` restores the live mic exactly as it was. Owner,
          // 2026-10-30: briefly a grayed, disabled mic ("coming soon") held the slot; later that
          // day the owner said "just hide it", so while it is off no mic shows at all.
          //
          // The folder button (owner 2026-10-27: "a folder icon next to the plus button") rides the same
          // slot, ahead of the mic — see `composerFooterLeading`.
          footerLeadingAccessory: composerFooterLeading({ folderPicker,
            voice: voiceFooterAccessory({ enabled: deps.voiceInputEnabled, onTranscript: voiceInput.insertTranscript, kit }), kit }),
  };
}

function chatPaneLeadingAccessory({ dock, kit, deps }: Parameters<typeof DockChatPane>[0], _optional = {}) {
  const { DockLeadingAccessory } = kit;
  const { executionPolicy, selectedAgentAuth, folderDrop, folderPicker, selectedPluginChips, removePluginRef, selectedSkills, skillOnlySend } = dock;
        // Renders the pinned-plugin chip tray above the composer's textarea. NOT passed inside
        // `composerSlots` above — verified live (2026-08-21) that `ChatPane`'s own
        // `Composer`-slot assembly unconditionally sets `leadingAccessories: leadingAccessory`
        // (this prop), discarding whatever `composerSlots.leadingAccessories` holds even when
        // this prop is omitted (`ChatPane.tsx`'s `slots` object, `{ ...composerSlots,
        // leadingAccessories: leadingAccessory, ... }`) — a `composerSlots.leadingAccessories`
        // value never reaches `Composer` at all through this component. `footerAccessories` is
        // correctly excluded from `ChatPaneProps.composerSlots`'s type for the same reason (it
        // is reserved for `AgentRuntimePicker`); `leadingAccessories` is not excluded from that
        // type, which is what made this reachable — an existing gap in Jini's own contract, not
        // something introduced here. Using this top-level prop instead (unused by this component
        // until now) avoids the gap entirely, with no change to Jini's package needed.
        // `null` when nothing is pinned (`SelectedAgentPluginTray`'s own early return).
        //
        // `DockLeadingAccessory`'s own doc carries the owner constraint on what renders here and
        // why it is a fragment (no DOM node of its own).
  return <DockLeadingAccessory note={executionPolicy.note} warning={selectedAgentAuth.warning} folderDrop={folderDrop} canPickFolder={folderPicker.available}
            folderWindowOpenElsewhere={folderWindowOpenElsewhere({ picking: folderPicker.picking, deps })}
            folderWindowNoteKey={deps.folderWindowNoteKey}
            pluginChips={selectedPluginChips} onRemovePlugin={removePluginRef} skills={selectedSkills} skillOnlySend={skillOnlySend} />
;
}

function chatPaneComposerDisplayProps({ dock, deps }: Parameters<typeof DockChatPane>[0], _optional = {}) {
  const { chatPaneDisplayProps } = deps;
  const { voiceInput, chatDisplay, agentPlugins } = dock;
  return {
        // Populated by `ChatPane` itself on mount; `PushToTalkMicButton`'s transcript is written
        // through it. Append-only by contract, so a transcript can never clobber a half-written
        // message — see `use-composer-voice-input.hooks.ts`.
        composerHandle: voiceInput.composerHandle,
        // No `attachmentAccept` on purpose: the upload path is kind-agnostic end to end, so a
        // type filter here has no security or correctness payoff, only friction. `attachments.ts`
        // (`@jini-ai/http-kit`) sniffs `detectAttachmentKind` from the leading bytes and stores
        // `'image' | 'file'` — it never rejects on MIME or extension. And an `accept` filter never
        // applies to drag-and-drop in any browser, so a picker restriction here would only ever
        // block the cooperative "+" button while the drop zone stayed wide open; it was previously
        // `"image/*"` and that is exactly what happened — a `.md` drag-drop already worked while
        // the same file was greyed out in the OS dialog. `extraAllowedDirs` gives the agent
        // filesystem read access to every claimed attachment regardless of kind, so there's no
        // pipeline-side restriction downstream to match either. `agent-daemon-server.ts` used to
        // drop non-image attachments from `imagePaths` before handing them to the agent, which
        // would have made a widened picker here pointless; that filter is gone (see
        // `resolveAttachmentRunFields`' own comment and
        // `__tests__/agent-daemon-server.attachment-kind-filter.unit.test.ts`), so every claimed
        // attachment is now named to the agent regardless of kind. What remains is cosmetic: the
        // `imagePaths` option name and Jini's `image-prompt-delivery.ts` prompt copy still say
        // "image" for what may be any file — a recorded Jini-side follow-up, not a gap a picker
        // filter could fix anyway.
        // No working-directory control renders in the web admin: a browser directory picker can
        // only ever yield a folder NAME (browsers withhold the real path from a picked
        // `FileSystemDirectoryHandle`), never a path the daemon's real `cwd`
        // (`agent-daemon-server.ts`'s `the host agent cwd env var ?? process.cwd()`) could use — so
        // a picker here would only ever re-label the chat, not move the agent. The real feature
        // belongs to the desktop host (the Electron app), which has an actual filesystem.
        workingDirectoryControlPlacement: "none",
        // Spread, not attributes: a chat build without these props ignores them (see `chatPaneDisplayProps`).
        ...chatPaneDisplayProps({ preferences: chatDisplay.preferences }),
        agentPluginsMode: agentPlugins.mode,
        // Starter suggestions are parked. The prompts last offered were: "Summarise what content
        // types this site defines.", "List the agent-callable tools and the permission each one
        // needs." and "Which admin sections exist, and what does each one manage?"
  } satisfies PaneProps;
}
