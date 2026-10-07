/**
 * @module features/mcp-ui/surfaces/text-input
 *
 * The free-text control fragment — `<input type="text">`, `<input type="number">`, or `<textarea>`
 * depending on the props, because all three are the same field to a caller (a labelled box you type
 * into) and differ only in how the value is read back.
 */
import { escapeHtml } from '../escape.js';
import { fieldDescribedBy, fieldElementId, renderFieldLabel } from './document.js';

/** Labels the host can translate for a multiline secret's reveal toggle. */
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
  /** Renders as `<input type="password">`, or a masked textarea with a show/hide toggle when
   *  multiline. No `<textarea type="password">` exists, so multiline uses CSS text security.
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
  const isNumber = type === 'number';
  const secretMultiline = props.secret === true && props.multiline === true && !isNumber;
  const control = props.multiline === true && !isNumber
    ? `<textarea class="mcpui-textarea"${common}${optionalAttribute('rows', props.rows)}` +
      // Password inputs strip line breaks. CSS masking keeps the textarea's actual value intact,
      // and disables browser text assistance that could retain or alter a pasted credential.
      (secretMultiline ? ' data-mcpui-secret style="-webkit-text-security: disc;" autocomplete="off" spellcheck="false"' : '') +
      `>${props.value === undefined ? '' : escapeHtml(String(props.value))}</textarea>` +
      (secretMultiline
        ? `<button type="button" class="mcpui-button" data-mcpui-secret-toggle="${escapeHtml(id)}" data-mcpui-show-secret="${escapeHtml(props.showSecret ?? DEFAULT_SECRET_INPUT_TEXT.showSecret)}" data-mcpui-hide-secret="${escapeHtml(props.hideSecret ?? DEFAULT_SECRET_INPUT_TEXT.hideSecret)}" aria-controls="${escapeHtml(id)}" aria-pressed="false"${booleanAttribute('disabled', props.disabled)}>${escapeHtml(props.showSecret ?? DEFAULT_SECRET_INPUT_TEXT.showSecret)}</button>`
        : '')
    : `<input class="mcpui-input" type="${type}"${common}` +
      optionalAttribute('value', props.value) +
      // A stored secret (e.g. a cloud provider's access key or a database password) must never be
      // autofilled with a saved website login. `new-password`, not `off`: Chrome ignores `off` on
      // password inputs by design and fills the saved login anyway.
      (type === 'password' ? optionalAttribute('autocomplete', 'new-password') : '') +
      (isNumber
        ? optionalAttribute('min', props.min) + optionalAttribute('max', props.max) + optionalAttribute('step', props.step)
        : '') +
      '>';

  return `<div class="mcpui-field">\n${renderFieldLabel(props)}\n${control}\n</div>`;
}
