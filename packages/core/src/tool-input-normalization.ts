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

/** Detect one insertion, deletion, substitution or adjacent transposition, for hints only. */
function nearMiss(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1 || left.length > 128 || right.length > 128) return false;
  let index = 0;
  while (index < left.length && left[index] === right[index]) index++;
  if (left.length === right.length) return left.slice(index + 1) === right.slice(index + 1)
    || (left[index] === right[index + 1] && left[index + 1] === right[index] && left.slice(index + 2) === right.slice(index + 2));
  return left.length > right.length ? left.slice(index + 1) === right.slice(index) : left.slice(index) === right.slice(index + 1);
}

/** Schema-guided copies only: unconstrained data and unsupported schema dialects stay untouched.
 * Cost is O(k*p) per object with k supplied keys and p schema properties; recursion is bounded
 * to 64 levels so a hostile input/schema cannot exhaust the execution gate's stack.
 */
function normalizeValue(value: unknown, schema: unknown, notes: string[], path: string, validateClosed: boolean, depth = 0, keysOnly = false): unknown {
  if (!object(schema)) return value;
  if (depth > 64) throw new ToolInputError({ message: 'Tool input exceeds the 64-level normalization limit. Send a shallower object.' });
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!keysOnly && typeof value === 'string' && !types.includes('string')) {
    if (types.includes('boolean') && /^(true|false)$/i.test(value.trim())) {
      notes.push(`${path}: string→boolean`);
      return value.trim().toLowerCase() === 'true';
    }
    if ((types.includes('number') || types.includes('integer')) && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value.trim())) {
      const number = Number(value);
      if (Number.isFinite(number) && (!types.includes('integer') || types.includes('number') || Number.isSafeInteger(number))) {
        notes.push(`${path}: string→${types.includes('number') ? 'number' : 'integer'}`);
        return number;
      }
    }
  }
  if (types.includes('array')) {
    // The single-object shorthand applies to items batching, never arbitrary domain arrays.
    if (!keysOnly && object(value) && path.split('.').at(-1) === 'items') {
      notes.push(`${path}: object→one-item array`);
      value = [value];
    }
    if (Array.isArray(value)) return value.map((item, index) => normalizeValue(item, schema.items, notes, `${path}[${index}]`, validateClosed, depth + 1, keysOnly));
    return value;
  }
  if (!object(value)) return value;
  const properties = object(schema.properties) ? schema.properties : {};
  const names = Object.keys(properties);
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : [];
  const entries: [string, unknown][] = [];
  const sources = new Map<string, string>();
  for (const [key, raw] of Object.entries(value)) {
    const candidates = Object.hasOwn(properties, key) ? [key] : names.filter(name => keyShape(name) === keyShape(key));
    const location = path ? `${path}.${key}` : key;
    if (candidates.length > 1) throw new ToolInputError({ message: `Ambiguous input '${location}': matches ${candidates.join(', ')}. Use exactly one canonical property name.` });
    const target = candidates[0];
    if (target !== undefined) {
      const previous = sources.get(target);
      if (previous !== undefined) throw new ToolInputError({ message: `Conflicting inputs '${previous}' and '${key}' both name '${target}'. Send only '${target}'.` });
      sources.set(target, key);
      if (target !== key) notes.push(`${path ? `${path}.` : ""}${key}→${target}`);
      entries.push([target, normalizeValue(raw, properties[target], notes, `${path ? `${path}.` : ""}${target}`, validateClosed, depth + 1, keysOnly)]);
    } else if (validateClosed && schema.additionalProperties === false) {
      const hints = required.filter(name => nearMiss(keyShape(key), keyShape(name)));
      if (hints.length) throw new ToolInputError({ message: `Unknown input '${location}'; possible required property: ${hints.join(', ')}. Use the canonical property explicitly; no value was guessed.` });
      throw new ToolInputError({ message: `Unknown input '${location}'. Use only the declared properties; declare target and permission fields in the tool schema before using them.` });
    } else {
      const childSchema = object(schema.additionalProperties) ? schema.additionalProperties : undefined;
      entries.push([key, normalizeValue(raw, childSchema, notes, location, validateClosed, depth + 1, keysOnly)]);
    }
  }
  return Object.fromEntries(entries);
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
  return { input: normalizeValue(input, schema, notes, '', false, 0, true) as Record<string, unknown>, notes };
}

/** Normalize before policy, confirmation and handler validation. Domain hooks own semantic aliases.
 * Never changes the caller's object or includes values in notes. Invalid/ambiguous input remains
 * a ToolInputError; ordinary domain/schema validation still belongs to the registered handler.
 * @complexity Two bounded schema walks plus the optional domain hook's cost.
 */
export async function normalizeToolInput(
  { input, registration }: { input: unknown; registration: Pick<ToolRegistration, 'descriptor' | 'normalizeInput'> },
  _options: Record<string, never> = {},
): Promise<NormalizedToolInput> {
  try {
    const schema = registration.descriptor.inputSchema;
    if (object(schema) && schema.type === 'object' && !object(input)) throw new ToolInputError({ message: `${registration.descriptor.id}: send one input object containing the tool's fields.` });
    const notes: string[] = [];
    let normalized = normalizeValue(input, schema, notes, '', false);
    if (registration.normalizeInput && object(normalized)) {
      const result = await registration.normalizeInput({ input: normalized });
      normalized = result.input;
      notes.push(...result.notes);
    }
    if (object(schema) && schema.type === 'object' && !object(normalized)) throw new ToolInputError({ message: `${registration.descriptor.id}: normalization must produce one input object.` });
    return { input: normalizeValue(normalized, schema, notes, '', true), notes };
  } catch (error) {
    if (error instanceof ToolInputError) throw new ToolInputNormalizationError({ message: error.message });
    throw error;
  }
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
