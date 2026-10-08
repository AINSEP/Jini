import { redactUserHistory, redactUserMessage, type UserTextRedactionOptions } from '../../core/user-text-redaction.js';
import { preserveAssistantContent, mergeRunEvents } from '../../core/durable-projection.js';
/**
 * @module useConversation
 *
 * Owns the message array, an optimistic user-message append, a scroll-intent
 * flag, and the active conversation id. Reconciles `useRunStream`'s live
 * `AgentEvent[]` into the streaming assistant message's `events`/`content`
 * as they arrive, and finalizes it once the run reaches a terminal status.
 * Per `ADS-memory/reports/jini-port/recon/r4b-webui-design.md` §4.
 *
 * Mutations reach the transport only through the composed `useRunStream` —
 * this hook never imports `fetch`/`EventSource` itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent, ChatAttachment, ChatMessage, ChatRunStatus } from '../../core/index.js';
import { assistantContentFromEvents, isTerminalRunStatus } from '../../core/index.js';
import type { ChatTransport, RunContext } from '../../core/index.js';
import { useRunStream } from './useRunStream.js';

export interface UseConversationOptions extends UserTextRedactionOptions {
  transport: ChatTransport;
  initialMessages?: ChatMessage[];
  conversationId?: string | null;
  agentId?: string;
  /** Defaults to a `crypto.randomUUID()`-based id generator when available, else a counter. */
  createMessageId?: () => string;
}

export interface SendMessageOptions {
  /** Non-secret signal from a composer that already sanitized the content before this boundary. */
  secretRedaction?: ChatMessage['secretRedaction'];
  attachments?: ChatAttachment[];
  context?: RunContext;
  agentId?: string;
}

export interface UseConversationResult {
  messages: ChatMessage[];
  conversationId: string | null;
  isStreaming: boolean;
  error: Error | null;
  /** `true` when new content just arrived and nothing has told the hook the user already scrolled away — a `<MessageList>` reads this to decide whether to auto-scroll. */
  scrollIntent: boolean;
  sendMessage: (content: string, options?: SendMessageOptions) => Promise<void>;
  cancel: () => void;
  /** Re-send the same content as a failed/canceled assistant message's preceding user turn. */
  retry: (assistantMessageId: string) => Promise<void>;
  setMessages: (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  /** Called by `<MessageList>` once it has scrolled to the newest content. */
  acknowledgeScroll: () => void;
  /** Called by `<MessageList>` when the user manually scrolls up, so the next event doesn't yank them back down. */
  suppressScroll: () => void;
}

let fallbackIdCounter = 0;
function defaultCreateMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  fallbackIdCounter += 1;
  return `msg-${Date.now()}-${fallbackIdCounter}`;
}

export function useConversation(options: UseConversationOptions): UseConversationResult {
  const { transport, conversationId = null, agentId, createMessageId = defaultCreateMessageId } = options;
  const [messages, setMessagesState] = useState<ChatMessage[]>(() => redactUserHistory(
    { history: options.initialMessages ?? [] },
    { ...(options.redactUserText ? { redactUserText: options.redactUserText } : {}) },
  ));
  const [scrollIntent, setScrollIntent] = useState(false);
  const run = useRunStream({ transport });
  // The assistant message id the currently-active run is writing into.
  const activeAssistantIdRef = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const setMessages = useCallback((updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setMessagesState((prev) => (typeof updater === 'function' ? (updater as (p: ChatMessage[]) => ChatMessage[])(prev) : updater));
  }, []);

  /**
   * The mount-time snapshot of `initialMessages`, captured once — the same "read once, never react
   * to a later identity change" contract `messages`'s own `useState` initializer above already has
   * for this same prop. A host's `initialMessages` array is expected to be a fresh identity on every
   * render (`ChatPane` remounts the whole pane with a fresh `key` on a real conversation switch
   * rather than pushing a new array into a live one), so depending on it directly in the effect below
   * would re-fire on every render of a host that does not itself memoize the prop.
   */
  const initialMessagesRef = useRef(options.initialMessages);

  /**
   * Resumes an interrupted run on mount instead of leaving it frozen forever.
   *
   * `run.reattach` (`useRunStream.ts`) has existed since 2026-07-29 and is fully implemented —
   * generation-guarded against double-subscription, abortable, race-safe — but until this effect,
   * nothing in this package or any host ever called it. The gap it left: once a browser's live
   * subscription to a run is torn down for ANY reason (this hook unmounting, a host remount, an HMR
   * reload, a daemon restart), the run keeps going server-side and nothing ever tells the browser
   * about it again — no more events, no more persistence, no error, just a frozen pane. The 2026-09-11 incident showed that teardown without remount reattachment
   * leaves a running server task invisible to the browser. Reattaching needs a durably-recorded, non-terminal `runId` to find
   * in `initialMessages` in the first place — the host is responsible for that half by persisting the run stub before starting the subscription.
   *
   * Mount-only (`[]` deps), by design: `useConversation` owns exactly one `useRunStream` instance for
   * its whole lifetime, and a host that wants a different transcript remounts the pane with a fresh
   * `key` rather than pushing a new `initialMessages` into a live one (see `initialMessagesRef`'s own
   * doc) — so "the moment this hook mounts" IS "the moment a stale subscription needs recovering",
   * and there is no later point in this hook's life that also needs this check.
   *
   * `activeAssistantIdRef.current` is set BEFORE calling `reattach`, not after: the reconciliation
   * effect below (`applyRunToAssistantMessage`) no-ops whenever that ref is `null` — a reattach whose
   * first event arrived before this assignment landed would be silently dropped on the floor instead
   * of reaching the message it belongs to.
   *
   * A message with a `runId` but no `runStatus` at all is treated as nothing to reattach to, not as
   * "assume non-terminal" — `useConversation`'s own reconciliation always writes both together, so
   * the combination only arises from data this hook did not itself produce (a host's legacy rows, a
   * different producer entirely), and there is no positive evidence there of an in-flight run worth
   * the network round trip.
   */
  useEffect(() => {
    const last = initialMessagesRef.current?.at(-1);
    if (!last || last.role !== 'assistant') return;
    if (last.runId === undefined || last.runStatus === undefined) return;
    if (isTerminalRunStatus({ status: last.runStatus })) return;
    activeAssistantIdRef.current = last.id;
    void run.reattach(last.runId, last.events);
    // Mount-only: see this effect's own doc for why `run` is deliberately not listed — it is a
    // `useCallback` (`useRunStream.ts`), stable for this hook instance's whole lifetime, so omitting
    // it changes nothing about correctness.
  }, []);

  const applyRunToAssistantMessage = useCallback(() => {
    const assistantId = activeAssistantIdRef.current;
    if (!assistantId) return;
    setMessagesState((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId) return m;
        // A plain if/else chain (not a nested ternary) — deliberately, so
        // each of the four mapped statuses is its own independently
        // trackable branch under coverage instrumentation. The initial
        // value is asserted non-null: this reconciliation effect only ever
        // runs after `sendMessage`/`retry` has called `run.start()`/
        // `reattach` (both set the message's `runStatus: 'queued'` via
        // `activeAssistantIdRef` first), so `m.runStatus` is always defined
        // and `run.status` is never `'idle'` by the time this callback
        // fires — one of the four branches below always reassigns it.
        let runStatus: ChatRunStatus = m.runStatus!;
        if (run.status === 'streaming') runStatus = 'running';
        else if (run.status === 'done') runStatus = 'succeeded';
        else if (run.status === 'error') runStatus = 'failed';
        else if (run.status === 'canceled') runStatus = 'canceled';
        const nextRunId = run.runId ?? m.runId;
        return {
          ...m,
          ...(nextRunId !== undefined ? { runId: nextRunId } : {}),
          events: mergeRunEvents({ saved: m.events, incoming: run.events }, {}),
          // Replayed completion prefixes cannot erase a saved interrupted segment.
          content: preserveAssistantContent({ saved: m.content, incoming: assistantContentFromEvents({ events: run.events }) }, {}),
          runStatus,
          ...(isTerminalRunStatus({ status: runStatus }) ? { endedAt: Date.now() } : {}),
        };
      }),
    );
    setScrollIntent(true);
  }, [run.events, run.runId, run.status]);

  // Reconcile the live run's events onto the streaming assistant message
  // whenever any of them changes identity. `run.runId` must be included:
  // an event can arrive (and get reconciled) before `start()`'s promise
  // resolves with the real id, and if the id then resolves with no further
  // event/status change, omitting it here would leave the message's runId
  // permanently unset.
  useEffect(() => {
    applyRunToAssistantMessage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.events, run.status, run.runId]);

  const sendMessage = useCallback(
    async (content: string, sendOptions: SendMessageOptions = {}) => {
      const userMessage: ChatMessage = redactUserMessage<ChatMessage>({ message: {
        id: createMessageId(),
        role: 'user',
        content,
        createdAt: Date.now(),
        ...(sendOptions.secretRedaction ? { secretRedaction: sendOptions.secretRedaction } : {}),
        ...(sendOptions.attachments ? { attachments: sendOptions.attachments } : {}),
      } }, options).message;
      const resolvedAgentId = sendOptions.agentId ?? agentId;
      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: 'assistant',
        content: '',
        ...(resolvedAgentId !== undefined ? { agentId: resolvedAgentId } : {}),
        runStatus: 'queued',
        createdAt: Date.now(),
        startedAt: Date.now(),
      };
      activeAssistantIdRef.current = assistantMessage.id;
      const history = redactUserHistory({ history: [...messagesRef.current, userMessage] }, options);
      // Functional, never `[...history, assistantMessage]`: `messagesRef` is the last RENDER's
      // snapshot, and a host that sends from an effect (`useChatPane`'s queued-prompt flush) runs in
      // the same commit as the reconciliation effect that just marked the previous turn terminal.
      // Replacing the array with the snapshot threw that pending update away, leaving the finished
      // turn `running` forever — and never persisted, since hosts persist only terminal turns
      // (host stuck-chat investigation, 2026-09-27).
      setMessagesState((prev) => [...prev, userMessage, assistantMessage]);
      setScrollIntent(true);
      await run.start({
        assistantMessageId: assistantMessage.id,
        history,
        ...(resolvedAgentId !== undefined ? { agentId: resolvedAgentId } : {}),
        conversationId,
        ...(sendOptions.attachments !== undefined ? { attachments: sendOptions.attachments } : {}),
        ...(sendOptions.context !== undefined ? { context: sendOptions.context } : {}),
      });
    },
    [agentId, conversationId, createMessageId, run, options.redactUserText, options.onSecretRedacted],
  );

  const retry = useCallback(
    async (assistantMessageId: string) => {
      const idx = messagesRef.current.findIndex((m) => m.id === assistantMessageId);
      if (idx <= 0) return;
      const priorUser = messagesRef.current[idx - 1];
      if (!priorUser || priorUser.role !== 'user') return;
      const history = redactUserHistory({ history: messagesRef.current.slice(0, idx) }, options);
      const resetAssistant: ChatMessage = { ...messagesRef.current[idx]!, content: '', events: [], runStatus: 'queued' };
      activeAssistantIdRef.current = resetAssistant.id;
      // Functional for the same reason as `sendMessage`'s: keep a just-queued terminal update.
      setMessagesState((prev) => {
        const at = prev.findIndex((m) => m.id === assistantMessageId);
        return at < 0 ? [...history, resetAssistant] : [...prev.slice(0, at), resetAssistant];
      });
      setScrollIntent(true);
      const resolvedAgentId = resetAssistant.agentId ?? agentId;
      // `priorUser`'s attachments go back out with the retry. They were located above and then
      // dropped: `sendMessage` forwards `attachments` to `run.start`, this path did not, so
      // retrying an image or file prompt re-sent the TEXT alone. The model then answered a question
      // about a picture it could no longer see — and because the transcript still renders the
      // attachment beside the user turn, the failure reads as the model ignoring it rather than as
      // the client never having sent it.
      await run.start({
        assistantMessageId: resetAssistant.id,
        history,
        ...(resolvedAgentId !== undefined ? { agentId: resolvedAgentId } : {}),
        conversationId,
        ...(priorUser.attachments !== undefined ? { attachments: priorUser.attachments } : {}),
      });
    },
    [agentId, conversationId, run, options.redactUserText, options.onSecretRedacted],
  );

  const cancel = useCallback(() => run.cancel(), [run]);
  const acknowledgeScroll = useCallback(() => setScrollIntent(false), []);
  const suppressScroll = useCallback(() => setScrollIntent(false), []);

  return useMemo(
    () => ({
      messages,
      conversationId,
      isStreaming: run.isStreaming,
      error: run.error,
      scrollIntent,
      sendMessage,
      cancel,
      retry,
      setMessages,
      acknowledgeScroll,
      suppressScroll,
    }),
    [messages, conversationId, run.isStreaming, run.error, scrollIntent, sendMessage, cancel, retry, setMessages, acknowledgeScroll, suppressScroll],
  );
}
