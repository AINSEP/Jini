/**
 * Declared input repairs: facts a tool's own input schema states so a caller's near-miss is repaired
 * in plain sight instead of refused. The only repair here is `clamp`: a numeric property that sets
 * `clamp: true` and declares `minimum` and/or `maximum` has an out-of-range number moved to the
 * nearest bound, with a note. Clamping is opt-in per property because it is only safe for page,
 * size and wait controls; a number that selects, addresses, prices or authorizes must be refused,
 * never moved. Pure: no I/O, no clock, no `node:` import, and it never mutates the caller's input.
 */
import { isNonArrayRecord } from './records.js';

/** Deepest object nesting the walks follow; a deeper property is neither clamped nor checked. */
const MAX_DEPTH = 6;

const isObject = (value: unknown): value is Record<string, unknown> => isNonArrayRecord({ value });
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The declared bounds of a numeric property; `undefined` when it is not numeric or has no finite bound. */
function declaredBounds(schema: Record<string, unknown>): { minimum?: number; maximum?: number } | undefined {
  if (schema.type !== 'integer' && schema.type !== 'number') return undefined;
  const minimum = isFiniteNumber(schema.minimum) ? schema.minimum : undefined;
  const maximum = isFiniteNumber(schema.maximum) ? schema.maximum : undefined;
  if (minimum === undefined && maximum === undefined) return undefined;
  return { ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}) };
}

/** The clamped value and its note, or `undefined` when the value is already in range or is not a repairable number. */
function clampedValue(
  { value, schema, path }: { value: unknown; schema: Record<string, unknown>; path: string },
): { value: number; note: string } | undefined {
  const bounds = declaredBounds(schema);
  if (bounds === undefined || !isFiniteNumber(value) || (schema.type === 'integer' && !Number.isInteger(value))) return undefined;
  if (bounds.maximum !== undefined && value > bounds.maximum) return { value: bounds.maximum, note: `${path} was lowered to its maximum, ${bounds.maximum}` };
  if (bounds.minimum !== undefined && value < bounds.minimum) return { value: bounds.minimum, note: `${path} was raised to its minimum, ${bounds.minimum}` };
  return undefined;
}

/** One property of one object level: recurse into an object value, or clamp an opted-in number. */
function clampProperty(
  { copy, name, property, prefix, depth, notes }: { copy: Record<string, unknown>; name: string; property: Record<string, unknown>; prefix: string; depth: number; notes: string[] },
): void {
  const path = `${prefix}${name}`;
  const current = copy[name];
  if (isObject(current)) {
    if (depth < MAX_DEPTH) copy[name] = clampObject({ value: current, schema: property, prefix: `${path}.`, depth: depth + 1, notes });
    return;
  }
  const repaired = property.clamp === true ? clampedValue({ value: current, schema: property, path }) : undefined;
  if (repaired === undefined) return;
  copy[name] = repaired.value;
  notes.push(repaired.note);
}

/** One object level: a copy whose opted-in numeric properties are clamped, recursing into object properties. */
function clampObject(
  { value, schema, prefix, depth, notes }: { value: Record<string, unknown>; schema: Record<string, unknown>; prefix: string; depth: number; notes: string[] },
): Record<string, unknown> {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const copy = { ...value };
  for (const [name, property] of Object.entries(properties)) {
    if (Object.hasOwn(copy, name) && isObject(property)) clampProperty({ copy, name, property, prefix, depth, notes });
  }
  return copy;
}

/**
 * Moves each out-of-range number of an opted-in property to its nearest declared bound.
 *
 * Only a finite number is repaired; a non-integer for an integer property, a string and anything
 * else is returned as given and refused by the tool's own validation as before. The note names the
 * property and the bound, never the caller's value.
 *
 * @param required.input - The already-normalized input (strings already coerced to numbers).
 * @param required.inputSchema - The tool's input schema.
 * @returns The input to run with (a copy; the argument is never mutated) and one note per repair.
 * @complexity O(p) for p schema properties visited, to depth 6; no effects.
 */
export function clampDeclaredBounds(
  { input, inputSchema }: { readonly input: unknown; readonly inputSchema: unknown },
  _optional: Record<string, never> = {},
): { input: unknown; notes: readonly string[] } {
  if (!isObject(input) || !isObject(inputSchema)) return { input, notes: [] };
  const notes: string[] = [];
  return { input: clampObject({ value: input, schema: inputSchema, prefix: '', depth: 0, notes }), notes };
}

/** Checks one property's `clamp` declaration; throws the message naming its path. */
function assertClampDeclaration({ property, path }: { property: Record<string, unknown>; path: string }): void {
  if (!Object.hasOwn(property, 'clamp')) return;
  if (typeof property.clamp !== 'boolean') throw new Error(`clamp on '${path}' must be true or false`);
  if (property.clamp && declaredBounds(property) === undefined) {
    throw new Error(`clamp on '${path}' needs a numeric type (integer or number) and a minimum or maximum`);
  }
}

/** Walks the properties of one object schema, to depth 6, checking every `clamp` declaration. */
function assertObjectSchema({ schema, prefix, depth }: { schema: Record<string, unknown>; prefix: string; depth: number }): void {
  const properties = isObject(schema.properties) ? schema.properties : {};
  for (const [name, property] of Object.entries(properties)) {
    if (!isObject(property)) continue;
    assertClampDeclaration({ property, path: `${prefix}${name}` });
    if (depth < MAX_DEPTH) assertObjectSchema({ schema: property, prefix: `${prefix}${name}.`, depth: depth + 1 });
  }
}

/**
 * Throws when a schema declares a repair the call-time code would silently ignore: `clamp` that is
 * not a boolean, or `clamp: true` on a property that is not numeric or has no bound. A registry-wide
 * gate calls this for every published schema so a mistyped declaration fails in CI, not in a run.
 *
 * @param required.inputSchema - The tool's input schema.
 * @throws Error naming the property path (`clamp on 'page.size' …`).
 * @complexity O(p) for p schema properties visited, to depth 6; no effects.
 */
export function assertRepairKeywords(
  { inputSchema }: { readonly inputSchema: unknown },
  _optional: Record<string, never> = {},
): void {
  if (isObject(inputSchema)) assertObjectSchema({ schema: inputSchema, prefix: '', depth: 0 });
}
