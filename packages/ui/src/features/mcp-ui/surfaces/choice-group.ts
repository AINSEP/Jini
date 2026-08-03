/**
 * @module features/mcp-ui/surfaces/choice-group
 *
 * The two grouped-choice control fragments: a radio group (pick one) and a checklist (pick any).
 *
 * ## Why these are not `select.ts` with a different attribute
 *
 * A `<select>` and a radio group carry the same data — one value from a fixed set — and this module
 * exists only because they answer different questions for the human. A dropdown hides its options
 * until opened, which is right for a long list and wrong for a short one the human is being asked to
 * *compare*; a confirmation surface asking "which of these three?" wants all three visible at once.
 * So `EnumField` gained a `presentation` discriminator rather than a second kind — same value, same
 * read path, same params key, different rendering. Adding a kind would have forced every consumer
 * switching on `kind` to handle a case that behaves identically to one it already handles.
 *
 * A checklist is genuinely different and *does* get its own kind: it posts an **array**, which no
 * other field kind does. `form.ts`'s `readField`/`isBlank` both branch on it for that reason.
 *
 * ## The grouping is a `<fieldset>`, not a `<label>`
 *
 * `renderFieldLabel` points `for` at `fieldElementId(name)`, which for a group names no element —
 * every option input needs its own id, so a single `for` target cannot exist. A `<fieldset>` with a
 * `<legend>` is the native construct for "one question, several controls": screen readers announce
 * the legend with each option, which is exactly the association a stray `<label>` would fail to make.
 *
 * ## The one-option DOM trap this module's read path has to survive
 *
 * `form.elements[name]` returns a `RadioNodeList` when several controls share a name and **the bare
 * element** when only one does. A checklist with a single option therefore reads as a non-iterable
 * value unless normalised — see `form.ts`'s `readChecked`, which is written against this fact.
 */
import { escapeHtml } from '../escape.js';
import type { SelectOption } from './select.js';
import { fieldElementId } from './document.js';

export interface ChoiceGroupProps {
  /** HTML `name`, DOM `id` stem, and the params key the value is posted under. */
  readonly name: string;
  /** The question. Rendered as the group's `<legend>`. */
  readonly label: string;
  readonly options: readonly SelectOption[];
  /**
   * `single` renders radios and posts one string; `multiple` renders checkboxes and posts an array
   * of the checked values.
   */
  readonly selection: 'single' | 'multiple';
  /** Pre-checked values. A `single` group honours only the first; unknown values check nothing. */
  readonly value?: readonly string[];
  /** Help text, wired up with `aria-describedby` on the group rather than on any one option. */
  readonly hint?: string;
  /**
   * Marks the group as answer-required. Enforced by `form.ts`'s `isBlank`, never by the native
   * `required` attribute: on a checkbox group `required` means *this specific box* must be checked,
   * which would silently demand the first option rather than any option. Radios are exempt from
   * that trap but are left consistent here so both groups fail the same way for the same reason.
   */
  readonly required?: boolean;
  readonly disabled?: boolean;
}

/**
 * Renders one grouped-choice field.
 *
 * @param props - See {@link ChoiceGroupProps}.
 * @returns An HTML fragment.
 * @complexity O(n) in the number of options.
 */
export function renderChoiceGroup(props: ChoiceGroupProps): string {
  const stem = fieldElementId(props.name);
  const type = props.selection === 'multiple' ? 'checkbox' : 'radio';
  const checked = new Set(props.selection === 'multiple' ? (props.value ?? []) : (props.value ?? []).slice(0, 1));

  const required = props.required === true ? '<span class="mcpui-required" aria-hidden="true">*</span>' : '';
  const hint =
    props.hint === undefined
      ? ''
      : `\n<span class="mcpui-hint" id="${escapeHtml(stem)}-hint">${escapeHtml(props.hint)}</span>`;
  const describedBy = props.hint === undefined ? '' : ` aria-describedby="${escapeHtml(stem)}-hint"`;

  const options = props.options
    .map((option, index) => {
      // Index-suffixed rather than value-suffixed: an option value is caller data and may contain
      // characters that are legal in a value and illegal in an id, which would break the `for`
      // association silently — the label would simply stop being a hit target.
      const id = `${stem}-${index}`;
      const attributes =
        ` id="${escapeHtml(id)}" name="${escapeHtml(props.name)}" value="${escapeHtml(option.value)}"` +
        (checked.has(option.value) ? ' checked' : '') +
        (props.disabled === true || option.disabled === true ? ' disabled' : '');
      return (
        `<div class="mcpui-choice">\n` +
        `<input class="mcpui-checkbox" type="${type}"${attributes}>\n` +
        `<label class="mcpui-choice-label" for="${escapeHtml(id)}">${escapeHtml(option.label ?? option.value)}</label>\n` +
        `</div>`
      );
    })
    .join('\n');

  return (
    `<fieldset class="mcpui-field mcpui-choice-group"${describedBy}>\n` +
    `<legend class="mcpui-label">${escapeHtml(props.label)}${required}</legend>${hint}\n` +
    `${options}\n` +
    `</fieldset>`
  );
}
