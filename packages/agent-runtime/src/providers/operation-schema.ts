import { googleParametersOf, findNumericEnumPaths, coerceNumericEnumStringsToNumbers } from './google-schema.js';
import type { ProviderProtocol } from './tool-turn-types.js';

/** Closed reason codes are safe to observe: no schema, argument values or provider error text. */
export type OperationSchemaFallbackReason = 'endpoint-unsupported' | 'endpoint-rejected' | 'open-map' | 'recursive-schema' | 'unresolved-reference' | 'unsupported-schema' | 'optional-nullable' | 'schema-limit';
export interface CompiledOperationSchema {
  readonly schema: Record<string, unknown>;
  readonly strict: boolean;
  readonly fallbackReason?: OperationSchemaFallbackReason;
  /** Decode wire-only representations; authoritative validation still belongs to the host. */
  readonly decodeInput: (input: unknown) => unknown;
}

interface Decoder {
  readonly omitNull: boolean;
  readonly properties?: Readonly<Record<string, Decoder>>;
  readonly items?: Decoder;
  readonly numericEnum?: readonly number[];
}
interface Projection { readonly schema: Record<string, unknown>; readonly decoder: Decoder }
interface WalkContext {
  readonly root: Record<string, unknown>;
  readonly protocol: ProviderProtocol;
  readonly ancestors: ReadonlySet<object>;
  readonly budget: { remaining: number };
  readonly depth: number;
}
class SchemaProjectionError extends Error {
  constructor(readonly reason: OperationSchemaFallbackReason) { super(reason); }
}
const EMPTY_SCHEMA = { type: 'object', additionalProperties: false, properties: {}, required: [] };
const SCHEMA_KEYS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf', '$defs', 'definitions', '$ref', '$schema', 'title', 'description', 'default', 'examples']);
const TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']);
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function reject(reason: OperationSchemaFallbackReason): never { throw new SchemaProjectionError(reason); }

/** Resolve local JSON pointers only. Expansion is bounded by the same node/depth budget as inline schemas. */
function resolveReference(schema: Record<string, unknown>, context: WalkContext): Record<string, unknown> {
  if (schema.$ref === undefined) return schema;
  if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/')) return reject('unresolved-reference');
  if (Object.keys(schema).some(key => !['$ref', 'description', 'title'].includes(key))) return reject('unsupported-schema');
  let target: unknown = context.root;
  for (const part of schema.$ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isRecord(target) || !Object.hasOwn(target, key)) return reject('unresolved-reference');
    target = target[key];
  }
  if (!isRecord(target)) return reject('unresolved-reference');
  return target;
}

/** Only simple nullable unions are projected; ambiguous variant decoders use host-validated fallback. */
function normalizedNode(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.anyOf === undefined) return schema;
  if (!Array.isArray(schema.anyOf) || schema.anyOf.length !== 2) return reject('unsupported-schema');
  const nullMember = schema.anyOf.find(member => isRecord(member) && member.type === 'null');
  if (!isRecord(nullMember) || Object.keys(nullMember).some(key => !['type', 'title', 'description'].includes(key))) return reject('unsupported-schema');
  const nonNull = schema.anyOf.filter(member => !isRecord(member) || member.type !== 'null');
  if (nonNull.length !== 1 || !isRecord(nonNull[0])) return reject('unsupported-schema');
  if (Object.keys(schema).some(key => !['anyOf', 'title', 'description', 'default'].includes(key))) return reject('unsupported-schema');
  const child = nonNull[0];
  if (typeof child.type !== 'string') return reject('unsupported-schema');
  return { ...child, type: [child.type, 'null'] };
}

function nodeTypes(schema: Record<string, unknown>): string[] {
  const types: unknown[] = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length === 0) return reject('unsupported-schema');
  if (!types.every((type): type is string => typeof type === 'string' && TYPES.has(type))) return reject('unsupported-schema');
  if (new Set(types).size !== types.length) return reject('unsupported-schema');
  if (types.length > 1 && (types.length !== 2 || !types.includes('null'))) return reject('unsupported-schema');
  return types;
}

function schemaMetadata(schema: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(['title', 'description'].filter(key => schema[key] !== undefined).map(key => [key, schema[key]]));
}

/** Literal constraints stay authoritative; numeric enum stringification is owned by google-schema. */
function projectLiterals(schema: Record<string, unknown>, projected: Record<string, unknown>): void {
  if (schema.enum !== undefined) projected.enum = literalValues(schema.enum);
  if (Object.hasOwn(schema, 'const')) {
    if (schema.enum !== undefined) return reject('unsupported-schema');
    projected.enum = literalValues([schema.const]);
  }
}

function literalValues(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length === 0) return reject('unsupported-schema');
  if (value.some(member => member !== null && !['string', 'number', 'boolean'].includes(typeof member))) return reject('unsupported-schema');
  return [...value];
}

function childContext(context: WalkContext, schema: Record<string, unknown>): WalkContext {
  return { ...context, depth: context.depth + 1, ancestors: new Set([...context.ancestors, schema]) };
}

function makeNullable(schema: Record<string, unknown>): Record<string, unknown> {
  return { anyOf: [schema, { type: 'null' }] };
}

/** A missing additionalProperties is open JSON Schema too; closing it would silently discard allowed keys. */
function projectObject(schema: Record<string, unknown>, context: WalkContext): Projection {
  if (schema.additionalProperties !== false) return reject('open-map');
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];
  if (!isRecord(properties) || !Array.isArray(required)) return reject('unsupported-schema');
  if (required.some(key => typeof key !== 'string' || !Object.hasOwn(properties, key))) return reject('unsupported-schema');
  const requiredKeys = new Set(required);
  const children = Object.entries(properties).map(([key, child]) => [key, projectNode(child, context, !requiredKeys.has(key))] as const);
  const projected = {
    type: schema.type, ...schemaMetadata(schema), additionalProperties: false,
    properties: Object.fromEntries(children.map(([key, child]) => [key, child.schema])),
    required: Object.keys(properties),
  };
  projectLiterals(schema, projected);
  return { schema: projected, decoder: { omitNull: false, properties: Object.fromEntries(children.map(([key, child]) => [key, child.decoder])) } };
}

function projectValue(schema: Record<string, unknown>, context: WalkContext): Projection {
  const types = nodeTypes(schema);
  if (types.includes('object')) return projectObject(schema, context);
  const projected: Record<string, unknown> = { type: schema.type, ...schemaMetadata(schema) };
  projectLiterals(schema, projected);
  let decoder: Decoder = { omitNull: false };
  if (types.includes('array')) {
    const item = projectNode(schema.items, context, false);
    projected.items = item.schema;
    decoder = { ...decoder, items: item.decoder };
  }
  decoder = googleEnumDecoder(projected, decoder, context.protocol);
  return { schema: projected, decoder };
}

/** Let the existing Google sanitizer stringify a nullable numeric enum too, retaining real nulls. */
function googleEnumDecoder(schema: Record<string, unknown>, decoder: Decoder, protocol: ProviderProtocol): Decoder {
  if (protocol !== 'google' || !Array.isArray(schema.enum)) return decoder;
  const values = schema.enum.filter(value => value !== null);
  if (values.length === 0 || !values.every(value => typeof value === 'number')) return decoder;
  if (schema.enum.includes(null)) {
    const types = nodeTypes(schema);
    if (!types.includes('null')) return reject('unsupported-schema');
    schema.enum = values;
  }
  return { ...decoder, numericEnum: values as number[] };
}

/** O(n) for the expanded tree, bounded to 2048 nodes and 32 levels; no I/O or input mutation. */
function projectNode(value: unknown, context: WalkContext, optional: boolean): Projection {
  if (--context.budget.remaining < 0 || context.depth > 32) return reject('schema-limit');
  if (!isRecord(value)) return reject('unsupported-schema');
  const resolved = resolveReference(value, context);
  if (context.ancestors.has(resolved)) return reject('recursive-schema');
  if (Object.keys(resolved).some(key => !SCHEMA_KEYS.has(key))) return reject('unsupported-schema');
  const schema = normalizedNode(resolved);
  if (Object.keys(schema).some(key => !SCHEMA_KEYS.has(key))) return reject('unsupported-schema');
  const types = nodeTypes(schema);
  // Required wire properties cannot represent both omission and a genuine null-as-clear.
  // Prefer fallback over inventing a sentinel or forcing an unintended clear operation.
  if (optional && types.includes('null')) return reject('optional-nullable');
  const result = projectValue(schema, childContext(context, resolved));
  // Synthetic null means omission only for originally non-nullable optional properties.
  // A required nullable field's real null remains a clear operation, even inside nested objects.
  if (!optional) return result;
  return { schema: makeNullable(result.schema), decoder: { ...result.decoder, omitNull: true } };
}

function decodeValue(input: unknown, decoder: Decoder): unknown {
  if (typeof input === 'string' && decoder.numericEnum?.some(value => String(value) === input)) return Number(input);
  if (Array.isArray(input) && decoder.items) return input.map(value => decodeValue(value, decoder.items!));
  if (!isRecord(input) || !decoder.properties) return input;
  return decodeObject(input, decoder.properties);
}

function decodeObject(input: Record<string, unknown>, properties: Readonly<Record<string, Decoder>>): Record<string, unknown> {
  const entries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(input)) {
    const child = Object.hasOwn(properties, key) ? properties[key] : undefined;
    if (value === null && child?.omitNull) continue;
    entries.push([key, child ? decodeValue(value, child) : value]);
  }
  return Object.fromEntries(entries);
}

function fallback(schema: Record<string, unknown>, protocol: ProviderProtocol, reason: OperationSchemaFallbackReason): CompiledOperationSchema {
  if (protocol !== 'google') return { schema, strict: false, fallbackReason: reason, decodeInput: input => input };
  const paths = findNumericEnumPaths({ schema });
  return {
    schema: googleParametersOf({ descriptor: { id: '', inputSchema: schema } }), strict: false, fallbackReason: reason,
    decodeInput: input => coerceNumericEnumStringsToNumbers({ input, paths }),
  };
}

function compileStrict(schema: Record<string, unknown>, protocol: ProviderProtocol): CompiledOperationSchema {
  const result = projectNode(schema, { root: schema, protocol, ancestors: new Set(), budget: { remaining: 2048 }, depth: 0 }, false);
  if (result.schema.type !== 'object') return reject('unsupported-schema');
  const wireSchema = protocol === 'google' ? googleParametersOf({ descriptor: { id: '', inputSchema: result.schema } }) : result.schema;
  return { schema: wireSchema, strict: true, decodeInput: input => decodeValue(input, result.decoder) };
}

/**
 * Project a conservative strict schema under the fixed prefer policy. Unsupported contracts stay
 * non-strict and require host validation; open maps and recursive schemas are never narrowed.
 * @param required - Authoritative input schema and the actual wire protocol.
 * @param optional - Strict endpoint support, supplied by the request adapter for this endpoint/model.
 * @returns Wire schema, value-free fallback reason and a decoder for exactly that projection.
 * @complexity O(n) time/space in the bounded expanded schema; decoding O(a) in argument nodes.
 */
export function compileOperationSchema(
  { schema: inputSchema, protocol }: { schema: unknown; protocol: ProviderProtocol },
  { strict = false }: { strict?: boolean } = {},
): CompiledOperationSchema {
  const schema = isRecord(inputSchema) ? inputSchema : EMPTY_SCHEMA;
  if (inputSchema !== undefined && !isRecord(inputSchema)) return fallback(schema, protocol, 'unsupported-schema');
  if (!strict) return fallback(schema, protocol, 'endpoint-unsupported');
  try {
    return compileStrict(schema, protocol);
  } catch (error) {
    if (!(error instanceof SchemaProjectionError)) throw error;
    return fallback(schema, protocol, error.reason);
  }
}
