/**
 * @file `useStoredConversations` and `useConversationDeleteConfirmation` rendered from their real
 * modules under jsdom, with a fake conversation store injected through the store lookup — so each
 * test controls exactly when a load, create or save settles.
 */
import assert from 'node:assert/strict';
import { act } from 'react';
import type { ChatMessage } from '../../../../core/messages.js';
import { useConversationDeleteConfirmation } from '../hooks/useConversationDeleteConfirmation.hooks.js';
import { useStoredConversations } from '../hooks/useStoredConversations.hooks.js';
import { deferred, renderHookWithView as renderHook, settle, test, type TestContext } from './node-test-context.js';

interface WorkspaceConversationSummary { id: string; title: string | null; messageCount: number; createdAt: number; updatedAt: number }

// ── useStoredConversations ──────────────────────────────────────────────────────────────────────

function convo(id: string, title: string | null = id): WorkspaceConversationSummary {
  return { id, title } as WorkspaceConversationSummary;
}

function message(id: string, role: 'user' | 'assistant' = 'user', runStatus?: string): ChatMessage {
  return { id, role, ...(runStatus ? { runStatus } : {}) } as unknown as ChatMessage;
}

/** A conversation store fake: a list, per-conversation transcripts, and a record of every write. */
function conversationStore(initial: WorkspaceConversationSummary[] = []) {
  const state = { list: [...initial], saved: [] as string[], created: 0, deleted: [] as string[], renamed: [] as string[] };
  const bridge = {
    listConversations: async () => [...state.list],
    loadConversationMessages: async ({ conversationId: id }: { conversationId: string }, _options = {}) => [message(`${id}-m1`)],
    createConversation: async () => { state.created++; const made = convo(`c${state.created}`); state.list.unshift(made); return made; },
    deleteConversation: async ({ id }: { id: string }, _options = {}) => { state.deleted.push(id); state.list = state.list.filter((c) => c.id !== id); },
    renameConversation: async ({ id, title }: { id: string; title: string }) => { state.renamed.push(`${id}=${title}`); },
    // Like the real store: a deleted conversation's row is gone, so a message written to it cannot persist.
    saveConversationMessage: async ({ conversationId, message: saved }: { conversationId: string; message: ChatMessage }) => {
      if (state.deleted.includes(conversationId)) throw new Error(`conversation ${conversationId} was deleted`);
      state.saved.push(`${conversationId}/${saved.id}`);
    },
  };
  return { state, bridge };
}

function renderConversations(t: TestContext, bridge: Partial<ReturnType<typeof conversationStore>['bridge']> | undefined) {
  const getBridge = () => bridge as never;
  return renderHook(t, () => useStoredConversations({ getStore: getBridge }));
}

/** Silences the hook's own console.error and counts what it logged. */
function quietErrors(t: TestContext) {
  const spy = t.mock.method(console, 'error', () => {});
  return { get length() { return spy.mock.callCount(); } };
}

test('useStoredConversations: loads the list on mount, and a failed load logs and keeps an empty switcher', async (t) => {
  const { bridge } = conversationStore([convo('a'), convo('b')]);
  const hook = renderConversations(t, bridge);
  await settle();
  assert.deepEqual(hook.current().conversations.map((c) => c.id), ['a', 'b']);
  assert.deepEqual([hook.current().activeId, hook.current().paneKey], [null, 'new']);

  const errors = quietErrors(t);
  const failing = renderConversations(t, { ...bridge, listConversations: () => Promise.reject(new Error('db locked')) });
  await settle();
  assert.deepEqual(failing.current().conversations, []);
  assert.equal(errors.length, 1);
});

test('useStoredConversations: select loads a transcript, a slower earlier select never lands, and a failed load still switches', async (t) => {
  const { bridge } = conversationStore([convo('a'), convo('b')]);
  const slow = deferred<ChatMessage[]>();
  const errors = quietErrors(t);
  const hook = renderConversations(t, {
    ...bridge,
    loadConversationMessages: ({ conversationId: id }: { conversationId: string }, _options = {}) => (id === 'a' ? slow.promise : id === 'bad' ? Promise.reject(new Error('gone')) : bridge.loadConversationMessages({ conversationId: id })),
  });
  await settle();
  act(() => hook.current().select('a'));
  act(() => hook.current().select('b'));
  await settle();
  slow.resolve([message('a-late')]);
  await settle();
  assert.deepEqual([hook.current().activeId, hook.current().paneKey], ['b', 'b']);
  assert.deepEqual(hook.current().initialMessages.map((m) => m.id), ['b-m1']);

  act(() => hook.current().select('bad'));
  await settle();
  assert.deepEqual([hook.current().activeId, hook.current().initialMessages], ['bad', []]);
  assert.equal(errors.length, 1);
});

test('useStoredConversations: create switches to the new thread unless a select overtook it while it was in flight', async (t) => {
  const { bridge, state } = conversationStore([convo('a')]);
  const hook = renderConversations(t, bridge);
  await settle();
  await act(() => hook.current().create());
  assert.deepEqual([hook.current().activeId, hook.current().paneKey, hook.current().initialMessages], ['c1', 'c1', []]);
  assert.equal(hook.current().conversations[0]!.id, 'c1');

  const gate = deferred<void>();
  const raced = renderConversations(t, { ...bridge, createConversation: async () => { await gate.promise; return bridge.createConversation(); } });
  await settle();
  let creating!: Promise<void>;
  act(() => { creating = raced.current().create(); });
  act(() => raced.current().select('a'));
  await settle();
  gate.resolve();
  await act(() => creating);
  assert.equal(raced.current().activeId, 'a', 'the later selection wins');
  assert.equal(raced.current().conversations[0]!.id, 'c2', 'the created row still shows in the switcher');
  assert.equal(state.created, 2);
});

test('useStoredConversations: removing the open thread lands on the next one, or on a fresh pane when none is left', async (t) => {
  const { bridge, state } = conversationStore([convo('a'), convo('b')]);
  const hook = renderConversations(t, bridge);
  await settle();
  act(() => hook.current().select('a'));
  await settle();
  await act(() => hook.current().remove('b'));
  assert.deepEqual(state.deleted, ['b']);
  assert.equal(hook.current().activeId, 'a', 'removing another thread leaves the open one alone');

  state.list.push(convo('z'));
  await act(() => hook.current().remove('a'));
  await settle();
  assert.deepEqual([hook.current().activeId, hook.current().paneKey], ['z', 'z']);

  await act(() => hook.current().remove('z'));
  assert.deepEqual([hook.current().activeId, hook.current().paneKey, hook.current().initialMessages], [null, 'new-1', []]);
  assert.deepEqual(hook.current().conversations, []);
});

test('useStoredConversations: a remove whose refresh fails falls back to the on-screen list without the deleted thread', async (t) => {
  const { bridge, state } = conversationStore([convo('a'), convo('b')]);
  let failLists = false;
  const errors = quietErrors(t);
  const hook = renderConversations(t, { ...bridge, listConversations: () => (failLists ? Promise.reject(new Error('db locked')) : bridge.listConversations()) });
  await settle();
  act(() => hook.current().select('a'));
  await settle();
  failLists = true;
  await act(() => hook.current().remove('a'));
  await settle();
  assert.deepEqual(state.deleted, ['a']);
  assert.deepEqual([hook.current().activeId, hook.current().paneKey], ['b', 'b'], 'the surviving thread opens, never the deleted one');
  assert.deepEqual(hook.current().conversations.map((c) => c.id), ['b'], 'the switcher no longer lists the deleted thread');
  assert.equal(errors.length, 1);
  failLists = false;
  act(() => hook.current().onMessagesChange([message('b-m1'), message('u1')]));
  await settle();
  assert.deepEqual(state.saved, ['b/u1'], 'the next message persists to the surviving thread');
  assert.equal(errors.length, 1, 'and no write was refused');
});

test('useStoredConversations: rename is optimistic, logs a failed write, and re-reads the list either way', async (t) => {
  const { bridge, state } = conversationStore([convo('a', 'Old')]);
  const hook = renderConversations(t, { ...bridge, listConversations: async () => state.list.map((c) => ({ ...c, title: `${c.title}!` })) });
  await settle();
  let renaming!: Promise<void>;
  assert.equal(hook.current().conversations[0]!.title, 'Old!');
  act(() => { renaming = hook.current().rename('a', 'New'); });
  assert.equal(hook.current().conversations[0]!.title, 'New', 'the new title shows before the round trip');
  await act(() => renaming);
  await settle();
  assert.deepEqual(state.renamed, ['a=New']);
  assert.equal(hook.current().conversations[0]!.title, 'Old!', 'then the list is re-read from the store');

  const errors = quietErrors(t);
  const failing = renderConversations(t, { ...bridge, renameConversation: () => Promise.reject(new Error('read-only')) });
  await settle();
  let failed!: Promise<void>;
  act(() => { failed = failing.current().rename('a', 'Draft'); });
  assert.equal(failing.current().conversations[0]!.title, 'Draft', 'the new title shows before the round trip');
  await act(() => failed);
  await settle();
  assert.equal(failing.current().conversations[0]!.title, 'Old', 'the re-read restores what the store kept');
  assert.equal(errors.length, 1);
});

test('useStoredConversations: an optimistic rename changes only the renamed thread', async (t) => {
  const { bridge } = conversationStore([convo('a', 'Alpha'), convo('b', 'Beta')]);
  const hook = renderConversations(t, bridge);
  await settle();
  let renaming!: Promise<void>;
  act(() => { renaming = hook.current().rename('b', 'Bravo'); });
  assert.deepEqual(hook.current().conversations.map((c) => [c.id, c.title]), [['a', 'Alpha'], ['b', 'Bravo']]);
  await act(() => renaming);
  await settle();
});

test('useStoredConversations: an open thread saves each settled message once, and a failed save is retried later', async (t) => {
  const { bridge, state } = conversationStore([convo('a')]);
  let failNext = false;
  const errors = quietErrors(t);
  const hook = renderConversations(t, {
    ...bridge,
    saveConversationMessage: (input: { conversationId: string; message: ChatMessage }) => {
      if (failNext) { failNext = false; return Promise.reject(new Error('disk full')); }
      return bridge.saveConversationMessage(input);
    },
  });
  await settle();
  act(() => hook.current().select('a'));
  await settle();
  act(() => hook.current().onMessagesChange([message('a-m1'), message('u1'), message('r1', 'assistant', 'running')]));
  await settle();
  assert.deepEqual(state.saved, ['a/u1'], 'the loaded transcript and a still-streaming reply are not saved');
  act(() => hook.current().onMessagesChange([message('a-m1'), message('u1')]));
  await settle();
  assert.deepEqual(state.saved, ['a/u1'], 'nothing new, nothing written');
  failNext = true;
  act(() => hook.current().onMessagesChange([message('u1'), message('u2')]));
  await settle();
  assert.equal(errors.length, 1);
  act(() => hook.current().onMessagesChange([message('u1'), message('u2')]));
  await settle();
  assert.deepEqual(state.saved, ['a/u1', 'a/u2']);
});

test('useStoredConversations: a first message with nothing open adopts exactly one new thread and saves into it', async (t) => {
  const { bridge, state } = conversationStore();
  const gate = deferred<void>();
  const hook = renderConversations(t, { ...bridge, createConversation: async () => { await gate.promise; return bridge.createConversation(); } });
  await settle();
  act(() => hook.current().onMessagesChange([]));
  act(() => hook.current().onMessagesChange([message('r0', 'assistant', 'running')]));
  assert.equal(state.created, 0, 'the mount echo and a streaming reply are not worth a thread');
  act(() => hook.current().onMessagesChange([message('u1')]));
  act(() => hook.current().onMessagesChange([message('u1'), message('u2')]));
  gate.resolve();
  await settle();
  assert.equal(state.created, 1);
  assert.equal(hook.current().activeId, 'c1');
  assert.equal(hook.current().paneKey, 'new', 'adopting mid-turn never remounts the pane');
  assert.deepEqual(state.saved.sort(), ['c1/u1', 'c1/u2']);
});

test('useStoredConversations: an adoption overtaken by a select still saves its messages but does not take over', async (t) => {
  const { bridge, state } = conversationStore([convo('a')]);
  const gate = deferred<void>();
  const hook = renderConversations(t, { ...bridge, createConversation: async () => { await gate.promise; return bridge.createConversation(); } });
  await settle();
  act(() => hook.current().onMessagesChange([message('u1')]));
  act(() => hook.current().select('a'));
  await settle();
  gate.resolve();
  await settle();
  assert.equal(hook.current().activeId, 'a');
  assert.deepEqual(state.saved, ['c1/u1']);
});

test('useStoredConversations: a failed adoption logs and lets the next message try again', async (t) => {
  const { bridge, state } = conversationStore();
  let failCreate = true;
  const errors = quietErrors(t);
  const hook = renderConversations(t, { ...bridge, createConversation: () => (failCreate ? Promise.reject(new Error('db locked')) : bridge.createConversation()) });
  await settle();
  act(() => hook.current().onMessagesChange([message('u1')]));
  await settle();
  assert.deepEqual([hook.current().activeId, state.saved, errors.length], [null, [], 1]);
  failCreate = false;
  act(() => hook.current().onMessagesChange([message('u1')]));
  await settle();
  assert.equal(hook.current().activeId, 'c1');
  assert.deepEqual(state.saved, ['c1/u1']);
});

test('useStoredConversations: a message landing between deleting the open thread and loading the next is not written to the deleted thread', async (t) => {
  const { bridge, state } = conversationStore([convo('a'), convo('b')]);
  const nextLoad = deferred<ChatMessage[]>();
  const errors = quietErrors(t);
  const hook = renderConversations(t, { ...bridge, loadConversationMessages: ({ conversationId: id }: { conversationId: string }, _options = {}) => (id === 'b' ? nextLoad.promise : bridge.loadConversationMessages({ conversationId: id })) });
  await settle();
  act(() => hook.current().select('a'));
  await settle();
  await act(() => hook.current().remove('a'));
  act(() => hook.current().onMessagesChange([message('late')]));
  await settle();
  assert.deepEqual(state.saved, [], 'the deleted thread is gone; nothing is sent to it');
  assert.equal(errors.length, 0, 'so no write is refused either');
  nextLoad.resolve([]);
  await settle();
  assert.equal(hook.current().activeId, 'b');
  act(() => hook.current().onMessagesChange([message('u1')]));
  await settle();
  assert.deepEqual(state.saved, ['b/u1'], 'the next thread persists normally');
});

test('useStoredConversations: without a bridge every action is a no-op', async (t) => {
  const hook = renderConversations(t, undefined);
  act(() => hook.current().select('a'));
  await act(() => hook.current().create());
  await act(() => hook.current().remove('a'));
  await act(() => hook.current().rename('a', 'x'));
  act(() => hook.current().onMessagesChange([message('u1')]));
  await settle();
  assert.deepEqual([hook.current().conversations, hook.current().activeId, hook.current().paneKey], [[], null, 'new']);
});

test('useStoredConversations: returns the same shape as before, with actions that keep their identity across renders', async (t) => {
  const { bridge } = conversationStore([convo('a')]);
  const hook = renderConversations(t, bridge);
  await settle();
  const first = hook.current();
  assert.deepEqual(Object.keys(first).sort(), ['activeId', 'conversations', 'create', 'initialMessages', 'onMessagesChange', 'paneKey', 'remove', 'rename', 'select']);
  act(() => first.select('a'));
  await settle();
  hook.rerender();
  const second = hook.current();
  assert.deepEqual([second.activeId, second.paneKey, second.initialMessages.map((m) => m.id)], ['a', 'a', ['a-m1']], 'controller state reaches the render');
  for (const name of ['select', 'create', 'remove', 'rename', 'onMessagesChange'] as const) {
    assert.equal(second[name], first[name], `${name} is stable`);
  }
});

test('useStoredConversations: looks the bridge up once, not on every render', async (t) => {
  const { bridge } = conversationStore([convo('a')]);
  let lookups = 0;
  const getBridge = () => { lookups++; return bridge as never; };
  const hook = renderHook(t, () => useStoredConversations({ getStore: getBridge }));
  await settle();
  hook.rerender();
  await settle();
  assert.equal(lookups, 1);
  assert.deepEqual(hook.current().conversations.map((c) => c.id), ['a'], 'the mount refresh still lands');
});

// ── useConversationDeleteConfirmation ───────────────────────────────────────────────────────────

test('useConversationDeleteConfirmation: a prompt resolves from the answer, and a newer prompt cancels an older one', async (t) => {
  const hook = renderHook(t, () => useConversationDeleteConfirmation());
  act(() => hook.current().resolvePending({ confirmed: true }));
  assert.equal(hook.current().pendingTitle, null, 'answering with nothing pending is a no-op');
  let first!: Promise<boolean>;
  act(() => { first = hook.current().confirmDelete({ id: 'a', title: null } as never); });
  assert.equal(hook.current().pendingTitle, 'Untitled');
  let second!: Promise<boolean>;
  act(() => { second = hook.current().confirmDelete({ id: 'b', title: 'Deploy notes' } as never); });
  assert.equal(await first, false);
  assert.equal(hook.current().pendingTitle, 'Deploy notes');
  act(() => hook.current().resolvePending({ confirmed: true }));
  assert.equal(await second, true);
  assert.equal(hook.current().pendingTitle, null);
});

test('useConversationDeleteConfirmation: declining resolves false, and a second answer to the same prompt changes nothing', async (t) => {
  const hook = renderHook(t, () => useConversationDeleteConfirmation());
  let asked!: Promise<boolean>;
  act(() => { asked = hook.current().confirmDelete({ id: 'a', title: 'Keep me' } as never); });
  act(() => hook.current().resolvePending({ confirmed: false }));
  act(() => hook.current().resolvePending({ confirmed: true }));
  assert.equal(await asked, false);
  assert.equal(hook.current().pendingTitle, null);
});

test('useStoredConversations: sends mount-read failures to the host logger and keeps an empty switcher', async (t) => {
  const { bridge } = conversationStore([convo('original')]);
  const problem = new Error('bridge temporarily unavailable');
  const logCalls: unknown[][] = [];
  const log: NonNullable<Parameters<typeof useStoredConversations>[1]>['log'] = (...args) => { logCalls.push(args); };
  const broken = { ...bridge, listConversations: async () => { throw problem; } };
  const hook = renderHook(t, () => useStoredConversations({ getStore: getBroken }, { log }));
  function getBroken() { return broken; }
  await settle();
  assert.deepEqual(hook.current().conversations, []);
  assert.deepEqual(logCalls, [['could not load conversations —', problem]]);
});
