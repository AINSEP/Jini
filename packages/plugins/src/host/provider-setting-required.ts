import type { PluginProviderSettingField } from './manifest-types.js';

/**
 * Whether a declared field is required for the effective public values (including defaults).
 * Absent controlling values never waive a requirement. Pure; no values are returned or logged.
 * @example isProviderSettingRequired({ field, values: { auth: 'none' } })
 * @complexity O(1) time and space.
 */
export function isProviderSettingRequired({ field, values }: {
  field: Pick<PluginProviderSettingField, 'required' | 'requiredUnless'>;
  values: Readonly<Record<string, unknown>>;
}, _optional: Record<string, never> = {}): boolean {
  return field.required === true && (!field.requiredUnless || values[field.requiredUnless.field] !== field.requiredUnless.equals);
}
