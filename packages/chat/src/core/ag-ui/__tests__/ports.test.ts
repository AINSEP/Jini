import { expect, it } from 'vitest';
import { createAgUiTranslationState, translateAgentEventToAgUi, closeAgUiRun, reduceAgentWirePayload } from '../entry.js';

it('injects host IDs and custom names and keeps concurrent runs isolated', () => {
  const names = { usage: 'consumer.usage', status: 'consumer.status', extensionPrefix: 'consumer.ext.' };
  const a = createAgUiTranslationState({ ids: { next: ({ ordinal }) => `a:${ordinal}` }, customEventNames: names });
  const b = createAgUiTranslationState({ ids: { next: ({ ordinal }) => `b:${ordinal}` }, customEventNames: names });
  names.status = 'mutated';
  expect(translateAgentEventToAgUi({ event: { kind: 'text', text: 'A' }, state: a })).toEqual([
    { type: 'TEXT_MESSAGE_START', messageId: 'a:1', role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a:1', delta: 'A' },
  ]);
  expect(translateAgentEventToAgUi({ event: { kind: 'thinking', text: 'B' }, state: b })).toEqual([
    { type: 'REASONING_START', messageId: 'b:1' }, { type: 'REASONING_MESSAGE_START', messageId: 'b:1', role: 'reasoning' },
    { type: 'REASONING_MESSAGE_CONTENT', messageId: 'b:1', delta: 'B' },
  ]);
  const status = { kind: 'status' as const, label: 'Ready' };
  expect(translateAgentEventToAgUi({ event: status, state: a })).toEqual([{ type: 'CUSTOM', name: 'consumer.status', value: status }]);
  expect(closeAgUiRun({ state: a })).toEqual([{ type: 'TEXT_MESSAGE_END', messageId: 'a:1' }]);
  expect(b.openReasoningMessageId).toBe('b:1');
});
it('treats inherited object keys as unknown extension event types', () => {
  for (const type of ['constructor', 'toString', '__proto__']) {
    const payload = { type, value: 'untrusted' };
    expect(reduceAgentWirePayload({ payload })).toEqual({ kind: 'ext', name: type, data: payload });
  }
});
