/**
 * @file Checks a tool handler's resolved value against its descriptor's `outputSchema`.
 *
 * Why a small purpose-built checker and not the input path's machinery: the input side never
 * *validates* shape — `@jini-ai/core`'s `normalizeToolInput` is a coercing walk (string→number,
 * alias renames, closed-key rejection) that leaves "is this the right shape" to each handler. Run
 * over an output it would silently rewrite the value instead of reporting it. No JSON-Schema library
 * is a dependency of this package, and adding one for a dev/test guard is not worth it, so this
 * covers the bounded subset tools actually declare — `type` (single or union), `enum`, `required`,
 * `properties`, `additionalProperties: false`, `items` — the same subset precedent as
 * `@jini-ai/cms`'s widget `config-validation.ts`. Keywords outside the subset are ignored (never a
 * false failure), so a richer schema degrades to a looser check, not a broken tool.
 *
 * Pure: no I/O, no clock. It reports only the FIRST problem — one plain sentence is what a model or
 * a developer can act on, and a full list on a large wrong-shaped result would just be noise.
 */

type Schema = Readonly<Record<string, unknown>>;

/** Where the walk is: a dotted path for the message, and depth so a cyclic or hostile schema ends. */
interface Step {
  readonly path: string;
  readonly depth: number;
}

/** Matches the input normalizer's 64-level bound, so neither side of a call can exhaust the stack. */
const MAX_DEPTH = 64;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One predicate per JSON-Schema type name. A name not listed here is treated as matching. */
const TYPE_CHECKS: Readonly<Record<string, (value: unknown) => boolean>> = {
  null: value => value === null,
  array: value => Array.isArray(value),
  object: isPlainObject,
  integer: value => Number.isInteger(value),
  number: value => typeof value === 'number',
  string: value => typeof value === 'string',
  boolean: value => typeof value === 'boolean',
};

const TYPE_WORDS: Readonly<Record<string, string>> = { null: 'null', array: 'an array', object: 'an object', integer: 'an integer' };

const label = (path: string): string => path || 'the result';
const typeWord = (type: string): string => TYPE_WORDS[type] ?? `a ${type}`;

/** Plain words for what a value actually was, e.g. "a string", "an array", "nothing". */
function describeValue(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

function declaredTypes(schema: Schema): readonly string[] {
  const { type } = schema;
  if (typeof type === 'string') return [type];
  return Array.isArray(type) ? type.filter((entry): entry is string => typeof entry === 'string') : [];
}

function typeProblem({ value, schema, step }: { value: unknown; schema: Schema; step: Step }): string | undefined {
  const types = declaredTypes(schema);
  if (types.length === 0 || types.some(type => (TYPE_CHECKS[type] ?? (() => true))(value))) return undefined;
  return `${label(step.path)} should be ${types.map(typeWord).join(' or ')}, but it was ${describeValue(value)}`;
}

function enumProblem({ value, schema, step }: { value: unknown; schema: Schema; step: Step }): string | undefined {
  if (!Array.isArray(schema.enum) || schema.enum.some(allowed => allowed === value)) return undefined;
  return `${label(step.path)} should be one of ${schema.enum.map(allowed => JSON.stringify(allowed)).join(', ')}`;
}

const childPath = ({ path, key }: { path: string; key: string }): string => (path ? `${path}.${key}` : key);

function objectProblem({ value, schema, step }: { value: Record<string, unknown>; schema: Schema; step: Step }): string | undefined {
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : [];
  const missing = required.find(key => !(key in value));
  if (missing !== undefined) return `the required field ${childPath({ path: step.path, key: missing })} is missing`;
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  for (const [key, field] of Object.entries(value)) {
    if (!(key in properties)) {
      if (schema.additionalProperties === false) return `${label(step.path)} has an unexpected field ${key}`;
      continue;
    }
    const problem = problemAt({ value: field, schema: properties[key], step: { path: childPath({ path: step.path, key }), depth: step.depth + 1 } });
    if (problem) return problem;
  }
  return undefined;
}

function itemsProblem({ value, schema, step }: { value: readonly unknown[]; schema: Schema; step: Step }): string | undefined {
  if (!isPlainObject(schema.items)) return undefined;
  for (const [index, item] of value.entries()) {
    const problem = problemAt({ value: item, schema: schema.items, step: { path: `${step.path || 'result'}[${index}]`, depth: step.depth + 1 } });
    if (problem) return problem;
  }
  return undefined;
}

function problemAt({ value, schema, step }: { value: unknown; schema: unknown; step: Step }): string | undefined {
  if (!isPlainObject(schema)) return undefined;
  if (step.depth > MAX_DEPTH) return `${label(step.path)} is nested more than ${MAX_DEPTH} levels deep`;
  const shallow = typeProblem({ value, schema, step }) ?? enumProblem({ value, schema, step });
  if (shallow) return shallow;
  if (Array.isArray(value)) return itemsProblem({ value, schema, step });
  return isPlainObject(value) ? objectProblem({ value, schema, step }) : undefined;
}

/**
 * Finds the first way `value` disagrees with `schema`, in plain words.
 *
 * @param required.value - The handler's resolved output, before guidance or notes are attached.
 * @param required.schema - The descriptor's `outputSchema`; a non-object schema checks nothing.
 * @returns A sentence fragment such as `count should be a number, but it was a string`, or
 *   `undefined` when the value fits.
 * @complexity O(size of value) bounded to {@link MAX_DEPTH} levels.
 * @example findOutputSchemaProblem({ value: { count: 'three' }, schema: { type: 'object', properties: { count: { type: 'number' } } } });
 */
export function findOutputSchemaProblem({ value, schema }: { value: unknown; schema: unknown }, _optional: Record<string, never> = {}): string | undefined {
  return problemAt({ value, schema, step: { path: '', depth: 0 } });
}
