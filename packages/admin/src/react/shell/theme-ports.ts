import type { AdminThemeDocument, AdminThemeTarget, ColorScheme, ColorSchemePreference, MatchMediaPort } from '@jini-ai/ui/theme';

/** The host chooses storage and keys. Preferences are always scoped to a user and workspace. */
export interface AdminThemePreferenceStorePort {
  read(args: { readonly userId: string; readonly workspace: Readonly<Record<string, string>> }): ColorSchemePreference | null;
  write(args: { readonly userId: string; readonly workspace: Readonly<Record<string, string>>; readonly preference: ColorSchemePreference }): void;
}

/** Inject the same scope for the theme and color scheme; use the document root for portals. */
export interface AdminThemeEnvironment {
  readonly target: AdminThemeTarget;
  readonly document: AdminThemeDocument;
  readonly matchMedia: MatchMediaPort;
}

/** Exposed to slots so the host supplies its own light/dark/system picker and labels. */
export interface AdminShellAppearance {
  readonly preference: ColorSchemePreference;
  readonly resolved: ColorScheme;
  setPreference(args: { readonly preference: ColorSchemePreference }): void;
}
