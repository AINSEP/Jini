import { isNonArrayRecord } from './records.js';
import type { ToolRegistration } from './tool-registry.js';
import { ToolInputError, ToolInputNormalizationError } from './tool-input-errors.js';
export { ToolInputNormalizationError } from './tool-input-errors.js';

/** A value-free account of canonicalization; domain hooks use the same contract as the gate. */
export interface NormalizedToolInput {
  readonly input: unknown;
  readonly notes: readonly string[];
}
export type ToolInputNormalizer = (required: { input: Readonly<Record<string, unknown>> }, optional?: Record<string, never>) => NormalizedToolInput | Promise<NormalizedToolInput>;

const object = (value: unknown): value is Record<string, unknown> => isNonArrayRecord({ value });
const keyShape = (key: string) => key.replace(/[_-]/g, '').toLowerCase();

/** Length of the shared prefix of two strings. */
function commonPrefixLength({ left, right }: { left: string; right: string }): number {
  let index = 0;
  while (index < left.length && left[index] === right[index]) index++;
  return index;
}

/** Same-length strings that differ by one substitution or one adjacent transposition at `index`. */
function sameLengthNearMiss({ left, right, index }: { left: string; right: string; index: number }): boolean {
  return left.slice(index + 1) === right.slice(index + 1)
    || (left[index] === right[index + 1] && left[index + 1] === right[index] && left.slice(index + 2) === right.slice(index + 2));
}

/** Whether either key is the generic id shorthand for the other's id suffix. */
function isIdShorthand({ left, right }: { left: string; right: string }, _options: Record<string, never> = {}): boolean {
  return (left === 'id' && right.endsWith('id')) || (right === 'id' && left.endsWith('id'));
}

/** Detect id shorthand or one insertion, deletion, substitution or transposition. */
function nearMiss({ left, right }: { left: string; right: string }, _options: Record<string, never> = {}): boolean {
  if (left.length > 128 || right.length > 128) return false;
  if (isIdShorthand({ left, right })) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  const index = commonPrefixLength({ left, right });
  if (left.length === right.length) return sameLengthNearMiss({ left, right, index });
  return left.length > right.length ? left.slice(index + 1) === right.slice(index) : left.slice(index) === right.slice(index + 1);
}

/** Per-walk settings shared by every level: the notes sink and which pass this is. */
interface Walk {
  readonly notes: string[];
  /** Final pass only: refuse keys a closed schema does not declare. */
  readonly validateClosed: boolean;
  /** Batch-layer pass: canonicalize keys without coercing values or wrapping items. */
  readonly keysOnly: boolean;
}
interface Step { readonly path: string; readonly depth: number; readonly walk: Walk }

const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Number/integer coercion; returns `value` itself when the string is not a representable number. */
function coerceNumber({ value, types, path, notes }: { value: string; types: readonly unknown[]; path: string; notes: string[] }): unknown {
  const numeric = types.includes('number');
  const integer = types.includes('integer');
  if (!(numeric || integer) || !NUMBER_PATTERN.test(value.trim())) return value;
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !numeric && !Number.isSafeInteger(number))) return value;
  notes.push(`${path}: string→${numeric ? 'number' : 'integer'}`);
  return number;
}

/** Boolean words first, then numbers; any other string is left for the handler's validator. */
function coerceString({ value, types, path, notes }: { value: string; types: readonly unknown[]; path: string; notes: string[] }): unknown {
  if (types.includes('boolean') && /^(true|false)$/i.test(value.trim())) {
    notes.push(`${path}: string→boolean`);
    return value.trim().toLowerCase() === 'true';
  }
  return coerceNumber({ value, types, path, notes });
}

/** Unwrap only a singleton string array; refuse malformed arrays without exposing values.
 * Keys-only batch layers preserve values until the final merged input is normalized.
 * @complexity O(t) time for t allowed schema types, O(1) space; array contents are not scanned.
 */
function unwrapStringArray({ value, types, step }: { value: unknown; types: readonly unknown[]; step: Step }): unknown {
  if (step.walk.keysOnly || !Array.isArray(value) || !types.includes('string')) return value;
  if (value.length !== 1 || typeof value[0] !== 'string') {
    throw new ToolInputError({ message: `${step.path}: send one value as a string or a one-element string array.` });
  }
  step.walk.notes.push(`${step.path}: one-item string array→string`);
  return value[0];
}

function normalizeArray({ value, schema, step }: { value: unknown; schema: Record<string, unknown>; step: Step }): unknown {
  const { path, depth, walk } = step;
  let list = value;
  // The single-object shorthand applies to items batching, never arbitrary domain arrays.
  if (!walk.keysOnly && object(value) && path.split('.').at(-1) === 'items') {
    walk.notes.push(`${path}: object→one-item array`);
    list = [value];
  }
  if (!Array.isArray(list)) return list;
  return list.map((item, index) => normalizeValue({ value: item, schema: schema.items, step: { path: `${path}[${index}]`, depth: depth + 1, walk } }));
}

/** The schema facts every key of one object is checked against. */
interface ObjectShape {
  readonly schema: Record<string, unknown>;
  readonly properties: Record<string, unknown>;
  readonly names: readonly string[];
  readonly required: readonly string[];
}

/** Exact names, then case/separator variants, then a sole hint; ambiguous hints stay unresolved
 * for the domain hook or closed-schema refusal. Never choose one of several candidates.
 * Hints apply only where a closed schema would refuse the key: an open schema accepts it as data.
 * @complexity O(p) time and space for p declared properties; near-miss names are length-bounded.
 */
function canonicalKey({ key, location, shape }: { key: string; location: string; shape: ObjectShape }): string | undefined {
  const candidates = Object.hasOwn(shape.properties, key) ? [key] : shape.names.filter(name => keyShape(name) === keyShape(key));
  if (candidates.length > 1) throw new ToolInputError({ message: `Ambiguous input '${location}': matches ${candidates.join(', ')}. Use exactly one canonical property name.` });
  if (candidates.length === 1 || shape.schema.additionalProperties !== false) return candidates[0];
  const hints = shape.names.filter(name => nearMiss({ left: keyShape(key), right: keyShape(name) }));
  return hints.length === 1 ? hints[0] : undefined;
}

/** Describe the local schema and likely names without choosing a name or exposing input values.
 * Target and permission fields must be declared in the tool schema before callers can use them.
 * @complexity O(p) time and space for p declared properties; name comparisons are length-bounded.
 */
function unknownKeyError({ key, location, shape }: { key: string; location: string; shape: ObjectShape }, _options: Record<string, never> = {}): ToolInputError {
  const required = new Set(shape.required);
  const names = [...shape.names.filter(name => required.has(name)), ...shape.names.filter(name => !required.has(name))];
  const declared = names.map(name => `${name} (${required.has(name) ? 'required' : 'optional'})`).join(', ') || 'none';
  const hints = names.filter(name => nearMiss({ left: keyShape(key), right: keyShape(name) }));
  const suggestion = hints.length ? ` Did you mean ${hints.map(name => `'${name}'`).join(', ')}?` : '';
  return new ToolInputError({ message: `Unknown input '${location}'. Declared inputs: ${declared}.${suggestion} Resend with the declared name.` });
}

/** One key of an object: canonical rename + recursion, closed-schema refusal, or open pass-through. */
function normalizeEntry(
  { key, raw, shape, sources, step }: { key: string; raw: unknown; shape: ObjectShape; sources: Map<string, string>; step: Step },
): [string, unknown] {
  const { path, depth, walk } = step;
  const location = path ? `${path}.${key}` : key;
  const target = canonicalKey({ key, location, shape });
  if (target === undefined) {
    if (walk.validateClosed && shape.schema.additionalProperties === false) throw unknownKeyError({ key, location, shape });
    const childSchema = object(shape.schema.additionalProperties) ? shape.schema.additionalProperties : undefined;
    return [key, normalizeValue({ value: raw, schema: childSchema, step: { path: location, depth: depth + 1, walk } })];
  }
  const previous = sources.get(target);
  if (previous !== undefined) throw new ToolInputError({ message: `Conflicting inputs '${previous}' and '${key}' both name '${target}'. Send only '${target}'.` });
  sources.set(target, key);
  if (target !== key) walk.notes.push(`${location}→${target}`);
  return [target, normalizeValue({ value: raw, schema: shape.properties[target], step: { path: `${path ? `${path}.` : ''}${target}`, depth: depth + 1, walk } })];
}

function normalizeObject({ value, schema, step }: { value: Record<string, unknown>; schema: Record<string, unknown>; step: Step }): Record<string, unknown> {
  const properties = object(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : [];
  const shape: ObjectShape = { schema, properties, names: Object.keys(properties), required };
  const sources = new Map<string, string>();
  return Object.fromEntries(Object.entries(value).map(([key, raw]) => normalizeEntry({ key, raw, shape, sources, step })));
}

/** Schema-guided copies only: unconstrained data and unsupported schema dialects stay untouched.
 * Cost is O(k*p) per object with k supplied keys and p schema properties; recursion is bounded
 * to 64 levels so a hostile input/schema cannot exhaust the execution gate's stack.
 */
function normalizeValue({ value, schema, step }: { value: unknown; schema: unknown; step: Step }): unknown {
  if (!object(schema)) return value;
  if (step.depth > 64) throw new ToolInputError({ message: 'Tool input exceeds the 64-level normalization limit. Send a shallower object.' });
  const types: readonly unknown[] = Array.isArray(schema.type) ? schema.type : [schema.type];
  // A string is never an array or object, so it is either coerced here or returned as-is.
  if (typeof value === 'string') {
    return step.walk.keysOnly || types.includes('string') ? value : coerceString({ value, types, path: step.path, notes: step.walk.notes });
  }
  if (types.includes('array')) return normalizeArray({ value, schema, step });
  const unwrapped = unwrapStringArray({ value, types, step });
  return object(unwrapped) ? normalizeObject({ value: unwrapped, schema, step }) : unwrapped;
}

/** A walk from the root of one input. */
function walkRoot({ input, schema, notes, validateClosed, keysOnly }: { input: unknown; schema: unknown } & Walk): unknown {
  return normalizeValue({ value: input, schema, step: { path: '', depth: 0, walk: { notes, validateClosed, keysOnly } } });
}

/** Canonicalize one batch layer before merging; preserve values and domain aliases for the
 * final normalization. Throws ToolInputError for collisions within this layer, never across
 * layers. Uses the same bounded schema walk as normalizeToolInput.
 * @example canonicalizeToolInputKeys({ input: { max_chars: '1000' }, schema });
 */
export function canonicalizeToolInputKeys(
  { input, schema }: { input: Readonly<Record<string, unknown>>; schema: unknown },
  _options: Record<string, never> = {},
): { input: Record<string, unknown>; notes: readonly string[] } {
  const notes: string[] = [];
  return { input: walkRoot({ input, schema, notes, validateClosed: false, keysOnly: true }) as Record<string, unknown>, notes };
}

/** Normalize before policy, confirmation and handler validation. Domain hooks own semantic aliases.
 * Never changes the caller's object or includes values in notes. Invalid/ambiguous input remains
 * a ToolInputError; ordinary domain/schema validation still belongs to the registered handler.
 * @complexity Two bounded schema walks plus the optional domain hook's cost.
 */
export async function normalizeToolInput(
  { input, registration }: { input: unknown; registration: Pick<ToolRegistration, 'descriptor' | 'normalizeInput' | 'invocationSchema'> },
  _options: Record<string, never> = {},
): Promise<NormalizedToolInput> {
  try {
    return await normalizeWithinGate({ input, registration });
  } catch (error) {
    if (error instanceof ToolInputError) throw new ToolInputNormalizationError({ message: error.message });
    throw error;
  }
}

const isObjectTool = (schema: unknown): boolean => object(schema) && schema.type === 'object';

/** First pass (open), the optional domain hook, then the final closed-schema pass. */
async function normalizeWithinGate(
  { input, registration }: { input: unknown; registration: Pick<ToolRegistration, 'descriptor' | 'normalizeInput' | 'invocationSchema'> },
): Promise<NormalizedToolInput> {
  const schema = registration.invocationSchema ?? registration.descriptor.inputSchema;
  if (isObjectTool(schema) && !object(input)) throw new ToolInputError({ message: `${registration.descriptor.id}: send one input object containing the tool's fields.` });
  const notes: string[] = [];
  let normalized = walkRoot({ input, schema, notes, validateClosed: false, keysOnly: false });
  if (registration.normalizeInput && object(normalized)) {
    const result = await registration.normalizeInput({ input: normalized });
    normalized = result.input;
    notes.push(...result.notes);
  }
  if (isObjectTool(schema) && !object(normalized)) throw new ToolInputError({ message: `${registration.descriptor.id}: normalization must produce one input object.` });
  return { input: walkRoot({ input: normalized, schema, notes, validateClosed: true, keysOnly: false }), notes };
}

/** Keep result shapes intact and make rewrite notes visible in plain and MCP tool results. */
export function withNormalizationNotes({ output, notes }: { output: unknown; notes: readonly string[] }, _options: Record<string, never> = {}): unknown {
  if (!notes.length) return output;
  const text = `normalized: ${notes.join('; ')}`;
  if (typeof output === 'string') return `${output}\n${text}`;
  if (object(output)) return { ...output, normalizationNotes: notes,
    ...(Array.isArray(output.content) ? { content: [...output.content, { type: 'text', text }] } : {}) };
  return { result: output, normalizationNotes: notes };
}
