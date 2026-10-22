import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';
import type { ChatMessage } from '../../../core/messages.js';
import type { AssistantConversation } from '../../../core/assistant-client/messages.js';
import { createAssistantChatsClient } from '../assistant-chats.js';
import type { AssistantChatsPort } from '../assistant-chats-contracts.js';
import type { LastConversationStore } from '../last-conversation-store.js';

/**
 * Hand-written fakes for `useAssistantChats` tests: an in-memory conversation backend whose every
 * method is a spy (so a test can hold one call open with `mockImplementationOnce`), a status-bearing
 * error, a controllable promise, and an in-memory last-conversation store.
 */
export class StatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export function conv(id: string, title: string | null = null): AssistantConversation {
  return { id, title, titleSource: 'fallback', messageCount: 0, createdAt: 0, updatedAt: 0 };
}

export const userTurn = (id: string, content = `said ${id}`): ChatMessage => ({ id, role: 'user', content });
export const reply = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: 'assistant', content: `reply ${id}`, runStatus: 'succeeded', ...extra });

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export function createFakePort(seed: { conversations?: AssistantConversation[]; messages?: Record<string, ChatMessage[]> } = {}) {
  let conversations = [...(seed.conversations ?? [])];
  const stored = new Map(Object.entries(seed.messages ?? {}));
  let created = 0;
  const port = {
    listConversations: vi.fn(async (_r: Record<string, never>, _o: Record<string, never>) => conversations.map((c) => ({ ...c }))),
    createConversation: vi.fn(async (_r: { firstMessage?: string }, _o: Record<string, never>) => {
      created += 1;
      const conversation = conv(`new-${created}`);
      conversations = [conversation, ...conversations];
      return conversation;
    }),
    renameConversation: vi.fn(async ({ id, title }: { id: string; title: string }, _o: Record<string, never>) => {
      conversations = conversations.map((c) => (c.id === id ? { ...c, title, titleSource: 'manual' as const } : c));
    }),
    deleteConversation: vi.fn(async ({ id }: { id: string }, _o: Record<string, never>) => {
      conversations = conversations.filter((c) => c.id !== id);
    }),
    loadMessages: vi.fn(async ({ conversationId }: { conversationId: string }, _o: Record<string, never>) => stored.get(conversationId) ?? []),
    saveMessage: vi.fn(async (_r: { conversationId: string; message: ChatMessage }, _o: Record<string, never>) => {}),
  } satisfies AssistantChatsPort;
  return {
    port,
    /** Every `saveMessage` call as `conversationId/messageId[:runId]@runStatus`. */
    writes: () => port.saveMessage.mock.calls.map(([{ conversationId, message }]) =>
      `${conversationId}/${message.id}${message.runId ? `:${message.runId}` : ''}${message.runStatus ? `@${message.runStatus}` : ''}`),
    serverHas: (next: AssistantConversation[]) => { conversations = next; },
  };
}

export type FakePort = ReturnType<typeof createFakePort>['port'];

export function makeClient() {
  const sleep = vi.fn(async (_required: { delayMs: number }, _o: Record<string, never>) => {});
  const reportPermanent = vi.fn();
  const client = createAssistantChatsClient({ ports: {
    statusOf: ({ error }) => (error instanceof StatusError ? error.status : undefined),
    sleep,
    reportPermanent,
    requestRunPrefixes: ['byok:', 'agui:'],
  } });
  return { client, sleep, reportPermanent };
}

export function memoryStore(initial: string | null = null): LastConversationStore & { value: () => string | null } {
  let value = initial;
  return {
    value: () => value,
    read: vi.fn(() => value),
    write: vi.fn((id: string) => { value = id; }),
    clear: vi.fn(() => { value = null; }),
  };
}

/** Lets every queued promise continuation (and the React updates they cause) run. */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

export async function mount(
  port: FakePort,
  { client = makeClient().client, lastConversation }: { client?: ReturnType<typeof makeClient>['client']; lastConversation?: LastConversationStore } = {},
) {
  const hook = renderHook(() => client.useAssistantChats({ port }, lastConversation ? { lastConversation } : {}));
  await waitFor(() => expect(port.listConversations).toHaveBeenCalled());
  await settle();
  return hook;
}
