import { describe, expect, it } from 'vitest';
import { CREDENTIAL_CARD_GUIDANCE } from '../../user-text-redaction.js';
import { formatFormAnswers } from '../format.js';
import type { FormQuestion, QuestionForm } from '../types.js';

const form = (questions: FormQuestion[]): QuestionForm => ({ id: 'f', title: 'T', questions });
const choice: FormQuestion = { id: 'c', label: 'Choice', type: 'radio', options: [{ label: 'Yes', value: 'y' }, { label: 'No', value: 'No' }] };

describe('formatFormAnswers', () => {
  it('trims a string answer before matching it to an option', () => {
    expect(formatFormAnswers({ form: form([choice]), answers: { c: '  y ' } })).toBe('[form answers — f]\n- Choice: Yes [value: y]');
  });

  it('joins every array entry as given, including an empty one', () => {
    expect(formatFormAnswers({ form: form([choice]), answers: { c: ['No', ''] } })).toBe('[form answers — f]\n- Choice: No, ');
  });

  it('marks a question with no answer at all as skipped', () => {
    expect(formatFormAnswers({ form: form([choice]), answers: {} })).toBe('[form answers — f]\n- Choice: (skipped)');
  });

  it('appends the credential guidance when the form has a secret question, even if it was skipped', () => {
    const secret: FormQuestion = { id: 'api_key', label: 'API key', type: 'text' };
    expect(formatFormAnswers({ form: form([secret]), answers: {} })).toBe(`[form answers — f]\n- API key: (skipped)\n${CREDENTIAL_CARD_GUIDANCE}`);
  });

  it('appends the credential guidance when a non-secret answer had a secret redacted from it', () => {
    const notes: FormQuestion = { id: 'notes', label: 'Notes', type: 'textarea' };
    const out = formatFormAnswers({ form: form([notes]), answers: { notes: `use ghp_${'a'.repeat(36)} please` } });
    expect(out).not.toContain('ghp_');
    expect(out.endsWith(CREDENTIAL_CARD_GUIDANCE)).toBe(true);
  });

  it('omits the credential guidance for an ordinary form', () => {
    expect(formatFormAnswers({ form: form([choice]), answers: { c: 'y' } })).not.toContain(CREDENTIAL_CARD_GUIDANCE);
  });
});
