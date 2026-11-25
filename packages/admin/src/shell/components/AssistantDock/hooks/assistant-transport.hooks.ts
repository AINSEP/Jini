import { activateAssistantDaemon, prepareAssistantPageBinding } from "../../../lib/assistant-daemon-activation.js";
import { getAssistantDockOpen, subscribeToAssistantDock } from "../../../lib/assistant-dock-bus.js";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ChatMessage, ChatPaneAgentSelection, ChatTransport, FrontendSessionBridge, StartRunInput } from "../../../../react/kit.js";
import type { ExecutionConfig } from "@jini-ai/core/contracts/execution";

/** What the host's transport factory is handed: the per-send reads this hook wires, plus the host's own flags. */
export interface AssistantTransportFactoryOptions {
  getExecutionConfig: () => ExecutionConfig;
  ensureConversationId?: () => Promise<string | null>;
  persistUserTurn?: (conversationId: string, message: ChatMessage) => Promise<void>;
  getAgUiEnabled: () => boolean;
  getResumeCapableAgentIds: () => ReadonlySet<string>;
}
/** The host's transport factory (the host owns its run endpoints and event vocabulary). */
export type AssistantTransportFactory = (options: AssistantTransportFactoryOptions) => ChatTransport;

/** The host collaborators every send needs, all required: the transport factory, its two flag reads, and the
 *  host's saved-selection readers. `prepareBinding` is the shell's own and stays an optional test seam. */
export interface AssistantTransportOptions {
  createTransport: AssistantTransportFactory;
  getAgUiEnabled: () => boolean;
  getResumeCapableAgentIds: () => ReadonlySet<string>;
  selectedLocalCliReasoning: (config: ExecutionConfig) => string | undefined;
  localCliSelectionFromConfig: (input: { config: ExecutionConfig }) => ChatPaneAgentSelection;
  prepareBinding?: typeof prepareAssistantPageBinding;
}
export interface AssistantTransportInput {
  agentBridge?: FrontendSessionBridge | null;
  executionConfigRef: React.MutableRefObject<ExecutionConfig>;
  readExecutionConfigForSend?: () => Promise<ExecutionConfig>;
  readLocalCliSelectionForSend?: (config: ExecutionConfig) => ChatPaneAgentSelection;
  ensureConversationId?: () => Promise<string | null>;
  persistUserTurn?: (conversationId: string, message: ChatMessage) => Promise<void>;
  onDaemonStartingChange?: (input: { starting: boolean }, options?: Record<string, never>) => void;
}

function createAssistantStartRun(
  { io, transport }: {
    io: React.MutableRefObject<{
      input: AssistantTransportInput;
      options: AssistantTransportOptions;
      prepareBinding: typeof prepareAssistantPageBinding;
    }>;
    transport: ChatTransport;
  },
  _options: Record<string, never> = {},
): ChatTransport["startRun"] {
  return async function startRun(runInput, handlers) {
    const fresh = io.current.input;
    // ChatPane freezes agent/context before startRun. Re-read the saved Local CLI selection
    // here so a just-finished refresh is used even before React renders the updated picker.
    // The deployed-site UI gate may still be discovering a local host. Await its effective
    // read in either mode so the pending BYOK projection cannot misroute a local first send.
    if (fresh.readExecutionConfigForSend) {
      const config = await fresh.readExecutionConfigForSend();
      if (config.mode === "local-cli") {
        runInput = withLatestLocalCliSelection({ runInput, config }, {
          readSelection: fresh.readLocalCliSelectionForSend,
          selectedLocalCliReasoning: io.current.options.selectedLocalCliReasoning,
          localCliSelectionFromConfig: io.current.options.localCliSelectionFromConfig,
        });
      }
    }
    // The pane froze context while the cold bridge was parked. Read its token after attach.
    if (fresh.executionConfigRef.current.mode === "local-cli") {
      const signals = [runInput.cancelSignal, runInput.signal].filter((signal): signal is AbortSignal => Boolean(signal));
      const signal = AbortSignal.any(signals);
      await pageBindToken({ bridge: fresh.agentBridge, signal }, {
        prepareBinding: io.current.prepareBinding,
        onDaemonStartingChange: ({ starting }) => io.current.input.onDaemonStartingChange?.({ starting }),
      });
      signal.throwIfAborted();
      if (fresh.agentBridge) {
        const token = fresh.agentBridge.bindToken();
        if (!token) throw new Error("the assistant page is not attached");
        runInput = { ...runInput, context: { ...runInput.context, frontendBindToken: token } };
      }
    }
    return transport.startRun(runInput, handlers);
  };
}

/**
 * Builds the `ChatTransport` `AssistantDock.tsx` passes to both `<JiniChatProvider>` and
 * `<ChatPane>` directly. Injectable per `INFO.md`'s Components rule 3 (real I/O: every `startRun`
 * this transport drives is a network call) — defaulted to the real hook on `AssistantDockProps`.
 *
 * The transport holds no per-render state; rebuilding it each render would drop in-flight runs —
 * that is why this stays a `useMemo` with an empty-shaped dependency list (`executionConfigRef` is
 * a ref object, stable for the component's lifetime, so including it does not defeat the memo).
 * `getExecutionConfig` reads `executionConfigRef.current` fresh on every call instead of closing
 * over `executionConfig` by value, so a mode change mid-session takes effect on the NEXT message
 * without forcing a new transport instance.
 *
 * @param input.executionConfigRef - {@link UseExecutionConfig.executionConfigRef} — read fresh
 *   inside `getExecutionConfig`, never captured by value.
 * @param input.ensureConversationId - `useChatsSeam`'s `ensureConversationId`. Stable for the
 *   component's lifetime (a `useCallback` over two other stable callbacks — see its own declaration
 *   in `use-assistant-chats.hooks.ts`), so listing it in the dependency array below does not defeat
 *   the memo any more than `executionConfigRef` does. Optional so a test that injects a `useChats`
 *   stub predating it still builds a working transport — one without first-turn session capture,
 *   which is exactly the pre-fix behavior and never a crash.
 * @returns The memoized transport instance.
 * @param input.onDaemonStartingChange - Reports a send's activation still pending after 500 ms;
 *   clears on activation settlement or Stop, independently of page attachment and run acceptance.
 * @example
 * const transport = useAssistantTransport({ executionConfigRef, ensureConversationId: chats.ensureConversationId });
 */
export function useAssistantTransport(
  input: AssistantTransportInput,
  options: AssistantTransportOptions,
): ChatTransport {
  const prepareBinding = options.prepareBinding ?? prepareAssistantPageBinding;
  const { executionConfigRef, ensureConversationId, persistUserTurn } = input;
  const io = useRef({ input, options, prepareBinding });
  io.current = { input, options, prepareBinding };
  return useMemo<ChatTransport>(() => {
    const transport = io.current.options.createTransport({
      getExecutionConfig: () => executionConfigRef.current,
      // Turn 1's run has no conversation id of its own to send — the pane adopts one lazily, from
      // a message delta that does not exist yet when `runContext` is frozen. See
      // the host factory's `ensureConversationId` option for the full mechanism and the
      // amnesia it caused.
      ...(ensureConversationId ? { ensureConversationId } : {}),
      // Defect 2 (2026-09-11): awaited by `startRun` before `POST /api/runs`, so a run can never
      // be dispatched for a message that exists nowhere durable. Same optional-spread shape as
      // `ensureConversationId` above and for the same reason — a test that injects a `useChats`
      // stub predating it still builds a working transport, just without the pre-dispatch write.
      ...(persistUserTurn ? { persistUserTurn } : {}),
      // ADR-059's AG-UI canary — off by default, flipped per-tab via `localStorage` (see
      // `isAgUiTransportEnabled`'s own doc). Read fresh per `startRun` call, same as
      // `getExecutionConfig` above.
      getAgUiEnabled: io.current.options.getAgUiEnabled,
      // Which Local CLI agentIds carry their own multi-turn memory — see the host
      // factory's `getResumeCapableAgentIds` option for the full contract (and why "not yet known"
      // must fail open to the full transcript).
      // `useRuntimeAccess`'s `listAgents`/`rescanAgents` keep the set it reads current.
      getResumeCapableAgentIds: io.current.options.getResumeCapableAgentIds,
    });
    return {
      ...transport,
      startRun: createAssistantStartRun({ io, transport }),
    };
  }, [executionConfigRef, ensureConversationId, persistUserTurn]);
}

/** Pre-warms the per-site agent daemon while the dock is open in Local CLI mode (ADR-070 #7).
 * API · BYOK runs in the API process, so it never wakes the daemon; neither does the default mode
 * before the saved one has loaded. Return a failed wake for the dock's visible status; first send retries it.
 * @complexity O(1), one activation per open/config/bridge change; no polling. */
export function useLocalCliDaemonPrewarm(
  { mode, configLoaded, agentBridge }: { mode: ExecutionConfig["mode"]; configLoaded: boolean; agentBridge?: FrontendSessionBridge | null },
  { activate = activateAssistantDaemon }: { activate?: typeof activateAssistantDaemon } = {},
): string | null {
  const dockOpen = useSyncExternalStore(subscribeToAssistantDock, getAssistantDockOpen);
  const [error, setError] = useState<string | null>(null);
  const wake = useRef(activate);
  wake.current = activate;
  useEffect(() => {
    if (!dockOpen || !configLoaded || mode !== "local-cli") return;
    const controller = new AbortController();
    setError(null);
    void prepareAssistantPageBinding({ bridge: agentBridge, signal: controller.signal }, { activate: wake.current }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : "The assistant could not attach to this page. Retry your message; if it keeps failing, restart the site.");
    });
    return () => controller.abort();
  }, [dockOpen, configLoaded, mode, agentBridge]);
  return dockOpen && mode === 'local-cli' ? error : null;
}

/** A required page binding must succeed before dispatch; failures and Stop reject the send.
 * Surfaces without page control retain run acceptance's existing cold-start path if wake fails.
 * Startup feedback covers only activation, never the subsequent page-attachment wait.
 * @returns The prepared token; the caller must re-read it at dispatch after this async boundary.
 * @complexity O(1), one timer and one abort listener, both released when the wait ends.
 */
async function pageBindToken(
  { bridge, signal }: { bridge?: FrontendSessionBridge | null | undefined; signal?: AbortSignal | undefined },
  { prepareBinding, onDaemonStartingChange }: {
    prepareBinding: typeof prepareAssistantPageBinding;
    onDaemonStartingChange: (input: { starting: boolean }, options?: Record<string, never>) => void;
  },
): Promise<string | undefined> {
  signal?.throwIfAborted();
  let activationPending = true;
  const timer = setTimeout(() => onDaemonStartingChange({ starting: true }), 500);
  // Stop and activation settlement may both arrive; a late completion must not clear a new send.
  const finishActivation = () => {
    if (!activationPending) return;
    activationPending = false;
    clearTimeout(timer);
    onDaemonStartingChange({ starting: false });
  };
  signal?.addEventListener("abort", finishActivation, { once: true });
  try {
    const token = await prepareBinding({ bridge, signal }, { onActivationSettled: finishActivation });
    signal?.throwIfAborted();
    return token;
  }
  catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (!bridge) return undefined;
    throw error;
  }
  finally {
    finishActivation();
    signal?.removeEventListener("abort", finishActivation);
  }
}

/** Keep the saved CLI selection authoritative at dispatch, before adding the live page binding. */
function withLatestLocalCliSelection(
  { runInput, config }: { runInput: StartRunInput; config: ExecutionConfig },
  { readSelection, selectedLocalCliReasoning, localCliSelectionFromConfig }: {
    readSelection?: ((config: ExecutionConfig) => ChatPaneAgentSelection) | undefined;
    selectedLocalCliReasoning: AssistantTransportOptions["selectedLocalCliReasoning"];
    localCliSelectionFromConfig: AssistantTransportOptions["localCliSelectionFromConfig"];
  },
): StartRunInput {
  const selection = readSelection?.(config) ?? localCliSelectionFromConfig({ config });
  const { model: _oldModel, reasoning: _oldReasoning, ...context } = runInput.context ?? {};
  // A pending picker save stays authoritative even if a refresh still sees the old
  // ledger effort. Missing effort retains the existing fallback for legacy callers.
  const reasoning = selection.reasoning ?? selectedLocalCliReasoning({
    ...config, localCli: { ...config.localCli, agentId: selection.agentId },
  });
  return {
    ...runInput,
    agentId: selection.agentId,
    context: { ...context, ...(selection.model ? { model: selection.model } : {}), ...(reasoning ? { reasoning } : {}) },
  };
}

/** Keeps startup display state in the dock's hooks layer without rebuilding the transport. */
export function useAssistantTransportSeam(
  input: AssistantTransportInput,
  { useTransport }: { useTransport: (input: AssistantTransportInput) => ChatTransport },
): { transport: ChatTransport; daemonStarting: boolean } {
  const [daemonStarting, setDaemonStarting] = useState(false);
  const transport = useTransport({ ...input, onDaemonStartingChange: ({ starting }) => setDaemonStarting(starting) });
  return { transport, daemonStarting };
}
