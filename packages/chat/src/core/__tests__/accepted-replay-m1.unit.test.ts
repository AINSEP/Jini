import { expect, it } from 'vitest';
import { acceptedInputUserEvent, projectAcceptedInputEvents } from '../accepted-input.js';

it('collapses replayed accepted aliases without dropping a distinct input', () => {
  const first = acceptedInputUserEvent({ input: { id: 'wire-a', text: 'First', aliases: ['local-a'] } }, { receipt: 'accepted' });
  const replay = acceptedInputUserEvent({ input: { id: 'wire-b', text: 'First', aliases: ['local-a'] } }, { receipt: 'accepted' });
  const next = acceptedInputUserEvent({ input: { id: 'wire-c', text: 'Next' } }, { receipt: 'accepted' });
  expect(projectAcceptedInputEvents({ events: [first, replay, next] })).toEqual([first, next]);
});

it('emits an optimistic input id once even when the local transcript repeats it', () => {
  const first = acceptedInputUserEvent({ input: { id: 'local-a', text: 'First' } });
  const repeat = acceptedInputUserEvent({ input: { id: 'local-a', text: 'First' } });
  const next = acceptedInputUserEvent({ input: { id: 'local-b', text: 'Next' } });
  expect(projectAcceptedInputEvents({ events: [first, repeat, next] })).toEqual([first, next]);
});
