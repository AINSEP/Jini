// @vitest-environment jsdom
/**
 * @file `useImportHandoff` rendered under jsdom: a hand-off opens the Import tab, typing in the
 * address only when the host's validator accepts it and no import is running. The bridge lookup and
 * validator are injected; the validator here accepts only `https://` addresses.
 */
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { test } from 'vitest';
import { handoffAddress, useImportHandoff } from '../use-import-handoff.js';

const accept = ({ text }: { text: string }) => (text.startsWith('https://') ? `${text}/` : null);

function fakeBridge() {
  const listeners = new Set<(request: unknown) => void>();
  const getBridge = () => ({
    onOpenImport: ({ listener }: { listener: (request: unknown) => void }) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  });
  const fire = (request: unknown) => act(() => { for (const listener of listeners) listener(request); });
  return { listeners, getBridge, fire };
}

function renderHandoff({ busy = false }: { busy?: boolean } = {}) {
  const bridge = fakeBridge();
  const calls: string[] = [];
  const hook = renderHook(() => useImportHandoff({
    busy, prefill: (address) => calls.push(`prefill:${address}`), open: () => calls.push('open'), getBridge: bridge.getBridge, accept,
  }));
  return { ...bridge, calls, hook };
}

test('useImportHandoff: a valid address is typed in, then the Import tab opens', () => {
  const { fire, calls } = renderHandoff();
  fire({ address: 'https://example.com' });
  assert.deepEqual(calls, ['prefill:https://example.com/', 'open']);
});

test('useImportHandoff: no address, or one the Import page would refuse, opens the tab without typing anything', () => {
  const { fire, calls } = renderHandoff();
  fire({});
  fire({ address: 'not an address' });
  fire({ address: 'ftp://example.com' });
  fire(null);
  assert.deepEqual(calls, ['open', 'open', 'open', 'open']);
});

test('useImportHandoff: while an import runs, the address it is using is left alone', () => {
  const { fire, calls } = renderHandoff({ busy: true });
  fire({ address: 'https://example.com' });
  assert.deepEqual(calls, ['open']);
});

test('useImportHandoff: subscribes once and detaches on unmount; without a bridge nothing subscribes', () => {
  const { listeners, hook } = renderHandoff();
  assert.equal(listeners.size, 1);
  hook.rerender();
  assert.equal(listeners.size, 1, 'a re-render does not add a second listener');
  hook.unmount();
  assert.equal(listeners.size, 0);
  const calls: string[] = [];
  const getBridge = () => undefined;
  renderHook(() => useImportHandoff({ busy: false, prefill: () => calls.push('prefill'), open: () => calls.push('open'), getBridge, accept })).unmount();
  assert.deepEqual(calls, []);
});

test('handoffAddress: only a string the validator accepts survives', () => {
  assert.equal(handoffAddress({ request: { address: 'https://example.com' }, accept }), 'https://example.com/');
  assert.equal(handoffAddress({ request: { address: 'localhost' }, accept }), null);
  assert.equal(handoffAddress({ request: { address: 7 }, accept }), null);
  assert.equal(handoffAddress({ request: undefined, accept }), null);
});
