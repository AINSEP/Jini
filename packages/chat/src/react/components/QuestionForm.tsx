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
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState, type CSSProperties } from 'react';
import type { DirectionCard, FormOption, QuestionForm as QuestionFormType } from '@jini-ai/chat/core';
import { formatFormAnswers, formOptionValueForLabel } from '@jini-ai/chat/core';
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

export interface QuestionFormProps {
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
  { form, interactive, submittedAnswers, hideInternalSubmit = false, draftAnswers, onReadyChange, onDraftChange, onAnswerChange, onSubmit },
  ref,
) {
  const t = useT();
  const initial = useMemo(() => buildInitialState(form, submittedAnswers, draftAnswers), [form, submittedAnswers, draftAnswers]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(initial);
  const [fileAnswers, setFileAnswers] = useState<Record<string, File[]>>({});
  const locked = !interactive || !onSubmit || submittedAnswers !== undefined;
  const currentAnswers = submittedAnswers ?? answers;

  useEffect(() => {
    setFileAnswers({});
  }, [form.id]);

  useEffect(() => {
    setAnswers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const q of form.questions) {
        if (next[q.id] !== undefined) continue;
        changed = true;
        if (submittedAnswers && submittedAnswers[q.id] !== undefined) {
          next[q.id] = canonicalizeQuestionValue(q, submittedAnswers[q.id]!);
        } else if (q.defaultValue !== undefined) {
          next[q.id] = canonicalizeQuestionValue(q, q.defaultValue);
        } else {
          next[q.id] = emptyQuestionValue(q);
        }
      }
      return changed ? next : prev;
    });
  }, [form, submittedAnswers]);

  function update(id: string, value: string | string[]) {
    if (locked) return;
    const next = { ...answers, [id]: value };
    setAnswers(next);
    onDraftChange?.(draftSafeAnswers(form, next));
    onAnswerChange?.(id, value);
  }

  function toggleCheckbox(id: string, option: string, maxSelections?: number) {
    if (locked) return;
    const current = Array.isArray(answers[id]) ? (answers[id] as string[]) : [];
    const has = current.includes(option);
    if (!has && maxSelections !== undefined && current.length >= maxSelections) return;
    const next = has ? current.filter((v) => v !== option) : [...current, option];
    const nextAnswers = { ...answers, [id]: next };
    setAnswers(nextAnswers);
    onDraftChange?.(draftSafeAnswers(form, nextAnswers));
    onAnswerChange?.(id, next);
  }

  function updateCheckboxCustom(q: QuestionFormType['questions'][number], raw: string) {
    if (locked) return;
    const current = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
    const fixed = current.filter((entry) => questionValueIsKnown(q, entry));
    update(q.id, [...fixed, ...splitCustomEntries(raw)]);
  }

  function handleSubmit() {
    if (locked || !onSubmit) return;
    if (!ready) return;
    const files = collectFileSubmissions(form, fileAnswers);
    if (files.length > 0) onSubmit(formatFormAnswers(form, answers), answers, files);
    else onSubmit(formatFormAnswers(form, answers), answers);
  }

  function handleSkipAll() {
    if (locked || !onSubmit) return;
    const empty: Record<string, string | string[]> = {};
    onSubmit(formatFormAnswers(form, empty), empty);
  }

  const withinSelectionLimits = form.questions.every((q) => {
    if (q.type !== 'checkbox' || q.maxSelections === undefined) return true;
    const v = currentAnswers[q.id];
    return !Array.isArray(v) || v.length <= q.maxSelections;
  });
  const requiredAnswered = form.questions.every((q) => {
    if (q.required !== true) return true;
    const v = currentAnswers[q.id];
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === 'string' && v.trim().length > 0;
  });
  const ready = withinSelectionLimits && requiredAnswered;

  useImperativeHandle(ref, () => ({ submit: handleSubmit, skipAll: handleSkipAll }));
  useEffect(() => {
    onReadyChange?.(!locked && ready);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onReadyChange, locked, ready]);

  return (
    <div className={`question-form${locked ? ' question-form-locked' : ''}`} data-form-id={form.id}>
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
      <div className="question-form-body">
        {form.questions.map((q) => {
          const value = currentAnswers[q.id];
          return (
            <div key={q.id} className="qf-field">
              <label className="qf-label">
                <span>{q.label}</span>
                {q.required ? (
                  <span className="qf-required" aria-label={t('required')}>
                    *
                  </span>
                ) : null}
              </label>
              {q.help ? <div className="qf-help">{q.help}</div> : null}
              {q.type === 'radio' && q.options ? (
                <div className="qf-options">
                  {q.options.map((opt) => (
                    <label key={opt.value} className={`qf-chip${value === opt.value ? ' qf-chip-on' : ''}`} title={opt.description}>
                      <input type="radio" name={`${form.id}-${q.id}`} value={opt.value} checked={value === opt.value} disabled={locked} aria-label={opt.label} onChange={() => update(q.id, opt.value)} />
                      <OptionCopy option={opt} />
                    </label>
                  ))}
                </div>
              ) : null}
              {q.type === 'radio' && q.options && shouldRenderCustomChoice(q) ? (
                <CustomChoiceInput
                  label={q.customLabel ?? t('Something else')}
                  value={customSingleValue(q, value)}
                  placeholder={q.customPlaceholder ?? t('Type your own answer')}
                  disabled={locked}
                  onChange={(next) => update(q.id, next)}
                />
              ) : null}
              {q.type === 'checkbox' && q.options ? (
                <div className="qf-options">
                  {q.options.map((opt) => {
                    const arr = Array.isArray(value) ? value : [];
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
              ) : null}
              {q.type === 'checkbox' && q.options && shouldRenderCustomChoice(q) ? (
                <CustomChoiceInput
                  label={q.customLabel ?? t('Something else')}
                  value={customCheckboxValue(q, value)}
                  placeholder={q.customPlaceholder ?? t('Type your own answer')}
                  disabled={locked}
                  onChange={(next) => updateCheckboxCustom(q, next)}
                />
              ) : null}
              {q.type === 'select' && q.options ? (
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
              ) : null}
              {q.type === 'select' && q.options && shouldRenderCustomChoice(q) ? (
                <CustomChoiceInput
                  label={q.customLabel ?? t('Something else')}
                  value={customSingleValue(q, value)}
                  placeholder={q.customPlaceholder ?? t('Type your own answer')}
                  disabled={locked}
                  onChange={(next) => update(q.id, next)}
                />
              ) : null}
              {q.type === 'text' ? <input type="text" className="qf-input" value={typeof value === 'string' ? value : ''} placeholder={q.placeholder} disabled={locked} onChange={(e) => update(q.id, e.target.value)} /> : null}
              {q.type === 'number' ? <input type="number" className="qf-input" value={typeof value === 'string' ? value : ''} placeholder={q.placeholder} min={q.min} max={q.max} step={q.step} disabled={locked} onChange={(e) => update(q.id, e.target.value)} /> : null}
              {q.type === 'range' ? (
                <div className="qf-range-wrap">
                  <input type="range" className="qf-range" value={typeof value === 'string' && value.trim() ? value : String(q.min ?? 0)} min={q.min} max={q.max} step={q.step} disabled={locked} onChange={(e) => update(q.id, e.target.value)} />
                  <output className="qf-range-value">{typeof value === 'string' && value.trim() ? value : String(q.min ?? 0)}</output>
                </div>
              ) : null}
              {q.type === 'date' || q.type === 'time' || q.type === 'datetime-local' ? <input type={q.type} className="qf-input" value={typeof value === 'string' ? value : ''} placeholder={q.placeholder} disabled={locked} onChange={(e) => update(q.id, e.target.value)} /> : null}
              {q.type === 'color' ? <input type="color" className="qf-color" value={normalizeColorInputValue(value)} disabled={locked} onChange={(e) => update(q.id, e.target.value)} /> : null}
              {q.type === 'url' || q.type === 'email' || q.type === 'tel' ? <input type={q.type} className="qf-input" value={typeof value === 'string' ? value : ''} placeholder={q.placeholder} disabled={locked} onChange={(e) => update(q.id, e.target.value)} /> : null}
              {q.type === 'file' ? (
                <div className="qf-file-wrap">
                  <input
                    type="file"
                    className="qf-file"
                    multiple={q.multiple}
                    accept={q.accept}
                    disabled={locked}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      const names = files.map((file) => file.name);
                      setFileAnswers((current) => ({ ...current, [q.id]: files }));
                      update(q.id, q.multiple ? names : (names[0] ?? ''));
                    }}
                  />
                  {fileValueLabel(value) ? <div className="qf-file-summary">{fileValueLabel(value)}</div> : null}
                </div>
              ) : null}
              {q.type === 'switch' ? (
                <label className="qf-switch">
                  <input type="checkbox" role="switch" checked={value === 'true'} disabled={locked} onChange={(e) => update(q.id, e.target.checked ? 'true' : 'false')} />
                  <span aria-hidden />
                </label>
              ) : null}
              {q.type === 'textarea' ? <textarea className="qf-textarea" value={typeof value === 'string' ? value : ''} placeholder={q.placeholder} disabled={locked} rows={3} onChange={(e) => update(q.id, e.target.value)} /> : null}
              {q.type === 'direction-cards' && q.cards && q.cards.length > 0 ? (
                <div className="qf-direction-cards">
                  {q.cards.map((card) => (
                    <DirectionCardView key={card.id} card={card} formId={form.id} questionId={q.id} selected={value === card.id || value === card.label} disabled={locked} onSelect={() => update(q.id, card.id)} />
                  ))}
                </div>
              ) : null}
              {q.type === 'direction-cards' && q.cards && q.cards.length > 0 && shouldRenderCustomChoice(q) ? (
                <CustomChoiceInput
                  label={q.customLabel ?? t('Something else')}
                  value={customSingleValue(q, value)}
                  placeholder={q.customPlaceholder ?? t('Type your own answer')}
                  disabled={locked}
                  onChange={(next) => update(q.id, next)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {hideInternalSubmit ? null : (
        <div className="question-form-foot">
          {locked ? <span className="qf-locked-note">{submittedAnswers ? t('You answered this') : t('A newer message answered this')}</span> : <span className="qf-hint">{t('Answer above, then continue')}</span>}
          {!locked ? (
            <button type="button" className="primary" onClick={handleSubmit} disabled={!ready} title={ready ? t('Submit your answers') : t('Answer the required questions first')}>
              {form.submitLabel ?? t('Continue')}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
});

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

function buildInitialState(form: QuestionFormType, submitted: Record<string, string | string[]> | undefined, draft: Record<string, string | string[]> | undefined): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const q of form.questions) {
    if (submitted && submitted[q.id] !== undefined) {
      out[q.id] = canonicalizeQuestionValue(q, submitted[q.id]!);
      continue;
    }
    if (draft && draft[q.id] !== undefined && q.type !== 'file') {
      out[q.id] = canonicalizeQuestionValue(q, draft[q.id]!);
      continue;
    }
    if (q.defaultValue !== undefined) {
      out[q.id] = canonicalizeQuestionValue(q, q.defaultValue);
      continue;
    }
    out[q.id] = emptyQuestionValue(q);
  }
  return out;
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
  if (Array.isArray(value)) return value.map((entry) => formOptionValueForLabel(q, entry));
  return formOptionValueForLabel(q, value);
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
