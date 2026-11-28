import { describe, expect, it } from 'vitest';
import { acceptedInputEvent, acceptedInputsFromMessages, acceptedInputUserEvent, foldersFromReceipts, projectAcceptedInputEvents, projectAcceptedInputMessages, withFolderReceipt } from '../accepted-input.js';
import type { ChatMessage } from '../messages.js';
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

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

it('drops an ordinary user row whose id an earlier mid-run receipt already showed', () => {
  const messages: ChatMessage[] = [
    { id: 'run', role: 'assistant', content: '', events: [accepted('plain-1', 'hello')] },
    { id: 'plain-1', role: 'user', content: 'hello' },
    { id: 'plain-2', role: 'user', content: 'next' },
  ];
  expect(projectAcceptedInputMessages({ messages }).map(message => message.id)).toEqual(['run', 'plain-2']);
});

describe('folder receipts', () => {
  const redaction = { secretRedacted: true } as NonNullable<ChatMessage['secretRedaction']>;
  const attachment = { path: 'uploads/a.png', name: 'a.png' } as unknown as NonNullable<ChatMessage['attachments']>[number];

  it('leaves non-user rows, folderless rows and rows that already carry a receipt unchanged', () => {
    const assistant: ChatMessage = { id: 'a', role: 'assistant', content: 'x', folders: ['/w'] };
    const plain: ChatMessage = { id: 'u', role: 'user', content: 'x', folders: [] };
    const receipted: ChatMessage = { id: 'r', role: 'user', content: 'x', folders: ['/w'], events: [accepted('r', 'x')] };
    for (const message of [assistant, plain, receipted]) expect(withFolderReceipt({ message })).toBe(message);
  });

  it('adds one accepted receipt carrying the folders, and the redaction and attachments only when present', () => {
    const full = withFolderReceipt({ message: { id: 'u1', role: 'user', content: 'see', folders: ['/w/a'], secretRedaction: redaction, attachments: [attachment], events: [unrelated] } });
    expect(full.events?.[0]).toEqual(unrelated);
    expect(acceptedInputEvent({ event: full.events![1]! })?.data).toEqual({ id: 'u1', text: 'see', folders: ['/w/a'], secretRedaction: redaction, attachments: [attachment] });
    const bare = withFolderReceipt({ message: { id: 'u2', role: 'user', content: 'see', folders: ['/w/b'] } });
    expect(bare.events).toHaveLength(1);
    expect(acceptedInputEvent({ event: bare.events![0]! })?.data).toEqual({ id: 'u2', text: 'see', folders: ['/w/b'] });
    expect(Object.keys(acceptedInputEvent({ event: bare.events![0]! })!.data).sort()).toEqual(['folders', 'id', 'text']);
  });

  it('reads string folder paths back from receipts, skipping non-receipts, non-objects and non-string paths', () => {
    expect(foldersFromReceipts({ events: 'not-a-list' })).toEqual([]);
    expect(foldersFromReceipts({ events: [
      null, 7, 'text', unrelated,
      { kind: 'ext', name: 'user_message', data: { id: 'one', text: 'a', folders: ['/w/a', 3, '/w/b'] } },
      { kind: 'ext', name: 'user_message', data: { id: 'two', text: 'b' } },
      { kind: 'ext', name: 'user_message', data: { id: 'three', text: 'c', folders: ['/w/c'] } },
    ] })).toEqual(['/w/a', '/w/b', '/w/c']);
  });
});
