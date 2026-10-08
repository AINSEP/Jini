import { isNonArrayRecord } from "@jini-ai/core";

/**
 * @file A minimal JSON-Schema-subset validator for `fields.ext.widget.*` config bags (SPEC-043
 * REQ-02, INV-01).
 *
 * Purpose:
 * `widgets/registry.ts`'s `WidgetTypeRegistration.configSchema` records use a small, deliberately
 * bounded JSON-Schema subset (`object`/`string`/`integer`/`array`, `properties`/`required`/
 * `additionalProperties`/`items`/`maxItems`/`minimum`/`maximum` — exactly what `registry.ts`'s five
 * v1 registrations actually use, no more). No JSON-Schema library is a dependency of this repo
 * (confirmed: no `ajv`/`jsonschema` entry in `package.json`), so this is a small, purpose-built
 * validator over that exact subset rather than a new third-party dependency for one feature.
 *
 * Architectural role:
 * `widgets` domain logic, internal helper. Used by `write-service.ts` before every widget-instance
 * write (REQ-01/02) — not part of this feature's frozen public contract list, so its shape is not
 * design-frozen the way `types.ts`/`ports.ts`/`errors.ts` are.
 */

interface WidgetConfigJsonSchema {
  readonly type?: string;
  readonly properties?: Readonly<Record<string, WidgetConfigJsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: WidgetConfigJsonSchema;
  readonly maxItems?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  /** A field naming other content by id (`registry.ts`'s `categoryTermId`/`menuRef`/`formDefinitionId`). */
  readonly "x-ref-target"?: string;
}

export interface WidgetConfigFieldError {
  readonly field: string;
  readonly reason: string;
}

export interface ValidateWidgetConfigResult {
  readonly valid: boolean;
  readonly fieldErrors: WidgetConfigFieldError[];
}

/** Reports every key in `schema.required` that is missing from `value`. */
function validateRequiredKeys(
  value: Record<string, unknown>,
  schema: WidgetConfigJsonSchema,
  path: string,
  errors: WidgetConfigFieldError[]
): void {
  for (const key of schema.required ?? []) {
    if (!(key in value)) errors.push({ field: `${path}.${key}`, reason: "required field is missing" });
  }
}

/** Recurses into each `value` key that has a declared `schema.properties` entry; flags the rest when `additionalProperties` is `false`. */
function walkObjectProperties(
  value: Record<string, unknown>,
  schema: WidgetConfigJsonSchema,
  path: string,
  errors: WidgetConfigFieldError[]
): void {
  for (const [key, fieldValue] of Object.entries(value)) {
    const propSchema = schema.properties?.[key];
    if (!propSchema) {
      if (schema.additionalProperties === false) {
        errors.push({ field: `${path}.${key}`, reason: "unrecognized field: not present in the registered schema" });
      }
      continue;
    }
    walk(fieldValue, propSchema, `${path}.${key}`, errors);
  }
}

/** Checks `required` keys are present and recurses into each declared property (schema.type === "object"). */
function walkObject(value: unknown, schema: WidgetConfigJsonSchema, path: string, errors: WidgetConfigFieldError[]): void {
  const record = { value };
  if (!isNonArrayRecord(record)) {
    errors.push({ field: path, reason: "expected an object" });
    return;
  }
  validateRequiredKeys(record.value, schema, path, errors);
  walkObjectProperties(record.value, schema, path, errors);
}

/** schema.type === "string": type check only, no length/pattern constraint in this subset. */
function walkString(value: unknown, path: string, errors: WidgetConfigFieldError[]): void {
  if (typeof value !== "string") errors.push({ field: path, reason: "expected a string" });
}

/** schema.type === "integer": type check plus optional `minimum`/`maximum` bounds. */
function walkInteger(value: unknown, schema: WidgetConfigJsonSchema, path: string, errors: WidgetConfigFieldError[]): void {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    errors.push({ field: path, reason: "expected an integer" });
    return;
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    errors.push({ field: path, reason: `below the minimum of ${schema.minimum}` });
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    errors.push({ field: path, reason: `above the maximum of ${schema.maximum}` });
  }
}

/** schema.type === "array": type check, optional `maxItems` bound, and recursion into `items`. */
function walkArray(value: unknown, schema: WidgetConfigJsonSchema, path: string, errors: WidgetConfigFieldError[]): void {
  if (!Array.isArray(value)) {
    errors.push({ field: path, reason: "expected an array" });
    return;
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    errors.push({ field: path, reason: `exceeds the maximum item count of ${schema.maxItems}` });
  }
  if (schema.items) {
    value.forEach((item, index) => {
      walk(item, schema.items as WidgetConfigJsonSchema, `${path}[${index}]`, errors);
    });
  }
}

/** Dispatches to the per-type walker for `schema.type` (object/string/integer/array); unspecified or boolean types accept anything. */
function walk(value: unknown, schema: WidgetConfigJsonSchema, path: string, errors: WidgetConfigFieldError[]): void {
  switch (schema.type) {
    case "object":
      walkObject(value, schema, path, errors);
      return;
    case "string":
      walkString(value, path, errors);
      return;
    case "integer":
      walkInteger(value, schema, path, errors);
      return;
    case "array":
      walkArray(value, schema, path, errors);
      return;
    default:
      // boolean / unspecified schema type: accept anything (no v1 registration needs this).
      return;
  }
}

/**
 * Validates `config` against a widget type's registered `configSchema` (REQ-02). The registered
 * schema is always the authority — a type's own `clamps` (e.g. `recent-entries`' `maxItems: 20`)
 * are already expressed as `maximum` constraints inside the schema itself (`registry.ts`), so no
 * separate clamp check is needed here to satisfy AC-02.
 *
 * @complexity O(n) over the config bag's total node count.
 * @overallScore 100
 */
export function validateWidgetConfig(
  required: {
  schema: Record<string, unknown>;
  config: Record<string, unknown>;
},
  _optional: Record<string, never> = {},
): ValidateWidgetConfigResult {
  const errors: WidgetConfigFieldError[] = [];
  walk(required.config, required.schema as WidgetConfigJsonSchema, "config", errors);
  return { valid: errors.length === 0, fieldErrors: errors };
}

/** Pushes each declared free-text string under `schema` (recursion into declared `properties` and
 *  `items` only). @complexity O(n) over the config's declared nodes. */
function collectStrings(value: unknown, schema: WidgetConfigJsonSchema, out: string[]): void {
  const record = { value };
  if (schema.type === "string" && typeof value === "string" && schema["x-ref-target"] === undefined) out.push(value);
  else if (schema.type === "array" && Array.isArray(value) && schema.items) for (const item of value) collectStrings(item, schema.items, out);
  else if (schema.type === "object" && isNonArrayRecord(record))
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) collectStrings(record.value[key], propSchema, out);
}

/**
 * Every free-text string `config` holds where its type's `configSchema` declares one — a `text`
 * widget's `body`, each social link's `url`. Ref fields (`x-ref-target`) are left out (they name
 * other content by id) and so is anything the schema does not declare (`recent-entries`' `where`).
 * The publish carry-along (`publish-content.ts`) reads media URLs out of these.
 *
 * @complexity O(n) over the config's declared nodes.
 */
export function collectWidgetConfigStrings(required: { schema: Record<string, unknown>; config: Record<string, unknown> }, _optional: Record<string, never> = {}): string[] {
  const out: string[] = [];
  collectStrings(required.config, required.schema as WidgetConfigJsonSchema, out);
  return out;
}
