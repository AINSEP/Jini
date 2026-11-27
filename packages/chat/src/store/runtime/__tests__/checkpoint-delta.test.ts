import { expect, it } from 'vitest';
import type { AgentEvent } from '@jini-ai/core/contracts/site/chat-core';
import { checkpointDelta, checkpointState } from '../checkpoint-delta.js';

const status = { kind: 'status', label: 'Working' } as const;
const text = (value: string): AgentEvent => ({ kind: 'text', text: value });
const use = { kind: 'tool_use', id: 'tool-1', name: 'read', input: { path: 'notes.txt' } } as const;
const result = { kind: 'tool_result', toolUseId: 'tool-1', content: 'read output', isError: false } as const;
const run = { conversationId: 'chat', messageId: 'answer', runId: 'run-1' };
function checkpoint(content: string, events: AgentEvent[]) {
  return checkpointState({ progress: { ...run, content, events }, length: [...JSON.stringify(events)].length, contentLength: [...content].length, version: 'v7' });
}

it('builds an exact append suffix from an empty checkpoint and marks a new tool result as progress without text growth', () => {
  expect(checkpointDelta({ previous: checkpoint('', []), progress: { ...run, content: '', events: [status] } }))
    .toEqual({ removeCharacters: 1, suffix: '{"kind":"status","label":"Working"}]', grown: false });
  const previous = checkpoint('', [use]);
  expect(checkpointDelta({ previous, progress: { ...run, content: '', events: [use, result] } })).toEqual({
    removeCharacters: 1, suffix: ',{"kind":"tool_result","toolUseId":"tool-1","content":"read output","isError":false}]', grown: true,
  });
  expect(checkpointDelta({ previous, progress: { ...run, content: '', events: [{ ...use }] } }))
    .toEqual({ removeCharacters: 1, suffix: ']', grown: false });
});

it('replaces only the final growing text using Unicode code points and does not retain half a surrogate in the guard', () => {
  const prefix = 'Draft 🚀';
  const events = [status, text(prefix)];
  const previous = checkpoint(prefix, events);
  expect(checkpointDelta({ previous, progress: { ...run, content: 'Draft 🚀 written', events: [{ ...status }, text('Draft 🚀 written')] } }))
    .toEqual({ removeCharacters: [...'{"kind":"text","text":"Draft 🚀"}]'].length, suffix: '{"kind":"text","text":"Draft 🚀 written"}]', grown: true });
  const boundary = '🚀' + 'x'.repeat(252);
  const receipt = checkpoint(boundary, [text(boundary)]);
  expect(receipt.tail).toBe('x'.repeat(252) + '"}]');
});

it.each([
  { reason: 'shorter text', content: 'D', events: [status, text('Draft')] },
  { reason: 'shorter event history', content: 'Draft', events: [status] },
  { reason: 'duplicate tool calls', content: 'Draft', events: [status, text('Draft'), use, { ...use }] },
  { reason: 'rewritten prefix', content: 'Draft plus', events: [{ ...status, label: 'Reordered' }, text('Draft plus')] },
  { reason: 'replaced event kind', content: 'Draft', events: [status, use] },
  { reason: 'rewritten last text', content: 'Other', events: [status, text('Other')] },
])('requires a full checkpoint for $reason', ({ content, events }) => {
  expect(checkpointDelta({ previous: checkpoint('Draft', [status, text('Draft')]), progress: { ...run, content, events } })).toBeUndefined();
});
