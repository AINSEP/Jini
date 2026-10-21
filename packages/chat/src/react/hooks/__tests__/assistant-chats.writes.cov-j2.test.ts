import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../core/messages.js';
import { StatusError, conv, createFakePort, deferred, makeClient, memoryStore, mount, reply, settle, userTurn } from './assistant-chats.fixtures.js';

/**
 * `useAssistantChats` — what gets written where: the delta-driven flush and its retry ladder, the
 * synchronous user-turn write a run start awaits, request-bound run stubs, and lazy adoption of a
 * conversation for a pane that has none yet.
 */
async function mountOn(id: string, seed: Parameters<typeof createFakePort>[0] = {}, client = makeClient()) {
  const fake = createFakePort({ conversations: [conv(id)], ...seed });
  const hook = await mount(fake.port, { client: client.client });
  act(() => hook.result.current.select({ id }));
  await settle();
  return { ...fake, ...hook, ...client };
}

describe('flush', () => {
  it('writes each settled message once, skips unsettled ones, and re-reads the list after a save', async () => {
    const { result, writes, port } = await mountOn('a');
    const listReads = port.listConversations.mock.calls.length;
    const pending: ChatMessage = { ...userTurn('u2'), inputPending: true };
    const running = reply('r2', { runStatus: 'running' });
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1'), reply('r1'), pending, running] }));
    await settle();
    expect(writes()).toEqual(['a/u1', 'a/r1@succeeded']);
    expect(port.listConversations.mock.calls.length).toBe(listReads + 1);

    act(() => result.current.onMessagesChange({ messages: [userTurn('u1'), reply('r1')] }));
    await settle();
    expect(writes()).toHaveLength(2);
  });

  it('does not re-send a write still in flight when re-selecting the conversation resets its written set', async () => {
    const { result, writes, port } = await mountOn('a');
    const slow = deferred();
    port.saveMessage.mockImplementationOnce(() => slow.promise);
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1')] }));
    await settle();
    act(() => result.current.select({ id: 'a' }));
    await settle();
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1')] }));
    await settle();
    expect(writes()).toEqual(['a/u1']);
    await act(async () => { slow.resolve(); });
  });

  it('rebuilds the written-set for a delta that arrives after its conversation was deleted but before the next one loads', async () => {
    const { result, writes, port } = await mountOn('a', { conversations: [conv('a'), conv('b')] });
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1')] }));
    await settle();
    const landing = deferred<ChatMessage[]>();
    port.loadMessages.mockImplementationOnce(() => landing.promise);
    await act(async () => { await result.current.remove({ id: 'a' }); });
    // `activeId` only moves when the landing chat's transcript is in hand, so this delta still
    // belongs to `a` — whose bookkeeping `remove` dropped — and is written from a fresh set.
    expect(result.current.activeId).toBe('a');
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1')] }));
    await settle();
    expect(writes()).toEqual(['a/u1', 'a/u1']);
    await act(async () => { landing.resolve([]); });
    await settle();
    expect(result.current.activeId).toBe('b');
  });

  it('survives a transient 503 by backing off and retrying', async () => {
    const { result, writes, port, sleep } = await mountOn('a');
    port.saveMessage.mockRejectedValueOnce(new StatusError(503));
    act(() => result.current.onMessagesChange({ messages: [reply('r1')] }));
    await settle();
    expect(sleep).toHaveBeenCalledWith({ delayMs: 1_000 }, {});
    expect(writes()).toEqual(['a/r1@succeeded', 'a/r1@succeeded']);
  });

  it('reports a permanent rejection once and never re-queues it on later deltas', async () => {
    const { result, writes, port, reportPermanent } = await mountOn('a');
    port.saveMessage.mockRejectedValueOnce(new StatusError(400));
    act(() => result.current.onMessagesChange({ messages: [reply('r1')] }));
    await settle();
    act(() => result.current.onMessagesChange({ messages: [reply('r1')] }));
    await settle();
    expect(writes()).toEqual(['a/r1@succeeded']);
    expect(reportPermanent).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'a', messageId: 'r1' }), {});
  });

  it('spends the whole ladder on a failing write, then releases it for the next delta to retry', async () => {
    const { result, writes, port, sleep } = await mountOn('a');
    port.saveMessage.mockRejectedValue(new TypeError('Failed to fetch'));
    act(() => result.current.onMessagesChange({ messages: [reply('r1')] }));
    await settle();
    expect(sleep.mock.calls.map(([{ delayMs }]) => delayMs)).toEqual([1_000, 3_000, 9_000]);
    expect(writes()).toHaveLength(4);

    port.saveMessage.mockResolvedValue(undefined);
    act(() => result.current.onMessagesChange({ messages: [reply('r1')] }));
    await settle();
    expect(writes()).toHaveLength(5);
  });

  it('re-reads the list when a write to the open conversation keeps 404ing', async () => {
    const { result, port } = await mountOn('a');
    port.saveMessage.mockRejectedValue(new StatusError(404));
    const listReads = port.listConversations.mock.calls.length;
    act(() => result.current.onMessagesChange({ messages: [reply('r1')] }));
    await settle();
    expect(port.listConversations.mock.calls.length).toBe(listReads + 1);
  });

  it('does not re-read for a 404ing write once the operator has moved to another conversation', async () => {
    const client = makeClient();
    const { result, port } = await mountOn('a', { conversations: [conv('a'), conv('b')] }, client);
    port.saveMessage.mockRejectedValue(new StatusError(404));
    const backoff = deferred();
    client.sleep.mockImplementationOnce(() => backoff.promise);
    act(() => result.current.onMessagesChange({ messages: [reply('r1')] }));
    await settle();
    act(() => result.current.select({ id: 'b' }));
    await settle();
    const listReads = port.listConversations.mock.calls.length;
    await act(async () => { backoff.resolve(); });
    await settle();
    expect(port.listConversations.mock.calls.length).toBe(listReads);
  });

  it('stops retrying once the dock unmounts mid-backoff', async () => {
    const client = makeClient();
    const { result, writes, port, unmount } = await mountOn('a', {}, client);
    port.saveMessage.mockRejectedValue(new StatusError(503));
    const backoff = deferred();
    client.sleep.mockImplementationOnce(() => backoff.promise);
    act(() => result.current.onMessagesChange({ messages: [reply('r1')] }));
    await settle();
    unmount();
    await act(async () => { backoff.resolve(); });
    await settle();
    expect(writes()).toEqual(['a/r1@succeeded']);
  });
});

describe('persistUserTurn', () => {
  it('writes the turn so the delta-driven flush does not send it again', async () => {
    const { result, writes } = await mountOn('a');
    await act(async () => { await result.current.persistUserTurn({ conversationId: 'a', message: userTurn('u1') }); });
    expect(writes()).toEqual(['a/u1']);
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1')] }));
    await settle();
    expect(writes()).toEqual(['a/u1']);
    await act(async () => { await result.current.persistUserTurn({ conversationId: 'a', message: userTurn('u1') }); });
    expect(writes()).toEqual(['a/u1']);
  });

  it('awaits the PUT a delta already scheduled instead of writing again', async () => {
    const { result, writes, port } = await mountOn('a');
    const slow = deferred();
    port.saveMessage.mockImplementationOnce(() => slow.promise);
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1')] }));
    await settle();
    let settled = false;
    let persisted!: Promise<void>;
    act(() => { persisted = result.current.persistUserTurn({ conversationId: 'a', message: userTurn('u1') }).then(() => { settled = true; }); });
    await settle();
    expect(settled).toBe(false);
    await act(async () => { slow.resolve(); await persisted; });
    expect(settled).toBe(true);
    expect(writes()).toEqual(['a/u1']);
  });

  it('never rejects, and releases a failed turn so a later delta can still write it', async () => {
    const { result, writes, port } = await mountOn('new-chat', {});
    port.saveMessage.mockRejectedValueOnce(new StatusError(422));
    await act(async () => {
      await expect(result.current.persistUserTurn({ conversationId: 'other', message: userTurn('u1') })).resolves.toBeUndefined();
    });
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1')] }));
    await settle();
    expect(writes()).toEqual(['other/u1', 'new-chat/u1']);
  });
});

describe('request-bound run stubs', () => {
  const running = (runId: string, runStatus: ChatMessage['runStatus'] = 'running') => reply('r1', { runId, runStatus, content: '' });

  it('writes a stub for a BYOK run once across repeated deltas, then the terminal result', async () => {
    const { result, writes } = await mountOn('a');
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1'), running('byok:1')] }));
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1'), running('byok:1')] }));
    await settle();
    expect(writes()).toEqual(['a/r1:byok:1@running', 'a/u1']);
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1'), running('byok:1', 'succeeded')] }));
    await settle();
    expect(writes()).toEqual(['a/r1:byok:1@running', 'a/u1', 'a/r1:byok:1@succeeded']);
  });

  it('never writes a browser stub for a daemon run', async () => {
    const { result, writes } = await mountOn('a');
    act(() => result.current.onMessagesChange({ messages: [running('run-9')] }));
    await settle();
    expect(writes()).toEqual([]);
  });

  it('treats an empty run id as not daemon-owned and stubs it', async () => {
    const { result, writes } = await mountOn('a');
    act(() => result.current.onMessagesChange({ messages: [reply('r1', { runId: '', runStatus: 'queued' })] }));
    await settle();
    expect(writes()).toEqual(['a/r1:@queued'.replace(':@', '@')]);
  });

  it('retries a failed stub on the next delta instead of leaving it missing', async () => {
    const { result, writes, port } = await mountOn('a');
    port.saveMessage.mockRejectedValueOnce(new StatusError(503));
    act(() => result.current.onMessagesChange({ messages: [running('agui:1')] }));
    await settle();
    act(() => result.current.onMessagesChange({ messages: [running('agui:1')] }));
    await settle();
    expect(writes()).toEqual(['a/r1:agui:1@running', 'a/r1:agui:1@running']);
  });

  it('holds the terminal write until a slow stub for the same run has landed', async () => {
    const { result, writes, port } = await mountOn('a');
    const slowStub = deferred();
    port.saveMessage.mockImplementationOnce(() => slowStub.promise);
    act(() => result.current.onMessagesChange({ messages: [running('byok:1')] }));
    act(() => result.current.onMessagesChange({ messages: [running('byok:1', 'succeeded')] }));
    await settle();
    expect(writes()).toEqual(['a/r1:byok:1@running']);
    await act(async () => { slowStub.resolve(); });
    await settle();
    expect(writes()).toEqual(['a/r1:byok:1@running', 'a/r1:byok:1@succeeded']);
  });

  it('keeps waiting on a retry run\'s own stub after an earlier run\'s stub settles', async () => {
    const { result, writes, port } = await mountOn('a');
    const firstStub = deferred();
    const secondStub = deferred();
    port.saveMessage.mockImplementationOnce(() => firstStub.promise).mockImplementationOnce(() => secondStub.promise);
    act(() => result.current.onMessagesChange({ messages: [running('byok:1')] }));
    act(() => result.current.onMessagesChange({ messages: [running('byok:2')] }));
    await act(async () => { firstStub.resolve(); });
    act(() => result.current.onMessagesChange({ messages: [running('byok:2', 'succeeded')] }));
    await settle();
    expect(writes()).toEqual(['a/r1:byok:1@running', 'a/r1:byok:2@running']);
    await act(async () => { secondStub.resolve(); });
    await settle();
    expect(writes()).toEqual(['a/r1:byok:1@running', 'a/r1:byok:2@running', 'a/r1:byok:2@succeeded']);
  });

  it('does not write a stale stub over a saved answer when a retry re-queues the old run id', async () => {
    const { result, writes } = await mountOn('a');
    act(() => result.current.onMessagesChange({ messages: [running('byok:1', 'succeeded')] }));
    await settle();
    act(() => result.current.onMessagesChange({ messages: [running('byok:1', 'queued')] }));
    await settle();
    expect(writes()).toEqual(['a/r1:byok:1@succeeded']);
  });
});

describe('lazy adoption', () => {
  it('adopts one conversation for typed text without remounting the pane, and remembers it', async () => {
    const { port, writes } = createFakePort();
    const store = memoryStore();
    const { result } = await mount(port, { lastConversation: store });
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1')] }));
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1'), reply('r1', { runId: 'byok:1', runStatus: 'running' })] }));
    await settle();
    expect(port.createConversation).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ activeId: 'new-1', paneKey: 'new' });
    expect(result.current.conversations.map((c) => c.id)).toEqual(['new-1']);
    expect(store.value()).toBe('new-1');
    expect(writes().sort()).toEqual(['new-1/r1:byok:1@running', 'new-1/u1']);
  });

  it('adopts for a lone run stub with nothing settled yet', async () => {
    const { port, writes } = createFakePort();
    const { result } = await mount(port);
    act(() => result.current.onMessagesChange({ messages: [reply('r1', { runId: 'byok:1', runStatus: 'queued' })] }));
    await settle();
    expect(writes()).toEqual(['new-1/r1:byok:1@queued']);
  });

  it('creates nothing while there is nothing worth saving', async () => {
    const { port } = createFakePort();
    const { result } = await mount(port);
    act(() => result.current.onMessagesChange({ messages: [{ ...userTurn('u1'), inputPending: true }] }));
    await settle();
    expect(port.createConversation).not.toHaveBeenCalled();
  });

  it('ensureConversationId returns the open conversation without creating one', async () => {
    const { result, port } = await mountOn('a');
    await act(async () => { await expect(result.current.ensureConversationId({})).resolves.toBe('a'); });
    expect(port.createConversation).not.toHaveBeenCalled();
  });

  it('ensureConversationId shares one creation with the deltas racing it', async () => {
    const { port } = createFakePort();
    const { result } = await mount(port);
    let ids: (string | null)[] = [];
    await act(async () => {
      const first = result.current.ensureConversationId({});
      result.current.onMessagesChange({ messages: [userTurn('u1')] });
      ids = await Promise.all([first, result.current.ensureConversationId({})]);
    });
    expect(ids).toEqual(['new-1', 'new-1']);
    expect(port.createConversation).toHaveBeenCalledTimes(1);
  });

  it('resolves null when creation fails, writes nothing, and lets a later call retry', async () => {
    const { port, writes } = createFakePort();
    port.createConversation.mockRejectedValueOnce(new StatusError(500));
    const { result } = await mount(port);
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1')] }));
    await settle();
    expect(writes()).toEqual([]);
    expect(result.current.activeId).toBeNull();
    await act(async () => { await expect(result.current.ensureConversationId({})).resolves.toBe('new-1'); });
    expect(result.current.activeId).toBe('new-1');
  });

  it('a superseded adoption never takes the open pane, but its own messages still land in it', async () => {
    const { port, writes, serverHas } = createFakePort({ conversations: [conv('a')] });
    const creation = deferred<ReturnType<typeof conv>>();
    port.createConversation.mockImplementationOnce(() => creation.promise);
    const { result } = await mount(port);
    act(() => result.current.onMessagesChange({ messages: [userTurn('u1')] }));
    act(() => result.current.select({ id: 'a' }));
    await settle();
    serverHas([conv('adopted'), conv('a')]);
    await act(async () => { creation.resolve(conv('adopted')); });
    await settle();
    expect(result.current.activeId).toBe('a');
    expect(result.current.conversations.map((c) => c.id)).toEqual(['adopted', 'a']);
    expect(writes()).toEqual(['adopted/u1']);
  });

  it('a stale adoption failing late does not clear a newer one still in flight', async () => {
    const { port } = createFakePort();
    const doomed = deferred<ReturnType<typeof conv>>();
    port.createConversation
      .mockImplementationOnce(() => doomed.promise)
      .mockImplementationOnce(async () => conv('explicit'))
      .mockImplementationOnce(() => new Promise(() => {}));
    const { result } = await mount(port);
    act(() => result.current.onMessagesChange({ messages: [userTurn('m1')] }));
    await act(async () => { await result.current.create({}); });
    await act(async () => { await result.current.remove({ id: 'explicit' }); });
    expect(result.current.activeId).toBeNull();

    act(() => result.current.onMessagesChange({ messages: [userTurn('m2')] }));
    await settle();
    await act(async () => { doomed.reject(new StatusError(500)); });
    await settle();
    act(() => result.current.onMessagesChange({ messages: [userTurn('m2')] }));
    await settle();
    expect(port.createConversation).toHaveBeenCalledTimes(3);
  });
});
