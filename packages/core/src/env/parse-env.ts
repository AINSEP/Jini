/** Turn a schema and an environment map into a frozen config plus plain-words issues.
 *
 * The parser never stops a boot: a bad value becomes an issue and the default is used. A value
 * with its own validator (`validation: 'owner'`) is handed on as raw text, unjudged, so the code
 * that refuses it today keeps refusing it with its own error at its own time. Values that are
 * not delivered through the environment are never read here and never enter the config.
 */
import type { EnvIssue, EnvSchema, EnvVarSpec, HostEnvironment, ParsedEnv } from '../contracts/env.js';
import { COERCERS, describeExpected } from './coercers.js';
import { echoEnvValue, isSet } from './value-echo.js';

interface FieldResult { readonly value: unknown; readonly source?: string; readonly issue?: EnvIssue }
type SpecsByName = ReadonlyMap<string, EnvVarSpec>;

/** The controlling variable's raw text when set, otherwise its own default. */
function isActive({ spec, env, byName }: { spec: EnvVarSpec; env: HostEnvironment; byName: SpecsByName }): boolean {
  const gate = spec.activeWhen;
  if (!gate) return true;
  const raw = env[gate.name];
  const controlling = isSet({ value: raw }) ? raw : byName.get(gate.name)?.default;
  return controlling !== undefined && gate.in.includes(controlling);
}

function defaultValue({ spec }: { spec: EnvVarSpec }): unknown {
  if (spec.default === undefined) return undefined;
  const coerced = COERCERS[spec.type]({ raw: spec.default, spec });
  return coerced.ok ? coerced.value : undefined;
}

function invalid({ spec, raw }: { spec: EnvVarSpec; raw: string }): EnvIssue {
  const usedInstead = spec.secret ? undefined : spec.default;
  return { name: spec.name, problem: 'invalid', received: echoEnvValue({ spec, raw }), expected: describeExpected({ spec }),
    ...(usedInstead === undefined ? {} : { usedInstead }), fix: spec.doc.fix };
}

function readOne({ spec, env, byName }: { spec: EnvVarSpec; env: HostEnvironment; byName: SpecsByName }): FieldResult {
  const raw = env[spec.name];
  if (spec.validation === 'owner') return raw === undefined ? { value: undefined } : { value: raw, source: spec.name };
  if (!isActive({ spec, env, byName })) return { value: undefined };
  if (!isSet({ value: raw }) || raw === undefined) return { value: defaultValue({ spec }) };
  const coerced = COERCERS[spec.type]({ raw, spec });
  if (coerced.ok) return { value: coerced.value, source: spec.name };
  return { value: defaultValue({ spec }), issue: invalid({ spec, raw }) };
}

function editDistance({ a, b }: { a: string; b: string }): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}

/** The closest known name within two edits; ties go to the first in sorted order. */
function nearestName({ name, known }: { name: string; known: readonly string[] }): string | undefined {
  const scored = known.map(candidate => ({ candidate, distance: editDistance({ a: name, b: candidate }) }))
    .filter(({ distance }) => distance <= 2).sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate));
  return scored[0]?.candidate;
}

/** O(e) over the map, plus one name comparison per known name for each unknown name found. */
function checkUnknownNames({ env, ownedPrefixes, known }: { env: HostEnvironment; ownedPrefixes: readonly string[]; known: readonly string[] }): EnvIssue[] {
  const names = new Set(known);
  return Object.keys(env).sort()
    .filter(name => isSet({ value: env[name] }) && !names.has(name) && ownedPrefixes.some(prefix => name.startsWith(prefix)))
    .map((name) => {
      const suggestion = nearestName({ name, known });
      return { name, problem: 'unknown-name' as const, received: echoEnvValue({ spec: undefined, raw: env[name] }), expected: 'a setting name this program knows',
        ...(suggestion === undefined ? {} : { suggestion }), fix: suggestion === undefined ? 'check the spelling where you set it, or remove it' : 'rename it where you set it' };
    });
}

function deepFreeze<Value>({ value }: { value: Value }): Value {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze({ value: child });
    Object.freeze(value);
  }
  return value;
}

function assemble<Config>({ fields, unknown }: { fields: readonly { spec: EnvVarSpec; result: FieldResult }[]; unknown: readonly EnvIssue[] }): ParsedEnv<Config> {
  const config: Record<string, unknown> = {};
  const sources: Record<string, string> = {};
  const issues: EnvIssue[] = [];
  for (const { spec, result } of fields) {
    config[spec.field] = result.value;
    if (result.source !== undefined) sources[spec.field] = result.source;
    if (result.issue) issues.push(result.issue);
  }
  // The host's schema type says which fields exist; this is the one place that shape is asserted.
  return deepFreeze({ value: { config: config as Config, sources, issues: [...issues, ...unknown] } });
}

/** Pure: no I/O, never logs, never throws on a bad value. Every issue is returned, not the first.
 * @param required The host's schema and the map to read (the ambient environment, a child's
 *   launch map or a per-scope snapshot: the parser treats them alike).
 * @param optional `declared`: names another list already owns (allow-lists, vendor names), so
 *   they are not reported as unknown.
 * @returns A deep-frozen config, the variable that set each field, and every issue found.
 * @complexity O(s + e) for s specs and e entries; each unknown name adds one pass over the names.
 * @example parseEnv({ schema, env: hostEnv }).issues.map(issue => formatEnvIssue({ issue, product: 'Host' }));
 */
export function parseEnv<Config>(
  required: { readonly schema: EnvSchema<Config>; readonly env: HostEnvironment },
  optional: { readonly declared?: readonly EnvVarSpec[] } = {},
): ParsedEnv<Config> {
  const { schema, env } = required;
  const specs: readonly EnvVarSpec[] = schema.specs;
  const byName: SpecsByName = new Map(specs.map(spec => [spec.name, spec]));
  const fields = specs.filter(spec => (spec.delivery ?? 'env') === 'env').map(spec => ({ spec, result: readOne({ spec, env, byName }) }));
  const known = [...specs, ...(optional.declared ?? [])].map(spec => spec.name);
  return assemble<Config>({ fields, unknown: checkUnknownNames({ env, ownedPrefixes: schema.ownedPrefixes, known }) });
}
