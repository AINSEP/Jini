import type { StringField, NumberField, BooleanField, EnumField, MultiEnumField, SurfaceField } from '@jini-ai/core/contracts/cards';
export type { StringField, NumberField, BooleanField, EnumField, MultiEnumField, SurfaceField } from '@jini-ai/core/contracts/cards';
/**
 * @module features/mcp-ui/surfaces/fields
 *
 * The field-kind union a form is described in, and the dispatch from a kind to its control builder.
 *
 * The four kinds are `string | number | boolean | enum` — the same set a JSON-Schema-shaped tool
 * input reduces to once objects and arrays are excluded, which is deliberate: a surface built from
 * a tool's own input schema should be describable without inventing a parallel type system. Nested
 * objects and arrays are a documented gap rather than an oversight; a dialog that renders them well
 * is a different, larger component than a confirmation box.
 *
 * {@link renderFieldControl}'s switch has no `default` branch on purpose. With every case returning
 * and the union exhausted, adding a fifth kind makes this function stop satisfying its `: string`
 * return type — a compile error at the switch itself. A `default` that threw would instead move
 * that failure to runtime, and add a branch no test could reach.
 */
import { unhandledCase } from '../../../utils/unhandled-case.js';
import { renderCheckbox } from './checkbox.js';
import { renderChoiceGroup } from './choice-group.js';
import { renderSelect, type SelectOption } from './select.js';
import { renderTextInput, type SecretInputText } from './text-input.js';

/** The listed properties that are present on `source`, in listed order.
 * Only the properties present on a given field are forwarded, because `exactOptionalPropertyTypes` makes `{ hint: undefined }` and `{}` different types.
 * @complexity O(k) in the key count. */
function present<T extends object, K extends keyof T>(source: T, keys: readonly K[]): { [P in K]?: Exclude<T[P], undefined> } {
  const picked: { [P in K]?: Exclude<T[P], undefined> } = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) picked[key] = value as Exclude<T[K], undefined>;
  }
  return picked;
}

/** Presentation the form decides for a field, not part of the field's own data. */
export interface FieldRenderOptions {
  /** The label repeats the card title: keep it as the accessible name, but don't show it twice. */
  readonly labelHidden?: boolean;
}

function base(field: SurfaceField, options: FieldRenderOptions = {}): { name: string; label: string; hint?: string; required?: boolean; disabled?: boolean; labelHidden?: boolean } {
  return { name: field.name, label: field.label, ...present(field, ['hint', 'required', 'disabled']), ...(options.labelHidden === true ? { labelHidden: true } : {}) };
}

/** One-of-N, drawn as radios or a select per {@link EnumField.presentation}. @complexity O(n) in the rendered length. */
function renderEnumField(field: EnumField, options: FieldRenderOptions): string {
  if (field.presentation === 'radio') {
    return renderChoiceGroup({
      ...base(field, options),
      selection: 'single',
      options: field.options,
      ...(field.value === undefined ? {} : { value: [field.value] }),
    });
  }
  return renderSelect({ ...base(field, options), options: field.options, ...present(field, ['value', 'placeholder']) });
}

/**
 * Renders the control fragment for one field, dispatching on its kind.
 *
 * @param field - See {@link SurfaceField}.
 * @param text - Optional host translations for secret reveal controls.
 * @param options - See {@link FieldRenderOptions}.
 * @returns An HTML fragment.
 * @complexity O(n) in the rendered length.
 */
export function renderFieldControl(field: SurfaceField, text?: Partial<SecretInputText>, options: FieldRenderOptions = {}): string {
  switch (field.kind) {
    case 'string':
      return renderTextInput({ ...base(field, options), ...text, ...present(field, ['value', 'placeholder', 'multiline', 'rows', 'secret']) });
    case 'number':
      return renderTextInput({ ...base(field, options), inputType: 'number', ...present(field, ['value', 'placeholder', 'min', 'max', 'step']) });
    case 'boolean':
      return renderCheckbox({ ...base(field, options), ...present(field, ['value']) });
    case 'enum':
      return renderEnumField(field, options);
    case 'multi-enum':
      return renderChoiceGroup({ ...base(field, options), selection: 'multiple', options: field.options, ...present(field, ['value']) });
  }
  return unhandledCase(field);
}

/** What the surface's inline script needs to read a field's value back and coerce it — the runtime half of {@link SurfaceField}, with the presentation stripped out. */
export interface FieldReadSpec {
  readonly name: string;
  readonly label: string;
  readonly kind: SurfaceField['kind'];
  readonly required: boolean;
  readonly hasSavedValue?: boolean;
  readonly requiredUnless?: { readonly field: string; readonly equals: string; readonly orPresent?: string; readonly headerNames?: readonly string[] };
  /** Require only while the controlling public field matches one of these choices. */
  readonly requiredWhen?: { readonly field: string; readonly in: readonly string[] };
  readonly hint?: string;
}

/** Projects fields to runtime validation data; conditional requirements also carry their guidance. */
export function toFieldReadSpecs(fields: readonly SurfaceField[]): readonly FieldReadSpec[] {
  return fields.map((field) => ({
    name: field.name,
    label: field.label,
    kind: field.kind,
    required: field.required === true,
    ...(field.requiredUnless ? { requiredUnless: field.requiredUnless } : {}),
    ...(field.requiredWhen ? { requiredWhen: field.requiredWhen } : {}),
    ...(field.kind === 'string' && field.hasSavedValue ? { hasSavedValue: true } : {}),
    ...((field.requiredUnless || field.requiredWhen) && field.hint ? { hint: field.hint } : {}),
  }));
}
