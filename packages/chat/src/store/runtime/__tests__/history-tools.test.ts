import { describe, expect, it } from 'vitest';
import type { ToolExecutionContext } from '@jini-ai/core';
import type { ChatHistoryStore, ChatHistoryReader } from '../../ports.js';
import { buildAssistantHistoryRegistrations, HISTORY_TOTAL_CHAR_CAP, HISTORY_MESSAGE_CHAR_CAP } from '../history-tools.js';

function harness({ history, exists = true }: { history?: ChatHistoryReader; exists?: boolean }, options: Parameters<typeof buildAssistantHistoryRegistrations>[1] = {}) {
  const callers: string[] = [];
  const getCalls: string[] = [];
  const store: ChatHistoryStore = {
    ...(history ? { history } : {}),
    get: async ({ id }) => { getCalls.push(id); return exists ? { id, title: null, titleSource: 'fallback', messageCount: 1, createdAt: 0, updatedAt: 0 } : null; },
    list: async () => [], messages: async () => [], create: async () => { throw new Error('unexpected write'); },
    rename: async () => null, touch: async () => {}, delete: async () => {}, appendMessage: async () => null,
  };
  const tools = buildAssistantHistoryRegistrations({ ports: { getStore: async ({ principalId }) => { callers.push(principalId); return store; } } }, options);
  return { tools, callers, getCalls, call: (id: string, input: unknown) => tools.find(tool => tool.descriptor.id === id)!.handler({
    input, principal: { id: 'authenticated-owner' }, executionId: 'exec', run: { id: 'run' }, signal: new AbortController().signal,
  } as ToolExecutionContext) };
}
function reader(messages: Awaited<ReturnType<ChatHistoryReader['read']>>['messages'] = []): ChatHistoryReader {
  return { list: async () => [], read: async () => ({ messages, hasMore: false }) };
}

describe('model-facing chat history tools', () => {
  it('uses execution identity, rejects identity injection, and refuses foreign/missing chats identically', async () => {
    const h = harness({ history: reader(), exists: false });
    await h.call('assistant_chats_list', {});
    expect(h.callers).toEqual(['authenticated-owner']);
    await expect(h.call('assistant_chats_list', { userId: 'other' })).rejects.toThrow('Unexpected chat history input');
    await expect(h.call('assistant_chat_read', { chatId: 'foreign', ownerId: 'other' })).rejects.toThrow('Unexpected chat history input');
    for (const chatId of ['foreign', 'missing']) await expect(h.call('assistant_chat_read', { chatId })).rejects.toThrow('Chat is unavailable to this caller');
    expect(h.getCalls).toEqual(['foreign', 'missing']);
    expect(h.callers).toHaveLength(3);
  });

  it('redacts historical titles and both roles before caps; skips attachment and tool payloads', async () => {
    const secret = 'sk-' + 'a'.repeat(32);
    const history = reader([{ id: 'm', position: 0, role: 'assistant', content: `echo ${secret}`,
      attachments: [{ path: secret, name: secret, kind: 'image' }], events: [
        { kind: 'tool_use', id: 'a', name: 'credential_save', input: { token: secret } },
        { kind: 'tool_result', toolUseId: 'a', content: secret, isError: false },
        { kind: 'tool_use', id: 'b', name: 'web_fetch', input: secret },
        { kind: 'tool_result', toolUseId: 'b', content: secret, isError: true },
        { kind: 'tool_use', id: 'c', name: 'interrupted', input: secret },
      ] }]);
    history.list = async () => [{ id: 'chat', title: secret, titleSource: 'manual', createdAt: 0, updatedAt: 1, messageCount: 1, firstUserLine: `before ${secret}\nsecond` }];
    const h = harness({ history });
    const list = await h.call('assistant_chats_list', {}) as any;
    expect(list.chats[0]).toMatchObject({ title: '[token removed]', firstUserLine: 'before [token removed]' });
    const read = await h.call('assistant_chat_read', { chatId: 'chat', includeToolEvents: true }) as any;
    expect(read.messages[0]).toMatchObject({ content: 'echo [token removed]', toolEvents: [
      { name: 'credential_save', outcome: 'succeeded' }, { name: 'web_fetch', outcome: 'failed' }, { name: 'interrupted', outcome: 'unknown' },
    ] });
    expect(JSON.stringify({ list, read })).not.toContain(secret);
    expect(read.messages[0]).not.toHaveProperty('attachments');
    expect(read.messages[0]).not.toHaveProperty('events');
    const noEvents = await h.call('assistant_chat_read', { chatId: 'chat' }) as any;
    expect(noEvents.messages[0]).not.toHaveProperty('toolEvents');
  });

  it('passes search and paging options to the persistence owner, and retains continuation', async () => {
    const inputs: unknown[] = [];
    const history: ChatHistoryReader = {
      list: async (required, optional) => { inputs.push([required, optional]); return []; },
      read: async (required, optional) => { inputs.push([required, optional]); return { messages: [{ id: 'm', role: 'user', content: 'hello', position: 7 }], hasMore: true }; },
    };
    const h = harness({ history });
    await h.call('assistant_chats_list', { query: 'theme', limit: 3 });
    expect(await h.call('assistant_chat_read', { chatId: 'chat', fromPosition: 7, limit: 1 })).toMatchObject({ nextPosition: 8, firstPosition: 7, hasMore: true, hasMoreBefore: false, truncated: true });
    expect(inputs).toEqual([[{}, { query: 'theme', limit: 3 }], [{ chatId: 'chat' }, { fromPosition: 7, limit: 1, includeToolEvents: false }]]);
    expect(await h.call('assistant_chat_read', { chatId: 'chat' })).toMatchObject({ hasMore: false, hasMoreBefore: true });
  });

  it('omits absent persistence options while preserving empty search and position zero', async () => {
    const inputs: unknown[] = [];
    const history: ChatHistoryReader = {
      list: async (required, optional) => { inputs.push([required, optional]); return []; },
      read: async (required, optional) => { inputs.push([required, optional]); return { messages: [], hasMore: false }; },
    };
    const h = harness({ history });
    for (const input of [{}, { query: undefined }, { query: '' }]) await h.call('assistant_chats_list', input);
    for (const input of [{ chatId: 'chat' }, { chatId: 'chat', fromPosition: undefined }, { chatId: 'chat', fromPosition: 0 }]) {
      await h.call('assistant_chat_read', input);
    }
    // Exact keys matter to persistence adapters; undefined is not an optional property's absence.
    expect(inputs).toStrictEqual([
      [{}, { limit: 20 }], [{}, { limit: 20 }], [{}, { query: '', limit: 20 }],
      [{ chatId: 'chat' }, { limit: 50, includeToolEvents: false }],
      [{ chatId: 'chat' }, { limit: 50, includeToolEvents: false }],
      [{ chatId: 'chat' }, { fromPosition: 0, limit: 50, includeToolEvents: false }],
    ]);
  });

  it('caps per-message and serialized total size, with no skipped continuation position', async () => {
    const messages = Array.from({ length: 10 }, (_, position) => ({ id: `m${position}`, role: 'assistant' as const, position, content: 'x'.repeat(10_000) }));
    const h = harness({ history: reader(messages) });
    const page = await h.call('assistant_chat_read', { chatId: 'chat', fromPosition: 0 }) as any;
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(HISTORY_TOTAL_CHAR_CAP);
    expect(page.messages.length).toBeGreaterThan(1);
    expect(page.messages.length).toBeLessThan(10);
    expect(page.messages.every((m: any) => JSON.stringify(m).length <= HISTORY_MESSAGE_CHAR_CAP && m.truncated)).toBe(true);
    expect(page.nextPosition).toBe(page.messages.length);
    expect(page.hasMore).toBe(true);
    const tail = await h.call('assistant_chat_read', { chatId: 'chat' }) as any;
    expect(tail.messages.at(-1).position).toBe(9);
    expect(tail.firstPosition).toBeGreaterThan(0);
    expect(tail.hasMoreBefore).toBe(true);
    const escaped = harness({ history: reader([{ id: 'm', position: 0, role: 'user', content: '\u0000'.repeat(20_000) }]) });
    const single = await escaped.call('assistant_chat_read', { chatId: 'chat', fromPosition: 0 }) as any;
    expect(JSON.stringify(single).length).toBeLessThanOrEqual(HISTORY_TOTAL_CHAR_CAP);
    expect(JSON.stringify(single.messages[0]).length).toBeLessThanOrEqual(HISTORY_MESSAGE_CHAR_CAP);
    expect(single.messages).toHaveLength(1);
    expect(single.messages[0].truncated).toBe(true);
  });

  it('redacts before cutting a credential at the character cap and bounds event summaries', async () => {
    const secret = 'sk-' + 'b'.repeat(32);
    const events = Array.from({ length: 60 }, (_, i) => ({ kind: 'tool_use' as const, id: `${i}`, name: `tool_${i}`, input: secret }));
    const h = harness({ history: reader([{ id: 'm', role: 'user', position: 0, content: ' '.repeat(HISTORY_MESSAGE_CHAR_CAP - 4) + secret, events }]) });
    const result = await h.call('assistant_chat_read', { chatId: 'chat', includeToolEvents: true }) as any;
    expect(result.messages[0].content).not.toContain('sk-');
    expect(result.messages[0].toolEvents).toHaveLength(50);
    expect(result.messages[0].truncated).toBe(true);
  });

  it('validates ranges/types and fails closed for hosts without the bounded reader', async () => {
    const h = harness({ history: reader() });
    for (const input of [{ limit: 0 }, { limit: 51 }, { limit: null }, { query: 2 }, { query: 'x'.repeat(201) }]) await expect(h.call('assistant_chats_list', input)).rejects.toThrow();
    for (const input of [{}, { chatId: '' }, { chatId: 'x'.repeat(129) }, { chatId: 'chat', limit: 101 }, { chatId: 'chat', fromPosition: -1 }, { chatId: 'chat', fromPosition: 0.5 }, { chatId: 'chat', includeToolEvents: 'yes' }]) await expect(h.call('assistant_chat_read', input)).rejects.toThrow();
    expect(h.callers).toEqual([]);
    const unavailable = harness({});
    await expect(unavailable.call('assistant_chats_list', {})).rejects.toThrow('unavailable');
    await expect(unavailable.call('assistant_chat_read', { chatId: 'chat' })).rejects.toThrow('unavailable');
  });

  it('supports a stricter redaction port for all model-facing text', async () => {
    const h = harness({ history: reader([{ id: 'm', position: 0, role: 'assistant', content: 'host-private' }]) }, { redact: ({ text }) => ({ text: text.replaceAll('host-private', '[hidden]'), secretRedacted: true, count: 1 }) });
    expect(await h.call('assistant_chat_read', { chatId: 'chat' })).toMatchObject({ messages: [{ content: '[hidden]' }] });
    expect(h.tools.every(tool => tool.descriptor.metadata?.approval?.class === 'read')).toBe(true);
  });

  it('bounds escaped tool names and list summaries, and handles malformed events and empty chats', async () => {
    const events = Array.from({ length: 55 }, (_, i) => ({ kind: 'tool_use' as const, id: `${i}`, name: '\u0000'.repeat(200), input: 'never returned' }));
    const history = reader([{ id: 'm', role: 'assistant', position: 0, content: '', events }]);
    history.list = async () => Array.from({ length: 50 }, (_, i) => ({ id: `${i}`, title: '\u0000'.repeat(600), titleSource: 'manual' as const,
      createdAt: 0, updatedAt: i, messageCount: 1, firstUserLine: '\u0000'.repeat(600) }));
    const h = harness({ history });
    const page = await h.call('assistant_chat_read', { chatId: 'chat', includeToolEvents: true }) as any;
    expect(JSON.stringify(page.messages[0]).length).toBeLessThanOrEqual(HISTORY_MESSAGE_CHAR_CAP);
    expect(page.messages[0].truncated).toBe(true);
    expect(page.messages[0].toolEvents.length).toBeLessThan(50);
    const list = await h.call('assistant_chats_list', { limit: 50 }) as any;
    expect(JSON.stringify(list).length).toBeLessThanOrEqual(HISTORY_TOTAL_CHAR_CAP);
    expect(list.truncated).toBe(true);
    const malformed = harness({ history: reader([{ id: 'm', role: 'assistant', position: 0, content: 'hello', events: {} as never }]) });
    expect(await malformed.call('assistant_chat_read', { chatId: 'chat', includeToolEvents: true })).toMatchObject({ messages: [{ toolEvents: [] }] });
    const empty = await harness({ history: reader() }).call('assistant_chat_read', { chatId: 'chat', fromPosition: 0 }) as any;
    expect(empty).toMatchObject({ messages: [], hasMore: false, truncated: false });
    expect(empty).not.toHaveProperty('nextPosition');
  });
});
