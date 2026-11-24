/**
 * @file `createConversationController` driven directly — no React — against a fake
 * conversation store whose every call returns a promise the test settles by hand, in whatever order
 * the race under test needs. Each test names the guard (or "why" comment) in the controller it
 * would catch breaking.
 */
import assert from 'node:assert/strict';
import type { ChatMessage } from '../../../../core/messages.js';
import { createConversationController } from '../conversation-controller.js';
import type { ConversationState, ConversationStorePort } from '../types.js';
import { test } from './node-test-context.js';

/** The host summary DTO shape the suite was written against; the controller passes it through. */
interface WorkspaceConversationSummary { id: string; title: string | null; messageCount: number; createdAt: number; updatedAt: number }
type RenameConversationInput = { id: string; title: string };
type SaveConversationMessageInput = { conversationId: string; message: ChatMessage };
type StoreBridge = ConversationStorePort<WorkspaceConversationSummary>;
type ControllerState = ConversationState<WorkspaceConversationSummary>;

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

interface Pending<A, R> {
  args: A;
  resolve: (value: R) => void;
  reject: (reason: unknown) => void;
}

/** One bridge method: records each call and hands the test that call's settle controls. */
function pendingCalls<A, R>() {
  const calls: Pending<A, R>[] = [];
  const call = (args: A): Promise<R> =>
    new Promise<R>((resolve, reject) => {
      calls.push({ args, resolve, reject });
    });
  return { calls, call };
}

function fakeStore() {
  const list = pendingCalls<void, readonly WorkspaceConversationSummary[]>();
  const load = pendingCalls<string, ChatMessage[]>();
  const create = pendingCalls<void, WorkspaceConversationSummary>();
  const del = pendingCalls<string, void>();
  const rename = pendingCalls<RenameConversationInput, void>();
  const save = pendingCalls<SaveConversationMessageInput, void>();
  const bridge: StoreBridge = {
    listConversations: () => list.call(undefined),
    loadConversationMessages: ({ conversationId: id }, _options = {}) => load.call(id),
    createConversation: () => create.call(undefined),
    deleteConversation: ({ id }, _options = {}) => del.call(id),
    renameConversation: (input) => rename.call(input),
    saveConversationMessage: (input) => save.call(input),
  };
  return { bridge, list: list.calls, load: load.calls, create: create.calls, del: del.calls, rename: rename.calls, save: save.calls };
}

type Store = ReturnType<typeof fakeStore>;

function setup({ onChange }: { onChange?: (state: ControllerState) => void } = {}) {
  const store = fakeStore();
  const logged: unknown[][] = [];
  const controller = createConversationController(
    { bridge: store.bridge },
    { log: (...args) => logged.push(args), ...(onChange ? { onChange } : {}) },
  );
  return { store, logged, controller };
}

type Setup = ReturnType<typeof setup>;

function convo(id: string, title: string | null = id): WorkspaceConversationSummary {
  return { id, title, messageCount: 0, createdAt: 0, updatedAt: 0 };
}

function user(id: string): ChatMessage {
  return { id, role: 'user', content: id };
}

function reply(id: string, runStatus: 'running' | 'succeeded'): ChatMessage {
  return { id, role: 'assistant', content: id, runStatus };
}

/** The `index`-th recorded call, failing the test if it was never made. */
function nth<T>(calls: readonly T[], index: number): T {
  const call = calls[index];
  assert.ok(call, `expected call #${index + 1}, saw ${calls.length}`);
  return call;
}

function latest<T>(calls: readonly T[]): T {
  return nth(calls, calls.length - 1);
}

/** Every write so far, as `conversation/message`. */
function saved(store: Store): string[] {
  return store.save.map((c) => `${c.args.conversationId}/${c.args.message.id}`);
}

/** Let pending promise callbacks run several rounds deep. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Publishes `list` through a resolved `refresh()`. */
async function seedList(ctx: Setup, list: WorkspaceConversationSummary[]): Promise<void> {
  const refreshing = ctx.controller.refresh();
  latest(ctx.store.list).resolve(list);
  await refreshing;
}

/** Selects `id` and lets its load resolve with `messages`. */
async function openThread(ctx: Setup, id: string, messages: ChatMessage[] = []): Promise<void> {
  ctx.controller.select({ id });
  latest(ctx.store.load).resolve(messages);
  await settle();
}

function view(state: ControllerState) {
  return { activeId: state.activeId, paneKey: state.paneKey, initial: state.initialMessages.map((m) => m.id) };
}

test('a deleted conversation stays absent when an older list request finishes last', async () => {
  const ctx = setup();
  await seedList(ctx, [convo('gone'), convo('kept')]);
  const stale = ctx.controller.refresh();
  const staleList = latest(ctx.store.list);
  const removing = ctx.controller.remove({ id: 'gone' });
  latest(ctx.store.del).resolve();
  await settle();
  latest(ctx.store.list).resolve([convo('gone'), convo('kept')]);
  await removing;
  staleList.resolve([convo('gone'), convo('kept')]);
  await stale;
  assert.deepEqual(ctx.controller.getState().conversations.map(c => c.id), ['kept']);
});

test('a deleted conversation cannot reopen when its pending transcript arrives', async () => {
  const ctx = setup();
  ctx.controller.select({ id: 'gone' });
  const removing = ctx.controller.remove({ id: 'gone' });
  latest(ctx.store.del).resolve();
  await settle();
  latest(ctx.store.list).resolve([]);
  await removing;
  latest(ctx.store.load).resolve([user('old')]);
  await settle();
  assert.equal(ctx.controller.getState().activeId, null);
  assert.deepEqual(ctx.controller.getState().initialMessages, []);
});

for (const navigation of ['select', 'create'] as const) {
  test(`lazy conversation creation preserves pending ${navigation} navigation and saves the outgoing turn`, async () => {
    const ctx = setup();
    ctx.controller.onMessagesChange({ messages: [user('outgoing')] });
    const adoption = latest(ctx.store.create);
    const navigating = navigation === 'create' ? ctx.controller.create() : undefined;
    if (navigation === 'select') ctx.controller.select({ id: 'chosen' });
    ctx.controller.onMessagesChange({ messages: [user('outgoing'), user('late-outgoing')] });
    assert.equal(ctx.store.create.length, navigation === 'create' ? 2 : 1, 'outgoing deltas share the original adoption');
    adoption.resolve(convo('adopted'));
    await settle();
    assert.equal(ctx.controller.getState().activeId, null, 'adoption must not claim the pane while navigation is pending');
    assert.deepEqual(saved(ctx.store), ['adopted/outgoing', 'adopted/late-outgoing']);
    if (navigation === 'select') latest(ctx.store.load).resolve([user('chosen-turn')]);
    else latest(ctx.store.create).resolve(convo('chosen'));
    await navigating;
    await settle();
    assert.equal(ctx.controller.getState().activeId, 'chosen');
  });
}

test('a first outgoing turn arriving during navigation is saved without replacing the pending choice', async () => {
  const ctx = setup();
  ctx.controller.select({ id: 'chosen' });
  ctx.controller.onMessagesChange({ messages: [user('outgoing')] });
  latest(ctx.store.create).resolve(convo('outgoing-thread'));
  await settle();
  assert.equal(ctx.controller.getState().activeId, null);
  assert.deepEqual(saved(ctx.store), ['outgoing-thread/outgoing']);
  latest(ctx.store.load).resolve([]);
  await settle();
  assert.equal(ctx.controller.getState().activeId, 'chosen');
});

for (const creation of ['adoption', 'explicit'] as const) {
  test(`a deleted thread stays deleted when its delayed ${creation} acknowledgement arrives`, async () => {
    const ctx = setup();
    const creating = creation === 'explicit' ? ctx.controller.create() : undefined;
    if (creation === 'adoption') ctx.controller.onMessagesChange({ messages: [user('outgoing')] });
    await seedList(ctx, [convo('gone')]);
    const removing = ctx.controller.remove({ id: 'gone' });
    latest(ctx.store.del).resolve();
    await settle();
    latest(ctx.store.list).resolve([]);
    await removing;
    latest(ctx.store.create).resolve(convo('gone'));
    await creating;
    await settle();
    assert.equal(ctx.controller.getState().activeId, null);
    assert.deepEqual(ctx.controller.getState().conversations, []);
    assert.deepEqual(saved(ctx.store), []);
  });
}

// ── state, subscribe, refresh ───────────────────────────────────────────────────────────────────

test('starts empty, keeps one state object until a change, then publishes a new one to subscribers and onChange', async () => {
  const seen: ControllerState[] = [];
  const ctx = setup({ onChange: (state) => seen.push(state) });
  const initial = ctx.controller.getState();
  assert.deepEqual(initial, { conversations: [], activeId: null, paneKey: 'new', initialMessages: [] });
  assert.equal(ctx.controller.getState(), initial, 'no change, same snapshot');

  let notified = 0;
  const unsubscribe = ctx.controller.subscribe({ listener: () => notified++ });
  await seedList(ctx, [convo('a')]);
  const next = ctx.controller.getState();
  assert.notEqual(next, initial);
  assert.deepEqual(initial.conversations, [], 'the old snapshot is never mutated');
  assert.deepEqual(next.conversations.map((c) => c.id), ['a']);
  assert.equal(notified, 1);
  assert.deepEqual(seen, [next]);

  unsubscribe();
  await seedList(ctx, [convo('b')]);
  assert.equal(notified, 1, 'an unsubscribed listener hears nothing more');
  assert.equal(seen.length, 2, 'onChange is not a subscription and keeps firing');
});

test('refresh: a failed list logs and resolves to the list already published, without publishing', async () => {
  const ctx = setup();
  await seedList(ctx, [convo('a')]);
  const before = ctx.controller.getState();
  const refreshing = ctx.controller.refresh();
  latest(ctx.store.list).reject(new Error('db locked'));
  assert.equal(await refreshing, before.conversations);
  assert.equal(ctx.controller.getState(), before);
  assert.equal(ctx.logged.length, 1);
});

test('refresh: failures go to console.error when no log port is given, looked up when the failure happens', async (t) => {
  const store = fakeStore();
  const controller = createConversationController({ bridge: store.bridge });
  const spy = t.mock.method(console, 'error', () => {});
  const refreshing = controller.refresh();
  latest(store.list).reject(new Error('db locked'));
  assert.deepEqual(await refreshing, []);
  assert.equal(spy.mock.callCount(), 1);
});

// ── select / create ─────────────────────────────────────────────────────────────────────────────

test('select publishes id, pane key and transcript together, once, only after the load resolves', async () => {
  const ctx = setup();
  let notified = 0;
  ctx.controller.subscribe({ listener: () => notified++ });
  ctx.controller.select({ id: 'a' });
  assert.deepEqual(view(ctx.controller.getState()), { activeId: null, paneKey: 'new', initial: [] });
  latest(ctx.store.load).resolve([user('a1')]);
  await settle();
  assert.deepEqual(view(ctx.controller.getState()), { activeId: 'a', paneKey: 'a', initial: ['a1'] });
  assert.equal(notified, 1);
});

test('a slower select resolving after a newer select never lands, and the newer transcript counts as already saved', async () => {
  const ctx = setup();
  ctx.controller.select({ id: 'a' });
  ctx.controller.select({ id: 'b' });
  nth(ctx.store.load, 1).resolve([user('b1')]);
  await settle();
  nth(ctx.store.load, 0).resolve([user('a1')]);
  await settle();
  assert.deepEqual(view(ctx.controller.getState()), { activeId: 'b', paneKey: 'b', initial: ['b1'] });
  ctx.controller.onMessagesChange({ messages: [user('b1'), user('u1')] });
  assert.deepEqual(saved(ctx.store), ['b/u1']);
});

test('a slower select resolving after a newer create never lands', async () => {
  const ctx = setup();
  ctx.controller.select({ id: 'a' });
  const creating = ctx.controller.create();
  latest(ctx.store.create).resolve(convo('c1'));
  await creating;
  latest(ctx.store.load).resolve([user('a1')]);
  await settle();
  assert.deepEqual(view(ctx.controller.getState()), { activeId: 'c1', paneKey: 'c1', initial: [] });
});

test('a failed load logs and still switches, to an empty pane', async () => {
  const ctx = setup();
  await openThread(ctx, 'a', [user('a1')]);
  ctx.controller.select({ id: 'gone' });
  latest(ctx.store.load).reject(new Error('missing'));
  await settle();
  assert.deepEqual(view(ctx.controller.getState()), { activeId: 'gone', paneKey: 'gone', initial: [] });
  assert.equal(ctx.logged.length, 1);
});

test('create opens a new empty thread on top of the switcher, ready to receive writes', async () => {
  const ctx = setup();
  await seedList(ctx, [convo('a')]);
  await openThread(ctx, 'a', [user('a1')]);
  const creating = ctx.controller.create();
  latest(ctx.store.create).resolve(convo('c1'));
  await creating;
  const state = ctx.controller.getState();
  assert.deepEqual(view(state), { activeId: 'c1', paneKey: 'c1', initial: [] });
  assert.deepEqual(state.conversations.map((c) => c.id), ['c1', 'a']);
  ctx.controller.onMessagesChange({ messages: [user('u1')] });
  assert.deepEqual(saved(ctx.store), ['c1/u1']);
});

test('create is claimed before its request: a select made while it is in flight wins, whichever settles first', async () => {
  for (const order of ['create first', 'select first'] as const) {
    const ctx = setup();
    const creating = ctx.controller.create();
    ctx.controller.select({ id: 'a' });
    if (order === 'select first') {
      latest(ctx.store.load).resolve([user('a1')]);
      await settle();
    }
    latest(ctx.store.create).resolve(convo('c1'));
    await creating;
    if (order === 'create first') {
      assert.deepEqual(view(ctx.controller.getState()), { activeId: null, paneKey: 'new', initial: [] }, order);
      latest(ctx.store.load).resolve([user('a1')]);
      await settle();
    }
    const state = ctx.controller.getState();
    assert.deepEqual(view(state), { activeId: 'a', paneKey: 'a', initial: ['a1'] }, order);
    assert.deepEqual(state.conversations.map((c) => c.id), ['c1'], `${order}: the created row still shows`);
  }
});

test('a failed create rejects and leaves the state alone', async () => {
  const ctx = setup();
  const before = ctx.controller.getState();
  const creating = ctx.controller.create();
  latest(ctx.store.create).reject(new Error('db locked'));
  await assert.rejects(creating, /db locked/);
  assert.equal(ctx.controller.getState(), before);
});

// ── remove ──────────────────────────────────────────────────────────────────────────────────────

test('removing a thread that is not open drops its row at once and leaves the open one alone', async () => {
  const ctx = setup();
  await seedList(ctx, [convo('a'), convo('b')]);
  await openThread(ctx, 'a');
  const removing = ctx.controller.remove({ id: 'b' });
  latest(ctx.store.del).resolve();
  await settle();
  assert.deepEqual(ctx.store.del.map((c) => c.args), ['b']);
  assert.deepEqual(ctx.controller.getState().conversations.map((c) => c.id), ['a'], 'gone before the re-read lands');
  latest(ctx.store.list).resolve([convo('a')]);
  await removing;
  assert.deepEqual(view(ctx.controller.getState()), { activeId: 'a', paneKey: 'a', initial: [] });
  assert.equal(ctx.store.load.length, 1, 'no switch was started');
});

test('removing the open thread selects the first survivor of the re-read list, never the deleted row', async () => {
  const ctx = setup();
  await seedList(ctx, [convo('a'), convo('z')]);
  await openThread(ctx, 'a');
  const removing = ctx.controller.remove({ id: 'a' });
  latest(ctx.store.del).resolve();
  await settle();
  latest(ctx.store.list).resolve([convo('a'), convo('z')]);
  await removing;
  assert.equal(latest(ctx.store.load).args, 'z');
  latest(ctx.store.load).resolve([user('z1')]);
  await settle();
  assert.deepEqual(view(ctx.controller.getState()), { activeId: 'z', paneKey: 'z', initial: ['z1'] });
  ctx.controller.onMessagesChange({ messages: [user('z1'), user('u1')] });
  assert.deepEqual(saved(ctx.store), ['z/u1'], 'reached through select, so the loaded transcript counts as saved');
});

test('removing the open thread when the re-read fails falls back to the on-screen list without the deleted row', async () => {
  const ctx = setup();
  await seedList(ctx, [convo('a'), convo('b')]);
  await openThread(ctx, 'a');
  const removing = ctx.controller.remove({ id: 'a' });
  latest(ctx.store.del).resolve();
  await settle();
  latest(ctx.store.list).reject(new Error('db locked'));
  await removing;
  assert.equal(latest(ctx.store.load).args, 'b');
  assert.deepEqual(ctx.controller.getState().conversations.map((c) => c.id), ['b']);
  assert.equal(ctx.logged.length, 1);
});

test('removing the last thread lands on a fresh pane with a new key each time, and drops a switch already in flight', async () => {
  const ctx = setup();
  await openThread(ctx, 'a');
  ctx.controller.select({ id: 'x' });
  const removing = ctx.controller.remove({ id: 'a' });
  latest(ctx.store.del).resolve();
  await settle();
  latest(ctx.store.list).resolve([]);
  await removing;
  assert.deepEqual(view(ctx.controller.getState()), { activeId: null, paneKey: 'new-1', initial: [] });
  nth(ctx.store.load, 1).resolve([user('x1')]);
  await settle();
  assert.deepEqual(view(ctx.controller.getState()), { activeId: null, paneKey: 'new-1', initial: [] }, 'the in-flight switch never lands');

  const creating = ctx.controller.create();
  latest(ctx.store.create).resolve(convo('c1'));
  await creating;
  const again = ctx.controller.remove({ id: 'c1' });
  latest(ctx.store.del).resolve();
  await settle();
  latest(ctx.store.list).resolve([]);
  await again;
  assert.equal(ctx.controller.getState().paneKey, 'new-2', 'a second fresh pane still remounts');
});

test('removing a lazily adopted last thread resets adoption, so the fresh pane adopts a new thread', async () => {
  const ctx = setup();
  ctx.controller.onMessagesChange({ messages: [user('u1')] });
  latest(ctx.store.create).resolve(convo('c1'));
  await settle();
  assert.equal(ctx.controller.getState().activeId, 'c1');
  const removing = ctx.controller.remove({ id: 'c1' });
  latest(ctx.store.del).resolve();
  await settle();
  latest(ctx.store.list).resolve([]);
  await removing;

  ctx.controller.onMessagesChange({ messages: [user('u2')] });
  assert.equal(ctx.store.create.length, 2, 'a new creation, not the deleted thread\'s settled one');
  latest(ctx.store.create).resolve(convo('c2'));
  await settle();
  assert.equal(ctx.controller.getState().activeId, 'c2');
  assert.deepEqual(saved(ctx.store), ['c1/u1', 'c2/u2']);
});

test('a failed delete rejects and keeps the thread, open and listed', async () => {
  const ctx = setup();
  await seedList(ctx, [convo('a')]);
  await openThread(ctx, 'a');
  const before = ctx.controller.getState();
  const removing = ctx.controller.remove({ id: 'a' });
  latest(ctx.store.del).reject(new Error('read-only'));
  await assert.rejects(removing, /read-only/);
  assert.equal(ctx.controller.getState(), before);
  ctx.controller.onMessagesChange({ messages: [user('u1')] });
  assert.deepEqual(saved(ctx.store), ['a/u1'], 'still writable');
});

// ── rename ──────────────────────────────────────────────────────────────────────────────────────

test('rename shows the new title at once on that row only, then re-reads the list', async () => {
  const ctx = setup();
  await seedList(ctx, [convo('a', 'Alpha'), convo('b', 'Beta')]);
  const untouched = ctx.controller.getState().conversations[0];
  const renaming = ctx.controller.rename({ id: 'b', title: 'Bravo' });
  const optimistic = ctx.controller.getState().conversations;
  assert.deepEqual(optimistic.map((c) => [c.id, c.title]), [['a', 'Alpha'], ['b', 'Bravo']]);
  assert.equal(optimistic[0], untouched, 'other rows are not copied');
  assert.deepEqual(latest(ctx.store.rename).args, { id: 'b', title: 'Bravo' });
  const listsBefore = ctx.store.list.length;
  latest(ctx.store.rename).resolve();
  await renaming;
  assert.equal(ctx.store.list.length, listsBefore + 1);
  latest(ctx.store.list).resolve([convo('a', 'Alpha'), convo('b', 'Bravo (stored)')]);
  await settle();
  assert.equal(nth(ctx.controller.getState().conversations, 1).title, 'Bravo (stored)');
  assert.equal(ctx.logged.length, 0);
});

test('a failed rename logs and still re-reads, so the stored title comes back', async () => {
  const ctx = setup();
  await seedList(ctx, [convo('a', 'Old')]);
  const renaming = ctx.controller.rename({ id: 'a', title: 'Draft' });
  assert.equal(nth(ctx.controller.getState().conversations, 0).title, 'Draft');
  latest(ctx.store.rename).reject(new Error('read-only'));
  await renaming;
  assert.equal(ctx.logged.length, 1);
  latest(ctx.store.list).resolve([convo('a', 'Old')]);
  await settle();
  assert.equal(nth(ctx.controller.getState().conversations, 0).title, 'Old');
});

// ── writing messages ────────────────────────────────────────────────────────────────────────────

test('an open thread saves pending user turns and settled, unsaved replies, and re-reads the list only when it wrote', async () => {
  const ctx = setup();
  await openThread(ctx, 'a', [user('a1')]);
  const lists = ctx.store.list.length;
  const outgoing = { ...user('u1'), inputPending: true };
  ctx.controller.onMessagesChange({ messages: [user('a1'), outgoing, reply('r1', 'running'), reply('d1', 'succeeded')] });
  assert.deepEqual(saved(ctx.store), ['a/u1', 'a/d1'], 'not the loaded transcript, not a streaming reply');
  assert.deepEqual(nth(ctx.store.save, 0).args.message, outgoing);
  assert.equal(ctx.store.list.length, lists + 1);
  ctx.controller.onMessagesChange({ messages: [user('a1'), outgoing, reply('d1', 'succeeded')] });
  assert.equal(ctx.store.save.length, 2, 'nothing new, nothing written');
  assert.equal(ctx.store.list.length, lists + 1, 'and nothing re-read');
  ctx.controller.onMessagesChange({ messages: [outgoing, reply('r1', 'succeeded')] });
  assert.deepEqual(saved(ctx.store), ['a/u1', 'a/d1', 'a/r1'], 'the reply is saved once it settles');
});

test('a message is marked saved before its write resolves, so a delta mid-flight does not queue it twice', async () => {
  const ctx = setup();
  await openThread(ctx, 'a');
  ctx.controller.onMessagesChange({ messages: [user('u1')] });
  ctx.controller.onMessagesChange({ messages: [user('u1')] });
  assert.deepEqual(saved(ctx.store), ['a/u1']);
});

test('a failed save logs and is un-marked, so the next delta writes it again', async () => {
  const ctx = setup();
  await openThread(ctx, 'a');
  ctx.controller.onMessagesChange({ messages: [user('u1'), user('u2')] });
  nth(ctx.store.save, 0).reject(new Error('disk full'));
  nth(ctx.store.save, 1).resolve();
  await settle();
  assert.equal(ctx.logged.length, 1);
  ctx.controller.onMessagesChange({ messages: [user('u1'), user('u2')] });
  assert.deepEqual(saved(ctx.store), ['a/u1', 'a/u2', 'a/u1'], 'only the failed one is retried');
});

test('a message settling between deleting the open thread and loading the next is not written anywhere', async () => {
  const ctx = setup();
  await seedList(ctx, [convo('a'), convo('b')]);
  await openThread(ctx, 'a');
  const removing = ctx.controller.remove({ id: 'a' });
  latest(ctx.store.del).resolve();
  await settle();
  latest(ctx.store.list).resolve([convo('b')]);
  await removing;
  ctx.controller.onMessagesChange({ messages: [user('late')] });
  assert.deepEqual(saved(ctx.store), [], 'the deleted thread is gone; nothing is sent to it');
  latest(ctx.store.load).resolve([]);
  await settle();
  ctx.controller.onMessagesChange({ messages: [user('u1')] });
  assert.deepEqual(saved(ctx.store), ['b/u1']);
});

// ── lazy adoption ───────────────────────────────────────────────────────────────────────────────

test('with nothing open, the mount echo and a still-streaming reply create nothing and publish nothing', () => {
  const ctx = setup();
  let notified = 0;
  ctx.controller.subscribe({ listener: () => notified++ });
  ctx.controller.onMessagesChange({ messages: [] });
  ctx.controller.onMessagesChange({ messages: [reply('r0', 'running')] });
  assert.equal(ctx.store.create.length, 0);
  assert.equal(notified, 0);
});

test('a pending first user message with nothing open adopts ONE thread for every delta before it exists, without a remount', async () => {
  const ctx = setup();
  await seedList(ctx, [convo('a')]);
  const outgoing = { ...user('u1'), inputPending: true };
  ctx.controller.onMessagesChange({ messages: [outgoing] });
  assert.equal(ctx.store.create.length, 1, 'a pending user turn starts adoption immediately');
  ctx.controller.onMessagesChange({ messages: [outgoing, user('u2')] });
  assert.equal(ctx.store.create.length, 1);
  latest(ctx.store.create).resolve(convo('c1'));
  await settle();
  const state = ctx.controller.getState();
  assert.deepEqual(view(state), { activeId: 'c1', paneKey: 'new', initial: [] });
  assert.deepEqual(state.conversations.map((c) => c.id), ['c1', 'a']);
  assert.deepEqual(saved(ctx.store), ['c1/u1', 'c1/u2'], 'each message once');
  assert.deepEqual(nth(ctx.store.save, 0).args.message, outgoing);
  ctx.controller.onMessagesChange({ messages: [outgoing, user('u2'), user('u3')] });
  assert.deepEqual(saved(ctx.store), ['c1/u1', 'c1/u2', 'c1/u3'], 'later deltas write straight to it');
});

test('an adoption overtaken by a select or create still saves its messages but does not take over', async () => {
  for (const overtake of ['select', 'create'] as const) {
    const ctx = setup();
    ctx.controller.onMessagesChange({ messages: [user('u1')] });
    if (overtake === 'select') {
      await openThread(ctx, 'a');
    } else {
      const creating = ctx.controller.create();
      nth(ctx.store.create, 1).resolve(convo('a'));
      await creating;
    }
    nth(ctx.store.create, 0).resolve(convo('adopted'));
    await settle();
    const state = ctx.controller.getState();
    assert.deepEqual([state.activeId, state.paneKey], ['a', 'a'], overtake);
    assert.ok(state.conversations.some((c) => c.id === 'adopted'), `${overtake}: the row still shows`);
    assert.deepEqual(saved(ctx.store), ['adopted/u1'], overtake);
  }
});

test('a failed adoption logs, saves nothing, and lets a later turn try again', async () => {
  const ctx = setup();
  ctx.controller.onMessagesChange({ messages: [user('u1')] });
  ctx.controller.onMessagesChange({ messages: [user('u1')] });
  latest(ctx.store.create).reject(new Error('db locked'));
  await settle();
  assert.deepEqual([ctx.controller.getState().activeId, saved(ctx.store), ctx.logged.length], [null, [], 1]);
  ctx.controller.onMessagesChange({ messages: [user('u1')] });
  assert.equal(ctx.store.create.length, 2);
  latest(ctx.store.create).resolve(convo('c2'));
  await settle();
  assert.equal(ctx.controller.getState().activeId, 'c2');
  assert.deepEqual(saved(ctx.store), ['c2/u1']);
});

test('an old adoption failing late does not clear a newer one still in flight', async () => {
  const ctx = setup();
  ctx.controller.onMessagesChange({ messages: [user('u1')] });
  await openThread(ctx, 'a');
  const removing = ctx.controller.remove({ id: 'a' });
  latest(ctx.store.del).resolve();
  await settle();
  latest(ctx.store.list).resolve([]);
  await removing;
  ctx.controller.onMessagesChange({ messages: [user('u2')] });
  assert.equal(ctx.store.create.length, 2);
  nth(ctx.store.create, 0).reject(new Error('db locked'));
  await settle();
  ctx.controller.onMessagesChange({ messages: [user('u2'), user('u3')] });
  assert.equal(ctx.store.create.length, 2, 'the newer adoption is still the one shared');
  nth(ctx.store.create, 1).resolve(convo('c2'));
  await settle();
  assert.equal(ctx.controller.getState().activeId, 'c2');
  assert.deepEqual(saved(ctx.store), ['c2/u2', 'c2/u3']);
});

// ── no bridge ───────────────────────────────────────────────────────────────────────────────────

test('without a bridge every action is a quiet no-op', async () => {
  const logged: unknown[][] = [];
  const controller = createConversationController({ bridge: undefined }, { log: (...args) => logged.push(args) });
  const before = controller.getState();
  let notified = 0;
  controller.subscribe({ listener: () => notified++ });
  controller.select({ id: 'a' });
  await controller.create();
  await controller.remove({ id: 'a' });
  await controller.rename({ id: 'a', title: 'x' });
  controller.onMessagesChange({ messages: [user('u1')] });
  assert.equal(await controller.refresh(), before.conversations);
  await settle();
  assert.equal(controller.getState(), before);
  assert.deepEqual([notified, logged.length], [0, 0]);
});
