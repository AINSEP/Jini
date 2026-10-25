import { describe, expect, it } from 'vitest';
import { acceptedInputEvent, acceptedInputsFromMessages, acceptedInputUserEvent, projectAcceptedInputEvents, projectAcceptedInputMessages } from '../accepted-input.js';
import type { ChatMessage } from '../messages.js';
import type { AgentEvent } from '../index.js';

const accepted = (id: string, text: string) => acceptedInputUserEvent({ input: { id, text } }, { receipt: 'accepted' });
const unrelated = { kind: 'status' as const, label: 'queued' };

describe('accepted input projections', () => {
  it('splits a queued user turn into one bubble per accepted input, ignoring unrelated events, with no legacy files', () => {
    const turn: ChatMessage = { id: 'u', role: 'user', content: 'a\nb', events: [unrelated, accepted('in-1', 'a'), accepted('in-2', 'b')] };
    expect(projectAcceptedInputMessages({ messages: [turn] }).map(({ id, content, attachments }) => ({ id, content, attachments }))).toEqual([
      { id: 'in-1', content: 'a', attachments: [] },
      { id: 'in-2', content: 'b', attachments: [] },
    ]);
  });

  it('emits a repeated accepted receipt once', () => {
    const projected = projectAcceptedInputEvents({ events: [accepted('w1', 'hello'), unrelated, accepted('w1', 'hello')] });
    expect(projected.flatMap(event => acceptedInputEvent({ event })?.data.id ?? [])).toEqual(['w1']);
    expect(projected).toContainEqual(unrelated);
  });

  it('keeps only the first bubble when an unmatched optimistic input and a receipt share an id', () => {
    const local = acceptedInputUserEvent({ input: { id: 'x', text: 'draft' } });
    const projected = projectAcceptedInputEvents({ events: [local, accepted('x', 'edited on the wire')] });
    expect(projected).toEqual([local]);
  });

  it('recalls a user turn whose events hold no receipts as its own text', () => {
    const turn: ChatMessage = { id: 'u', role: 'user', content: 'plain', events: [unrelated] };
    expect(acceptedInputsFromMessages({ messages: [turn] })).toEqual([{ id: 'u', text: 'plain' }]);
  });
});

// Stryker L5 (2026-10-25): acceptedInputEvent's kind/name guard and its id/text type guard survived
// being forced to true/false or swapped to &&. One malformed field per case.
describe('acceptedInputEvent — malformed mid-run message events (F3)', () => {
  const good = { kind: 'ext', name: 'user_message', data: { id: 'm1', text: 'hi' } } as AgentEvent;
  it('accepts a well-formed event as-is', () => {
    expect(acceptedInputEvent({ event: good })).toBe(good);
  });
  it.each([
    ['another ext name', { kind: 'ext', name: 'mcp-ui', data: { id: 'm1', text: 'hi' } }],
    ['a non-ext kind with the same name', { kind: 'status', name: 'user_message', label: 'x', data: { id: 'm1', text: 'hi' } }],
    ['null data', { kind: 'ext', name: 'user_message', data: null }],
    ['missing data', { kind: 'ext', name: 'user_message' }],
    ['numeric id', { kind: 'ext', name: 'user_message', data: { id: 1, text: 'hi' } }],
    ['missing text', { kind: 'ext', name: 'user_message', data: { id: 'm1' } }],
    ['object text', { kind: 'ext', name: 'user_message', data: { id: 'm1', text: { value: 'hi' } } }],
  ])('refuses %s', (_label, event) => {
    expect(acceptedInputEvent({ event: event as unknown as AgentEvent })).toBeNull();
  });
});
