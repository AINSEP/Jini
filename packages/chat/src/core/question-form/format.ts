/**
 * @module question-form/format
 *
 * Answer presentation: turning a submitted answer set into the prose the
 * agent reads on its next turn, plus the label/value lookups also used by
 * `normalize.ts`'s default-value resolution. Split out of the original
 * single-file `question-form.ts`; see `../question-form.ts` for the public
 * facade.
 */
import type { FormOption, QuestionForm } from './types.js';

/**
 * Format a finished set of answers into a prose user message the agent can
 * read on its next turn. The shape is stable enough that the agent can
 * recognize "the form was answered" without any structured wrapper.
 *
 * @complexity O(q) in the number of questions on the form.
 */
export function formatFormAnswers(form: QuestionForm, answers: Record<string, string | string[]>): string {
  const lines: string[] = [];
  lines.push(`[form answers — ${form.id}]`);
  for (const q of form.questions) {
    const v = answers[q.id];
    let display: string;
    if (Array.isArray(v)) {
      display = v.length > 0 ? v.map((value) => formOptionDisplayForValue(q, value)).join(', ') : '(skipped)';
    } else if (typeof v === 'string') {
      display = v.trim().length > 0 ? formOptionDisplayForValue(q, v.trim()) : '(skipped)';
    } else {
      display = '(skipped)';
    }
    lines.push(`- ${q.label}: ${display}`);
  }
  return lines.join('\n');
}

function formOptionDisplayForValue(question: { options?: FormOption[] | undefined }, value: string): string {
  const match = question.options?.find((option) => option.value === value || option.label === value);
  if (!match) return value;
  if (match.value === match.label) return match.label;
  return `${match.label} [value: ${match.value}]`;
}

/** Resolve a submitted answer value back to its display label, or the value itself when unmatched. */
export function formOptionLabelForValue(question: { options?: FormOption[] | undefined }, value: string): string {
  const match = question.options?.find((option) => option.value === value || option.label === value);
  return match?.label ?? value;
}

/** Resolve a label or value to the canonical option `value`, or the input itself when unmatched. */
export function formOptionValueForLabel(question: { options?: FormOption[] | undefined }, labelOrValue: string): string {
  const match = question.options?.find((option) => option.value === labelOrValue || option.label === labelOrValue);
  return match?.value ?? labelOrValue;
}
