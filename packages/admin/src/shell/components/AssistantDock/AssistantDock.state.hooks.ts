import { useCallback, type ComponentType, type RefObject } from "react";
import { isAbortError } from "@jini-ai/core/text";
import type { ExecutionConfig, ExecutionPort, ExecutionCardAgent } from "@jini-ai/core/contracts/execution";
import type { ChatMessage, ChatPaneAgent, ChatPaneAgentSelection, ChatPaneRuntimeAccess, ChatTransport, ExtEventRendererRegistry, I18nAdapter, KitChatPaneProps, KitChatPermissionsPort, ChatPaneComposerHandle, KitMcpUiToolCall } from "../../../react/kit.js";
import type { useConfirmRequest } from "../../../react/index.js";
import type { useNativeFolderPicker } from "../../../screens/fs-files/use-native-folder-picker.hooks.js";
import type { SkillInstallView } from "../../../screens/skills/skills-screen.types.js";
import type { useSelectedSkills, useComposerDiscoveryDraft, useSkillOnlySend } from "../../../screens/plugins/composer-skills.hooks.js";
import { visibleAssistantRuntimePreferences, type AgentRuntimePreferenceSupport } from "./assistant-runtime-preferences.js";
import type { UseAssistantChats } from "../../hooks/use-assistant-chats.hooks.js";
import type { useConversationRefreshSignal } from "./hooks/conversation-refresh.hooks.js";
import type { useAgentFailureSurface } from "./AgentFailureCard.hooks.js";
import type { useComposerSendStopGuard } from "./hooks/use-composer-send-stop-guard.hooks.js";
import type { useAssistantEmptyState } from "./hooks/use-assistant-empty-state.hooks.js";
import type { useSelectedAgentAuthWarning } from "./hooks/use-selected-agent-auth-warning.hooks.js";
import type { useMessagesChangeHandler } from "./hooks/messages-change.hooks.js";
import { useRuntimeAccessSeam, useAgentsPlaceholderSeam } from "./hooks/runtime-access.hooks.js";
// Every call below goes through the `useXSeam` wrappers rather than the bare hooks — see
// `AssistantDock.hooks.tsx`'s "Seam layer" doc for why.
import type { useRunContext } from "./hooks/run-context.hooks.js";
import { resolveSkillsAvailable, type useSkillAwareAttachmentUploader, type useFolderDropBridge } from "./hooks/composer-files.hooks.js";
import type { useComposerDiscoverySelect } from "./hooks/composer-discovery.hooks.js";
import type { useSelectedAgentPlugins, useSelectedPluginChips } from "./hooks/selected-agent-plugins.hooks.js";
import { useAssistantTransportSeam, type useLocalCliDaemonPrewarm, type AssistantTransportInput } from "./hooks/assistant-transport.hooks.js";
import { useExecutionConfigSeam, type UseExecutionConfig } from "./hooks/execution-config.hooks.js";
import type { AssistantDockProps } from "./AssistantDock.js";
import { useDockComposerInput } from "./dock-composer-input.hooks.js";

type DockProps = {
  props: Omit<AssistantDockProps, "kit" | "useAssistantDockStateHook">;
  kit: { ChatPane: ComponentType<KitChatPaneProps> };
  hooks: {
    useDockRendererRegistry: (required: { agUiApprovals: { answersExchange: (required: { exchangeId: string }) => boolean; answer: (required: { exchangeId: string; allow: boolean }) => Promise<boolean> } }, optional: Record<string, never>) => { registry: ExtEventRendererRegistry; mcpUiToolCaller: (call: KitMcpUiToolCall) => Promise<unknown> };
    useAdminBrowserAgentSettings: (required: Record<string, never>) => { enabled: boolean };
    useChrome: (required: { useAdminLocaleOverride: AssistantDockProps["useAdminLocale"] }) => { locale: string; t: DockTranslate; chatI18n: I18nAdapter };
    useConfirmRequest: typeof useConfirmRequest;
    useChatDisplayPreferences: NonNullable<AssistantDockProps["useChatDisplayPreferences"]>;
    useChatAgentPlugins: NonNullable<AssistantDockProps["useChatAgentPlugins"]>;
    useAssistantRuntimePreferences: NonNullable<AssistantDockProps["useAssistantRuntimePreferences"]>;
    useChatSettingsDialog: (required: Record<string, never>) => { open: boolean; show: () => void; close: () => void };
    useDockAgentPermissions: (required: { t: (key: string) => string; openSettings: () => void }) => KitChatPermissionsPort & { nativeToolPolicy: KitChatPaneProps["nativeToolPolicy"]; onMoreSettings: (() => void) | undefined };
    useExecutionConfig: NonNullable<AssistantDockProps["useExecutionConfig"]>;
    useDockExecutionPolicy: (required: { controller: UseExecutionConfig; locale: string }, optional: { usePolicy: AssistantDockProps["useExecutionPolicy"] }) => UseExecutionConfig & { visibility: string; note: string | null; runtimeAccess: (port: ChatPaneRuntimeAccess) => ChatPaneRuntimeAccess; agents: (required: { agents: readonly ChatPaneAgent[] | undefined }) => readonly ChatPaneAgent[] | undefined; selectionChange: (required: { change: (selection: ChatPaneAgentSelection) => void }) => (selection: ChatPaneAgentSelection) => void };
    usePrewarm: typeof useLocalCliDaemonPrewarm;
    useByokRuntimeSeam: (required: { override: AssistantDockProps["useByokRuntime"]; input: Parameters<NonNullable<AssistantDockProps["useByokRuntime"]>>[0] }) => ReturnType<NonNullable<AssistantDockProps["useByokRuntime"]>>;
    useLocalCliSelectionSeam: (required: { override: AssistantDockProps["useLocalCliSelection"]; input: Parameters<NonNullable<AssistantDockProps["useLocalCliSelection"]>>[0] }) => ReturnType<NonNullable<AssistantDockProps["useLocalCliSelection"]>>;
    useChatsSeam: (required: { override: AssistantDockProps["useChats"] }, optional: { principalId: string | undefined }) => UseAssistantChats;
    useAssistantTransport: (input: AssistantTransportInput) => ChatTransport;
    useAttachmentUploaderSeam: (required: { override: AssistantDockProps["useAttachmentUploader"]; t: (key: string) => string }) => ReturnType<NonNullable<AssistantDockProps["useAttachmentUploader"]>>;
    useAttachmentValidatorSeam: (required: { override: AssistantDockProps["useAttachmentValidator"] }) => ReturnType<NonNullable<AssistantDockProps["useAttachmentValidator"]>>;
    useSkillInstall: () => SkillInstallView & { proposeFiles: (files: readonly File[], paths?: readonly string[]) => Promise<void>; fail: (message: string) => void };
    useSkillUploader: typeof useSkillAwareAttachmentUploader;
    useRuntimeAccess: () => ChatPaneRuntimeAccess;
    useAgentsPlaceholder: () => readonly ChatPaneAgent[] | undefined;
    useSelectedAgentAuthWarning: typeof useSelectedAgentAuthWarning<ExecutionCardAgent, ChatPaneRuntimeAccess>;
    useComposerCapabilitiesSeam: (required: { override: AssistantDockProps["useComposerCapabilities"] }) => ReturnType<NonNullable<AssistantDockProps["useComposerCapabilities"]>>;
    usePins: typeof useSelectedAgentPlugins;
    useSelectedSkills: typeof useSelectedSkills;
    useComposerDiscoveryDraft: typeof useComposerDiscoveryDraft;
    useComposerSendStopGuard: typeof useComposerSendStopGuard;
    useDiscoverySelect: (required: Omit<Parameters<typeof useComposerDiscoverySelect>[0], "navigate" | "resolveRoute" | "loadSkillDraft">) => ReturnType<typeof useComposerDiscoverySelect>;
    useChips: typeof useSelectedPluginChips;
    useComposerVoiceInput: () => { composerHandle: RefObject<ChatPaneComposerHandle | null>; insertTranscript: (text: string) => void };
    useAssistantPromptRequests: (composerHandle: RefObject<ChatPaneComposerHandle | null>) => void;
    useSkillOnlySend: typeof useSkillOnlySend;
    useDropBridge: (required: Omit<Parameters<typeof useFolderDropBridge>[0], "folderDropDeps">, optional: Parameters<typeof useFolderDropBridge>[1]) => ReturnType<typeof useFolderDropBridge>;
    useNativeFolderPicker: typeof useNativeFolderPicker;
    useMessages: typeof useMessagesChangeHandler;
    useContext: typeof useRunContext;
    useAgentFailureSurface: typeof useAgentFailureSurface;
    useAssistantEmptyState: typeof useAssistantEmptyState;
    useConversationRefreshSignal: typeof useConversationRefreshSignal;
  };
  deps: {
    agUiApprovals: Parameters<Parameters<typeof useAssistantDockState>[0]["hooks"]["useDockRendererRegistry"]>[0]["agUiApprovals"];
    translateMedia: (required: { locale: string; key: string }) => string;
    legacyManifestNames: readonly string[];
    createExecutionPort: () => Pick<ExecutionPort, "detectLocalAgents" | "rescanLocalAgents">;
    selectedAgentWarning: Parameters<typeof useSelectedAgentAuthWarning<ExecutionCardAgent, ChatPaneRuntimeAccess>>[0]["selectWarning"];
    nativeFolderPickerDeps: Parameters<typeof useNativeFolderPicker>[1];
    selectedLocalCliReasoning: (required: { config: ExecutionConfig }, optional: Record<string, never>) => string;
    MESSAGE_CHANGE_DEPS: Parameters<typeof useMessagesChangeHandler>[0]["deps"];
    publishMessages: (messages: ChatMessage[]) => void;
    publishSettingsRefresh: () => void;
    publishContentRefresh: () => void;
    resolveAssistantConversationTitle: (required: { chats: UseAssistantChats; fallback: string }) => string;
    defaultAssistantChatsPort: Parameters<typeof useConversationRefreshSignal>[0]["port"];
    lookupOwnedConversation: NonNullable<AssistantDockProps["deepLinkPorts"]>["lookupConversation"] & {};
    replaceBrowserQuery: NonNullable<AssistantDockProps["deepLinkPorts"]>["replaceQuery"] & {};
    assistantTitleKey: string;
  };
};
type DockTranslate = (input: { key: string }, options?: Record<string, never>) => string;

export function bindAssistantDockState({ hooks, deps, kit }: Omit<Parameters<typeof useAssistantDockState>[0], "props">, _optional = {}) {
  return function useBoundAssistantDockState(props: DockProps["props"], _optional = {}): AssistantDockState {
    return useAssistantDockState({ props, hooks, deps, kit });
  };
}

function selectedDockAgent({ mode, agents, agentId }: {
  mode: string;
  agents: readonly (AgentRuntimePreferenceSupport & { id: string })[] | undefined;
  agentId: string;
}, _options = {}) {
  // Only a Local CLI run spawns the picked agent, so only then do its `supports*` flags apply. Each
  // `/api/agents` entry carries them; `ChatPaneAgent` just does not declare them.
  return mode === "local-cli" ? agents?.find((agent) => agent.id === agentId) : undefined;
}


/** Renderer registry, WebMCP setting and the pane's translated chrome. */
function useDockChrome({ props, hooks, deps }: { props: DockProps["props"] } & Pick<Parameters<typeof useAssistantDockState>[0], "hooks" | "deps">, _optional = {}) {
  const { useChrome, useDockRendererRegistry, useAdminBrowserAgentSettings } = hooks;
  const { agUiApprovals: agUiApprovalPoster } = deps;
  const { useAdminLocale } = props;
  // The same AG-UI client the transport drives, so the card answers the interrupt that run parked.
  const renderers = useDockRendererRegistry({ agUiApprovals: agUiApprovalPoster }, {});
  const { mcpUiToolCaller } = renderers;
  const { enabled: webMcpEnabled } = useAdminBrowserAgentSettings({});
  // Translates this component's own pane chrome (eyebrow, title fallback, composer placeholder)
  // and — via `chatI18n` — the `ConversationList` switcher mounted in `header` below. See
  // {@link useAssistantDockChrome}'s own doc for why `locale`/`t`/`chatI18n` are one hook rather
  // than three separate calls.
  const { locale, t, chatI18n } = useChrome({ useAdminLocaleOverride: useAdminLocale });
  return { renderers, mcpUiToolCaller, webMcpEnabled, locale, t, chatI18n };
}

/** Per-operator display, plugin and runtime preferences, the settings dialog and the delete confirmation. */
function useDockPreferences({ props, t, hooks }: { props: DockProps["props"]; t: DockTranslate } & Pick<Parameters<typeof useAssistantDockState>[0], "hooks" | "deps">, _optional = {}) {
  const { useConfirmRequest, useChatSettingsDialog, useDockAgentPermissions } = hooks;
  const {
    useChatDisplayPreferences: useChatDisplayPreferencesOverride,
    useChatAgentPlugins = hooks.useChatAgentPlugins,
    useAssistantRuntimePreferences = hooks.useAssistantRuntimePreferences,
  } = props;
  const conversationDelete = useConfirmRequest({});
  // Gear menu: per-operator transcript display, applied to the pane at once.
  const chatDisplay = useDockDisplayPreferences({ override: useChatDisplayPreferencesOverride, hooks });
  // Gear menu: per-person Agent plugins mode; Off hides the pane's "Using" chip at once.
  const agentPlugins = useChatAgentPlugins();
  // Gear menu: per-person runtime switches; the server reads them when it starts the next run.
  const runtimePreferences = useAssistantRuntimePreferences();
  const chatSettings = useChatSettingsDialog({});
  const agentPermissions = useDockAgentPermissions({ t: (key) => t({ key }), openSettings: chatSettings.show });

  return { conversationDelete, chatDisplay, agentPlugins, runtimePreferences, chatSettings, agentPermissions };
}

/** The execution policy and everything derived from the stored execution config and CLI selection. */
function useDockExecution({ props, locale, hooks }: { props: DockProps["props"]; locale: string } & Pick<Parameters<typeof useAssistantDockState>[0], "hooks" | "deps">, _optional = {}) {
  const { usePrewarm, useDockExecutionPolicy, useByokRuntimeSeam, useLocalCliSelectionSeam } = hooks;
  const {
    agentBridge = null,
    useExecutionConfig: useExecutionConfigOverride,
    useByokRuntime: useByokRuntimeOverride,
    useLocalCliSelection: useLocalCliSelectionOverride,
    useExecutionPolicy,
  } = props;
  const executionPolicy = useDockExecutionPolicy({ controller: useExecutionConfigSeam({ override: useExecutionConfigOverride, hooks: { useExecutionConfigHook: hooks.useExecutionConfig } }), locale }, { usePolicy: useExecutionPolicy });
  const { executionConfig, executionConfigRef, setExecutionConfig, handleExecutionModeChange, hasStoredAdminKey, configLoaded, readExecutionConfigForSend } = executionPolicy;
  // The dock, not the layout, owns the pre-warm: only it knows the chat's execution mode.
  const pageActivationError = usePrewarm({ mode: executionConfig.mode, configLoaded, agentBridge });
  const { byokRuntime, handleByokModelChange } = useByokRuntimeSeam({ override: useByokRuntimeOverride, input: { executionConfig, setExecutionConfig } });
  const { localCliSelection, handleLocalCliSelectionChange, readLocalCliSelectionForSend } = useLocalCliSelectionSeam({
    override: useLocalCliSelectionOverride,
    input: { executionConfig, setExecutionConfig, configLoaded },
  });

  return {
    executionPolicy, executionConfig, executionConfigRef, setExecutionConfig, handleExecutionModeChange, hasStoredAdminKey, configLoaded,
    readExecutionConfigForSend, pageActivationError, byokRuntime, handleByokModelChange, localCliSelection, handleLocalCliSelectionChange,
    readLocalCliSelectionForSend,
  };
}

type DockExecution = ReturnType<typeof useDockExecution>;

/** Conversation history, the run transport and the attachment upload/validation ports. */
function useDockTransport({ props, execution, locale, hooks, deps }: { props: DockProps["props"]; execution: DockExecution; locale: string } & Pick<Parameters<typeof useAssistantDockState>[0], "hooks" | "deps">, _optional = {}) {
  const { useChatsSeam, useAttachmentUploaderSeam, useAttachmentValidatorSeam, useSkillInstall, useSkillUploader } = hooks;
  const { translateMedia, legacyManifestNames } = deps;
  const {
    agentBridge = null,
    useChats,
    principalId,
    useAssistantTransport: useAssistantTransportOverride,
    useAttachmentUploader: useAttachmentUploaderOverride,
    useAttachmentValidator: useAttachmentValidatorOverride,
  } = props;
  const { executionConfigRef, readExecutionConfigForSend, readLocalCliSelectionForSend } = execution;
  // Resolved BEFORE the transport, which now takes `chats.ensureConversationId`: turn 1's run must
  // be able to adopt this pane's conversation before it is dispatched, because the lazy adoption
  // driven by `onMessagesChange` starts too late for the run to carry the id. See
  // `AssistantTransportFactoryOptions.ensureConversationId` for the full mechanism.
  const chats = useChatsSeam({ override: useChats }, { principalId });
  const persistUserTurn = useCallback((conversationId: string, message: ChatMessage) =>
    chats.persistUserTurn({ conversationId, message }), [chats.persistUserTurn]);
  const { transport, daemonStarting } = useAssistantTransportSeam({
    agentBridge,
    executionConfigRef,
    readExecutionConfigForSend,
    readLocalCliSelectionForSend,
    ensureConversationId: chats.ensureConversationId,
    // Defect 2 (2026-09-11): the same reasoning one line up, for the message rather than the
    // conversation. `startRun` awaits this before dispatching, so the user's turn is durable before
    // a run that may fail to deliver it exists at all — see `persistUserTurn`'s own doc in
    // `use-assistant-chats.hooks.ts`.
    persistUserTurn,
  }, { useTransport: useAssistantTransportOverride ?? hooks.useAssistantTransport });
  // The size-refusal sentence is translated in the host's Media dictionary; memoized because the uploader is memoized on it.
  const translateUpload = useCallback((key: string): string => translateMedia({ locale, key }), [locale]);
  const uploadOrdinaryAttachments = useAttachmentUploaderSeam({ override: useAttachmentUploaderOverride, t: translateUpload });
  const skillInstall = useSkillInstall();
  const uploadAttachments = useSkillUploader({ uploadAttachments: uploadOrdinaryAttachments, proposeFiles: skillInstall.proposeFiles, legacyManifestNames: legacyManifestNames });
  const validateAttachments = useAttachmentValidatorSeam({ override: useAttachmentValidatorOverride });
  return { chats, transport, daemonStarting, skillInstall, uploadAttachments, validateAttachments };
}

/** The selected agent, its sign-in warning, runtime access and the runtime switches that apply to it. */
function useDockAgent({ props, execution, locale, runtimePreferences, hooks, deps }: { props: DockProps["props"]; execution: DockExecution; locale: string; runtimePreferences: ReturnType<typeof useDockPreferences>["runtimePreferences"] } & Pick<Parameters<typeof useAssistantDockState>[0], "hooks" | "deps">, _optional = {}) {
  const { useRuntimeAccess, useAgentsPlaceholder, useSelectedAgentAuthWarning } = hooks;
  const { createExecutionPort, selectedAgentWarning } = deps;
  const { useRuntimeAccess: useRuntimeAccessOverride } = props;
  const { executionConfig, executionPolicy, localCliSelection } = execution;
  // D-21(b): the picker's inventory has no auth status, so the sign-in warning reads Settings'
  // detection; its wrapped runtimeAccess re-probes auth on the picker's own Rescan.
  const pickerRuntimeAccess = useRuntimeAccessSeam({ override: useRuntimeAccessOverride, useRuntimeAccessHook: useRuntimeAccess });
  const selectedAgentAuth = useSelectedAgentAuthWarning({ mode: executionConfig.mode, agentId: localCliSelection.agentId, locale, runtimeAccess: pickerRuntimeAccess, createPort: createExecutionPort, selectWarning: selectedAgentWarning });
  const runtimeAccess = executionPolicy.runtimeAccess(selectedAgentAuth.runtimeAccess);
  // The picker's instant list while `listAgents` is still in flight — see `useAgentsPlaceholder`.
  const agentsPlaceholder = executionPolicy.agents({ agents: useAgentsPlaceholderSeam({ runtimeAccessOverride: useRuntimeAccessOverride, usePlaceholder: useAgentsPlaceholder }) });
  const selectedAgent = selectedDockAgent({ mode: executionConfig.mode, agents: agentsPlaceholder, agentId: localCliSelection.agentId });
  const runtime = { ...runtimePreferences, visible: visibleAssistantRuntimePreferences({ agent: selectedAgent }) };
  return { selectedAgentAuth, runtimeAccess, agentsPlaceholder, runtime };
}

type DockAgent = ReturnType<typeof useDockAgent>;
type DockTransport = ReturnType<typeof useDockTransport>;

/** The composer: discovery catalog, pinned plugins and skills, voice input and folder drop/pick. */
function useDockComposer({ props, renderers, execution, agent, transportState, hooks, deps }: { props: DockProps["props"]; renderers: ReturnType<typeof useDockChrome>["renderers"]; execution: DockExecution; agent: DockAgent; transportState: DockTransport } & Pick<Parameters<typeof useAssistantDockState>[0], "hooks" | "deps">, _optional = {}) {
  const { useComposerCapabilitiesSeam, usePins, useSelectedSkills, useComposerDiscoveryDraft, useComposerSendStopGuard, useDiscoverySelect, useChips } = hooks;
  const { onFolderDropCaptureReady } = props;
  const { mcpUiToolCaller } = renderers;
  const { executionConfig, localCliSelection } = execution;
  const { agentsPlaceholder } = agent;
  const { skillInstall } = transportState;
  const { useComposerCapabilities: useComposerCapabilitiesOverride } = props;
  /**
   * The composer's discovery catalog, projected asynchronously (debate 2, "Composer slash
   * commands") — replaces the pre-2026-08-12 static `HOST_COMPOSER_DISCOVERY_GROUPS` import. See
   * `useComposerCapabilities`'s own doc (`AssistantDock.hooks.tsx`) for why it starts empty and how
   * a failed projection degrades.
   */
  const { composerCapabilities } = useComposerCapabilitiesSeam({ override: useComposerCapabilitiesOverride });
  /**
   * The composer's pinned-Agent-Plugin chips (2026-08-21) — see {@link useSelectedAgentPlugins}'s
   * own doc for why this is host state rather than part of `@jini-ai/chat`'s own composer state,
   * and `SelectedAgentPluginTray`'s doc for how it renders.
   */
  const { selectedPluginRefIds, addPluginRef, removePluginRef } = usePins();
  const selectedSkills = useSelectedSkills();
  const discoveryDraft = useComposerDiscoveryDraft(composerCapabilities.groups);
  const captureComposerClick = useComposerSendStopGuard();
  const handleComposerDiscoverySelect = useDiscoverySelect({
    composerCapabilities,
    callAllowlistedTool: mcpUiToolCaller,
    skillsAvailable: resolveSkillsAvailable({ executionMode: executionConfig.mode, agents: agentsPlaceholder, selectedAgentId: localCliSelection.agentId }),
    addPluginRef,
    addSkill: selectedSkills.addSkill,
    readDraft: discoveryDraft.readDraft,
  });
  // See `useSelectedPluginChips`'s own doc for the projection and its label-fallback reasoning.
  const selectedPluginChips = useChips(selectedPluginRefIds, composerCapabilities);

  const { voiceInput, skillOnlySend, folderDrop, folderPicker } = useDockComposerInput({ onFolderDropCaptureReady, selectedSkills, discoveryDraft, skillInstall, hooks, deps });

  return {
    composerCapabilities, selectedPluginRefIds, removePluginRef, selectedSkills, discoveryDraft, captureComposerClick,
    handleComposerDiscoverySelect, selectedPluginChips, voiceInput, skillOnlySend, folderDrop, folderPicker,
  };
}

type DockComposer = ReturnType<typeof useDockComposer>;

/** Per-run wiring: message persistence, run context, the failure surface, the empty state and the refresh signal. */
function useDockRun({ props, t, execution, agent, transportState, composer, hooks, deps }: { props: DockProps["props"]; t: DockTranslate; execution: DockExecution; agent: DockAgent; transportState: DockTransport; composer: DockComposer } & Pick<Parameters<typeof useAssistantDockState>[0], "hooks" | "deps">, _optional = {}) {
  const { useMessages, useContext, useAgentFailureSurface, useAssistantEmptyState, useConversationRefreshSignal } = hooks;
  const { selectedLocalCliReasoning, resolveAssistantConversationTitle, defaultAssistantChatsPort, assistantTitleKey, MESSAGE_CHANGE_DEPS, publishMessages, publishSettingsRefresh, publishContentRefresh } = deps;
  const { agentBridge = null } = props;
  const { executionPolicy, executionConfig, localCliSelection, handleLocalCliSelectionChange, handleExecutionModeChange } = execution;
  const { runtimeAccess } = agent;
  const { chats, transport } = transportState;
  const { selectedPluginRefIds, selectedSkills } = composer;
  const handleMessagesChange = useMessages({ deps: MESSAGE_CHANGE_DEPS, publishSettingsRefresh, publishContentRefresh, publishMessages: (messages) => { publishMessages(messages); }, chats });
  const runContext = useContext({
    agentBridge,
    model: localCliSelection.model,
    // The Execution tab owns the "Reasoning effort" control, so this comes from the persisted
    // ledger rather than from the dock's own picker (which has no effort axis). Reading it here is
    // what turns a stored level into real CLI argv — see `useRunContext`'s own doc.
    reasoning: selectedLocalCliReasoning({ config: executionConfig }, {}),
    pluginRefIds: selectedPluginRefIds,
    selectedSkills: selectedSkills.selectedSkills,
    // Same id already passed to `<ChatPane conversationId={...}>` below — see `useRunContext`'s
    // own doc for why the daemon needs it too (per-conversation agent-CLI session resume).
    conversationId: chats.activeId,
  });
  // Shown on one ellipsized line, so the full name rides along as the hover tooltip.
  const activeTitle = resolveAssistantConversationTitle({ chats, fallback: t({ key: assistantTitleKey }) });
  // One policy-gated selection handler for both the failure card and the picker.
  const handleSelectionChange = executionPolicy.selectionChange({ change: handleLocalCliSelectionChange });
  const failureSurface = useAgentFailureSurface({ transport, isAbortError, runtimeAccess, initialMessages: chats.initialMessages,
    onSelectionChange: handleSelectionChange, onExecutionModeChange: handleExecutionModeChange }, {});
  const emptyState = useAssistantEmptyState({ paneKey: chats.paneKey, initialMessages: failureSurface.initialMessages, onMessagesChange: handleMessagesChange });
  const refreshSignal = useConversationRefreshSignal({ conversationId: chats.activeId, port: defaultAssistantChatsPort });

  return { runContext, activeTitle, handleSelectionChange, failureSurface, emptyState, refreshSignal };
}

/** Resolve the injectable preference owner with the same unconditional hook call as the dock. */
function useDockDisplayPreferences({ override, hooks }: { override: AssistantDockProps["useChatDisplayPreferences"] } & Pick<Parameters<typeof useAssistantDockState>[0], "hooks">, _optional = {}) {
  const usePreferences = override ?? hooks.useChatDisplayPreferences;
  return usePreferences();
}

/**
 * Destructured rather than read as `props.x` throughout the body — every seam below is passed
 * straight to its matching `useXSeam` (or, for `agentBridge`, defaulted to `null` in place), so
 * there is nothing left to gain from keeping a `props` object around. Renamed to `...Override`
 * where the prop name would otherwise collide with the imported real hook it defaults to (same
 * "rename the local binding, not the prop" rule `INFO.md`'s Components section states) — `useChats`
 * needs no rename since only its `Seam` counterpart, not the bare hook, is imported here.
 */
export function useAssistantDockState({ props, hooks, deps, kit }: DockProps, _optional = {}) {
  const { ChatPane: ChatPaneView = kit.ChatPane, principalId, agentBridge = null } = props;
  const chrome = useDockChrome({ props, hooks, deps });
  const preferences = useDockPreferences({ props, t: chrome.t, hooks, deps });
  const execution = useDockExecution({ props, locale: chrome.locale, hooks, deps });
  const transport = useDockTransport({ props, execution, locale: chrome.locale, hooks, deps });
  const agent = useDockAgent({ props, execution, locale: chrome.locale, runtimePreferences: preferences.runtimePreferences, hooks, deps });
  const composer = useDockComposer({ props, renderers: chrome.renderers, execution, agent, transportState: transport, hooks, deps });
  const run = useDockRun({ props, t: chrome.t, execution, agent, transportState: transport, composer, hooks, deps });
  const ports = props.deepLinkPorts ?? {};
  const { lookupOwnedConversation, replaceBrowserQuery } = deps;
  // Reuses the transport's `chats` (no second controller): the link selects through the same seam the picker uses.
  props.useConversationDeepLink({ query: props.query, chats: transport.chats, principalId: principalId ?? "", lookupConversation: ports.lookupConversation ?? lookupOwnedConversation,
    replaceQuery: ports.replaceQuery ?? replaceBrowserQuery, notify: ports.notify ?? (() => undefined), openDock: ports.openDock ?? (() => undefined) });
  return { ChatPaneView, agentBridge, principalId, ...chrome, ...preferences, ...execution, ...transport, ...agent, ...composer, ...run };
}


export type AssistantDockState = ReturnType<typeof useAssistantDockState>;
