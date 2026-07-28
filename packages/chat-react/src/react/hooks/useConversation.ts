/**
 * @module useConversation
 *
 * Owns the message array, an optimistic user-message append, a scroll-intent
 * flag, and the active conversation id. Reconciles `useRunStream`'s live
 * `AgentEvent[]` into the streaming assistant message's `events`/`content`
 * as they arrive, and finalizes it once the run reaches a terminal status.
 * Per `foundry/docs/jini-port/recon/r4b-webui-design.md` §4.
 *
 * Mutations reach the transport only through the composed `useRunStream` —
 * this hook never imports `fetch`/`EventSource` itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent, ChatAttachment, ChatMessage, RunStatus } from '@jini-ai/chat-core';
import { isTerminalRunStatus } from '@jini-ai/chat-core';
import type { ChatTransport, RunContext } from '../../transport.js';
import { useRunStream } from './useRunStream.js';

export interface UseConversationOptions {
  transport: ChatTransport;
  initialMessages?: ChatMessage[];
  conversationId?: string | null;
  agentId?: string;
  /** Defaults to a `crypto.randomUUID()`-based id generator when available, else a counter. */
  createMessageId?: () => string;
}

export interface SendMessageOptions {
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

function assistantContentFromEvents(events: AgentEvent[]): string {
  let out = '';
  for (const ev of events) {
    if (ev.kind === 'text') out += ev.text;
  }
  return out;
}

export function useConversation(options: UseConversationOptions): UseConversationResult {
  const { transport, conversationId = null, agentId, createMessageId = defaultCreateMessageId } = options;
  const [messages, setMessagesState] = useState<ChatMessage[]>(options.initialMessages ?? []);
  const [scrollIntent, setScrollIntent] = useState(false);
  const run = useRunStream(transport);
  // The assistant message id the currently-active run is writing into.
  const activeAssistantIdRef = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const setMessages = useCallback((updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setMessagesState((prev) => (typeof updater === 'function' ? (updater as (p: ChatMessage[]) => ChatMessage[])(prev) : updater));
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
        let runStatus: RunStatus = m.runStatus!;
        if (run.status === 'streaming') runStatus = 'running';
        else if (run.status === 'done') runStatus = 'succeeded';
        else if (run.status === 'error') runStatus = 'failed';
        else if (run.status === 'canceled') runStatus = 'canceled';
        const nextRunId = run.runId ?? m.runId;
        return {
          ...m,
          ...(nextRunId !== undefined ? { runId: nextRunId } : {}),
          events: run.events,
          content: assistantContentFromEvents(run.events),
          runStatus,
          ...(isTerminalRunStatus(runStatus) ? { endedAt: Date.now() } : {}),
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
      const userMessage: ChatMessage = {
        id: createMessageId(),
        role: 'user',
        content,
        createdAt: Date.now(),
        ...(sendOptions.attachments ? { attachments: sendOptions.attachments } : {}),
      };
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
      const history = [...messagesRef.current, userMessage];
      setMessagesState([...history, assistantMessage]);
      setScrollIntent(true);
      await run.start({
        history,
        ...(resolvedAgentId !== undefined ? { agentId: resolvedAgentId } : {}),
        conversationId,
        ...(sendOptions.attachments !== undefined ? { attachments: sendOptions.attachments } : {}),
        ...(sendOptions.context !== undefined ? { context: sendOptions.context } : {}),
      });
    },
    [agentId, conversationId, createMessageId, run],
  );

  const retry = useCallback(
    async (assistantMessageId: string) => {
      const idx = messagesRef.current.findIndex((m) => m.id === assistantMessageId);
      if (idx <= 0) return;
      const priorUser = messagesRef.current[idx - 1];
      if (!priorUser || priorUser.role !== 'user') return;
      const history = messagesRef.current.slice(0, idx);
      const resetAssistant: ChatMessage = { ...messagesRef.current[idx]!, content: '', events: [], runStatus: 'queued' };
      activeAssistantIdRef.current = resetAssistant.id;
      setMessagesState([...history, resetAssistant]);
      setScrollIntent(true);
      const resolvedAgentId = resetAssistant.agentId ?? agentId;
      await run.start({ history, ...(resolvedAgentId !== undefined ? { agentId: resolvedAgentId } : {}), conversationId });
    },
    [agentId, conversationId, run],
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
