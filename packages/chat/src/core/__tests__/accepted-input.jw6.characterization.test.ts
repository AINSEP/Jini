import { expect, it } from 'vitest';
import { acceptedInputEvent, acceptedInputUserEvent, projectAcceptedInputEvents } from '../accepted-input.js';
import { questionAnswerText } from '../question-answer.js';

it('consumes equal-text optimistic receipts in order only after their predecessor is seen', () => {
  const first = acceptedInputUserEvent({ input: { id: 'local-1', text: 'same' }, afterInputId: 'prior' });
  const second = acceptedInputUserEvent({ input: { id: 'local-2', text: 'same' }, afterInputId: 'local-1' });
  const receipt = (id: string, text = 'same') => acceptedInputUserEvent({ input: { id, text } }, { receipt: 'accepted' });
  const events = [first, second, receipt('early'), receipt('prior', 'before'), receipt('wire-1'), receipt('wire-2'), receipt('wire-1')];
  const projected = projectAcceptedInputEvents({ events });
  expect(projected.flatMap(event => acceptedInputEvent({ event })?.data ?? [])).toEqual([
    { id: 'early', text: 'same' }, { id: 'prior', text: 'before' },
    { id: 'local-1', text: 'same', aliases: ['wire-1'] },
    { id: 'local-2', text: 'same', aliases: ['wire-2'] },
  ]);
  expect(projectAcceptedInputEvents({ events: projected })).toEqual(projected);
});

it('keeps blank free-text precedence and mixed selection filtering', () => {
  expect(questionAnswerText({ answer: { freeText: '', __typedAnswer: 'ignored', selections: [null, 'x', 4] } })).toBe('x');
  expect(questionAnswerText({ answer: { submitted: false, __typedAnswer: 'ignored' } })).toBeUndefined();
  expect(questionAnswerText({ answer: { selections: [null, 4] } })).toBeUndefined();
});
