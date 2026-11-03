import { expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
import { foldDelegatedWrapperCalls } from '../tool-events.js';

it('folds buffered CLI receipts once per matching bridge result while preserving failed retries and native calls', () => {
  const events: AgentEvent[] = [
    { kind: 'tool_use', id: 'bridge', name: 'read', input: { path: 'a' }, toolOrigin: 'bridge' },
    { kind: 'tool_result', toolUseId: 'bridge', content: 'contents', isError: false },
    { kind: 'tool_use', id: 'native', name: 'read', input: { path: 'a' } },
    { kind: 'tool_use', id: 'failed', name: 'server_read', input: { path: 'a' }, bridgeCall: { name: 'read', input: { path: 'a' }, buffered: true } },
    { kind: 'tool_result', toolUseId: 'failed', content: 'denied before execution', isError: true },
    { kind: 'tool_use', id: 'ok', name: 'server_read', input: { path: 'a' }, bridgeCall: { name: 'read', input: { path: 'a' }, buffered: true } },
    { kind: 'tool_result', toolUseId: 'ok', content: 'contents', isError: false },
    { kind: 'tool_use', id: 'retry', name: 'server_read', input: { path: 'a' }, bridgeCall: { name: 'read', input: { path: 'a' }, buffered: true } },
    { kind: 'tool_use', id: 'different', name: 'read', input: { path: 'b' }, bridgeCall: { name: 'read', input: { path: 'b' } } },
  ];
  expect(foldDelegatedWrapperCalls({ events })).toEqual(events.filter(event =>
    !(event.kind === 'tool_use' && event.id === 'ok') && !(event.kind === 'tool_result' && event.toolUseId === 'ok')));
});

it.each([false, true])('a closed normalized receipt folds only onto a bridge-origin row (bridge: %s)', bridge => {
  const events: AgentEvent[] = [
    { kind: 'tool_use', id: 'receipt', name: 'server_list', input: { limit: '10' }, bridgeCall: { name: 'list', input: { limit: '10' } } },
    { kind: 'tool_use', id: 'canonical', name: 'list', input: { limit: 10 }, ...(bridge ? { toolOrigin: 'bridge' as const } : {}) },
    { kind: 'tool_result', toolUseId: 'canonical', content: 'items', isError: false },
    { kind: 'tool_result', toolUseId: 'receipt', content: 'done', isError: false },
  ];
  // Name-only fallback must retain HEAD's origin boundary, even when the CLI result closed its window.
  expect(foldDelegatedWrapperCalls({ events })).toEqual(bridge ? events.slice(1, 3) : events);
});
