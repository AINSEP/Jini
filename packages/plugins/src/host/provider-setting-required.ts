import { captureLineTail } from '@jini-ai/core/text';
import type { PluginProviderSettingField } from './manifest-types.js';

/** Evaluate the declared alternative without returning any setting or credential value. O(b) alternative text. */
function requirementWaived({ condition, values }: {
  condition: PluginProviderSettingField['requiredUnless']; values: Readonly<Record<string, unknown>>;
}, _optional = {}): boolean {
  if (!condition) return false;
  if (values[condition.field] === condition.equals) return true;
  if (!condition.orPresent) return false;
  const alternative = values[condition.orPresent];
  if (typeof alternative !== 'string' || alternative.trim() === '') return false;
  if (!condition.headerNames) return true;
  return hasProviderAuthHeader({ text: alternative, names: condition.headerNames });
}

/**
 * Whether a declared field is required for the effective public values (including defaults).
 * `requiredWhen` gates the requirement by exact choices; `requiredUnless` waives it on an exact match or a nonblank declared alternative.
 * Pure; no values are returned or logged.
 * @example isProviderSettingRequired({ field, values: { auth: 'none' } })
 * @complexity O(k + b) time in conditional choices and alternative text; O(b) transient trim space.
 */
export function isProviderSettingRequired({ field, values }: {
  field: Pick<PluginProviderSettingField, 'required' | 'requiredUnless' | 'requiredWhen'>;
  values: Readonly<Record<string, unknown>>;
}, _optional: Record<string, never> = {}): boolean {
  const when = field.requiredWhen;
  const required = when
    ? when.in.some((choice) => choice === values[when.field])
    : field.required === true;
  return required && !requirementWaived({ condition: field.requiredUnless, values });
}


/** Match only declared nonblank Name=Value headers; malformed lists never waive a requirement.
 * @complexity O(h * n) in header text and the manifest's small name allowlist. */
export function hasProviderAuthHeader({ text, names }: { text: string; names: readonly string[] }, _optional = {}): boolean {
  const pairs = text.split(',').map(pair => headerPair(pair.trim()));
  if (pairs.some(pair => !pair)) return false;
  return pairs.some(pair => names.some(name => name.toLowerCase() === pair![0].toLowerCase()) && pair![1].trim() !== '');
}

/** `[name, value]` exactly as /^([^=\s][^=]*?)\s*=\s*(.+)$/ captures them from a trimmed pair, but
 * without that pattern's backtracking: the name runs to the first `=` (trailing spaces dropped). */
function headerPair(pair: string): [string, string] | null {
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  const value = captureLineTail({ rest: pair.slice(eq + 1) });
  return value === null ? null : [pair.slice(0, eq).trimEnd(), value];
}
