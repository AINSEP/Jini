/**
 * @file A deliberately small, closed subset of JSON Schema for admin-surface action inputs and
 * results: checked once when the descriptor is parsed, then used to validate every payload.
 *
 * Why not full JSON Schema: a surface's payload crosses a trust boundary (plugin UI -> host
 * handler), so the schema language is fail-closed. An unknown keyword refuses the descriptor
 * instead of being ignored (a plugin cannot rely on `pattern` or `format` that would silently pass),
 * objects are closed (no undeclared keys reach a handler), and every node must name its `type`.
 * Violation messages name the path only, never the value, so a rejected payload cannot echo a secret.
 */

export type AdminSurfaceActionSchema =
  | { readonly type: 'object'; readonly properties?: Readonly<Record<string, AdminSurfaceActionSchema>>; readonly required?: readonly string[]; readonly additionalProperties?: false }
  | { readonly type: 'array'; readonly items: AdminSurfaceActionSchema; readonly maxItems?: number }
  | { readonly type: 'string'; readonly minLength?: number; readonly maxLength?: number; readonly enum?: readonly string[] }
  | { readonly type: 'number' | 'integer'; readonly minimum?: number; readonly maximum?: number }
  | { readonly type: 'boolean' | 'null' };

type SchemaNode = Readonly<Record<string, unknown>>;

const MAX_DEPTH = 8;
/** Applies when an array schema declares no `maxItems`, so no payload is unbounded. */
const DEFAULT_MAX_ITEMS = 1000;
const ANNOTATIONS = ['type', 'title', 'description'];
const KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  object: ['properties', 'required', 'additionalProperties'],
  array: ['items', 'maxItems'],
  string: ['minLength', 'maxLength', 'enum'],
  number: ['minimum', 'maximum'],
  integer: ['minimum', 'maximum'],
  boolean: [],
  null: [],
};

function isPlainObject(value: unknown): value is SchemaNode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
const isCount = (value: unknown) => value === undefined || (Number.isInteger(value) && (value as number) >= 0);
const isBound = (value: unknown) => value === undefined || (typeof value === 'number' && Number.isFinite(value));

/**
 * Why a declared schema is unusable, or `null` when it is a valid member of the subset.
 * @complexity O(n) schema nodes; recursion bounded by {@link MAX_DEPTH}.
 */
export function checkAdminSurfaceActionSchema(required: { readonly schema: unknown }, optional: { readonly depth?: number } = {}): string | null {
  const { schema } = required;
  const depth = optional.depth ?? 0;
  if (!isPlainObject(schema)) return 'must be an object';
  if (depth > MAX_DEPTH) return `nests deeper than ${MAX_DEPTH} levels`;
  const type = schema.type;
  if (typeof type !== 'string' || !Object.hasOwn(KEYWORDS, type)) return 'must declare a supported type';
  const unknown = Object.keys(schema).find((key) => !ANNOTATIONS.includes(key) && !KEYWORDS[type]!.includes(key));
  if (unknown !== undefined) return `uses unsupported keyword '${unknown}'`;
  return checkKeywords(schema, type, depth);
}

/** @complexity O(n) child schema nodes. */
function checkKeywords(schema: SchemaNode, type: string, depth: number): string | null {
  if (type === 'object') return checkObject(schema, depth);
  if (type === 'array') return checkArray(schema, depth);
  if (type === 'string') return checkString(schema);
  if (type === 'number' || type === 'integer') return isBound(schema.minimum) && isBound(schema.maximum) ? null : 'minimum/maximum must be finite numbers';
  return null;
}

function checkObject(schema: SchemaNode, depth: number): string | null {
  const properties = schema.properties ?? {};
  if (!isPlainObject(properties)) return 'properties must be an object';
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) return 'additionalProperties may only be false (objects are closed)';
  const required = schema.required ?? [];
  if (!Array.isArray(required) || !required.every((key) => typeof key === 'string' && Object.hasOwn(properties, key))) return 'required must list declared properties';
  for (const [key, child] of Object.entries(properties)) {
    const reason = checkAdminSurfaceActionSchema({ schema: child }, { depth: depth + 1 });
    if (reason !== null) return `property '${key}' ${reason}`;
  }
  return null;
}

function checkArray(schema: SchemaNode, depth: number): string | null {
  if (!isCount(schema.maxItems)) return 'maxItems must be a non-negative integer';
  const reason = checkAdminSurfaceActionSchema({ schema: schema.items }, { depth: depth + 1 });
  return reason === null ? null : `items ${reason}`;
}

function checkString(schema: SchemaNode): string | null {
  if (!isCount(schema.minLength) || !isCount(schema.maxLength)) return 'minLength/maxLength must be non-negative integers';
  const values = schema.enum;
  if (values === undefined) return null;
  return Array.isArray(values) && values.length > 0 && values.every((value) => typeof value === 'string') ? null : 'enum must be a non-empty list of strings';
}

/**
 * The first place `value` violates a schema that passed {@link checkAdminSurfaceActionSchema}, or
 * `null` when it conforms. The message names a path such as `$.rows[2]`, never the offending value.
 * @complexity O(v) values visited.
 */
export function validateAdminSurfaceActionValue(required: { readonly schema: AdminSurfaceActionSchema; readonly value: unknown }, optional: { readonly path?: string } = {}): string | null {
  const { schema, value } = required;
  const path = optional.path ?? '$';
  switch (schema.type) {
    case 'object': return validateObject(schema, value, path);
    case 'array': return validateArray(schema, value, path);
    case 'string': return validateString(schema, value, path);
    case 'boolean': return typeof value === 'boolean' ? null : `${path} must be a boolean`;
    case 'null': return value === null ? null : `${path} must be null`;
    default: return validateNumber(schema, value, path);
  }
}

function validateObject(schema: Extract<AdminSurfaceActionSchema, { type: 'object' }>, value: unknown, path: string): string | null {
  if (!isPlainObject(value)) return `${path} must be an object`;
  const properties = schema.properties ?? {};
  const extra = Object.keys(value).find((key) => !Object.hasOwn(properties, key));
  if (extra !== undefined) return `${path} has an undeclared property ${JSON.stringify(extra.slice(0, 64))}`;
  const missing = (schema.required ?? []).find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) return `${path}.${missing} is required`;
  for (const [key, child] of Object.entries(value)) {
    const reason = validateAdminSurfaceActionValue({ schema: properties[key]!, value: child }, { path: `${path}.${key}` });
    if (reason !== null) return reason;
  }
  return null;
}

function validateArray(schema: Extract<AdminSurfaceActionSchema, { type: 'array' }>, value: unknown, path: string): string | null {
  if (!Array.isArray(value)) return `${path} must be an array`;
  if (value.length > (schema.maxItems ?? DEFAULT_MAX_ITEMS)) return `${path} has too many items`;
  for (const [index, item] of value.entries()) {
    const reason = validateAdminSurfaceActionValue({ schema: schema.items, value: item }, { path: `${path}[${index}]` });
    if (reason !== null) return reason;
  }
  return null;
}

function validateString(schema: Extract<AdminSurfaceActionSchema, { type: 'string' }>, value: unknown, path: string): string | null {
  if (typeof value !== 'string') return `${path} must be a string`;
  if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) return `${path} has the wrong length`;
  return schema.enum === undefined || schema.enum.includes(value) ? null : `${path} is not one of the allowed values`;
}

function validateNumber(schema: Extract<AdminSurfaceActionSchema, { type: 'number' | 'integer' }>, value: unknown, path: string): string | null {
  const ok = typeof value === 'number' && Number.isFinite(value) && (schema.type === 'number' || Number.isInteger(value));
  if (!ok) return `${path} must be ${schema.type === 'integer' ? 'an integer' : 'a number'}`;
  return value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity) ? null : `${path} is out of range`;
}
