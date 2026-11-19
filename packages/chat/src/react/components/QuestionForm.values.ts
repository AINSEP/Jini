import type { QuestionForm as QuestionFormType } from '../../core/index.js';
import { formOptionValueForLabel } from '../../core/index.js';
export type AnswerValue = string | string[] | undefined;

export function emptyQuestionValue(q: QuestionFormType['questions'][number]): string | string[] {
  if (q.type === 'checkbox') return [];
  if (q.type === 'switch') return 'false';
  if (q.type === 'range') return String(q.min ?? 0);
  if (q.type === 'color') return normalizeColorInputValue('');
  return '';
}

export function canonicalizeQuestionValue(q: QuestionFormType['questions'][number], value: string | string[]): string | string[] {
  if (Array.isArray(value)) return value.map((entry) => formOptionValueForLabel({ question: q, labelOrValue: entry }));
  return formOptionValueForLabel({ question: q, labelOrValue: value });
}

export function shouldRenderCustomChoice(q: QuestionFormType['questions'][number]): boolean {
  return q.allowCustom !== false;
}

export function questionValueIsKnown(q: QuestionFormType['questions'][number], value: string): boolean {
  if (q.options?.some((option) => option.value === value || option.label === value)) return true;
  if (q.cards?.some((card) => card.id === value || card.label === value)) return true;
  return false;
}

export function customSingleValue(q: QuestionFormType['questions'][number], value: AnswerValue): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  return questionValueIsKnown(q, value) ? '' : value;
}

export function customCheckboxValue(q: QuestionFormType['questions'][number], value: AnswerValue): string {
  if (!Array.isArray(value)) return '';
  return value.filter((entry) => !questionValueIsKnown(q, entry)).join(', ');
}

export function splitCustomEntries(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function customInputCharCount(value: string, placeholder: string): number {
  const base = value.length > 0 ? value.length : Math.min(placeholder.length, 22);
  return Math.max(18, Math.min(base + 2, 72));
}

export function normalizeColorInputValue(value: AnswerValue): string {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
  return '#000000';
}

export function fileValueLabel(value: AnswerValue): string {
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : '';
}
