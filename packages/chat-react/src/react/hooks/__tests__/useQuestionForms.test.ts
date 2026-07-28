import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChatMessage, QuestionForm } from '@jini-ai/chat-core';
import { parseSubmittedAnswers, useQuestionForms } from '../useQuestionForms.js';

const FORM_CONTENT = `Let's clarify a few things.
<question-form id="discovery" title="Quick brief">
{
  "questions": [
    { "id": "platform", "label": "Platform", "type": "radio", "options": ["Mobile", "Desktop"], "required": true }
  ]
}
</question-form>`;

describe('useQuestionForms', () => {
  it('finds no forms in a plain conversation', () => {
    const messages: ChatMessage[] = [{ id: '1', role: 'user', content: 'hello' }];
    const { result } = renderHook(() => useQuestionForms(messages));
    expect(result.current.forms).toEqual([]);
    expect(result.current.activeForm).toBeNull();
  });

  it('marks the form on the most recent assistant message as active/interactive', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'help me build something' },
      { id: '2', role: 'assistant', content: FORM_CONTENT },
    ];
    const { result } = renderHook(() => useQuestionForms(messages));
    expect(result.current.forms).toHaveLength(1);
    expect(result.current.activeForm?.form.id).toBe('discovery');
    expect(result.current.activeForm?.interactive).toBe(true);
    expect(result.current.activeForm?.submittedAnswers).toBeUndefined();
  });

  it('recovers submitted answers from the following user message and marks the form non-interactive', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'help me build something' },
      { id: '2', role: 'assistant', content: FORM_CONTENT },
      { id: '3', role: 'user', content: '[form answers — discovery]\n- Platform: Mobile' },
    ];
    const { result } = renderHook(() => useQuestionForms(messages));
    const form = result.current.forms[0]!;
    expect(form.interactive).toBe(false);
    expect(form.submittedAnswers).toEqual({ platform: 'Mobile' });
    expect(result.current.activeForm).toBeNull();
  });

  it('buildSubmission formats answers into the transcript-safe text the host sends back', () => {
    const messages: ChatMessage[] = [{ id: '2', role: 'assistant', content: FORM_CONTENT }];
    const { result } = renderHook(() => useQuestionForms(messages));
    const form = result.current.forms[0]!.form;
    const text = result.current.buildSubmission(form, { platform: 'Mobile' });
    expect(text).toContain('[form answers — discovery]');
    expect(text).toContain('Platform: Mobile');
  });

  it('an older form is not interactive once a newer assistant message exists', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'assistant', content: FORM_CONTENT },
      { id: '2', role: 'assistant', content: 'moving on without answering' },
    ];
    const { result } = renderHook(() => useQuestionForms(messages));
    expect(result.current.forms[0]?.interactive).toBe(false);
    expect(result.current.activeForm).toBeNull();
  });

  it('returns empty results for an undefined messages array', () => {
    const { result } = renderHook(() => useQuestionForms(undefined));
    expect(result.current.forms).toEqual([]);
    expect(result.current.activeForm).toBeNull();
  });

  it('returns empty results for an empty messages array', () => {
    const { result } = renderHook(() => useQuestionForms([]));
    expect(result.current.forms).toEqual([]);
    expect(result.current.activeForm).toBeNull();
  });

  it('treats a following user message that is not a recognizable form-answers reply as unsubmitted (the ?? undefined fallback)', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'help me build something' },
      { id: '2', role: 'assistant', content: FORM_CONTENT },
      { id: '3', role: 'user', content: 'just a normal follow-up message, not a form reply' },
    ];
    const { result } = renderHook(() => useQuestionForms(messages));
    const form = result.current.forms[0]!;
    expect(form.submittedAnswers).toBeUndefined();
    // Not the last message anymore, so it's also not interactive.
    expect(form.interactive).toBe(false);
  });
});

describe('parseSubmittedAnswers', () => {
  const radioForm: QuestionForm = {
    id: 'discovery',
    title: 'Quick brief',
    questions: [{ id: 'platform', label: 'Platform', type: 'radio', options: [{ label: 'Mobile (iOS/Android)', value: 'mobile' }] }],
  };

  const checkboxForm: QuestionForm = {
    id: 'discovery',
    title: 'Quick brief',
    questions: [{ id: 'colors', label: 'Colors', type: 'checkbox', options: [{ label: 'Red', value: 'red' }, { label: 'Blue', value: 'blue' }] }],
  };

  it('returns null when the message has no "[form answers" header at all', () => {
    expect(parseSubmittedAnswers(radioForm, "Sure, let's keep going.")).toBeNull();
  });

  it('returns null when the header matches but no body line is recognized', () => {
    const content = '[form answers — discovery]\nNo structured info here, just prose.';
    expect(parseSubmittedAnswers(radioForm, content)).toBeNull();
  });

  it('skips unrecognized-label lines and non-matching lines while keeping recognized ones', () => {
    const content = ['[form answers — discovery]', '- Platform: Mobile (iOS/Android)', '- Unknown Field: whatever', 'a plain sentence with no colon-prefix'].join('\n');
    const answers = parseSubmittedAnswers(radioForm, content);
    expect(answers).toEqual({ platform: 'mobile' });
  });

  it('decodes a "[value: ...]" suffix back to the option value for a single-answer question', () => {
    const content = '[form answers — discovery]\n- Platform: Mobile (iOS/Android) [value: mobile]';
    expect(parseSubmittedAnswers(radioForm, content)).toEqual({ platform: 'mobile' });
  });

  it('treats "(skipped)" as an empty answer for a single-answer question', () => {
    const content = '[form answers — discovery]\n- Platform: (Skipped)';
    expect(parseSubmittedAnswers(radioForm, content)).toEqual({ platform: '' });
  });

  it('decodes a comma-separated checkbox answer, stripping "[value: ...]" suffixes and filtering "(skipped)"/empty tokens', () => {
    const content = '[form answers — discovery]\n- Colors: Red, Blue [value: blue], (skipped),, ';
    const answers = parseSubmittedAnswers(checkboxForm, content);
    expect(answers).toEqual({ colors: ['red', 'blue'] });
  });
});
