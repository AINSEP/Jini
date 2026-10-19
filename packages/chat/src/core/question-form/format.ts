/**
 * @module question-form/format
 *
 * Answer presentation: turning a submitted answer set into the prose the
 * agent reads on its next turn, plus the label/value lookups also used by
 * `normalize.ts`'s default-value resolution. Split out of the original
 * single-file `question-form.ts`; see `../question-form.ts` for the public
 * facade.
 */
import { redactQuestionAnswers, isSecretQuestion } from './secret-answers.js';
import { CREDENTIAL_CARD_GUIDANCE, redactUserText } from '../user-text-redaction.js';
import type { FormOption, QuestionForm } from './types.js';

/**
 * Format a finished set of answers into a prose user message the agent can
 * read on its next turn. The shape is stable enough that the agent can
 * recognize "the form was answered" without any structured wrapper.
 *
 * @complexity O(q) in the number of questions on the form.
 */
export function formatFormAnswers({ form, answers }: { form: QuestionForm; answers: Record<string, string | string[]> }): string {
  const safe = redactQuestionAnswers({ form, answers });
  const lines: string[] = [];
  lines.push(`[form answers — ${form.id}]`);
  for (const q of form.questions) {
    lines.push(`- ${q.label}: ${answerDisplay(q, safe.answers[q.id])}`);
  }
  if (safe.secretRedacted || form.questions.some(question => isSecretQuestion({ question }))) lines.push(CREDENTIAL_CARD_GUIDANCE);
  return redactUserText({ text: lines.join('\n') }).text;
}

type OptionHolder = { options?: FormOption[] | undefined };

// Array entries are shown as given; a string answer is trimmed first. An
// empty answer of either shape reads as skipped.
function answerDisplay(question: OptionHolder, answer: string | string[] | undefined): string {
  if (Array.isArray(answer)) {
    return answer.length > 0 ? answer.map((value) => formOptionDisplayForValue(question, value)).join(', ') : '(skipped)';
  }
  const value = typeof answer === 'string' ? answer.trim() : '';
  return value ? formOptionDisplayForValue(question, value) : '(skipped)';
}

function findOption(question: OptionHolder, labelOrValue: string): FormOption | undefined {
  return question.options?.find((option) => option.value === labelOrValue || option.label === labelOrValue);
}

function formOptionDisplayForValue(question: OptionHolder, value: string): string {
  const match = findOption(question, value);
  if (!match) return value;
  if (match.value === match.label) return match.label;
  return `${match.label} [value: ${match.value}]`;
}

/** Resolve a submitted answer value back to its display label, or the value itself when unmatched. */
export function formOptionLabelForValue({ question, value }: { question: OptionHolder; value: string }): string {
  return findOption(question, value)?.label ?? value;
}

/** Resolve a label or value to the canonical option `value`, or the input itself when unmatched. */
export function formOptionValueForLabel({ question, labelOrValue }: { question: OptionHolder; labelOrValue: string }): string {
  return findOption(question, labelOrValue)?.value ?? labelOrValue;
}
