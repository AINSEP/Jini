import { useCallback, useEffect, useState } from 'react';
import { applyAdminTheme, resolveColorScheme, type AdminTheme, type ColorSchemePreference } from '@jini-ai/ui/theme';
import type { AdminShellAppearance, AdminThemeEnvironment, AdminThemePreferenceStorePort } from './theme-ports.js';

/** Keep effects inside the host's scope; storage reads/writes never use ambient browser state. */
export function useAdminTheme({ userId, workspace }: {
  readonly userId: string | null; readonly workspace: Readonly<Record<string, string>>;
}, { theme, colorScheme, environment, preferenceStore, onColorSchemeChange }: {
  readonly theme?: AdminTheme;
  readonly colorScheme?: ColorSchemePreference;
  readonly environment?: AdminThemeEnvironment;
  readonly preferenceStore?: AdminThemePreferenceStorePort;
  readonly onColorSchemeChange?: (args: { readonly preference: ColorSchemePreference }) => void;
} = {}): AdminShellAppearance | undefined {
  const scope = JSON.stringify([userId, Object.entries(workspace).sort(([a], [b]) => a.localeCompare(b))]);
  const [saved, setSaved] = useState<{ scope: string; preference: ColorSchemePreference } | null>(null);
  const [mediaRevision, setMediaRevision] = useState(0);
  const preference = colorScheme ?? (saved?.scope === scope ? saved.preference : 'system');

  useEffect(() => {
    if (!userId || !preferenceStore) { setSaved(null); return; }
    const stored = preferenceStore.read({ userId, workspace });
    setSaved(stored === 'light' || stored === 'dark' || stored === 'system' ? { scope, preference: stored } : null);
  }, [userId, workspace, scope, preferenceStore]);

  useEffect(() => {
    if (!theme) return;
    if (!environment) throw new TypeError('AdminShell theme requires a themeEnvironment port');
    return applyAdminTheme({ theme }, environment);
  }, [theme, environment]);

  useEffect(() => {
    if (!environment || preference !== 'system') return;
    const media = environment.matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setMediaRevision((revision) => revision + 1);
    media.addEventListener?.('change', changed);
    return () => media.removeEventListener?.('change', changed);
  }, [environment, preference]);

  // A revision refreshes the live media snapshot; explicit choices never query the OS.
  void mediaRevision;
  const resolved = environment ? resolveColorScheme({ preference }, { matchMedia: environment.matchMedia }) : 'light';
  useEffect(() => {
    if (!environment) return;
    const previous = environment.target.getAttribute('data-color-scheme');
    environment.target.setAttribute('data-color-scheme', resolved);
    return () => {
      if (previous === null) environment.target.removeAttribute('data-color-scheme');
      else environment.target.setAttribute('data-color-scheme', previous);
    };
  }, [environment, resolved]);

  const setPreference = useCallback(({ preference: next }: { readonly preference: ColorSchemePreference }) => {
    if (next !== 'light' && next !== 'dark' && next !== 'system') throw new TypeError('Invalid color scheme preference');
    if (userId && preferenceStore) preferenceStore.write({ userId, workspace, preference: next });
    setSaved({ scope, preference: next });
    onColorSchemeChange?.({ preference: next });
  }, [userId, preferenceStore, workspace, scope, onColorSchemeChange]);

  return environment ? { preference, resolved, setPreference } : undefined;
}
