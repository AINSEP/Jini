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
import { renderTextInput } from './text-input.js';

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
  /** Renders as a masked `<input type="password">` — see {@link TextInputProps.secret}. */
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

/** Only the properties present on a given field are forwarded, because `exactOptionalPropertyTypes` makes `{ hint: undefined }` and `{}` different types. */
function base(field: SurfaceField): { name: string; label: string; hint?: string; required?: boolean; disabled?: boolean } {
  return {
    name: field.name,
    label: field.label,
    ...(field.hint === undefined ? {} : { hint: field.hint }),
    ...(field.required === undefined ? {} : { required: field.required }),
    ...(field.disabled === undefined ? {} : { disabled: field.disabled }),
  };
}

/**
 * Renders the control fragment for one field, dispatching on its kind.
 *
 * @param field - See {@link SurfaceField}.
 * @returns An HTML fragment.
 * @complexity O(n) in the rendered length.
 */
export function renderFieldControl(field: SurfaceField): string {
  switch (field.kind) {
    case 'string':
      return renderTextInput({
        ...base(field),
        ...(field.value === undefined ? {} : { value: field.value }),
        ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
        ...(field.multiline === undefined ? {} : { multiline: field.multiline }),
        ...(field.rows === undefined ? {} : { rows: field.rows }),
        ...(field.secret === undefined ? {} : { secret: field.secret }),
      });
    case 'number':
      return renderTextInput({
        ...base(field),
        inputType: 'number',
        ...(field.value === undefined ? {} : { value: field.value }),
        ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
        ...(field.min === undefined ? {} : { min: field.min }),
        ...(field.max === undefined ? {} : { max: field.max }),
        ...(field.step === undefined ? {} : { step: field.step }),
      });
    case 'boolean':
      return renderCheckbox({
        ...base(field),
        ...(field.value === undefined ? {} : { value: field.value }),
      });
    case 'enum':
      if (field.presentation === 'radio') {
        return renderChoiceGroup({
          ...base(field),
          selection: 'single',
          options: field.options,
          ...(field.value === undefined ? {} : { value: [field.value] }),
        });
      }
      return renderSelect({
        ...base(field),
        options: field.options,
        ...(field.value === undefined ? {} : { value: field.value }),
        ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
      });
    case 'multi-enum':
      return renderChoiceGroup({
        ...base(field),
        selection: 'multiple',
        options: field.options,
        ...(field.value === undefined ? {} : { value: field.value }),
      });
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
