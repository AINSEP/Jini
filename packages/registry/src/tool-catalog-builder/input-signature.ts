import { batchItemRequiredFields } from '@jini-ai/core';

/** Search hits carry this compact argument line instead of the full input schema: a full schema
 * on every hit doubled search output (7,988 -> 16,381 bytes for ten theme hits) on every search,
 * every run, while the first call only needs each required name and its type. */
export const MAX_SIGNATURE_BYTES = 300;
const DESCRIBE = 'call describe_tool for the arguments';
const MAX_ENUM_CHARS = 60;

type Schema = Record<string, unknown>;

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function scalarType(schema: Schema): string {
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.map(value => JSON.stringify(value)).join('|');
    return values.length <= MAX_ENUM_CHARS ? values : 'enum';
  }
  return typeof schema.type === 'string' ? schema.type : 'any';
}

/** One nesting level: `{label: string, value?: string}`. Deeper shapes print their bare type. */
function objectShape(schema: Schema): string | undefined {
  if (!isSchema(schema.properties)) return undefined;
  const required = Array.isArray(schema.required) ? schema.required : [];
  const fields = Object.entries(schema.properties).map(([name, field]) =>
    `${name}${required.includes(name) ? '' : '?'}: ${isSchema(field) ? scalarType(field) : 'any'}`);
  return `{${fields.join(', ')}}`;
}

function typeLabel(schema: unknown): string {
  if (!isSchema(schema)) return 'any';
  if (schema.type === 'array') return `array<${isSchema(schema.items) ? objectShape(schema.items) ?? scalarType(schema.items) : 'any'}>`;
  return objectShape(schema) ?? scalarType(schema);
}

/** Where the required names live: the schema itself, the first `anyOf` alternative (the primary
 * form; others are aliases), or the items description a batch wrapper moved them into. */
function requiredNames(schema: Schema): { names: string[]; alternatives: boolean } {
  if (Array.isArray(schema.required) && schema.required.length > 0) return { names: schema.required.map(String), alternatives: false };
  const first: unknown = Array.isArray(schema.anyOf) ? schema.anyOf[0] : undefined;
  if (isSchema(first) && Array.isArray(first.required)) return { names: first.required.map(String), alternatives: true };
  return { names: batchItemRequiredFields({ inputSchema: schema }), alternatives: false };
}

/**
 * A bounded one-line argument signature for a search hit, e.g. `themeId: string, includeTrash?: boolean`.
 * Required fields come first; optional ones are dropped before the line exceeds the byte cap, and a
 * line whose required part alone is too long tells the model to call describe_tool.
 * @returns The signature, or undefined for a schema-less or non-object descriptor.
 * @complexity O(p + e) for p properties and e enum values; pure.
 */
export function inputSignature({ inputSchema }: { inputSchema: unknown }, _optional: Record<string, never> = {}): string | undefined {
  if (!isSchema(inputSchema) || !isSchema(inputSchema.properties)) return undefined;
  const properties = inputSchema.properties;
  const { names, alternatives } = requiredNames(inputSchema);
  const required = names.map(name => `${name}: ${typeLabel(properties[name])}`);
  const optional = Object.keys(properties).filter(name => !names.includes(name)).map(name => `${name}?: ${typeLabel(properties[name])}`);
  const suffix = alternatives ? ' (other forms: describe_tool)' : '';
  const full = [...required, ...optional].join(', ') + suffix;
  if (full === '') return 'no arguments';
  if (byteLength(full) <= MAX_SIGNATURE_BYTES) return full;
  const requiredOnly = `${required.length > 0 ? required.join(', ') : 'no required arguments'}; optional fields: describe_tool`;
  return byteLength(requiredOnly) <= MAX_SIGNATURE_BYTES ? requiredOnly : DESCRIBE;
}
