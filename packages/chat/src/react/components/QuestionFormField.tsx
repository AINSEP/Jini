import { useId, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';
import { SecretInput, SecretTextarea } from '@jini-ai/ui';
import type { DirectionCard, FormOption, QuestionForm as QuestionFormType } from '../../core/index.js';
import { isSecretQuestion, questionTextInputProps, questionTextareaProps } from '../../core/index.js';
import { CREDENTIAL_CARD_GUIDANCE } from '../../core/user-text-redaction.js';
import type { useT } from '../hooks/context.js';
import type { useQuestionAnswers } from './QuestionForm.answers.hooks.js';
import { shouldRenderCustomChoice, questionValueIsKnown, customSingleValue, customCheckboxValue, customInputCharCount, normalizeColorInputValue, fileValueLabel, type AnswerValue } from './QuestionForm.values.js';
type Question = QuestionFormType['questions'][number];

/** Everything one question's control needs: its value plus the form-level edit handlers. */
type FieldHandlers = ReturnType<typeof useQuestionAnswers>['handlers'];
interface FieldContext extends FieldHandlers {
  q: Question;
  value: AnswerValue;
  formId: string;
  locked: boolean;
  t: ReturnType<typeof useT>;
}

/** A field context plus the id its single control carries so the visible `<label>` can point at it. */
interface ControlContext extends FieldContext {
  controlId: string;
}

function questionHelpId(formId: string, q: Question): string {
  return `${formId}-${q.id}-help`;
}

/** Required state and help-text link for a control; each attribute is omitted when it does not apply. */
function fieldAria(formId: string, q: Question) {
  return { 'aria-required': q.required || undefined, 'aria-describedby': q.help ? questionHelpId(formId, q) : undefined };
}

/** Controls that are ONE focusable element; radio/checkbox/card groups are many, so a single `for` would mislabel them. */
const SINGLE_CONTROL_TYPES: ReadonlySet<Question['type']> = new Set(['text', 'textarea', 'select', 'number', 'range', 'date', 'time', 'datetime-local', 'url', 'email', 'tel', 'color', 'file', 'switch']);

export function QuestionField(ctx: FieldContext) {
  const { q, t } = ctx;
  const renderControl = QUESTION_CONTROLS[q.type];
  // Why useId: the same question id can render in two forms on one page, so an id built from
  // `q.id` could collide and point a label at the wrong form's control.
  const controlId = useId();
  return (
    <div className="qf-field">
      <label className="qf-label" htmlFor={SINGLE_CONTROL_TYPES.has(q.type) ? controlId : undefined}>
        <span>{q.label}</span>
        {q.required ? (
          <span className="qf-required" aria-label={t('required')}>
            *
          </span>
        ) : null}
      </label>
      {q.help ? <div className="qf-help" id={questionHelpId(ctx.formId, q)}>{q.help}</div> : null}
      {isSecretQuestion({ question: q }) ? <div className="qf-help">{t(CREDENTIAL_CARD_GUIDANCE)}</div> : null}
      {renderControl ? renderControl({ ...ctx, controlId }) : null}
    </div>
  );
}

function stringValue(value: AnswerValue): string {
  return typeof value === 'string' ? value : '';
}

/** A range with no usable answer yet (e.g. mid-stream) shows its minimum, matching `emptyQuestionValue`. */
function rangeValue(q: Question, value: AnswerValue): string {
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

function SelectControl(ctx: ControlContext) {
  const { q, value, locked, t, update } = ctx;
  if (!q.options) return null;
  return (
    <>
      <select id={ctx.controlId} className="qf-select" aria-label={q.label} {...fieldAria(ctx.formId, q)} value={typeof value === 'string' && questionValueIsKnown({ q, value }) ? value : ''} disabled={locked} onChange={(e) => update(q.id, e.target.value)}>
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
  const { q, value, formId, locked, update, t } = ctx;
  if (!q.cards || q.cards.length === 0) return null;
  return (
    <>
      <div className="qf-direction-cards">
        {q.cards.map((card) => (
          <DirectionCardView key={card.id} card={card} formId={formId} questionId={q.id} selected={value === card.id || value === card.label} disabled={locked} onSelect={() => update(q.id, card.id)} t={t} />
        ))}
      </div>
      {singleCustomChoice(ctx)}
    </>
  );
}

/** A credential-shaped text question gets the shared eye toggle (hidden by default). */
function TextControl({ q, value, locked, update, t, formId, controlId }: ControlContext) {
  const shared = { id: controlId, className: 'qf-input', value: stringValue(value), placeholder: q.placeholder, disabled: locked, onChange: (e: ChangeEvent<HTMLInputElement>) => update(q.id, e.target.value) };
  const props = questionTextInputProps({ question: q });
  const { type, ...secretProps } = props;
  if (type === 'password') {
    return <SecretInput {...secretProps} {...shared} aria-label={q.label} label={q.label} toggleLabels={{ show: `${t('Show')} ${q.label}`, hide: `${t('Hide')} ${q.label}` }} />;
  }
  return <input {...props} {...shared} aria-label={q.label} {...fieldAria(formId, q)} />;
}

/** A credential-shaped textarea gets the same eye toggle; `SecretTextarea` owns the masking style. */
function TextareaControl({ q, value, locked, update, t, formId, controlId }: ControlContext) {
  const shared = { id: controlId, className: 'qf-textarea', value: stringValue(value), placeholder: q.placeholder, disabled: locked, rows: 3, onChange: (e: ChangeEvent<HTMLTextAreaElement>) => update(q.id, e.target.value) };
  const props = questionTextareaProps({ question: q });
  if (isSecretQuestion({ question: q })) {
    return <SecretTextarea {...props} {...shared} aria-label={q.label} label={q.label} toggleLabels={{ show: `${t('Show')} ${q.label}`, hide: `${t('Hide')} ${q.label}` }} />;
  }
  return <textarea {...props} {...shared} aria-label={q.label} {...fieldAria(formId, q)} />;
}

/** date/time/datetime-local and url/email/tel share one plain input whose `type` is the question type. */
function TypedInputControl({ q, value, locked, update, formId, controlId }: ControlContext) {
  return <input id={controlId} type={q.type} className="qf-input" aria-label={q.label} {...fieldAria(formId, q)} value={stringValue(value)} placeholder={q.placeholder} disabled={locked} onChange={(e) => update(q.id, e.target.value)} />;
}

const QUESTION_CONTROLS: Record<Question['type'], (ctx: ControlContext) => ReactNode> = {
  radio: RadioControl,
  checkbox: CheckboxControl,
  select: SelectControl,
  'direction-cards': DirectionCardsControl,
  text: TextControl,
  number: ({ q, value, locked, update, formId, controlId }) => <input id={controlId} type="number" className="qf-input" aria-label={q.label} {...fieldAria(formId, q)} value={stringValue(value)} placeholder={q.placeholder} min={q.min} max={q.max} step={q.step} disabled={locked} onChange={(e) => update(q.id, e.target.value)} />,
  range: ({ q, value, locked, update, formId, controlId }) => (
    <div className="qf-range-wrap">
      <input id={controlId} type="range" className="qf-range" aria-label={q.label} {...fieldAria(formId, q)} value={rangeValue(q, value)} min={q.min} max={q.max} step={q.step} disabled={locked} onChange={(e) => update(q.id, e.target.value)} />
      <output className="qf-range-value">{rangeValue(q, value)}</output>
    </div>
  ),
  date: TypedInputControl,
  time: TypedInputControl,
  'datetime-local': TypedInputControl,
  url: TypedInputControl,
  email: TypedInputControl,
  tel: TypedInputControl,
  color: ({ q, value, locked, update, formId, controlId }) => <input id={controlId} type="color" className="qf-color" aria-label={q.label} {...fieldAria(formId, q)} value={normalizeColorInputValue(value)} disabled={locked} onChange={(e) => update(q.id, e.target.value)} />,
  file: ({ q, value, locked, selectFiles, formId, controlId }) => (
    <div className="qf-file-wrap">
      <input id={controlId} type="file" className="qf-file" aria-label={q.label} {...fieldAria(formId, q)} multiple={q.multiple} accept={q.accept} disabled={locked} onChange={(e) => selectFiles(q, e.target.files)} />
      {fileValueLabel(value) ? <div className="qf-file-summary">{fileValueLabel(value)}</div> : null}
    </div>
  ),
  switch: ({ q, value, locked, update, formId, controlId }) => (
    <label className="qf-switch">
      <input id={controlId} type="checkbox" role="switch" aria-label={q.label} {...fieldAria(formId, q)} checked={value === 'true'} disabled={locked} onChange={(e) => update(q.id, e.target.checked ? 'true' : 'false')} />
      <span aria-hidden />
    </label>
  ),
  textarea: TextareaControl,
};

function OptionCopy({ option }: { option: FormOption }) {
  return (
    <span className="jini-qf-chip-copy">
      <span>{option.label}</span>
      {option.description ? <span className="jini-qf-chip-desc">{option.description}</span> : null}
    </span>
  );
}

function CustomChoiceInput({ label, value, placeholder, disabled, onChange }: { label: string; value: string; placeholder: string; disabled: boolean; onChange: (value: string) => void }) {
  const chars = customInputCharCount({ value, placeholder });
  return (
    <label className="jini-qf-custom">
      <span>{label}</span>
      <input type="text" className="qf-input" value={value} placeholder={placeholder} disabled={disabled} style={{ '--qf-custom-chars': String(chars) } as CSSProperties} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function DirectionCardView({ card, formId, questionId, selected, disabled, onSelect, t }: { t: ReturnType<typeof useT>; card: DirectionCard; formId: string; questionId: string; selected: boolean; disabled: boolean; onSelect: () => void }) {
  return (
    <label className={`qf-card${selected ? ' qf-card-on' : ''}${disabled ? ' qf-card-disabled' : ''}`}>
      <input type="radio" name={`${formId}-${questionId}`} value={card.id} checked={selected} disabled={disabled} onChange={() => onSelect()} />
      <div className="jini-qf-card-head">
        <div className="jini-qf-card-title">{card.label}</div>
        {selected ? <span className="jini-qf-card-pill">{t('Selected')}</span> : null}
      </div>
      {card.palette.length > 0 ? (
        <div className="jini-qf-card-swatches" aria-hidden>
          {card.palette.slice(0, 6).map((c, i) => (
            <span key={i} className="jini-qf-card-swatch" style={{ background: c }} title={c} />
          ))}
        </div>
      ) : null}
      <div className="jini-qf-card-types" aria-hidden>
        <span className="jini-qf-card-type-display" style={{ fontFamily: card.displayFont }}>
          Aa
        </span>
        <span className="jini-qf-card-type-body" style={{ fontFamily: card.bodyFont }}>
          {t('The quick brown fox')}
        </span>
      </div>
      {card.mood ? <p className="jini-qf-card-mood">{card.mood}</p> : null}
      {card.references.length > 0 ? (
        <p className="jini-qf-card-refs">
          <span className="jini-qf-card-refs-label">{t('References:')}</span> {card.references.slice(0, 4).join(' · ')}
        </p>
      ) : null}
    </label>
  );
}

