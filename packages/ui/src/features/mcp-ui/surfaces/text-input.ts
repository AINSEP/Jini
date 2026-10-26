/**
 * @module features/mcp-ui/surfaces/text-input
 *
 * The free-text control fragment — `<input type="text">`, `<input type="number">`, or `<textarea>`
 * depending on the props, because all three are the same field to a caller (a labelled box you type
 * into) and differ only in how the value is read back.
 */
import { escapeHtml } from '../escape.js';
import { fieldDescribedBy, fieldElementId, renderFieldLabel } from './document.js';

/** Verbs the host can translate for a secret's reveal toggle; the field label is appended. */
export interface SecretInputText {
  readonly showSecret: string;
  readonly hideSecret: string;
}

export const DEFAULT_SECRET_INPUT_TEXT: SecretInputText = { showSecret: 'Show', hideSecret: 'Hide' };

export interface TextInputProps extends Partial<SecretInputText> {
  /** HTML `name`, DOM `id` suffix, and the params key the value is posted under. */
  readonly name: string;
  readonly label: string;
  /** Pre-filled value. Numbers are stringified; `undefined` leaves the control empty.
   *  Forbidden when `secret` is true, including an empty string. */
  readonly value?: string | number;
  readonly placeholder?: string;
  /** Help text, wired up with `aria-describedby`. */
  readonly hint?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  /** `'number'` also constrains the on-screen keyboard on touch devices, which `'text'` would not. */
  readonly inputType?: 'text' | 'number';
  /** Renders as `<input type="password">`, or a masked textarea when multiline — either way with
   *  an eye show/hide toggle. No `<textarea type="password">` exists, so multiline uses CSS text security.
   *  Ignored for presentation when `inputType` is `'number'` (no such thing as a masked number) —
   *  same precedence `multiline`'s own doc comment already gives `inputType: 'number'`.
   *  A supplied value is always rejected: masking cannot protect a secret serialized into HTML. */
  readonly secret?: boolean;
  /** Renders a `<textarea>`. Ignored when `inputType` is `'number'` — there is no multiline number. */
  readonly multiline?: boolean;
  readonly rows?: number;
  /** Number-only constraints; ignored for text. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

function optionalAttribute(name: string, value: string | number | undefined): string {
  if (value === undefined) return '';
  return ` ${name}="${escapeHtml(String(value))}"`;
}

function booleanAttribute(name: string, value: boolean | undefined): string {
  return value === true ? ` ${name}` : '';
}

/**
 * Resolves which HTML `type` a text control renders as. `'number'` wins over `secret` — there is no
 * masked number input, and `TextInputProps.secret`'s own doc comment already fixes that precedence.
 *
 * @param props - The `inputType`/`secret` slice of {@link TextInputProps}.
 * @returns The concrete `<input type>` value.
 * @complexity O(1).
 */
function resolveInputType(props: Pick<TextInputProps, 'inputType' | 'secret'>): 'text' | 'number' | 'password' {
  if (props.inputType === 'number') return 'number';
  return props.secret === true ? 'password' : 'text';
}

/** Eye / eye-off glyphs. Both ship; CSS shows the one matching `aria-pressed`, so the inline script
 *  never builds markup. `currentColor` keeps them on the surface's theme tokens in light and dark. */
const EYE_ICON =
  '<svg class="mcpui-secret-icon-show" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>' +
  '<svg class="mcpui-secret-icon-hide" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a17.8 17.8 0 0 1-2.16 3.19M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M2 2l20 20"/></svg>';

/**
 * The eye toggle every secret control carries, inside the field's right edge. Its accessible name
 * is the host's verb plus the field label ("Show Token"); the full show/hide names ride on data
 * attributes so the form script swaps them without knowing the label.
 * @complexity O(n) in the label lengths.
 */
function renderSecretToggle(props: TextInputProps, id: string): string {
  const show = `${props.showSecret ?? DEFAULT_SECRET_INPUT_TEXT.showSecret} ${props.label}`;
  const hide = `${props.hideSecret ?? DEFAULT_SECRET_INPUT_TEXT.hideSecret} ${props.label}`;
  return `<button type="button" class="mcpui-secret-toggle" data-mcpui-secret-toggle="${escapeHtml(id)}" data-mcpui-show-secret="${escapeHtml(show)}" data-mcpui-hide-secret="${escapeHtml(hide)}" aria-label="${escapeHtml(show)}" aria-controls="${escapeHtml(id)}" aria-pressed="false"${booleanAttribute('disabled', props.disabled)}>${EYE_ICON}</button>`;
}

/** Wraps a secret control so its toggle sits inside the field's right edge. @complexity O(n) in the rendered length. */
function withSecretToggle(control: string, props: TextInputProps, id: string): string {
  return `<div class="mcpui-secret">${control}${renderSecretToggle(props, id)}</div>`;
}

/** The `<textarea>` control, masked with a reveal toggle when secret. @complexity O(n) in the rendered length. */
function renderTextarea(props: TextInputProps, required: { id: string; common: string }): string {
  const secret = props.secret === true;
  const control = `<textarea class="mcpui-textarea"${required.common}${optionalAttribute('rows', props.rows)}` +
    // Password inputs strip line breaks. CSS masking keeps the textarea's actual value intact,
    // and disables browser text assistance that could retain or alter a pasted credential.
    (secret ? ' data-mcpui-secret style="-webkit-text-security: disc;" autocomplete="off" spellcheck="false"' : '') +
    `>${props.value === undefined ? '' : escapeHtml(String(props.value))}</textarea>`;
  return secret ? withSecretToggle(control, props, required.id) : control;
}

/** The single-line `<input>` control, with the eye toggle when masked. @complexity O(n) in the rendered length. */
function renderInput(props: TextInputProps, required: { id: string; type: 'text' | 'number' | 'password'; common: string }): string {
  const { type, common } = required;
  const control = `<input class="mcpui-input" type="${type}"${common}` +
    optionalAttribute('value', props.value) +
    // A stored secret (e.g. a cloud provider's access key or a database password) must never be
    // autofilled with a saved website login. `new-password`, not `off`: Chrome ignores `off` on
    // password inputs by design and fills the saved login anyway.
    // spellcheck off: once revealed as `type="text"`, enhanced spellcheck would ship the secret out.
    (type === 'password' ? optionalAttribute('autocomplete', 'new-password') + optionalAttribute('spellcheck', 'false') : '') +
    (type === 'number'
      ? optionalAttribute('min', props.min) + optionalAttribute('max', props.max) + optionalAttribute('step', props.step)
      : '') +
    '>';
  return type === 'password' ? withSecretToggle(control, props, required.id) : control;
}

/**
 * Renders one free-text field: its label, hint, and control, wrapped in `.mcpui-field`.
 *
 * @param props - See {@link TextInputProps}.
 * @returns An HTML fragment. Not a whole document — compose it with `form.ts`.
 * @complexity O(n) in the rendered length.
 */
export function renderTextInput(props: TextInputProps): string {
  // Even an empty prefill is forbidden: callers must omit value so a stored credential can never
  // enter the resource's HTML. Keep this error fixed, without the field name or rejected value.
  if (props.secret === true && props.value !== undefined) {
    throw new Error('Secret fields cannot have a pre-filled value. Omit value.');
  }
  const id = fieldElementId(props.name);
  const common =
    ` id="${escapeHtml(id)}" name="${escapeHtml(props.name)}"` +
    optionalAttribute('placeholder', props.placeholder) +
    booleanAttribute('required', props.required) +
    booleanAttribute('disabled', props.disabled) +
    fieldDescribedBy(props);

  const type = resolveInputType(props);
  const control = props.multiline === true && type !== 'number'
    ? renderTextarea(props, { id, common })
    : renderInput(props, { id, type, common });

  return `<div class="mcpui-field">\n${renderFieldLabel(props)}\n${control}\n</div>`;
}
