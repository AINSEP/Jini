/**
 * @module features/mcp-ui/surfaces/checkbox
 *
 * The boolean control fragment. Laid out inline (control first, label after) rather than
 * label-above like the other controls, because a checkbox's label is its hit target and stacking it
 * above leaves a lone box with nothing next to it.
 */
import { escapeHtml } from '../escape.js';
import { fieldDescribedBy, fieldElementId, renderFieldLabel } from './document.js';

export interface CheckboxProps {
  /** HTML `name`, DOM `id` suffix, and the params key the value is posted under. */
  readonly name: string;
  readonly label: string;
  /** Initial checked state. Defaults to unchecked. */
  readonly value?: boolean;
  /** Help text, wired up with `aria-describedby`. */
  readonly hint?: string;
  /**
   * Native checkbox `required` semantics: the box must be CHECKED to submit, not merely answered.
   * That is the right meaning for the case this control exists for ("I understand this deletes the
   * record"), and the wrong meaning for a plain optional toggle — leave it off for those.
   */
  readonly required?: boolean;
  readonly disabled?: boolean;
}

/**
 * Renders one boolean field.
 *
 * @param props - See {@link CheckboxProps}.
 * @returns An HTML fragment.
 * @complexity O(n) in the rendered length.
 */
export function renderCheckbox(props: CheckboxProps): string {
  const id = fieldElementId(props.name);
  const attributes =
    ` id="${escapeHtml(id)}" name="${escapeHtml(props.name)}"` +
    (props.value === true ? ' checked' : '') +
    (props.required === true ? ' required' : '') +
    (props.disabled === true ? ' disabled' : '') +
    fieldDescribedBy(props);
  return `<div class="mcpui-field mcpui-field-inline">\n<input class="mcpui-checkbox" type="checkbox"${attributes}>\n<span>${renderFieldLabel(props)}</span>\n</div>`;
}
