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
