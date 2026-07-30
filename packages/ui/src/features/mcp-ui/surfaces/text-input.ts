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

  const isNumber = props.inputType === 'number';
  const control = props.multiline === true && !isNumber
    ? `<textarea class="mcpui-textarea"${common}${optionalAttribute('rows', props.rows)}>${props.value === undefined ? '' : escapeHtml(String(props.value))}</textarea>`
    : `<input class="mcpui-input" type="${isNumber ? 'number' : 'text'}"${common}` +
      optionalAttribute('value', props.value) +
      (isNumber
        ? optionalAttribute('min', props.min) + optionalAttribute('max', props.max) + optionalAttribute('step', props.step)
        : '') +
      '>';

  return `<div class="mcpui-field">\n${renderFieldLabel(props)}\n${control}\n</div>`;
}
