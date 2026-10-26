import type { PluginProviderSettingField } from './manifest-types.js';

/** Evaluate the declared alternative without returning any setting or credential value. O(b) alternative text. */
function requirementWaived({ condition, values }: {
  condition: PluginProviderSettingField['requiredUnless']; values: Readonly<Record<string, unknown>>;
}, _optional = {}): boolean {
  if (!condition) return false;
  if (values[condition.field] === condition.equals) return true;
  if (!condition.orPresent) return false;
  const alternative = values[condition.orPresent];
  return typeof alternative === 'string' && alternative.trim() !== '';
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
