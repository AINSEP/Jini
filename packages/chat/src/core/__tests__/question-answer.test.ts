import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
import { acceptedInputEvent, acceptedInputUserEvent, projectAcceptedInputEvents } from '../accepted-input.js';
import { questionAnswerFromResult, questionAnswerText } from '../question-answer.js';

const input = {
  title: 'Which theme should this local site show?',
  singleSelect: { options: [{ value: 'ucla', label: 'A26 UCLA' }] },
  multiSelect: { options: [{ value: 'news', label: 'News' }, { value: 'events', label: 'Events' }] },
};

describe('readable question answers', () => {
  it('resolves flat question option values in single and multiple answers, including saved raw receipts', () => {
    const input = { question: 'How should we publish?', options: [
      { value: 'embed', label: 'Embed the widget' }, { value: 'api', label: 'Use the API' },
    ] };
    expect(questionAnswerText({ input, answer: { choice: 'api' } })).toBe('Use the API');
    expect(questionAnswerText({ input, answer: { selections: ['embed', 'api'] } })).toBe('Embed the widget, Use the API');
    const saved: AgentEvent[] = [
      { kind: 'tool_use', id: 'q', name: 'assistant_ask_choice', input },
      acceptedInputUserEvent({ input: { id: 'receipt', text: 'api' }, toolUseId: 'q' }, { receipt: 'accepted' }),
      { kind: 'tool_result', toolUseId: 'q', content: '{"submitted":true,"choice":"api"}', isError: false },
    ];
    const projected = projectAcceptedInputEvents({ events: saved });
    expect(projected.flatMap(event => acceptedInputEvent({ event })?.data.text ?? [])).toEqual(['Use the API']);
    expect(projectAcceptedInputEvents({ events: projected })).toEqual(projected);
  });

  it('uses offered labels for both single and multiple selections', () => {
    expect(questionAnswerText({ input, answer: { choice: 'ucla', selections: ['events', 'news'] } })).toBe('A26 UCLA, Events, News');
  });

  it('shows an explicit empty selection as an answer', () => {
    expect(questionAnswerText({ input, answer: { submitted: true, selections: [] } })).toBe('None selected');
  });

  it('preserves free text, with the same typed-over-picks precedence as ask-choice', () => {
    expect(questionAnswerText({ input, answer: { choice: 'ucla', freeText: '  My custom theme\nwith accents  ' } })).toBe('My custom theme\nwith accents');
    expect(questionAnswerText({ input, answer: { __typedAnswer: '  Custom  ' } })).toBe('Custom');
  });

  it('renders a decline even when a dismissed form still carries a selection or typed draft', () => {
    expect(questionAnswerText({ input, answer: { __dismissed: true, choice: 'ucla', __typedAnswer: 'draft' } })).toBe('Declined');
    expect(questionAnswerFromResult({ input, result: { content: '{"submitted":false,"reason":"cancelled"}', isError: false } })).toBe('Declined');
  });

  it('keeps old values readable when the question options are unavailable', () => {
    expect(questionAnswerText({ answer: { choice: 'Legacy label' } })).toBe('Legacy label');
    expect(questionAnswerText({ input: { singleSelect: { options: [null, { value: 'x' }] } }, answer: { choice: 'x' } })).toBe('x');
  });

  it.each([
    'not json', 'null', '[]', '{"saved":true}', '{"submitted":true}',
    '{"submitted":false,"reason":"expired","choice":"ucla"}',
    '{"submitted":false,"reason":"invalid-answer"}',
    '{"submitted":true,"freeText":"   "}',
  ])('never invents an answer from %s', content => {
    expect(questionAnswerFromResult({ input, result: { content, isError: false } })).toBeUndefined();
  });

  it('ignores failed tools even if the body resembles an answer', () => {
    expect(questionAnswerFromResult({ input, result: { content: '{"submitted":true,"choice":"ucla"}', isError: true } })).toBeUndefined();
    expect(questionAnswerFromResult({ result: undefined })).toBeUndefined();
  });
});

describe('accepted-input answer ownership', () => {
  function events(answer: unknown, id = 'question'): AgentEvent[] {
    return [
      { kind: 'tool_use', id, name: 'assistant_ask_choice', input },
      { kind: 'tool_result', toolUseId: id, content: JSON.stringify(answer), isError: false },
    ];
  }

  it.each([
    [{ submitted: true, choice: 'ucla' }, 'A26 UCLA'],
    [{ submitted: true, freeText: 'A custom theme' }, 'A custom theme'],
    [{ submitted: false, reason: 'cancelled' }, 'Declined'],
  ])('reconstructs one answer from JSON-persisted results and remains idempotent', (answer, text) => {
    const persisted: AgentEvent[] = JSON.parse(JSON.stringify(events(answer)));
    const projected = projectAcceptedInputEvents({ events: persisted });
    expect(projected.flatMap(event => acceptedInputEvent({ event })?.data.text ?? [])).toEqual([text]);
    expect(projectAcceptedInputEvents({ events: projected })).toEqual(projected);
  });

  it('deduplicates optimistic typed input, a durable receipt, and the tool result in either receipt order', () => {
    const optimistic = acceptedInputUserEvent({ input: { id: 'client', text: 'Custom' }, toolUseId: 'question' });
    const receipt = acceptedInputUserEvent({ input: { id: 'server', text: 'Custom' }, toolUseId: 'question' }, { receipt: 'accepted' });
    const resultEvents = events({ submitted: true, freeText: 'Custom' });
    for (const wire of [[...resultEvents, receipt], [resultEvents[0]!, receipt, resultEvents[1]!]]) {
      const projected = projectAcceptedInputEvents({ events: [optimistic, ...wire] });
      expect(projected.flatMap(event => acceptedInputEvent({ event })?.data.text ?? [])).toEqual(['Custom']);
    }
  });

  it('keeps identical answers to two different questions separate', () => {
    const projected = projectAcceptedInputEvents({ events: [
      ...events({ submitted: true, choice: 'ucla' }, 'first'),
      ...events({ submitted: true, choice: 'ucla' }, 'second'),
    ] });
    expect(projected.flatMap(event => acceptedInputEvent({ event })?.data.text ?? [])).toEqual(['A26 UCLA', 'A26 UCLA']);
  });
});
