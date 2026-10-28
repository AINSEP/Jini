import { describe, expect, it } from 'vitest';
import { acceptedInputEvent, acceptedInputsFromMessages, acceptedInputUserEvent, projectAcceptedInputEvents, projectAcceptedInputMessages } from '../accepted-input.js';
import type { ChatMessage } from '../messages.js';

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

  it('P27: confirms optimistic bubbles and applies changed receipt text by identity', () => {
    const local = acceptedInputUserEvent({ input: { id: 'x', text: 'draft' } });
    const queued = acceptedInputUserEvent({ input: { id: 'x', text: 'draft', deliveryState: 'queued' } }, { receipt: 'accepted' });
    const confirmed = projectAcceptedInputEvents({ events: [local, unrelated, queued] });
    expect.soft(confirmed).toEqual([queued, unrelated]);

    const renamed = accepted('x', 'edited on the wire');
    const projected = projectAcceptedInputEvents({ events: [local, unrelated, renamed] });
    expect(projected).toEqual([renamed, unrelated]);
  });

  it('recalls a user turn whose events hold no receipts as its own text', () => {
    const turn: ChatMessage = { id: 'u', role: 'user', content: 'plain', events: [unrelated] };
    expect(acceptedInputsFromMessages({ messages: [turn] })).toEqual([{ id: 'u', text: 'plain' }]);
  });

  it('projects an unchanged events array once, so per-update transcript passes reuse the result', () => {
    const events = [unrelated, accepted('in-1', 'a')];
    const first = projectAcceptedInputEvents({ events });
    expect(projectAcceptedInputEvents({ events })).toBe(first);
    expect(projectAcceptedInputEvents({ events: [...events] })).not.toBe(first);
  });
});
