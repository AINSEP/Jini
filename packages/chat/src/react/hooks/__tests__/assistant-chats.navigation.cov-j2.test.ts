import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusError, conv, createFakePort, deferred, memoryStore, mount, reply, settle, userTurn } from './assistant-chats.fixtures.js';

/**
 * `useAssistantChats` — which conversation is open, what it shows, and the list beside it: the
 * mount-time restore, select/create/remove/rename, and the stale-response races each one guards.
 */
describe('mount', () => {
  it('reads the list once and opens an empty new chat when nothing is remembered', async () => {
    const { port } = createFakePort({ conversations: [conv('a')] });
    const { result } = await mount(port);
    expect(port.listConversations).toHaveBeenCalledTimes(1);
    expect(result.current.conversations.map((c) => c.id)).toEqual(['a']);
    expect(result.current).toMatchObject({ activeId: null, paneKey: 'new', initialMessages: [] });
  });

  it('reopens the remembered conversation with its transcript, even when it is not the newest', async () => {
    const { port } = createFakePort({ conversations: [conv('a'), conv('b')], messages: { b: [userTurn('u1'), reply('r1')] } });
    const store = memoryStore('b');
    const { result } = await mount(port, { lastConversation: store });
    expect(result.current).toMatchObject({ activeId: 'b', paneKey: 'b' });
    expect(result.current.initialMessages.map((m) => m.id)).toEqual(['u1', 'r1']);
    expect(store.value()).toBe('b');
  });

  it('forgets a remembered conversation the list no longer has, and stays on a new chat', async () => {
    const { port } = createFakePort({ conversations: [conv('a')] });
    const store = memoryStore('gone');
    const { result } = await mount(port, { lastConversation: store });
    expect(store.value()).toBeNull();
    expect(result.current.activeId).toBeNull();
    expect(port.loadMessages).not.toHaveBeenCalled();
  });

  it('keeps the memory when the list read fails — a network blip is not a deletion', async () => {
    const { port } = createFakePort();
    port.listConversations.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const store = memoryStore('a');
    const { result } = await mount(port, { lastConversation: store });
    expect(store.value()).toBe('a');
    expect(result.current).toMatchObject({ activeId: null, conversations: [] });
  });

  it('does nothing extra for a store with nothing remembered', async () => {
    const { port } = createFakePort({ conversations: [conv('a')] });
    const store = memoryStore(null);
    const { result } = await mount(port, { lastConversation: store });
    expect(store.clear).not.toHaveBeenCalled();
    expect(result.current.activeId).toBeNull();
  });

  it('does not restore over a new chat the operator created before the list arrived', async () => {
    const { port } = createFakePort({ conversations: [conv('a')] });
    const list = deferred<ReturnType<typeof conv>[]>();
    port.listConversations.mockImplementationOnce(() => list.promise);
    const store = memoryStore('a');
    const { result } = await mount(port, { lastConversation: store });
    await act(async () => { await result.current.create({}); });
    await act(async () => { list.resolve([conv('a')]); });
    await settle();
    expect(result.current.activeId).toBe('new-1');
    expect(port.loadMessages).not.toHaveBeenCalled();
  });

  it('does not restore while a lazy adoption for typed text is still in flight', async () => {
    const { port } = createFakePort({ conversations: [conv('a')] });
    const list = deferred<ReturnType<typeof conv>[]>();
    port.listConversations.mockImplementationOnce(() => list.promise);
    port.createConversation.mockImplementationOnce(() => new Promise(() => {}));
    const { result } = await mount(port, { lastConversation: memoryStore('a') });
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1')] }));
    await act(async () => { list.resolve([conv('a')]); });
    await settle();
    expect(port.loadMessages).not.toHaveBeenCalled();
  });

  it('does not restore over a conversation the operator already adopted by typing', async () => {
    const { port } = createFakePort({ conversations: [conv('a')] });
    const list = deferred<ReturnType<typeof conv>[]>();
    port.listConversations.mockImplementationOnce(() => list.promise);
    const store = memoryStore('a');
    const { result } = await mount(port, { lastConversation: store });
    await act(async () => { await result.current.ensureConversationId({}); });
    expect(result.current.activeId).toBe('new-1');
    await act(async () => { list.resolve([conv('a')]); });
    await settle();
    expect(result.current.activeId).toBe('new-1');
    expect(port.loadMessages).not.toHaveBeenCalled();
  });

  it('does not forget a chat the operator opened while the list read was in flight', async () => {
    const { port } = createFakePort({ conversations: [conv('a')] });
    const list = deferred<ReturnType<typeof conv>[]>();
    port.listConversations.mockImplementationOnce(() => list.promise);
    const store = memoryStore('gone');
    const { result } = await mount(port, { lastConversation: store });
    act(() => result.current.select({ id: 'a' }));
    await settle();
    expect(store.value()).toBe('a');
    await act(async () => { list.resolve([conv('a')]); });
    await settle();
    expect(store.value()).toBe('a');
    expect(result.current.activeId).toBe('a');
  });
});

describe('select', () => {
  it('switches to an empty pane when the transcript fails to load', async () => {
    const { port } = createFakePort({ conversations: [conv('a')] });
    port.loadMessages.mockRejectedValueOnce(new Error('load failed'));
    const { result } = await mount(port);
    act(() => result.current.select({ id: 'a' }));
    await settle();
    expect(result.current).toMatchObject({ activeId: 'a', paneKey: 'a', initialMessages: [] });
  });

  it('never lands a slower load for a conversation the operator already left', async () => {
    const { port } = createFakePort({ conversations: [conv('a'), conv('b')], messages: { b: [userTurn('ub')] } });
    const slowA = deferred<ReturnType<typeof userTurn>[]>();
    port.loadMessages.mockImplementationOnce(() => slowA.promise);
    const { result } = await mount(port);
    act(() => result.current.select({ id: 'a' }));
    act(() => result.current.select({ id: 'b' }));
    await settle();
    await act(async () => { slowA.resolve([userTurn('ua')]); });
    await settle();
    expect(result.current.activeId).toBe('b');
    expect(result.current.initialMessages.map((m) => m.id)).toEqual(['ub']);
  });
});

describe('create', () => {
  it('opens a new conversation, remounts the pane, lists it first and remembers it', async () => {
    const { port } = createFakePort({ conversations: [conv('a')] });
    const store = memoryStore();
    const { result } = await mount(port, { lastConversation: store });
    await act(async () => { await result.current.create({}); });
    expect(result.current).toMatchObject({ activeId: 'new-1', paneKey: 'new-1', initialMessages: [] });
    expect(result.current.conversations.map((c) => c.id)).toEqual(['new-1', 'a']);
    expect(store.value()).toBe('new-1');
  });

  it('lists the row but keeps the operator where they went when they switched during the request', async () => {
    const { port } = createFakePort({ conversations: [conv('a')] });
    const creation = deferred<ReturnType<typeof conv>>();
    port.createConversation.mockImplementationOnce(() => creation.promise);
    const { result } = await mount(port);
    let created!: Promise<void>;
    act(() => { created = result.current.create({}); });
    act(() => result.current.select({ id: 'a' }));
    await settle();
    await act(async () => { creation.resolve(conv('late')); await created; });
    expect(result.current.activeId).toBe('a');
    expect(result.current.conversations.map((c) => c.id)).toEqual(['late', 'a']);
  });

  it('is not erased by an older list snapshot that lands after it', async () => {
    const { port } = createFakePort();
    const list = deferred<ReturnType<typeof conv>[]>();
    port.listConversations.mockImplementationOnce(() => list.promise);
    const { result } = await mount(port);
    await act(async () => { await result.current.create({}); });
    await act(async () => { list.resolve([]); });
    await settle();
    expect(result.current.conversations.map((c) => c.id)).toEqual(['new-1']);
  });
});

describe('remove', () => {
  it('re-reads the list and stays put when a conversation other than the open one is deleted', async () => {
    const { port } = createFakePort({ conversations: [conv('a'), conv('b')] });
    const { result } = await mount(port);
    act(() => result.current.select({ id: 'a' }));
    await settle();
    await act(async () => { await result.current.remove({ id: 'b' }); });
    expect(port.deleteConversation).toHaveBeenCalledWith({ id: 'b' }, {});
    expect(result.current.activeId).toBe('a');
    expect(result.current.conversations.map((c) => c.id)).toEqual(['a']);
  });

  it('lands on the next most recent chat, with its transcript, when the open one is deleted', async () => {
    const { port } = createFakePort({ conversations: [conv('a'), conv('b')], messages: { b: [userTurn('ub')] } });
    const { result } = await mount(port);
    act(() => result.current.select({ id: 'a' }));
    await settle();
    await act(async () => { await result.current.remove({ id: 'a' }); });
    await settle();
    expect(result.current).toMatchObject({ activeId: 'b', paneKey: 'b' });
    expect(result.current.initialMessages.map((m) => m.id)).toEqual(['ub']);
  });

  it('opens a fresh pane, forgets the memory and adopts a NEW conversation after deleting the last one', async () => {
    const { port, writes } = createFakePort({ conversations: [conv('a')] });
    const store = memoryStore();
    const { result } = await mount(port, { lastConversation: store });
    act(() => result.current.select({ id: 'a' }));
    await settle();
    await act(async () => { await result.current.remove({ id: 'a' }); });
    expect(result.current).toMatchObject({ activeId: null, paneKey: 'new-1', initialMessages: [] });
    expect(store.value()).toBeNull();

    act(() => result.current.onMessagesChange({ messages: [userTurn('u1')] }));
    await settle();
    expect(result.current.activeId).toBe('new-1');
    expect(writes()).toEqual(['new-1/u1']);
  });

  it('routes by the last committed list, not by a superseded snapshot that still names a deleted row', async () => {
    const { port, serverHas } = createFakePort({ conversations: [conv('a'), conv('b'), conv('c')] });
    const { result } = await mount(port);
    act(() => result.current.select({ id: 'a' }));
    await settle();

    // remove(a)'s own list read is held open, and will come back stale: it still has `c` first.
    const staleRead = deferred<ReturnType<typeof conv>[]>();
    port.listConversations.mockImplementationOnce(() => staleRead.promise);
    let removed!: Promise<void>;
    act(() => { removed = result.current.remove({ id: 'a' }); });
    await settle();

    // A newer mutation commits its own fresh read (which no longer has `c`) first.
    serverHas([conv('b')]);
    await act(async () => { await result.current.rename({ id: 'b', title: 'B' }); });
    await settle();

    await act(async () => { staleRead.resolve([conv('c'), conv('b')]); await removed; });
    await settle();
    expect(result.current.activeId).toBe('b');
    expect(result.current.conversations.map((c) => c.id)).toEqual(['b']);
  });
});

describe('rename', () => {
  it('shows the new title at once, writes it, and re-reads the list; other rows are untouched', async () => {
    const { port } = createFakePort({ conversations: [conv('a', 'old'), conv('b', 'other')] });
    const { result } = await mount(port);
    const patch = deferred();
    port.renameConversation.mockImplementationOnce(() => patch.promise);
    let renamed!: Promise<void>;
    act(() => { renamed = result.current.rename({ id: 'a', title: 'new' }); });
    expect(result.current.conversations).toMatchObject([{ id: 'a', title: 'new', titleSource: 'manual' }, { id: 'b', title: 'other' }]);
    await act(async () => { patch.resolve(); await renamed; });
    await settle();
    expect(port.renameConversation).toHaveBeenCalledWith({ id: 'a', title: 'new' }, {});
    expect(port.listConversations).toHaveBeenCalledTimes(2);
  });

  it('shows what the server has after a failed rename, without rejecting', async () => {
    const { port } = createFakePort({ conversations: [conv('a', 'old')] });
    port.renameConversation.mockRejectedValueOnce(new StatusError(500));
    const { result } = await mount(port);
    await act(async () => { await result.current.rename({ id: 'a', title: 'new' }); });
    await settle();
    expect(result.current.conversations[0]).toMatchObject({ title: 'old' });
  });

  it('keeps an in-flight title over a list read the server has not caught up with', async () => {
    const { port, serverHas } = createFakePort({ conversations: [conv('a', 'old'), conv('b', 'other')] });
    const { result } = await mount(port);
    act(() => result.current.select({ id: 'a' }));
    await settle();
    const patch = deferred();
    port.renameConversation.mockImplementationOnce(() => patch.promise);
    let renamed!: Promise<void>;
    act(() => { renamed = result.current.rename({ id: 'a', title: 'new' }); });

    // A message save completing elsewhere triggers an unrelated refresh while the PATCH is pending.
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1')] }));
    await settle();
    expect(port.listConversations).toHaveBeenCalledTimes(2);
    expect(result.current.conversations).toMatchObject([{ id: 'a', title: 'new' }, { id: 'b', title: 'other' }]);

    serverHas([conv('a', 'new'), conv('b', 'other')]);
    await act(async () => { patch.resolve(); await renamed; });
    await settle();
    expect(result.current.conversations[0]).toMatchObject({ title: 'new' });
  });

  it('a settling first rename does not drop a newer rename of the same conversation still in flight', async () => {
    const { port, serverHas } = createFakePort({ conversations: [conv('a', 'old')] });
    const { result } = await mount(port);
    const first = deferred();
    const second = deferred();
    port.renameConversation.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    let one!: Promise<void>;
    let two!: Promise<void>;
    act(() => { one = result.current.rename({ id: 'a', title: 'one' }); });
    act(() => { two = result.current.rename({ id: 'a', title: 'two' }); });

    serverHas([conv('a', 'one')]);
    await act(async () => { first.resolve(); await one; });
    await settle();
    expect(result.current.conversations[0]).toMatchObject({ title: 'two' });

    serverHas([conv('a', 'two')]);
    await act(async () => { second.resolve(); await two; });
    await settle();
    expect(result.current.conversations[0]).toMatchObject({ title: 'two' });
  });
});
