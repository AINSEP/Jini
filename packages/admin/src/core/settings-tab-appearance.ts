import { APPEARANCE_NAMESPACE } from "@jini-ai/core/settings";
import { readString } from "./ledger-slice.js";
import type { createSettingsTabs } from "./settings-tabs.js";

const USER_SCOPE = "user";

// --- Appearance -----------------------------------------------------------

const APPEARANCE_KEYS = { theme: "theme", accentColor: "accentColor", adminThemeAccents: "adminThemeAccents" } as const;

/** Mirrors `@jini-ai/ui`'s own `DEFAULT_ACCENT_COLOR` and the registered
 *  ledger default. */
export interface AppearanceConfig {
  theme: "system" | "light" | "dark";
  /** Legacy single value belongs to Classic. Kept for existing settings callers. */
  accentColor: string;
  /** Tovu admin-theme overrides other than Classic; stored separately from the scalar. */
  accentColors?: Readonly<Record<string, string>>;
}

/** Read the separate admin-theme object, preserving overrides for uninstalled themes.
 * Classic's scalar remains the sole owner of its value for legacy readers and agent writes.
 * @complexity O(n) time/space for n stored theme entries. Invalid entries are ignored. */
function readAppearanceAccents({ stored, deps }: { stored: unknown; deps: Parameters<typeof createSettingsTabs>[0]["deps"] }, _optional: object = {}): Readonly<Record<string, string>> | undefined {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return undefined;
  const entries = Object.entries(stored).filter(([id, value]) => id !== deps.legacyThemeId && deps.normalizeAccentColor({ value }) !== null);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** The active theme's override, or undefined so its own palette stays in charge. O(1). */
export function adminThemeAccent({ appearance, themeId, deps }: { appearance: AppearanceConfig; themeId: string; deps: Parameters<typeof createSettingsTabs>[0]["deps"] }, _optional: object = {}): string | undefined {
  const accent = themeId === deps.legacyThemeId ? appearance.accentColor : appearance.accentColors?.[themeId];
  // Jini's original neutral-blue ledger default was never an operator choice for Classic.
  return themeId === deps.legacyThemeId && accent?.toLowerCase() === deps.DEFAULT_APPEARANCE.accentColor.toLowerCase() ? undefined : accent;
}

/** Edit one theme without losing other choices; undefined restores its palette default.
 * @complexity O(n) time/space for n stored theme entries; never mutates the draft. */
export function withAdminThemeAccent({ appearance, themeId, accentColor, deps }: { appearance: AppearanceConfig; themeId: string; accentColor: string | undefined; deps: Parameters<typeof createSettingsTabs>[0]["deps"] }, _optional: object = {}): AppearanceConfig {
  if (themeId === deps.legacyThemeId) return { ...appearance, accentColor: accentColor ?? deps.DEFAULT_APPEARANCE.accentColor };
  const accentColors = { ...appearance.accentColors };
  if (accentColor === undefined) delete accentColors[themeId];
  else accentColors[themeId] = accentColor;
  return { ...appearance, accentColors };
}

export async function loadAppearance({ deps }: { deps: Parameters<typeof createSettingsTabs>[0]["deps"] }, _optional = {}): Promise<AppearanceConfig> {
  const values = await deps.loadNamespaceValues({ namespace: APPEARANCE_NAMESPACE });
  const theme = readString({ values, key: APPEARANCE_KEYS.theme, fallback: deps.DEFAULT_APPEARANCE.theme });
  const accentColors = readAppearanceAccents({ stored: values.get(APPEARANCE_KEYS.adminThemeAccents), deps }, {});
  return {
    // An unrecognised stored theme falls back rather than reaching the tab as
    // a value its radio group cannot select.
    theme: theme === "system" || theme === "light" || theme === "dark" ? theme : deps.DEFAULT_APPEARANCE.theme,
    accentColor: readString({ values, key: APPEARANCE_KEYS.accentColor, fallback: deps.DEFAULT_APPEARANCE.accentColor }),
    ...(accentColors ? { accentColors } : {}),
  };
}

/** Diff-write appearance; scalar-only callers leave the optional admin-theme map untouched.
 * @complexity O(n) time/space for n theme entries; the shared ledger owns sequential writes. */
export async function saveAppearance(
  { next, previous, deps }: { next: AppearanceConfig; previous: AppearanceConfig; deps: Parameters<typeof createSettingsTabs>[0]["deps"] },
  _optional = {},
): Promise<readonly string[]> {
  const accentColors = next.accentColors ?? previous.accentColors ?? {};
  return deps.saveChangedEntries({ namespace: APPEARANCE_NAMESPACE, scope: USER_SCOPE, candidates: [
    { key: APPEARANCE_KEYS.theme, valueJson: next.theme, changed: next.theme !== previous.theme },
    {
      key: APPEARANCE_KEYS.accentColor,
      valueJson: next.accentColor,
      changed: next.accentColor !== previous.accentColor,
    },
    {
      key: APPEARANCE_KEYS.adminThemeAccents,
      valueJson: accentColors,
      changed: JSON.stringify(accentColors) !== JSON.stringify(previous.accentColors ?? {}),
    },
  ] });
}

