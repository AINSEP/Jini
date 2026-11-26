// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { useEffect, useState } from "react";

import { bindAssistantDock } from "../AssistantDock.js";
import { bindAssistantDockState, useAssistantDockState } from "../AssistantDock.state.hooks.js";
import { bindDockChatPane } from "../DockChatPane.js";
import { bindExecutionConfig } from "../hooks/execution-config.hooks.js";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { subscribeStoredKeyRefresh } from "../hooks/execution-config-refresh.js";

vi.mock("../DockLeadingAccessory.js", () => ({ DockLeadingAccessory: () => null }));

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
    agUiApprovals: { answersExchange: () => false, answer: async () => false },
    translateMedia: ({ key }) => key, legacyManifestNames: ["legacy.json"],
    createExecutionPort: () => ({ detectLocalAgents: async () => [] }), selectedAgentWarning: () => null,
    nativeFolderPickerDeps: { probe: async () => ({}), pick: async () => ({ path: null }), isDialogAlreadyOpen: () => false },
    selectedLocalCliReasoning: () => "", MESSAGE_CHANGE_DEPS: { isTerminalRunStatus: () => false }, publishMessages: vi.fn(), publishSettingsRefresh: vi.fn(), publishContentRefresh: vi.fn(), resolveAssistantConversationTitle: ({ fallback }) => fallback,
    defaultAssistantChatsPort: { loadMessages: async () => [] },
    lookupOwnedConversation: async () => true, replaceBrowserQuery: vi.fn(), assistantTitleKey: "Host assistant",
  },
};

beforeEach(() => { order.length = 0; vi.clearAllMocks(); });
afterEach(cleanup);

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
  const PaneView = bindDockChatPane({
    kit: { JiniChatProvider: ({ children }) => <>{children}</>, ChatSettingsDialog: () => null, ConversationTitle: () => null,
      DockCleanupHeader: () => null, ChatCleanupPanel: () => null, SkillInstallConfirmation: () => null, ConfirmDialog: () => null,
      PushToTalkMicButton: () => null, chat: { useT: () => key => key } },
    hooks: { useDockChatCleanup: vi.fn(), useWiredAssistantSubagentsSettings: vi.fn() },
    deps: { createAdminTypedAnswerPoster: () => Object.assign(async () => "not-pending" as const, { toolName: "ask" }),
      createMidRunMessagePoster: () => async () => "not-running", fetch, baseUrl: "", onSecretRedacted: vi.fn(), subscribeToAdminPageSurfaces: () => () => {},
      translateAiAssistant: ({ key }) => key, skillInstallConfirmationHost: { hooks: { useSkillInstallConfirmation: () => ({ dialogRef: { current: null }, onDialogClick: vi.fn(), source: "files", onConfirm: vi.fn() }) }, failureHost: { ApiError: Error, describeApiError: ({ fallback }) => fallback, redactionOptions: {} }, classNames: { dialogBackdrop: "backdrop", dialog: "dialog", noticeError: "error", editorActions: "actions", buttonPrimary: "primary", buttonSecondary: "secondary", buttonDanger: "danger" } },
      voiceInputEnabled: false, isDesktopAdmin: () => false,
      hasUsableAdminKey: () => false, assistantTitleKey: "Host assistant", folderWindowNoteKey: "Folder window opened on the host",
      localCliDataAttribute: "data-host-local-cli" },
  });
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
