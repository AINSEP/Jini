import type { ComponentProps, ComponentType } from "react";
import type { KitChatPaneProps, KitChatSettingsDialogProps, KitJiniChatProviderProps } from "../../../react/kit.js";
import type { ConfirmDialog } from "../../../react/index.js";
import type { SkillInstallConfirmation } from "../../../screens/skills/SkillInstallConfirmation.js";
import type { DockCleanupHeaderProps, DockChatCleanup } from "./DockCleanupHeader.js";
import type { AssistantDockState } from "./AssistantDock.state.hooks.js";
import type { FailureSurfaceContext } from "./AgentFailureCard.hooks.js";
import type { DockLeadingAccessory } from "./DockLeadingAccessory.js";
import type { FolderPathButton } from "./FolderPathButton.js";
import type { dockSettingsMenuSections } from "./dock-header-rules.js";
import type { CHAT_TOOL_CALL_OPTIONS, chatPaneDisplayProps } from "./chat-display-preferences.js";
import type { REPLY_LENGTH_OPTIONS } from "./assistant-runtime-preferences.js";
import { chatPaneSessionProps, chatPaneChromeProps, chatPaneComposerProps } from "./dock-pane-props.js";

type DockState = AssistantDockState;
type PaneProps = {
  dock: DockState;
  kit: {
    FailureSurfaceProvider: ComponentType<ComponentProps<typeof FailureSurfaceContext.Provider>>;
    DockLeadingAccessory: ComponentType<ComponentProps<typeof DockLeadingAccessory>>;
    FolderPathButton: ComponentType<ComponentProps<typeof FolderPathButton>>;
    JiniChatProvider: ComponentType<KitJiniChatProviderProps>;
    ChatSettingsDialog: ComponentType<KitChatSettingsDialogProps>;
    ConversationTitle: DockCleanupHeaderProps<DockChatCleanup>["ConversationTitle"];
    DockCleanupHeader: ComponentType<Omit<DockCleanupHeaderProps<DockChatCleanup>, "DockHeader">>;
    ChatCleanupPanel: DockCleanupHeaderProps<DockChatCleanup>["ChatCleanupPanel"];
    SkillInstallConfirmation: ComponentType<ComponentProps<typeof SkillInstallConfirmation>>;
    ConfirmDialog: ComponentType<ComponentProps<typeof ConfirmDialog>>;
    PushToTalkMicButton: ComponentType<{ onTranscript: (text: string) => void }>;
    chat: { useT: () => (key: string) => string };
  };
  hooks: { useDockChatCleanup: DockCleanupHeaderProps<DockChatCleanup>["useChatCleanup"]; useWiredAssistantSubagentsSettings: DockCleanupHeaderProps<DockChatCleanup>["useSubagentsSettingsHook"] };
  deps: {
    dockSettingsMenuSections: typeof dockSettingsMenuSections;
    toolCallOptions: typeof CHAT_TOOL_CALL_OPTIONS;
    replyLengthOptions: typeof REPLY_LENGTH_OPTIONS;
    chatPaneDisplayProps: typeof chatPaneDisplayProps;
    typedAnswerPoster: NonNullable<KitChatPaneProps["deliverTypedAnswer"]>;
    midRunMessagePoster: NonNullable<KitChatPaneProps["deliverMidRunMessage"]>;
    onSecretRedacted: NonNullable<KitChatPaneProps["onSecretRedacted"]>;
    subscribeToAdminPageSurfaces: NonNullable<KitChatPaneProps["subscribeToSurfaces"]>;
    translateAiAssistant: DockCleanupHeaderProps<DockChatCleanup>["translateAiAssistant"];
    skillInstallConfirmationHost: Omit<ComponentProps<typeof SkillInstallConfirmation>, "install" | "locale">;
    voiceInputEnabled: boolean;
    isDesktopAdmin: (required: {}) => boolean;
    hasUsableAdminKey: (required: { apiKey: string; stored: { isSet: boolean } }) => boolean;
    assistantTitleKey: string;
    folderWindowNoteKey: string;
    localCliDataAttribute: string;
  };
};

export function bindDockChatPane({ kit, hooks, deps }: {
  kit: PaneProps["kit"];
  hooks: PaneProps["hooks"];
  deps: Omit<PaneProps["deps"], "typedAnswerPoster" | "midRunMessagePoster"> & {
    createAdminTypedAnswerPoster: (required: { fetch: typeof globalThis.fetch }) => NonNullable<KitChatPaneProps["deliverTypedAnswer"]>;
    createMidRunMessagePoster: (required: { baseUrl: string; fetch: typeof globalThis.fetch }, optional: { onSecretRedacted: NonNullable<KitChatPaneProps["onSecretRedacted"]> }) => NonNullable<KitChatPaneProps["deliverMidRunMessage"]>;
    fetch: typeof globalThis.fetch;
    baseUrl: string;
  };
}, _optional = {}) {
  const { createAdminTypedAnswerPoster, createMidRunMessagePoster, fetch, baseUrl, onSecretRedacted } = deps;
  /**
   * Typed answers to a pending `assistant_ask_choice` (jl A1a/A1b): `ChatPane` calls this instead of
   * queueing when the operator types while the agent holds a question card open. Module scope for the
   * same reason as the renderer hook's `mcpUiToolCaller` — one stable instance, same route.
   * See `typed-answer-poster.ts`.
   */
  const typedAnswerPoster = createAdminTypedAnswerPoster({ fetch });
  /**
   * A message sent while a run streams goes to the running agent (`POST /api/runs/:runId/messages`,
   * proxied to the daemon) instead of waiting behind the run; an agent that cannot take it mid-run
   * keeps working and the text waits for its next turn. Module scope, like the typed-answer poster.
   */
  const midRunMessagePoster = createMidRunMessagePoster({ baseUrl, fetch }, { onSecretRedacted });
  const paneDeps = { ...deps, typedAnswerPoster, midRunMessagePoster };
  return function BoundDockChatPane({ dock }: { dock: DockState }, _optional = {}) {
    return <DockChatPane dock={dock} kit={kit} hooks={hooks} deps={paneDeps} />;
  };
}

/** The dock's view: providers, the failure/skill surfaces, the drop zone around the chat pane, and its dialogs. */
export function DockChatPane({ dock, kit, hooks, deps }: PaneProps, _optional = {}) {
  const { JiniChatProvider, FailureSurfaceProvider, SkillInstallConfirmation, ConfirmDialog, ChatSettingsDialog } = kit;
  const { skillInstallConfirmationHost: SKILL_INSTALL_CONFIRMATION_HOST, dockSettingsMenuSections, toolCallOptions, replyLengthOptions } = deps;
  const { ChatPaneView, renderers, locale, t, chatI18n, conversationDelete, chatDisplay, agentPlugins, chatSettings, agentPermissions, executionPolicy, pageActivationError, chats, skillInstall, discoveryDraft, captureComposerClick, folderDrop, failureSurface } = dock;
  return (
    <JiniChatProvider transport={failureSurface.transport} i18n={chatI18n} extEventRendererRegistry={renderers.registry}>
      <FailureSurfaceProvider value={failureSurface.actions}>
      <SkillInstallConfirmation install={skillInstall} locale={locale} {...SKILL_INSTALL_CONFIRMATION_HOST} />
      {pageActivationError && <div className="jini-chat-pane__notice" role="alert">{t({ key: pageActivationError })}</div>}
      {/* ChatPane takes `transport` directly as well as via the provider — the package's
          components read their dependencies from props, not implicitly from context. */}
      <div className="admin-chat-dock-drop" data-testid="admin-chat-driver-root" {...{ [deps.localCliDataAttribute]: executionPolicy.visibility }} data-conversation-id={chats.activeId ?? ""} ref={discoveryDraft.rootRef} style={{ display: "contents" }} onClickCapture={captureComposerClick} onChangeCapture={discoveryDraft.captureDraft} onDropCapture={folderDrop.handleDropCapture}>
      <ChatPaneView
        // Remounts the pane on a conversation switch. `ChatPane` owns its transcript and takes
        // `initialMessages` only at mount, so re-keying is how a different conversation's history
        // gets in — pushing new messages into a live pane would fight its own state.
        key={chats.paneKey}
        {...chatPaneSessionProps({ dock, kit, hooks, deps })}
        {...chatPaneChromeProps({ dock, kit, hooks, deps })}
        {...chatPaneComposerProps({ dock, kit, hooks, deps })}
      />
      <ConfirmDialog {...conversationDelete.dialog} />
      <ChatSettingsDialog open={chatSettings.open} onClose={chatSettings.close} t={(key) => t({ key })}
        displaySections={dockSettingsMenuSections({ t: (key) => t({ key }), toolCallOptions, replyLengthOptions }, { display: chatDisplay, agentPlugins })} permissions={agentPermissions} />
      </div>
      </FailureSurfaceProvider>
    </JiniChatProvider>
  );
}

