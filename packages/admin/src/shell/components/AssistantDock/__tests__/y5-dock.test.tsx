// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { useContext, useEffect, useState, type ComponentProps } from "react";

import { bindAssistantDock } from "../AssistantDock.js";
import { bindAssistantDockState, useAssistantDockState } from "../AssistantDock.state.hooks.js";
import { bindDockChatPane } from "../DockChatPane.js";
import { bindExecutionConfig } from "../hooks/execution-config.hooks.js";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { subscribeStoredKeyRefresh } from "../hooks/execution-config-refresh.js";
import { useAssistantTransportSeam } from "../hooks/assistant-transport.hooks.js";
import { visibleAssistantRuntimePreferences, REPLY_LENGTH_OPTIONS } from "../assistant-runtime-preferences.js";
import { resolveSkillsAvailable } from "../hooks/composer-files.hooks.js";
import { FailureSurfaceContext } from "../AgentFailureCard.hooks.js";
import { DockLeadingAccessory } from "../DockLeadingAccessory.js";
import { FolderPathButton } from "../FolderPathButton.js";
import { dockSettingsMenuSections } from "../dock-header-rules.js";
import { CHAT_TOOL_CALL_OPTIONS, chatPaneDisplayProps } from "../chat-display-preferences.js";
import { composerFooterLeading } from "../assistant-dock-props.js";

test("stored-key refresh ignores unrelated namespaces and retains global refresh", () => {
  let notify!: (scope: readonly string[] | null) => void;
  const revalidate = vi.fn();
  const cleanup = vi.fn();
  const unsubscribe = subscribeStoredKeyRefresh({ revalidate, deps: {
    EXECUTION_NAMESPACE: "core.execution",
    subscribeToSettingsRefresh: listener => { notify = listener; return cleanup; },
  } });
  notify(["unrelated"]);
  expect(revalidate).not.toHaveBeenCalled();
  notify(["core.execution"]);
  notify(null);
  expect(revalidate).toHaveBeenCalledTimes(2);
  unsubscribe();
  expect(cleanup).toHaveBeenCalledOnce();
});


test("dock entry calls the supplied state hook once and mounts its pane", () => {
  const { result } = renderHook(() => useAssistantDockState(input));
  const dock = result.current;
  const useAssistantDockStateHook = vi.fn(() => dock);
  const Dock = bindAssistantDock({ hooks: { useAssistantDockStateHook }, kit: {
    DockChatPane: ({ dock: value }) => <p>{value === dock ? "state" : "wrong state"}</p>,
  } });
  const useConversationDeepLink = vi.fn();
  render(<Dock query={null} principalId="owner" useConversationDeepLink={useConversationDeepLink} />);
  expect(screen.getByText("state")).toBeTruthy();
  expect(useAssistantDockStateHook).toHaveBeenCalledTimes(1);
  expect(useAssistantDockStateHook).toHaveBeenCalledWith({ query: null, principalId: "owner", useConversationDeepLink });
});

test("the dock preserves a synchronous MCP tool caller's result", () => {
  const receipt = { delivered: true };
  const mcpUiToolCaller = vi.fn(() => receipt);
  const { result } = renderHook(() => useAssistantDockState({ ...input, hooks: {
    ...input.hooks,
    useDockRendererRegistry: (required, optional) => ({
      ...input.hooks.useDockRendererRegistry(required, optional), mcpUiToolCaller,
    }),
  } }));
  const call = { name: "answer", arguments: { choice: "yes" } };
  expect(result.current.mcpUiToolCaller(call)).toBe(receipt);
  expect(mcpUiToolCaller).toHaveBeenCalledExactlyOnceWith(call);
});

const order: string[] = [];
const config: ExecutionConfig = { mode: "byok", byok: { protocol: "openai", providerId: null, apiKey: "", baseUrl: "", model: "" }, localCli: { agentId: null } };
const chats = {
  conversations: [], activeId: null, paneKey: "new", initialMessages: [], select: vi.fn(),
  create: vi.fn(async () => {}), remove: vi.fn(async () => {}), rename: vi.fn(async () => {}), onMessagesChange: vi.fn(),
  ensureConversationId: vi.fn(async () => { order.push("adopt"); return "conversation"; }),
  persistUserTurn: vi.fn(async () => { order.push("persist"); }),
};
const runtimeAccess = { listAgents: async () => [], rescanAgents: async () => [], daemonOnline: async () => true };
const useConversationDeepLink = vi.fn();
const input: Parameters<typeof useAssistantDockState>[0] = {
  props: { query: null, principalId: "owner", useConversationDeepLink }, kit: { ChatPane: () => null },
  hooks: {
    useDockRendererRegistry: () => ({ registry: { register: () => () => {}, get: () => undefined, slot: () => "slot", hasTerminalNotice: () => false, clear: vi.fn() }, mcpUiToolCaller: async () => ({}) }),
    useAdminBrowserAgentSettings: () => ({ enabled: true }),
    useChrome: () => ({ locale: "en", t: ({ key }) => key, chatI18n: { locale: "en", t: key => key } }),
    useConfirmRequest: () => ({ confirm: vi.fn(async () => true), dialog: { open: false, title: "", body: "", confirmLabel: "", onConfirm: vi.fn(), onCancel: vi.fn() } }),
    useChatDisplayPreferences: () => ({ preferences: { toolCalls: "show", showUsageLine: true, showThinking: true }, update: vi.fn(), saveFailed: false }),
    useChatAgentPlugins: () => ({ mode: "off", update: vi.fn(), saveFailed: false }),
    useAssistantRuntimePreferences: () => ({ preferences: { preferSubagents: true, useClaudeInChrome: false, replyLength: "normal" }, update: vi.fn(), saveFailed: false }),
    useChatSettingsDialog: () => ({ open: false, show: vi.fn(), close: vi.fn() }),
    useDockAgentPermissions: () => ({ enabled: false, canEdit: false, capabilities: [], onChange: vi.fn(), onMoreSettings: undefined, nativeToolPolicy: undefined }),
    useExecutionConfig: () => ({ executionConfig: config, executionConfigRef: { current: config }, setExecutionConfig: vi.fn(), handleExecutionModeChange: vi.fn(), hasStoredAdminKey: false, configLoaded: true }),
    useDockExecutionPolicy: ({ controller }) => ({ ...controller, visibility: "available", note: null, runtimeAccess: value => value, agents: ({ agents }) => agents, selectionChange: ({ change }) => change }),
    usePrewarm: () => null,
    useByokRuntimeSeam: () => ({ byokRuntime: { model: "", models: [] }, handleByokModelChange: vi.fn() }),
    useLocalCliSelectionSeam: () => ({ localCliSelection: { agentId: "agent" }, handleLocalCliSelectionChange: vi.fn() }),
    useChatsSeam: () => { order.push("chats"); return chats; },
    useAssistantTransportSeam,
    useAssistantTransport: ({ ensureConversationId, persistUserTurn }) => {
      order.push("transport");
      return { async startRun() {
        const id = await ensureConversationId!();
        await persistUserTurn!(id!, { id: "turn", role: "user", content: "hello", createdAt: 1 });
        order.push("dispatch");
        return { runId: "run" };
      }, reattachRun: async () => {}, fetchRunStatus: async () => null, stopRun: async () => {} };
    },
    useAttachmentUploaderSeam: () => async () => [], useAttachmentValidatorSeam: () => async () => [],
    useSkillInstall: () => ({ pending: null, busy: false, error: null, cancel: vi.fn(), confirm: vi.fn(), proposeFiles: vi.fn(async () => {}), fail: vi.fn() }),
    useSkillUploader: ({ uploadAttachments }) => uploadAttachments,
    useRuntimeAccess: () => runtimeAccess, useAgentsPlaceholder: () => undefined,
    useSelectedAgentAuthWarning: ({ runtimeAccess }) => ({ warning: null, runtimeAccess }),
    useComposerCapabilitiesSeam: () => ({ composerCapabilities: { groups: [], byItemId: new Map(), byPluginRefId: new Map() } }),
    usePins: () => ({ selectedPluginRefIds: [], addPluginRef: vi.fn(), removePluginRef: vi.fn() }),
    useSelectedSkills: () => ({ selectedSkills: [], addSkill: vi.fn(), removeSkill: vi.fn(), chips: [], skillOnlyPrompt: "" }),
    useComposerDiscoveryDraft: () => ({ rootRef: { current: null }, captureDraft: vi.fn(), readDraft: () => "", groups: [], draftBlank: true, refreshDraft: vi.fn() }),
    useComposerSendStopGuard: () => vi.fn(), useDiscoverySelect: () => async () => {}, useChips: () => [],
    useComposerVoiceInput: () => ({ composerHandle: { current: null }, insertTranscript: vi.fn() }),
    useAssistantPromptRequests: vi.fn(), useSkillOnlySend: () => ({ canSendSkills: false, sendSkills: vi.fn() }),
    useDropBridge: () => ({ notice: null, dismiss: vi.fn(), retry: vi.fn(), handleDropCapture: vi.fn(), insertFolderPath: vi.fn(), showPathHint: vi.fn() }),
    useNativeFolderPicker: () => ({ available: false, picking: false, pickFolder: vi.fn() }),
    useMessages: () => vi.fn(), useContext: () => () => ({ frontendTabId: "tab" }),
    useAgentFailureSurface: ({ transport, runtimeAccess, initialMessages }) => ({ transport, runtimeAccess, initialMessages, actions: { agents: [], switchAgent: vi.fn() } }),
    useAssistantEmptyState: ({ onMessagesChange }) => ({ empty: true, handleMessagesChange: onMessagesChange }),
    useConversationRefreshSignal: () => undefined,
  },
  deps: {
    visibleAssistantRuntimePreferences, resolveSkillsAvailable,
    agUiApprovals: { answersExchange: () => false, answer: async () => false },
    translateMedia: ({ key }) => key, legacyManifestNames: ["legacy.json"],
    createExecutionPort: () => ({ detectLocalAgents: async () => [] }), selectedAgentWarning: () => null,
    nativeFolderPickerDeps: { probe: async () => ({}), pick: async () => ({ path: null }), isDialogAlreadyOpen: () => false },
    selectedLocalCliReasoning: () => "", MESSAGE_CHANGE_DEPS: { isTerminalRunStatus: () => false }, publishMessages: vi.fn(), publishSettingsRefresh: vi.fn(), publishContentRefresh: vi.fn(), resolveAssistantConversationTitle: ({ fallback }) => fallback,
    defaultAssistantChatsPort: { loadMessages: async () => [] },
    lookupOwnedConversation: async () => true, replaceBrowserQuery: vi.fn(), assistantTitleKey: "Host assistant",
  },
};

const paneInput: Parameters<typeof bindDockChatPane>[0] = {
    kit: { FailureSurfaceProvider: FailureSurfaceContext.Provider, DockLeadingAccessory, FolderPathButton, JiniChatProvider: ({ children }) => <>{children}</>, ChatSettingsDialog: () => null, ConversationTitle: () => null,
      DockCleanupHeader: () => null, ChatCleanupPanel: () => null, SkillInstallConfirmation: () => null, ConfirmDialog: () => null,
      PushToTalkMicButton: () => null, chat: { useT: () => key => key } },
    hooks: { useDockChatCleanup: vi.fn(), useWiredAssistantSubagentsSettings: vi.fn() },
    deps: { dockSettingsMenuSections, toolCallOptions: CHAT_TOOL_CALL_OPTIONS, replyLengthOptions: REPLY_LENGTH_OPTIONS, chatPaneDisplayProps, createAdminTypedAnswerPoster: () => Object.assign(async () => "not-pending" as const, { toolName: "ask" }),
      createMidRunMessagePoster: () => async () => "not-running", fetch, baseUrl: "", onSecretRedacted: vi.fn(), subscribeToAdminPageSurfaces: () => () => {},
      translateAiAssistant: ({ key }) => key, skillInstallConfirmationHost: { hooks: { useSkillInstallConfirmation: () => ({ dialogRef: { current: null }, onDialogClick: vi.fn(), source: "files", onConfirm: vi.fn() }) }, failureHost: { ApiError: Error, describeApiError: ({ fallback }) => fallback, redactionOptions: {} }, classNames: { dialogBackdrop: "backdrop", dialog: "dialog", noticeError: "error", editorActions: "actions", buttonPrimary: "primary", buttonSecondary: "secondary", buttonDanger: "danger" } },
      voiceInputEnabled: false, isDesktopAdmin: () => false,
      hasUsableAdminKey: () => false, assistantTitleKey: "Host assistant", folderWindowNoteKey: "Folder window opened on the host",
      localCliDataAttribute: "data-host-local-cli" },
  };

beforeEach(() => { order.length = 0; vi.clearAllMocks(); });
afterEach(cleanup);

test.each([false, true])("the injected transport seam preserves override=%s and daemon-start feedback", (override) => {
  const seam = vi.fn(useAssistantTransportSeam);
  const useTransport = vi.fn(input.hooks.useAssistantTransport);
  const useDefaultTransport = vi.fn(input.hooks.useAssistantTransport);
  const useBound = bindAssistantDockState({ ...input, hooks: { ...input.hooks,
    useAssistantTransportSeam: seam, useAssistantTransport: override ? useDefaultTransport : useTransport,
  } });
  const { result } = renderHook(() => useBound({ ...input.props, ...(override ? { useAssistantTransport: useTransport } : {}) }));
  expect(seam).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    executionConfigRef: result.current.executionConfigRef, ensureConversationId: chats.ensureConversationId,
    readExecutionConfigForSend: result.current.readExecutionConfigForSend,
    readLocalCliSelectionForSend: result.current.readLocalCliSelectionForSend, persistUserTurn: expect.any(Function),
  }), { useTransport });
  expect(useDefaultTransport).not.toHaveBeenCalled();
  act(() => useTransport.mock.calls[0]![0].onDaemonStartingChange!({ starting: true }));
  expect(result.current.daemonStarting).toBe(true);
  act(() => useTransport.mock.calls.at(-1)![0].onDaemonStartingChange!({ starting: false }));
  expect(result.current.daemonStarting).toBe(false);
});

test("the dock uses the injected runtime visibility and skill availability rules", () => {
  const visible = vi.fn(visibleAssistantRuntimePreferences).mockReturnValue({ preferSubagents: true, useClaudeInChrome: true, replyLength: false });
  const available = vi.fn(resolveSkillsAvailable).mockReturnValue(false);
  const useDiscoverySelect = vi.fn(input.hooks.useDiscoverySelect);
  const { result } = renderHook(() => useAssistantDockState({ ...input,
    hooks: { ...input.hooks, useDiscoverySelect },
    deps: { ...input.deps, visibleAssistantRuntimePreferences: visible, resolveSkillsAvailable: available },
  }));
  expect(visible).toHaveBeenCalledExactlyOnceWith({ agent: undefined });
  expect(result.current.runtime.visible).toEqual({ preferSubagents: true, useClaudeInChrome: true, replyLength: false });
  expect(available).toHaveBeenCalledExactlyOnceWith({ executionMode: "byok", agents: undefined, selectedAgentId: "agent" });
  expect(useDiscoverySelect).toHaveBeenCalledWith(expect.objectContaining({ skillsAvailable: false }));
});

test("the pane uses the supplied failure provider, settings choices, accessories and display helper", () => {
  const { result } = renderHook(() => useAssistantDockState(input));
  const dock = result.current;
  const provider = vi.fn((props: Parameters<typeof FailureSurfaceContext.Provider>[0]) => <FailureSurfaceContext.Provider {...props} />);
  const sections = vi.fn(dockSettingsMenuSections);
  const display = vi.fn(chatPaneDisplayProps);
  const leading = vi.fn(() => <p>leading</p>);
  const header = vi.fn((_props: ComponentProps<typeof paneInput.kit.DockCleanupHeader>) => null);
  const dialog = vi.fn((_props: ComponentProps<typeof paneInput.kit.ChatSettingsDialog>) => null);
  const toolCallOptions = CHAT_TOOL_CALL_OPTIONS.slice(0, 1);
  const replyLengthOptions = REPLY_LENGTH_OPTIONS.slice(0, 1);
  const PaneView = bindDockChatPane({ ...paneInput,
    kit: { ...paneInput.kit, FailureSurfaceProvider: provider, DockLeadingAccessory: leading, DockCleanupHeader: header, ChatSettingsDialog: dialog },
    deps: { ...paneInput.deps, dockSettingsMenuSections: sections, toolCallOptions, replyLengthOptions, chatPaneDisplayProps: display },
  });
  const pane = vi.fn((props: ComponentProps<typeof dock.ChatPaneView>) => {
    expect(useContext(FailureSurfaceContext)).toBe(dock.failureSurface.actions);
    return <>{props.header}{props.leadingAccessory}<p>{props.toolCallDisplay}</p></>;
  });
  render(<PaneView dock={{ ...dock, ChatPaneView: pane }} />);
  expect(provider.mock.calls[0]![0].value).toBe(dock.failureSurface.actions);
  expect(sections).toHaveBeenCalledExactlyOnceWith({ t: expect.any(Function), toolCallOptions, replyLengthOptions }, { display: dock.chatDisplay, agentPlugins: dock.agentPlugins });
  expect(header.mock.calls[0]![0]).toEqual(expect.objectContaining({ toolCallOptions, replyLengthOptions }));
  expect(dialog.mock.calls[0]![0].displaySections).toBe(sections.mock.results[0]!.value);
  expect(display).toHaveBeenCalledExactlyOnceWith({ preferences: dock.chatDisplay.preferences });
  expect(screen.getByText("leading")).toBeTruthy();
  expect(screen.getByText("show")).toBeTruthy();
});

test("the footer uses the injected folder button with its translator before voice", () => {
  const useT = () => (key: string) => `chat:${key}`;
  const folder = vi.fn(({ useTHook, onPick, picking }: Parameters<typeof FolderPathButton>[0]) =>
    <button disabled={picking} onClick={onPick}>{useTHook()("Choose a folder")}</button>);
  const folderPicker = { available: true, picking: false, pickFolder: vi.fn() };
  const kit = { FolderPathButton: folder, chat: { useT } };
  const view = render(composerFooterLeading({ folderPicker, voice: <button>voice</button>, kit }));
  expect(folder.mock.calls[0]![0]).toEqual({ picking: false, onPick: folderPicker.pickFolder, useTHook: useT });
  expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["chat:Choose a folder", "voice"]);
  screen.getByRole("button", { name: "chat:Choose a folder" }).click();
  expect(folderPicker.pickFolder).toHaveBeenCalledOnce();
  view.rerender(<>{composerFooterLeading({ folderPicker: { ...folderPicker, available: false }, voice: <button>voice</button>, kit })}</>);
  expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["voice"]);
});

test("first-turn adoption and durability precede dispatch and deep links share the chats controller", async () => {
  const useStateHook = bindAssistantDockState(input);
  const { result } = renderHook(() => useStateHook(input.props));
  expect(order).toEqual(["chats", "transport"]);
  expect(useConversationDeepLink).toHaveBeenCalledWith(expect.objectContaining({ chats }));
  await act(async () => { await result.current.transport.startRun({ history: [], signal: new AbortController().signal }, { onEvent: vi.fn(), onError: vi.fn(), onDone: vi.fn() }); });
  expect(order).toEqual(["chats", "transport", "adopt", "persist", "dispatch"]);
  expect(chats.persistUserTurn).toHaveBeenCalledWith({ conversationId: "conversation", message: expect.objectContaining({ id: "turn" }) });
});

test("a conversation switch remounts the pane while adopting an id keeps its transcript", () => {
  const { result } = renderHook(() => useAssistantDockState(input));
  const mounts = vi.fn();
  const unmounts = vi.fn();
  function Pane() {
    const [transcript] = useState(result.current.chats.initialMessages);
    useEffect(() => { mounts(transcript); return () => { unmounts(); }; }, []);
    return <p>pane</p>;
  }
  const dock = { ...result.current, ChatPaneView: Pane };
  const PaneView = bindDockChatPane(paneInput);
  const view = render(<PaneView dock={dock} />);
  view.rerender(<PaneView dock={{ ...dock, chats: { ...dock.chats, activeId: "adopted" } }} />);
  expect(mounts).toHaveBeenCalledTimes(1);
  view.rerender(<PaneView dock={{ ...dock, chats: { ...dock.chats, activeId: "other", paneKey: "other" } }} />);
  expect(mounts).toHaveBeenCalledTimes(2);
  expect(unmounts).toHaveBeenCalledTimes(1);
});

test("execution binding forwards persisted mode changes with host failure copy and override ports and hooks", () => {
  const initialConfig = input.hooks.useExecutionConfig({}).executionConfig;
  const next = { ...initialConfig, mode: "local-cli" as const };
  const write = { previous: initialConfig, next };
  const persistWrite = vi.fn(async () => true);
  const port = { loadConfig: async () => initialConfig, loadCredential: async () => ({ isSet: false }), now: () => 1 };
  const useLedgerHook = vi.fn((_required: Parameters<Parameters<typeof bindExecutionConfig>[0]["hooks"]["useLedgerHook"]>[0]) => ({ ...input.hooks.useExecutionConfig({}), readExecutionConfigForSend: async () => initialConfig }));
  const useBound = bindExecutionConfig({ hooks: {
    useBootScopeHook: () => ({ queryScope: "owner", principalId: "owner", checking: false }),
    useCachedLoaderHook: () => ({ load: async () => { throw new Error("unused loader"); }, peek: () => undefined, replace: vi.fn() }),
    useInvalidateHook: () => vi.fn(), useLedgerHook: () => { throw new Error("the selected ledger override must run"); }, useStoredKeyHook: () => false,
  }, deps: { port, initialConfig, namespace: "execution", applyChange: () => write,
    retry: ({ load }) => load(), onConfigLoadFailure: vi.fn(), onStoredKeyLoadFailure: vi.fn(), persistWrite,
    modeFailureLog: "mode save failed", refresh: { window, document, subscribeToSettingsRefresh: () => () => {}, EXECUTION_NAMESPACE: "execution" },
  } });
  const overridePort = { ...port, now: () => 2 };
  const { result } = renderHook(() => useBound({}, { port: overridePort, useLedger: useLedgerHook }));
  act(() => result.current.handleExecutionModeChange("local"));
  expect(useLedgerHook.mock.calls[0]?.[0].io.current).toBe(overridePort);
  expect(persistWrite).toHaveBeenCalledWith({ write, failureLog: "mode save failed" });
});
