/**
 * @module features/mcp-ui/surfaces/select
 *
 * The enumerated-choice control fragment. A native `<select>` rather than a custom listbox: an
 * isolated iframe has no shared component runtime to mount one from, and the native control already
 * carries keyboard navigation, mobile pickers, and screen-reader semantics that a hand-rolled
 * div-with-role would have to re-earn.
 */
import { escapeHtml } from '../escape.js';
import { fieldDescribedBy, fieldElementId, renderFieldLabel } from './document.js';

export interface SelectOption {
  /** The value posted back. */
  readonly value: string;
  /** What the human reads. Defaults to `value`. */
  readonly label?: string;
  readonly disabled?: boolean;
}

export interface SelectProps {
  /** HTML `name`, DOM `id` suffix, and the params key the value is posted under. */
  readonly name: string;
  readonly label: string;
  readonly options: readonly SelectOption[];
  /** Which option starts selected. When it matches no option, nothing is pre-selected. */
  readonly value?: string;
  /** Help text, wired up with `aria-describedby`. */
  readonly hint?: string;
  /**
   * Adds a leading empty option so "not answered yet" is representable, and marks the control
   * `required` so submitting without choosing is blocked. Without it a `<select>` starts on its
   * first option, which silently turns "the human never chose" into "the human chose the first one".
   */
  readonly required?: boolean;
  /** Label for that leading empty option. Defaults to an em-dash. */
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

/**
 * Renders one enumerated field.
 *
 * @param props - See {@link SelectProps}.
 * @returns An HTML fragment.
 * @complexity O(n) in the number of options.
 */
export function renderSelect(props: SelectProps): string {
  const id = fieldElementId(props.name);
  const placeholderOption =
    props.required === true
      ? `\n  <option value="" ${props.value === undefined ? 'selected ' : ''}disabled>${escapeHtml(props.placeholder ?? '—')}</option>`
      : '';
  const options = props.options
    .map((option) => {
      const selected = option.value === props.value ? ' selected' : '';
      const disabled = option.disabled === true ? ' disabled' : '';
      return `  <option value="${escapeHtml(option.value)}"${selected}${disabled}>${escapeHtml(option.label ?? option.value)}</option>`;
    })
    .join('\n');
  const attributes =
    ` id="${escapeHtml(id)}" name="${escapeHtml(props.name)}"` +
    (props.required === true ? ' required' : '') +
    (props.disabled === true ? ' disabled' : '') +
    fieldDescribedBy(props);
  return `<div class="mcpui-field">\n${renderFieldLabel(props)}\n<select class="mcpui-select"${attributes}>${placeholderOption}\n${options}\n</select>\n</div>`;
}
