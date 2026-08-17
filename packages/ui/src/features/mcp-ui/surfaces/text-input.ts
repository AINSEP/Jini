/**
 * @module features/mcp-ui/surfaces/text-input
 *
 * The free-text control fragment — `<input type="text">`, `<input type="number">`, or `<textarea>`
 * depending on the props, because all three are the same field to a caller (a labelled box you type
 * into) and differ only in how the value is read back.
 */
import { escapeHtml } from '../escape.js';
import { fieldDescribedBy, fieldElementId, renderFieldLabel } from './document.js';

export interface TextInputProps {
  /** HTML `name`, DOM `id` suffix, and the params key the value is posted under. */
  readonly name: string;
  readonly label: string;
  /** Pre-filled value. Numbers are stringified; `undefined` leaves the control empty. */
  readonly value?: string | number;
  readonly placeholder?: string;
  /** Help text, wired up with `aria-describedby`. */
  readonly hint?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  /** `'number'` also constrains the on-screen keyboard on touch devices, which `'text'` would not. */
  readonly inputType?: 'text' | 'number';
  /** Renders as `<input type="password">` — the value is never visible on screen, and browser
   *  password managers may offer to remember it. Ignored when `inputType` is `'number'` (no such
   *  thing as a masked number) and forces `multiline` off (no `<textarea type="password">` exists) —
   *  same precedence `multiline`'s own doc comment already gives `inputType: 'number'`. */
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
  const id = fieldElementId(props.name);
  const common =
    ` id="${escapeHtml(id)}" name="${escapeHtml(props.name)}"` +
    optionalAttribute('placeholder', props.placeholder) +
    booleanAttribute('required', props.required) +
    booleanAttribute('disabled', props.disabled) +
    fieldDescribedBy(props);

  const type = resolveInputType(props);
  const isNumber = type === 'number';
  const control = props.multiline === true && type === 'text'
    ? `<textarea class="mcpui-textarea"${common}${optionalAttribute('rows', props.rows)}>${props.value === undefined ? '' : escapeHtml(String(props.value))}</textarea>`
    : `<input class="mcpui-input" type="${type}"${common}` +
      optionalAttribute('value', props.value) +
      // A stored secret (e.g. a cloud provider's access key) must never be offered to a browser's
      // password manager as a saveable website login — it belongs to this `ui://` surface, not a
      // credential the browser should remember.
      (props.secret === true ? optionalAttribute('autocomplete', 'off') : '') +
      (isNumber
        ? optionalAttribute('min', props.min) + optionalAttribute('max', props.max) + optionalAttribute('step', props.step)
        : '') +
      '>';

  return `<div class="mcpui-field">\n${renderFieldLabel(props)}\n${control}\n</div>`;
}
