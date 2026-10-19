import { CREDENTIAL_CARD_GUIDANCE, SECRET_REDACTED_NOTICE, type UserTextRedactionOptions } from '../../core/user-text-redaction.js';
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
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { DirectionCard, FormOption, QuestionForm as QuestionFormType } from '../../core/index.js';
import { formatFormAnswers, formOptionValueForLabel, redactQuestionAnswers, isSecretQuestion, withoutSecretQuestionDefaults, questionTextInputProps, questionTextareaProps } from '../../core/index.js';
import { useT } from '../hooks/context.js';

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
  { form: incomingForm, interactive, submittedAnswers, hideInternalSubmit = false, draftAnswers, onReadyChange, onDraftChange, onAnswerChange, onSubmit, redactUserText, onSecretRedacted },
  ref,
) {
  const t = useT();
  const form = useMemo(() => withoutSecretQuestionDefaults({ form: incomingForm }), [incomingForm]);
  const guard = useUserTextGuard({ ...(redactUserText ? { redactUserText } : {}), ...(onSecretRedacted ? { onSecretRedacted } : {}) });
  const locked = !interactive || !onSubmit || submittedAnswers !== undefined;
  const state = useQuestionAnswers({ form, submittedAnswers, draftAnswers, locked }, { onDraftChange, onAnswerChange });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onReadyChange, locked, ready]);

  return (
    <div className={`question-form${locked ? ' question-form-locked' : ''}`} data-form-id={form.id}>
      <QuestionFormHead form={form} locked={locked} />
      <div className="question-form-body">
        {form.questions.map((q) => (
          <QuestionField key={q.id} q={q} value={currentAnswers[q.id]} formId={form.id} locked={locked} t={t} {...state.handlers} />
        ))}
      </div>
      {guard.secretRedacted ? <div role="status">{t(SECRET_REDACTED_NOTICE)}</div> : null}
      {hideInternalSubmit ? null : <QuestionFormFoot locked={locked} answered={submittedAnswers !== undefined} ready={ready} submitLabel={form.submitLabel} onSubmit={handleSubmit} />}
    </div>
  );
});

type Question = QuestionFormType['questions'][number];
type Answers = Record<string, string | string[]>;

/** Owns the editable answers plus the picked files; every edit is a no-op once the form is locked. */
function useQuestionAnswers(
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
    const files = Array.from(list ?? []);
    const names = files.map((file) => file.name);
    setFileAnswers((current) => ({ ...current, [q.id]: files }));
    update(q.id, q.multiple ? names : (names[0] ?? ''));
  }

  return { answers, setAnswers, fileAnswers, handlers: { update, toggleCheckbox, updateCheckboxCustom, selectFiles } };
}

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

function QuestionFormHead({ form, locked }: { form: QuestionFormType; locked: boolean }) {
  const t = useT();
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

function QuestionFormFoot({ locked, answered, ready, submitLabel, onSubmit }: { locked: boolean; answered: boolean; ready: boolean; submitLabel: string | undefined; onSubmit: () => void }) {
  const t = useT();
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

/** Everything one question's control needs: its value plus the form-level edit handlers. */
type FieldHandlers = ReturnType<typeof useQuestionAnswers>['handlers'];
interface FieldContext extends FieldHandlers {
  q: Question;
  value: string | string[] | undefined;
  formId: string;
  locked: boolean;
  t: ReturnType<typeof useT>;
}

function QuestionField(ctx: FieldContext) {
  const { q, t } = ctx;
  const renderControl = QUESTION_CONTROLS[q.type];
  return (
    <div className="qf-field">
      <label className="qf-label">
        <span>{q.label}</span>
        {q.required ? (
          <span className="qf-required" aria-label={t('required')}>
            *
          </span>
        ) : null}
      </label>
      {q.help ? <div className="qf-help">{q.help}</div> : null}
      {isSecretQuestion({ question: q }) ? <div className="qf-help">{t(CREDENTIAL_CARD_GUIDANCE)}</div> : null}
      {renderControl ? renderControl(ctx) : null}
    </div>
  );
}

function stringValue(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

/** A range with no usable answer yet (e.g. mid-stream) shows its minimum, matching `emptyQuestionValue`. */
function rangeValue(q: Question, value: string | string[] | undefined): string {
  return typeof value === 'string' && value.trim() ? value : String(q.min ?? 0);
}

function customChoice({ q, t, locked }: FieldContext, value: string, onChange: (next: string) => void) {
  if (!shouldRenderCustomChoice(q)) return null;
  return <CustomChoiceInput label={q.customLabel ?? t('Something else')} value={value} placeholder={q.customPlaceholder ?? t('Type your own answer')} disabled={locked} onChange={onChange} />;
}

function singleCustomChoice(ctx: FieldContext) {
  return customChoice(ctx, customSingleValue(ctx.q, ctx.value), (next) => ctx.update(ctx.q.id, next));
}

function RadioControl(ctx: FieldContext) {
  const { q, value, formId, locked, update } = ctx;
  if (!q.options) return null;
  return (
    <>
      <div className="qf-options">
        {q.options.map((opt) => (
          <label key={opt.value} className={`qf-chip${value === opt.value ? ' qf-chip-on' : ''}`} title={opt.description}>
            <input type="radio" name={`${formId}-${q.id}`} value={opt.value} checked={value === opt.value} disabled={locked} aria-label={opt.label} onChange={() => update(q.id, opt.value)} />
            <OptionCopy option={opt} />
          </label>
        ))}
      </div>
      {singleCustomChoice(ctx)}
    </>
  );
}

function CheckboxControl(ctx: FieldContext) {
  const { q, value, locked, toggleCheckbox, updateCheckboxCustom } = ctx;
  if (!q.options) return null;
  const arr = Array.isArray(value) ? value : [];
  return (
    <>
      <div className="qf-options">
        {q.options.map((opt) => {
          const on = arr.includes(opt.value);
          const maxed = q.maxSelections !== undefined && !on && arr.length >= q.maxSelections;
          return (
            <label key={opt.value} title={opt.description} className={`qf-chip${on ? ' qf-chip-on' : ''}${maxed ? ' qf-chip-disabled' : ''}`}>
              <input type="checkbox" value={opt.value} checked={on} disabled={locked || maxed} aria-label={opt.label} onChange={() => toggleCheckbox(q.id, opt.value, q.maxSelections)} />
              <OptionCopy option={opt} />
            </label>
          );
        })}
      </div>
      {customChoice(ctx, customCheckboxValue(q, value), (next) => updateCheckboxCustom(q, next))}
    </>
  );
}

function SelectControl(ctx: FieldContext) {
  const { q, value, locked, t, update } = ctx;
  if (!q.options) return null;
  return (
    <>
      <select className="qf-select" value={typeof value === 'string' && questionValueIsKnown(q, value) ? value : ''} disabled={locked} onChange={(e) => update(q.id, e.target.value)}>
        <option value="" disabled>
          {q.placeholder ?? t('Choose one')}
        </option>
        {q.options.map((opt) => (
          <option key={opt.value} value={opt.value} title={opt.description}>
            {opt.label}
          </option>
        ))}
      </select>
      {singleCustomChoice(ctx)}
    </>
  );
}

function DirectionCardsControl(ctx: FieldContext) {
  const { q, value, formId, locked, update } = ctx;
  if (!q.cards || q.cards.length === 0) return null;
  return (
    <>
      <div className="qf-direction-cards">
        {q.cards.map((card) => (
          <DirectionCardView key={card.id} card={card} formId={formId} questionId={q.id} selected={value === card.id || value === card.label} disabled={locked} onSelect={() => update(q.id, card.id)} />
        ))}
      </div>
      {singleCustomChoice(ctx)}
    </>
  );
}

/** date/time/datetime-local and url/email/tel share one plain input whose `type` is the question type. */
function TypedInputControl({ q, value, locked, update }: FieldContext) {
  return <input type={q.type} className="qf-input" value={stringValue(value)} placeholder={q.placeholder} disabled={locked} onChange={(e) => update(q.id, e.target.value)} />;
}

const QUESTION_CONTROLS: Record<Question['type'], (ctx: FieldContext) => ReactNode> = {
  radio: RadioControl,
  checkbox: CheckboxControl,
  select: SelectControl,
  'direction-cards': DirectionCardsControl,
  text: ({ q, value, locked, update }) => <input {...questionTextInputProps({ question: q })} className="qf-input" value={stringValue(value)} placeholder={q.placeholder} disabled={locked} onChange={(e) => update(q.id, e.target.value)} />,
  number: ({ q, value, locked, update }) => <input type="number" className="qf-input" value={stringValue(value)} placeholder={q.placeholder} min={q.min} max={q.max} step={q.step} disabled={locked} onChange={(e) => update(q.id, e.target.value)} />,
  range: ({ q, value, locked, update }) => (
    <div className="qf-range-wrap">
      <input type="range" className="qf-range" value={rangeValue(q, value)} min={q.min} max={q.max} step={q.step} disabled={locked} onChange={(e) => update(q.id, e.target.value)} />
      <output className="qf-range-value">{rangeValue(q, value)}</output>
    </div>
  ),
  date: TypedInputControl,
  time: TypedInputControl,
  'datetime-local': TypedInputControl,
  url: TypedInputControl,
  email: TypedInputControl,
  tel: TypedInputControl,
  color: ({ q, value, locked, update }) => <input type="color" className="qf-color" value={normalizeColorInputValue(value)} disabled={locked} onChange={(e) => update(q.id, e.target.value)} />,
  file: ({ q, value, locked, selectFiles }) => (
    <div className="qf-file-wrap">
      <input type="file" className="qf-file" multiple={q.multiple} accept={q.accept} disabled={locked} onChange={(e) => selectFiles(q, e.target.files)} />
      {fileValueLabel(value) ? <div className="qf-file-summary">{fileValueLabel(value)}</div> : null}
    </div>
  ),
  switch: ({ q, value, locked, update }) => (
    <label className="qf-switch">
      <input type="checkbox" role="switch" checked={value === 'true'} disabled={locked} onChange={(e) => update(q.id, e.target.checked ? 'true' : 'false')} />
      <span aria-hidden />
    </label>
  ),
  textarea: ({ q, value, locked, update }) => <textarea {...questionTextareaProps({ question: q })} className="qf-textarea" value={stringValue(value)} placeholder={q.placeholder} disabled={locked} rows={3} onChange={(e) => update(q.id, e.target.value)} />,
};

function OptionCopy({ option }: { option: FormOption }) {
  return (
    <span className="qf-chip-copy">
      <span>{option.label}</span>
      {option.description ? <span className="qf-chip-desc">{option.description}</span> : null}
    </span>
  );
}

function CustomChoiceInput({ label, value, placeholder, disabled, onChange }: { label: string; value: string; placeholder: string; disabled: boolean; onChange: (value: string) => void }) {
  const chars = customInputCharCount(value, placeholder);
  return (
    <label className="qf-custom">
      <span>{label}</span>
      <input type="text" className="qf-input" value={value} placeholder={placeholder} disabled={disabled} style={{ '--qf-custom-chars': String(chars) } as CSSProperties} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function DirectionCardView({ card, formId, questionId, selected, disabled, onSelect }: { card: DirectionCard; formId: string; questionId: string; selected: boolean; disabled: boolean; onSelect: () => void }) {
  const t = useT();
  return (
    <label className={`qf-card${selected ? ' qf-card-on' : ''}${disabled ? ' qf-card-disabled' : ''}`}>
      <input type="radio" name={`${formId}-${questionId}`} value={card.id} checked={selected} disabled={disabled} onChange={() => onSelect()} />
      <div className="qf-card-head">
        <div className="qf-card-title">{card.label}</div>
        {selected ? <span className="qf-card-pill">{t('Selected')}</span> : null}
      </div>
      {card.palette.length > 0 ? (
        <div className="qf-card-swatches" aria-hidden>
          {card.palette.slice(0, 6).map((c, i) => (
            <span key={i} className="qf-card-swatch" style={{ background: c }} title={c} />
          ))}
        </div>
      ) : null}
      <div className="qf-card-types" aria-hidden>
        <span className="qf-card-type-display" style={{ fontFamily: card.displayFont }}>
          Aa
        </span>
        <span className="qf-card-type-body" style={{ fontFamily: card.bodyFont }}>
          {t('The quick brown fox')}
        </span>
      </div>
      {card.mood ? <p className="qf-card-mood">{card.mood}</p> : null}
      {card.references.length > 0 ? (
        <p className="qf-card-refs">
          <span className="qf-card-refs-label">{t('References:')}</span> {card.references.slice(0, 4).join(' · ')}
        </p>
      ) : null}
    </label>
  );
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

function collectFileSubmissions(form: QuestionFormType, fileAnswers: Record<string, File[]>): QuestionFormFileSubmission[] {
  const out: QuestionFormFileSubmission[] = [];
  for (const q of form.questions) {
    if (q.type !== 'file') continue;
    const files = fileAnswers[q.id] ?? [];
    if (files.length === 0) continue;
    out.push({ questionId: q.id, questionLabel: q.label, files });
  }
  return out;
}

function emptyQuestionValue(q: QuestionFormType['questions'][number]): string | string[] {
  if (q.type === 'checkbox') return [];
  if (q.type === 'switch') return 'false';
  if (q.type === 'range') return String(q.min ?? 0);
  if (q.type === 'color') return normalizeColorInputValue('');
  return '';
}

function canonicalizeQuestionValue(q: QuestionFormType['questions'][number], value: string | string[]): string | string[] {
  if (Array.isArray(value)) return value.map((entry) => formOptionValueForLabel({ question: q, labelOrValue: entry }));
  return formOptionValueForLabel({ question: q, labelOrValue: value });
}

function shouldRenderCustomChoice(q: QuestionFormType['questions'][number]): boolean {
  return q.allowCustom !== false;
}

function questionValueIsKnown(q: QuestionFormType['questions'][number], value: string): boolean {
  if (q.options?.some((option) => option.value === value || option.label === value)) return true;
  if (q.cards?.some((card) => card.id === value || card.label === value)) return true;
  return false;
}

function customSingleValue(q: QuestionFormType['questions'][number], value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  return questionValueIsKnown(q, value) ? '' : value;
}

function customCheckboxValue(q: QuestionFormType['questions'][number], value: string | string[] | undefined): string {
  if (!Array.isArray(value)) return '';
  return value.filter((entry) => !questionValueIsKnown(q, entry)).join(', ');
}

function splitCustomEntries(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function customInputCharCount(value: string, placeholder: string): number {
  const base = value.length > 0 ? value.length : Math.min(placeholder.length, 22);
  return Math.max(18, Math.min(base + 2, 72));
}

function normalizeColorInputValue(value: string | string[] | undefined): string {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
  return '#000000';
}

function fileValueLabel(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : '';
}
