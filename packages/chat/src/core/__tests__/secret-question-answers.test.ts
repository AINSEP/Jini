import { expect, it } from 'vitest';
import { isSecretQuestion, redactQuestionAnswers, formatFormAnswers, parseQuestionForm } from '../question-form.js';
import { CREDENTIAL_CARD_GUIDANCE } from '../user-text-redaction.js';
it('recognizes credential labels, field names, and camelCase ids without matching keyboard', () => {
  for (const name of ['API key', 'accessToken', 'password', 'client_secret']) expect(isSecretQuestion({ question: { id: name, label: 'Input', type: 'text' } })).toBe(true);
  expect(isSecretQuestion({ question: { id: 'keyboard', label: 'Keyboard layout', type: 'text' } })).toBe(false);
  const form = parseQuestionForm({ input: '<question-form id="f">{"questions":[{"id":"q","name":"accessToken","label":"Access","type":"text"}]}</question-form>' });
  expect(form?.questions[0]?.name).toBe('accessToken');
});
it('guards short credential answers and model-bound formatted output while preserving normal prose', () => {
  const form = { id: 'f', title: 'Form', questions: [{ id: 'password', label: 'Password', type: 'text' as const }, { id: 'notes', label: 'Notes', type: 'text' as const }] };
  const answers = { password: 'short', notes: 'Preserve this prose.' };
  expect(redactQuestionAnswers({ form, answers })).toEqual({ answers: { password: '[token removed]', notes: 'Preserve this prose.' }, secretRedacted: true, count: 1 });
  expect(formatFormAnswers({ form, answers })).toBe('[form answers — f]\n- Password: [token removed]\n- Notes: Preserve this prose.\n' + CREDENTIAL_CARD_GUIDANCE);
});
