import type { PluginProviderDeclaration } from './manifest-types.js';

/** Apply the plugin's declared public-setting migrations to a copy; inputs and secrets stay intact.
 * @complexity O(f + m * c) for fields, ordered migrations and their declared choices. */
export function migrateProviderSettings({ providers, settings }: {
  providers: readonly PluginProviderDeclaration[]; settings: Readonly<Record<string, string>>;
}, _optional = {}): Readonly<Record<string, string>> {
  const next = { ...settings };
  for (const provider of providers) for (const rule of provider.settingsMigrations ?? []) {
    const value = next[rule.when.field];
    const matches = value === undefined ? rule.when.orAbsent === true : rule.when.in.includes(value);
    if (matches && (!rule.whenPresent || next[rule.whenPresent]?.trim())) Object.assign(next, rule.set);
  }
  return next;
}
