import { SECRET_REDACTED_NOTICE, type UserTextRedactionOptions } from '../../core/user-text-redaction.js';
import { useUserTextGuard } from '../hooks/useUserTextGuard.js';
/**
 * @module QuestionForm
 *
 * Renders one parsed `<question-form>` as an interactive (or locked/
 * answered) set of controls. Ported from OD's `components/QuestionForm.tsx`
 * (verified 0 OD product references — the file only imports React,
 * `useT()`, and its own question-form types) against `@jini-ai/chat/core`'s
 * `QuestionForm`/`FormQuestion`/`FormOption`/`DirectionCard`/
 * `formatFormAnswers` (the same shapes, lifted verbatim into chat-core
 * already). className/structure kept verbatim (`question-form`/`qf-*`
 * classes — unstyled semantic markup, host supplies CSS); every user-facing
 * string wrapped in `useT()`.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo } from 'react';
import type { QuestionForm as QuestionFormType } from '../../core/index.js';
import { formatFormAnswers, redactQuestionAnswers, withoutSecretQuestionDefaults } from '../../core/index.js';
import { useT } from '../hooks/context.js';
import { useQuestionAnswers } from './QuestionForm.answers.hooks.js';
import { QuestionField } from './QuestionFormField.js';

export interface QuestionFormFileSubmission {
  questionId: string;
  questionLabel: string;
  files: File[];
}

export interface QuestionFormHandle {
  submit: () => void;
  /** Submit with no answers — every question is optional, so this records each as "(skipped)" and moves on. */
  skipAll: () => void;
}

export interface QuestionFormProps extends UserTextRedactionOptions {
  useTHook?: typeof useT;
  useUserTextGuardHook?: typeof useUserTextGuard;
  useQuestionAnswersHook?: typeof useQuestionAnswers;
  form: QuestionFormType;
  /** Whether the user can still submit answers — the host disables this once the turn is no longer the most recent one. */
  interactive: boolean;
  submittedAnswers?: Record<string, string | string[]>;
  /** When a host's own Continue button owns the submit, hide this form's footer button and report ready-state via `onReadyChange`. */
  hideInternalSubmit?: boolean;
  draftAnswers?: Record<string, string | string[]>;
  onReadyChange?: (ready: boolean) => void;
  onDraftChange?: (answers: Record<string, string | string[]>) => void;
  onAnswerChange?: (questionId: string, value: string | string[]) => void;
  onSubmit?: (text: string, answers: Record<string, string | string[]>, files?: QuestionFormFileSubmission[]) => void;
}

export const QuestionForm = forwardRef<QuestionFormHandle, QuestionFormProps>(function QuestionForm(
  { useTHook = useT, useUserTextGuardHook = useUserTextGuard, useQuestionAnswersHook = useQuestionAnswers, form: incomingForm, interactive, submittedAnswers, hideInternalSubmit = false, draftAnswers, onReadyChange, onDraftChange, onAnswerChange, onSubmit, redactUserText, onSecretRedacted },
  ref,
) {
  const t = useTHook();
  const form = useMemo(() => withoutSecretQuestionDefaults({ form: incomingForm }), [incomingForm]);
  const guard = useUserTextGuardHook({ ...(redactUserText ? { redactUserText } : {}), ...(onSecretRedacted ? { onSecretRedacted } : {}) });
  const locked = !interactive || !onSubmit || submittedAnswers !== undefined;
  const state = useQuestionAnswersHook({ form, submittedAnswers, draftAnswers, locked }, { onDraftChange, onAnswerChange });
  const currentAnswers = submittedAnswers ? redactQuestionAnswers({ form, answers: submittedAnswers }).answers : state.answers;
  const ready = answersReady(form, currentAnswers);

  function handleSubmit() {
    if (locked || !onSubmit) return;
    if (!ready) return;
    const safe = redactQuestionAnswers({ form, answers: state.answers }, { ...(redactUserText ? { redactUserText } : {}), onSecretRedacted: guard.notifyRedaction });
    state.setAnswers(safe.answers);
    const files = collectFileSubmissions(form, state.fileAnswers);
    if (files.length > 0) onSubmit(formatFormAnswers({ form: form, answers: safe.answers }), safe.answers, files);
    else onSubmit(formatFormAnswers({ form: form, answers: safe.answers }), safe.answers);
  }

  function handleSkipAll() {
    if (locked || !onSubmit) return;
    const empty: Record<string, string | string[]> = {};
    onSubmit(formatFormAnswers({ form: form, answers: empty }), empty);
  }

  useImperativeHandle(ref, () => ({ submit: handleSubmit, skipAll: handleSkipAll }));
  useEffect(() => {
    onReadyChange?.(!locked && ready);
  }, [onReadyChange, locked, ready]);

  return (
    <div className={`question-form${locked ? ' question-form-locked' : ''}`} data-form-id={form.id}>
      <QuestionFormHead form={form} locked={locked} t={t} />
      <div className="question-form-body">
        {form.questions.map((q) => (
          <QuestionField key={q.id} q={q} value={currentAnswers[q.id]} formId={form.id} locked={locked} t={t} {...state.handlers} />
        ))}
      </div>
      {guard.secretRedacted ? <div role="status">{t(SECRET_REDACTED_NOTICE)}</div> : null}
      {hideInternalSubmit ? null : <QuestionFormFoot locked={locked} answered={submittedAnswers !== undefined} ready={ready} submitLabel={form.submitLabel} onSubmit={handleSubmit} t={t} />}
    </div>
  );
});

type Answers = Record<string, string | string[]>;

function answersReady(form: QuestionFormType, answers: Answers): boolean {
  const withinSelectionLimits = form.questions.every((q) => {
    if (q.type !== 'checkbox' || q.maxSelections === undefined) return true;
    const v = answers[q.id];
    return !Array.isArray(v) || v.length <= q.maxSelections;
  });
  const requiredAnswered = form.questions.every((q) => {
    if (q.required !== true) return true;
    const v = answers[q.id];
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === 'string' && v.trim().length > 0;
  });
  return withinSelectionLimits && requiredAnswered;
}

function QuestionFormHead({ form, locked, t }: { t: ReturnType<typeof useT>; form: QuestionFormType; locked: boolean }) {
  return (
    <div className="question-form-head">
      <span className="question-form-icon" aria-hidden>
        ?
      </span>
      <div className="question-form-titles">
        <div className="question-form-title">{form.title}</div>
        {form.description ? <div className="question-form-desc">{form.description}</div> : null}
      </div>
      {locked ? <span className="question-form-pill">{t('Answered')}</span> : null}
    </div>
  );
}

function QuestionFormFoot({ locked, answered, ready, submitLabel, onSubmit, t }: { t: ReturnType<typeof useT>; locked: boolean; answered: boolean; ready: boolean; submitLabel: string | undefined; onSubmit: () => void }) {
  return (
    <div className="question-form-foot">
      {locked ? <span className="qf-locked-note">{answered ? t('You answered this') : t('A newer message answered this')}</span> : <span className="qf-hint">{t('Answer above, then continue')}</span>}
      {!locked ? (
        <button type="button" className="primary" onClick={onSubmit} disabled={!ready} title={ready ? t('Submit your answers') : t('Answer the required questions first')}>
          {submitLabel ?? t('Continue')}
        </button>
      ) : null}
    </div>
  );
}

function collectFileSubmissions(form: QuestionFormType, fileAnswers: Record<string, File[]>): QuestionFormFileSubmission[] {
  const out: QuestionFormFileSubmission[] = [];
  for (const q of form.questions) {
    if (q.type !== 'file') continue;
    const files = fileAnswers[q.id] ?? [];
    if (files.length > 0) out.push({ questionId: q.id, questionLabel: q.label, files });
  }
  return out;
}

