/** Chat question forms are model-visible text, never secure credential storage. */
import { redactUserText, type UserTextRedactionOptions, type UserTextRedaction } from '../user-text-redaction.js';
import type { FormQuestion, QuestionForm } from './types.js';

export function isSecretQuestion({ question }: { readonly question: Pick<FormQuestion, 'id' | 'label' | 'type' | 'name'> }): boolean {
  if (question.type !== 'text' && question.type !== 'textarea') return false;
  const names = [question.id, question.label, question.name ?? ''].join(' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return /(?:^|[^a-z0-9])(?:key|token|password|passwd|secret)(?:$|[^a-z0-9])/i.test(names);
}

/** The map as well as its formatted transcript must be safe: hosts often persist both. */
export function redactQuestionAnswers(
  { form, answers }: { readonly form: QuestionForm; readonly answers: Readonly<Record<string, string | string[]>> },
  options: UserTextRedactionOptions = {},
): { readonly answers: Record<string, string | string[]>; readonly secretRedacted: boolean; readonly count: number } {
  let count = 0;
  const cleaned: Record<string, string | string[]> = {};
  const redact = options.redactUserText ?? redactUserText;
  for (const question of form.questions) {
    const value = answers[question.id];
    if (value === undefined) continue;
    const guard = (text: string): string => {
      const result: UserTextRedaction = redact({ text }, { secretField: isSecretQuestion({ question }) });
      count += result.count;
      return result.text;
    };
    cleaned[question.id] = Array.isArray(value) ? value.map(guard) : guard(value);
  }
  if (count > 0) options.onSecretRedacted?.({ secretRedacted: true, count });
  return { answers: cleaned, secretRedacted: count > 0, count };
}

/** Never populate a credential text question from model-supplied defaults. */
export function withoutSecretQuestionDefaults({ form }: { readonly form: QuestionForm }): QuestionForm {
  return { ...form, questions: form.questions.map(question => {
    if (!isSecretQuestion({ question })) return question;
    const { defaultValue: _defaultValue, ...safe } = question;
    return safe;
  }) };
}

/** Attributes are presentation policy, shared by any host renderer. */
export function questionTextInputProps({ question }: { readonly question: FormQuestion }): { type: 'password' | 'text'; autoComplete?: string; spellCheck?: boolean } {
  return isSecretQuestion({ question }) ? { type: 'password', autoComplete: 'new-password', spellCheck: false } : { type: 'text' };
}

export function questionTextareaProps({ question }: { readonly question: FormQuestion }): { autoComplete?: string; spellCheck?: boolean; style?: { WebkitTextSecurity: string; whiteSpace: 'pre-wrap' } } {
  return isSecretQuestion({ question }) ? { autoComplete: 'off', spellCheck: false, style: { WebkitTextSecurity: 'disc', whiteSpace: 'pre-wrap' } } : {};
}
