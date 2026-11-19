import { useEffect, useMemo, useState } from 'react';
import type { QuestionForm as QuestionFormType } from '../../core/index.js';
import { redactQuestionAnswers } from '../../core/index.js';
import type { QuestionFormProps } from './QuestionForm.js';
import { canonicalizeQuestionValue, emptyQuestionValue, questionValueIsKnown, splitCustomEntries } from './QuestionForm.values.js';

type Question = QuestionFormType['questions'][number];
type Answers = Record<string, string | string[]>;

/** Owns the editable answers plus the picked files; every edit is a no-op once the form is locked. */
export function useQuestionAnswers(
  { form, submittedAnswers, draftAnswers, locked }: { form: QuestionFormType; submittedAnswers: Answers | undefined; draftAnswers: Answers | undefined; locked: boolean },
  { onDraftChange, onAnswerChange }: { onDraftChange?: QuestionFormProps['onDraftChange'] | undefined; onAnswerChange?: QuestionFormProps['onAnswerChange'] | undefined } = {},
) {
  const initial = useMemo(() => buildInitialState(form, submittedAnswers, draftAnswers), [form, submittedAnswers, draftAnswers]);
  const [answers, setAnswers] = useState<Answers>(initial);
  const [fileAnswers, setFileAnswers] = useState<Record<string, File[]>>({});
  useEffect(() => {
    setFileAnswers({});
  }, [form.id]);
  useEffect(() => {
    setAnswers((prev) => backfillAnswers(prev, form, submittedAnswers));
  }, [form, submittedAnswers]);
  function update(id: string, value: string | string[]) {
    if (locked) return;
    const next = { ...answers, [id]: value };
    setAnswers(next);
    onDraftChange?.(redactQuestionAnswers({ form, answers: draftSafeAnswers(form, next) }).answers);
    onAnswerChange?.(id, redactQuestionAnswers({ form, answers: { [id]: value } }).answers[id]!);
  }
  function toggleCheckbox(id: string, option: string, maxSelections?: number) {
    if (locked) return;
    const current = Array.isArray(answers[id]) ? (answers[id] as string[]) : [];
    const has = current.includes(option);
    if (!has && maxSelections !== undefined && current.length >= maxSelections) return;
    const next = has ? current.filter((v) => v !== option) : [...current, option];
    const nextAnswers = { ...answers, [id]: next };
    setAnswers(nextAnswers);
    onDraftChange?.(redactQuestionAnswers({ form, answers: draftSafeAnswers(form, nextAnswers) }).answers);
    onAnswerChange?.(id, next);
  }
  function updateCheckboxCustom(q: Question, raw: string) {
    if (locked) return;
    const current = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
    const fixed = current.filter((entry) => questionValueIsKnown(q, entry));
    update(q.id, [...fixed, ...splitCustomEntries(raw)]);
  }
  function selectFiles(q: Question, list: FileList | null) {
    const files = Array.from(list ?? []), names = files.map((file) => file.name);
    setFileAnswers((current) => ({ ...current, [q.id]: files }));
    update(q.id, q.multiple ? names : (names[0] ?? ''));
  }
  return { answers, setAnswers, fileAnswers, handlers: { update, toggleCheckbox, updateCheckboxCustom, selectFiles } };
}

function buildInitialState(form: QuestionFormType, submitted: Answers | undefined, draft: Answers | undefined): Answers {
  const out: Answers = {};
  for (const q of form.questions) out[q.id] = initialQuestionValue(q, submitted, draft);
  return out;
}

/** Submitted beats draft beats default beats empty; file drafts are never restored (the File objects are gone). */
function initialQuestionValue(q: Question, submitted: Answers | undefined, draft: Answers | undefined): string | string[] {
  if (submitted?.[q.id] !== undefined) return canonicalizeQuestionValue(q, submitted[q.id]!);
  if (draft?.[q.id] !== undefined && q.type !== 'file') return canonicalizeQuestionValue(q, draft[q.id]!);
  if (q.defaultValue !== undefined) return canonicalizeQuestionValue(q, q.defaultValue);
  return emptyQuestionValue(q);
}

/** Questions that stream in after mount get their initial value; answers already set are kept. */
function backfillAnswers(prev: Answers, form: QuestionFormType, submitted: Answers | undefined): Answers {
  let changed = false;
  const next = { ...prev };
  for (const q of form.questions) {
    if (next[q.id] !== undefined) continue;
    changed = true;
    next[q.id] = initialQuestionValue(q, submitted, undefined);
  }
  return changed ? next : prev;
}

function draftSafeAnswers(form: QuestionFormType, answers: Record<string, string | string[]>): Record<string, string | string[]> {
  const fileQuestionIds = new Set(form.questions.filter((q) => q.type === 'file').map((q) => q.id));
  if (fileQuestionIds.size === 0) return answers;
  const out: Record<string, string | string[]> = {};
  for (const [id, value] of Object.entries(answers)) {
    if (!fileQuestionIds.has(id)) out[id] = value;
  }
  return out;
}

