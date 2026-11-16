/** One coercer and one plain-words description per value type. A lookup table, not a switch,
 * so adding a type cannot grow one function past the complexity limit. Pure; no I/O.
 */
import type { EnvValueType, EnvVarSpec } from '../contracts/env.js';

export type Coerced = { readonly ok: true; readonly value: unknown } | { readonly ok: false };
type Coercer = (input: { readonly raw: string; readonly spec: EnvVarSpec }) => Coerced;
type Describer = (input: { readonly spec: EnvVarSpec }) => string;

const REJECTED: Coerced = { ok: false };
const DEFAULT_ON: readonly string[] = ['1', 'true'];
const DEFAULT_OFF: readonly string[] = ['0', 'false'];

function wholeNumber({ raw, spec, floor }: { raw: string; spec: EnvVarSpec; floor: number }): Coerced {
  const text = raw.trim();
  if (!/^-?\d+$/.test(text)) return REJECTED;
  const value = Number(text);
  const min = spec.accepts?.min ?? floor;
  const max = spec.accepts?.max ?? Number.MAX_SAFE_INTEGER;
  return Number.isSafeInteger(value) && value >= min && value <= max ? { ok: true, value } : REJECTED;
}

/** Flag and enum words are compared with the raw text: today's readers do not trim or fold case. */
const flag: Coercer = ({ raw, spec }) => {
  if ((spec.accepts?.on ?? DEFAULT_ON).includes(raw)) return { ok: true, value: true };
  return (spec.accepts?.off ?? DEFAULT_OFF).includes(raw) ? { ok: true, value: false } : REJECTED;
};

const origin: Coercer = ({ raw }) => {
  const text = raw.trim();
  return URL.canParse(text) && new URL(text).origin === text ? { ok: true, value: text } : REJECTED;
};

/** A parse failure is reported as an invalid value by the caller; nothing is swallowed. */
const json: Coercer = ({ raw }) => {
  try { return { ok: true, value: JSON.parse(raw) as unknown }; } catch { return REJECTED; }
};

export const COERCERS: Readonly<Record<EnvValueType, Coercer>> = {
  string: ({ raw }) => ({ ok: true, value: raw }),
  path: ({ raw }) => ({ ok: true, value: raw }),
  int: ({ raw, spec }) => wholeNumber({ raw, spec, floor: Number.MIN_SAFE_INTEGER }),
  'duration-ms': ({ raw, spec }) => wholeNumber({ raw, spec, floor: 0 }),
  flag,
  enum: ({ raw, spec }) => (spec.accepts?.values?.includes(raw) ? { ok: true, value: raw } : REJECTED),
  url: ({ raw }) => (URL.canParse(raw.trim()) ? { ok: true, value: raw.trim() } : REJECTED),
  origin,
  list: ({ raw }) => ({ ok: true, value: raw.split(',').map(item => item.trim()).filter(item => item !== '') }),
  json,
};

function range({ spec, unit }: { spec: EnvVarSpec; unit: string }): string {
  const { min, max } = spec.accepts ?? {};
  if (min !== undefined && max !== undefined) return `${unit} from ${min} to ${max}`;
  if (min !== undefined) return `${unit} of ${min} or more`;
  return max !== undefined ? `${unit} of ${max} or less` : unit;
}

const EXPECTED: Readonly<Record<EnvValueType, Describer>> = {
  string: () => 'text',
  path: () => 'a file or folder path',
  int: ({ spec }) => range({ spec, unit: 'a whole number' }),
  'duration-ms': ({ spec }) => range({ spec, unit: 'a whole number of milliseconds' }),
  flag: ({ spec }) => `${(spec.accepts?.on ?? DEFAULT_ON).join(' or ')} to turn it on, or ${(spec.accepts?.off ?? DEFAULT_OFF).join(' or ')} to turn it off`,
  enum: ({ spec }) => `one of: ${(spec.accepts?.values ?? []).join(', ')}`,
  url: () => 'a full web address such as https://example.com/path',
  origin: () => 'a web address with no path, such as https://example.com',
  list: () => 'a comma-separated list',
  json: () => 'valid JSON',
};

/** What the variable accepts, in words an operator can act on. */
export function describeExpected({ spec }: { spec: EnvVarSpec }, _optional: Record<string, never> = {}): string {
  return EXPECTED[spec.type]({ spec });
}
