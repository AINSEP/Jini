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
import { renderCheckbox } from './checkbox.js';
import { renderChoiceGroup } from './choice-group.js';
import { renderSelect, type SelectOption } from './select.js';
import { renderTextInput, type SecretInputText } from './text-input.js';

interface SurfaceFieldBase {
  /** HTML `name`, DOM `id` suffix, and the params key the value is posted under. */
  readonly name: string;
  readonly label: string;
  /** Help text, wired up with `aria-describedby`. */
  readonly hint?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
}

export interface StringField extends SurfaceFieldBase {
  readonly kind: 'string';
  readonly value?: string;
  readonly placeholder?: string;
  readonly multiline?: boolean;
  readonly rows?: number;
  /** Renders as a masked input or multiline textarea; pre-filled values are forbidden.
   *  See {@link TextInputProps.secret}. */
  readonly secret?: boolean;
}

export interface NumberField extends SurfaceFieldBase {
  readonly kind: 'number';
  readonly value?: number;
  readonly placeholder?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export interface BooleanField extends SurfaceFieldBase {
  readonly kind: 'boolean';
  readonly value?: boolean;
}

export interface EnumField extends SurfaceFieldBase {
  readonly kind: 'enum';
  readonly value?: string;
  readonly options: readonly SelectOption[];
  readonly placeholder?: string;
  /**
   * How the same one-of-N value is drawn. `select` (the default) hides the options until opened —
   * right for a long list; `radio` shows them all at once — right for a short one the human is
   * meant to compare before choosing. Presentation only: both post one string under `name`, and
   * both read back through the same `control.value` path, so `kind` stays `'enum'` either way.
   */
  readonly presentation?: 'select' | 'radio';
}

/**
 * A pick-any-number-of-N field.
 *
 * Its own kind rather than a flag on {@link EnumField}, because it is the only field whose value is
 * an **array** — `form.ts`'s `readField` and `isBlank` both branch on that, and no `presentation`
 * discriminator would have told them to.
 */
export interface MultiEnumField extends SurfaceFieldBase {
  readonly kind: 'multi-enum';
  /** Pre-checked values. Unknown entries check nothing rather than erroring. */
  readonly value?: readonly string[];
  readonly options: readonly SelectOption[];
}

export type SurfaceField = StringField | NumberField | BooleanField | EnumField | MultiEnumField;

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

function base(field: SurfaceField): { name: string; label: string; hint?: string; required?: boolean; disabled?: boolean } {
  return { name: field.name, label: field.label, ...present(field, ['hint', 'required', 'disabled']) };
}

/** One-of-N, drawn as radios or a select per {@link EnumField.presentation}. @complexity O(n) in the rendered length. */
function renderEnumField(field: EnumField): string {
  if (field.presentation === 'radio') {
    return renderChoiceGroup({
      ...base(field),
      selection: 'single',
      options: field.options,
      ...(field.value === undefined ? {} : { value: [field.value] }),
    });
  }
  return renderSelect({ ...base(field), options: field.options, ...present(field, ['value', 'placeholder']) });
}

/**
 * Renders the control fragment for one field, dispatching on its kind.
 *
 * @param field - See {@link SurfaceField}.
 * @param text - Optional host translations for secret reveal controls.
 * @returns An HTML fragment.
 * @complexity O(n) in the rendered length.
 */
export function renderFieldControl(field: SurfaceField, text?: Partial<SecretInputText>): string {
  switch (field.kind) {
    case 'string':
      return renderTextInput({ ...base(field), ...text, ...present(field, ['value', 'placeholder', 'multiline', 'rows', 'secret']) });
    case 'number':
      return renderTextInput({ ...base(field), inputType: 'number', ...present(field, ['value', 'placeholder', 'min', 'max', 'step']) });
    case 'boolean':
      return renderCheckbox({ ...base(field), ...present(field, ['value']) });
    case 'enum':
      return renderEnumField(field);
    case 'multi-enum':
      return renderChoiceGroup({ ...base(field), selection: 'multiple', options: field.options, ...present(field, ['value']) });
  }
}

/** What the surface's inline script needs to read a field's value back and coerce it — the runtime half of {@link SurfaceField}, with the presentation stripped out. */
export interface FieldReadSpec {
  readonly name: string;
  readonly label: string;
  readonly kind: SurfaceField['kind'];
  readonly required: boolean;
}

/** Projects fields down to what the inline script needs, so the generated JS carries no labels, hints, or option lists it will never read. */
export function toFieldReadSpecs(fields: readonly SurfaceField[]): readonly FieldReadSpec[] {
  return fields.map((field) => ({
    name: field.name,
    label: field.label,
    kind: field.kind,
    required: field.required === true,
  }));
}
