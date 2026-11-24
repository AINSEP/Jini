/**
 * @file `useBridgedChatTransport` rendered from its real module under jsdom with a fake bridge and
 * a listener-installing transport factory injected.
 */
import assert from 'node:assert/strict';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installDom, renderHookWithView as renderHook, test } from '../../conversations/__tests__/node-test-context.js';
import { useBridgedChatTransport } from '../hooks/useBridgedChatTransport.hooks.js';
import type { ChatBridgePort } from '../types.js';

type ChatListener = (event: unknown) => void;
type FakeBridge = ChatBridgePort & {
  onChatEvent: (input: { listener: ChatListener }, options?: Record<string, never>) => () => void;
};

/** A full bridge with inert defaults; tests override only what they exercise. */
function fakeBridge(overrides: Partial<FakeBridge> = {}): FakeBridge & { chatListeners: Set<unknown> } {
  const chatListeners = new Set<unknown>();
  return {
    chatListeners,
    listAgents: async () => [], rescanAgents: async () => [], daemonOnline: async () => true,
    saveChatAttachment: async () => ({ path: '/staged/file.txt' }),
    onChatEvent: ({ listener }, _options = {}) => { chatListeners.add(listener); return () => chatListeners.delete(listener); },
    getPathForFile: () => '/picked/file.txt',
    pickWorkingDirectory: async () => null, recentWorkingDirectories: async () => [], workingDirectoryExists: async () => true,
    normalizeWorkingDirectory: async ({ directory }, _options = {}) => directory,
    ...overrides,
  };
}

/** Stands in for the host's run transport: construction installs one run-event listener, `dispose` removes it. */
function createTransport(bridge: FakeBridge): { dispose: () => void } {
  const off = bridge.onChatEvent({ listener: () => {} });
  return { dispose: () => { off(); } };
}

function useTransportUnderTest(_required: Record<string, never>, { getBridge }: { getBridge: () => FakeBridge | undefined }) {
  return useBridgedChatTransport({ getBridge, createTransport });
}

test('workspace chat keeps one working listener after StrictMode replays setup and removes it on close', (t) => {
  const bridge = fakeBridge();
  const getBridge = () => bridge;
  let current: ReturnType<typeof useTransportUnderTest> | undefined;
  function Pane() { current = useTransportUnderTest({}, { getBridge }); return null; }
  const window = installDom();
  const root = createRoot(window.document.body.appendChild(window.document.createElement('div')));
  t.after(() => act(() => root.unmount()));
  act(() => root.render(createElement(StrictMode, null, createElement(Pane))));
  assert.ok(current?.transport);
  assert.equal(bridge.chatListeners.size, 1, 'the committed transport must own a live listener');
  act(() => root.render(null));
  assert.equal(bridge.chatListeners.size, 0, 'render-discarded transports must not leak listeners');
});

test('reconnecting the same desktop bridge never hands the pane its disposed transport', (t) => {
  const bridge = fakeBridge();
  let getBridge: () => FakeBridge | undefined = () => bridge;
  const seen: Array<ReturnType<typeof useTransportUnderTest>['transport']> = [];
  const hook = renderHook(t, () => {
    const value = useTransportUnderTest({}, { getBridge });
    seen.push(value.transport);
    return value;
  });
  const original = hook.current().transport;
  assert.ok(original);
  getBridge = () => undefined;
  hook.rerender();
  assert.equal(bridge.chatListeners.size, 0);
  seen.length = 0;
  getBridge = () => bridge;
  hook.rerender();
  assert.equal(seen.includes(original), false, 'even the render before effect setup must not expose the closed instance');
  assert.ok(hook.current().transport);
  assert.equal(bridge.chatListeners.size, 1);
});

test('useBridgedChatTransport: wires every surface from one bridge, and disposing the pane drops its run listener', async (t) => {
  const bridge = fakeBridge();
  const getBridge = () => bridge;
  const hook = renderHook(t, () => useTransportUnderTest({}, { getBridge }));
  const value = hook.current();
  assert.deepEqual(value.runtimeAccess, { listAgents: bridge.listAgents, rescanAgents: bridge.rescanAgents, daemonOnline: bridge.daemonOnline });
  assert.ok(value.workingDirectoryAccess);
  assert.equal(await value.workingDirectoryAccess.normalizeWorkingDirectory?.('/site'), '/site');
  assert.equal(await value.workingDirectoryAccess.pickWorkingDirectory('/site'), null);
  assert.equal(await value.workingDirectoryAccess.directoryExists('/site'), true);
  assert.equal(value.workingDirectoryAccess.recentDirectories, bridge.recentWorkingDirectories);
  assert.equal(value.getPathForFile, bridge.getPathForFile);
  assert.equal(typeof value.uploadAttachments, 'function');
  assert.ok(value.transport);
  assert.equal(bridge.chatListeners.size, 1, 'one run-event listener per pane');
  hook.rerender();
  assert.equal(hook.current().transport, value.transport, 'the transport is not rebuilt per render');
  assert.equal(hook.current().runtimeAccess, value.runtimeAccess, 'nor are the access surfaces');
  assert.equal(bridge.chatListeners.size, 1);
  hook.unmount();
  assert.equal(bridge.chatListeners.size, 0);
});

test('useBridgedChatTransport: the bridge is looked up once per lookup, not once per render', (t) => {
  let lookups = 0;
  const bridge = fakeBridge();
  const getBridge = () => { lookups++; return bridge; };
  const hook = renderHook(t, () => useTransportUnderTest({}, { getBridge }));
  hook.rerender();
  hook.rerender();
  assert.equal(lookups, 1);
});

test('useBridgedChatTransport: without a bridge every surface is absent', (t) => {
  const getBridge = () => undefined;
  const hook = renderHook(t, () => useTransportUnderTest({}, { getBridge }));
  assert.deepEqual(hook.current(), { transport: undefined, runtimeAccess: undefined, workingDirectoryAccess: undefined, getPathForFile: undefined, uploadAttachments: undefined });
});
