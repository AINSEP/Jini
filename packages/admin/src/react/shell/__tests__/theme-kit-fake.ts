import { fakeAdminKit } from '../../testing-kit.js';
import type { AdminTheme, AdminThemeKit, ColorSchemePreference, MatchMediaPort } from '../../kit.js';

/** Everything one `applyAdminTheme` call received, so a test can assert what the hook handed the kit. */
export interface AppliedTheme {
  readonly required: { readonly theme: AdminTheme };
  readonly optional: Parameters<AdminThemeKit['applyAdminTheme']>[1];
}

/**
 * A fake of the host's theme kit with the two observable duties the shell tests read: applying a
 * theme marks `data-admin-theme` on the target until its cleanup runs, and the "system" preference
 * follows the injected media query. Explicit choices never consult the media query, as in the real one.
 */
export function recordingThemeKit() {
  const applied: AppliedTheme[] = [];
  const released: AppliedTheme[] = [];
  const base = fakeAdminKit().theme;
  const theme: AdminThemeKit = {
    defaultAdminTheme: base.defaultAdminTheme,
    applyAdminTheme: (required, optional) => {
      const call = { required, optional };
      applied.push(call);
      optional.target.setAttribute('data-admin-theme', required.theme.name);
      return () => { released.push(call); optional.target.removeAttribute('data-admin-theme'); };
    },
    resolveColorScheme: ({ preference }: { readonly preference: ColorSchemePreference }, { matchMedia }: { readonly matchMedia?: MatchMediaPort } = {}) => {
      if (preference === 'light' || preference === 'dark') return preference;
      if (!matchMedia) throw new TypeError('System color scheme requires matchMedia');
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    },
  };
  return { theme, applied, released, useThemeKit: () => theme };
}
