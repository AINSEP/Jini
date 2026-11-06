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

it('keeps folder ownership per receipt through projection and recall, including empty folder lists', () => {
  const folders = [String.raw`C:\A B`, String.raw`\\srv\share`];
  const inputs = [{ id: 'one', text: 'first', folders: [folders[0]!] }, { id: 'two', text: 'second', folders: [folders[1]!] }];
  const messages: ChatMessage[] = [{ id: 'turn', role: 'user', content: 'first\n\nsecond', folders,
    events: inputs.map(input => acceptedInputUserEvent({ input }, { receipt: 'accepted' })) }];
  expect(projectAcceptedInputMessages({ messages }).map(message => message.folders)).toEqual(inputs.map(input => input.folders));
  expect(acceptedInputsFromMessages({ messages })).toEqual(inputs);
  const empty = { ...messages[0]!, events: [acceptedInputUserEvent({ input: { ...inputs[0]!, folders: [] } }, { receipt: 'accepted' })] };
  expect(projectAcceptedInputMessages({ messages: [empty] })[0]?.folders).toEqual([]);
});

// Identity, never equal text, decides whether a queued fallback duplicates a mid-run receipt.
it('keeps distinct equal-text sends and deduplicates aliases and partial fallback batches in display and recall', () => {
  const messages: ChatMessage[] = [
    { id: 'run', role: 'assistant', content: '', events: [acceptedInputUserEvent({ input: {
      id: 'wire', text: 'same', aliases: ['local'], deliveryState: 'consumed',
    } }, { receipt: 'accepted' })] },
    { id: 'fallback', role: 'user', content: 'same\n\nsame', events: [accepted('local', 'same'), accepted('second', 'same')] },
    { id: 'ordinary', role: 'user', content: 'same' },
  ];
  expect(projectAcceptedInputMessages({ messages }).map(message => message.id)).toEqual(['run', 'second', 'ordinary']);
  expect(acceptedInputsFromMessages({ messages }).map(input => input.id)).toEqual(['wire', 'second', 'ordinary']);
  expect(messages[1]!.events).toHaveLength(2);
});


it('recalls confirmed queue receipts while their carrier awaits run acceptance, excluding pending drafts', () => {
  const pending: ChatMessage = { id: 'carrier', role: 'user', content: 'batched carrier', inputPending: true,
    events: [unrelated, accepted('queued', 'accepted queue'), acceptedInputUserEvent({ input: { id: 'draft', text: 'unaccepted draft' } })] };
  const messages: ChatMessage[] = [pending, { id: 'raw-pending', role: 'user', content: 'not accepted', inputPending: true }];
  expect(acceptedInputsFromMessages({ messages })).toEqual([{ id: 'queued', text: 'accepted queue' }]);
  expect(pending.inputPending).toBe(true);
});
