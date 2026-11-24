import { SETTINGS_DIALOG_DICTIONARIES as CMS_SETTINGS_DIALOG_DICTIONARIES } from "@jini-ai/core/settings";
import type { LocaleDictionary } from "@jini-ai/core/text";

import { navigate } from "../../shell/lib/router.js";
import { t as tSettingsExecution } from "./settings-execution-i18n.js";
import { t as tSettings } from "./settings-i18n.js";

/** A `{ locale, key }` dictionary lookup — the shape every `createDictionaryTranslator` result has. */
export type SettingsLocaleTranslate = (required: { locale: string; key: string }) => string;

/** What the host hands `createSettingsUiTranslators` besides the locale (K3: its own copy stays in the host). */
export interface SettingsUiTranslatorSources {
  settingsLocale: string;
  /** The UI library's settings-dialog dictionaries (`SETTINGS_DIALOG_DICTIONARIES`, also on the admin kit). */
  dialogDictionaries: Partial<LocaleDictionary>;
  /** The host's app-wide dictionary — `t`'s last tier before the raw key. */
  translateApp: SettingsLocaleTranslate;
  /** The host's "no backend yet" capability-status notes dictionary, behind `tCap`. */
  translateCapability: SettingsLocaleTranslate;
}

export function createSettingsUiTranslators(
  { settingsLocale, dialogDictionaries, translateApp, translateCapability }: SettingsUiTranslatorSources, _options = {},
) {
  /**
   * `SettingsDialogShell` renders `tabs[].label/title/subtitle` verbatim — it only calls `t()` on
   * its own chrome strings (the "Settings" kicker, "Settings sections" aria-label, etc.; see
   * `context.tsx`). Every tab's own label/title/subtitle below is this file's responsibility to
   * translate before handing it to the shell, same as OD's own settings-tab array does upstream.
   *
   * Can't use `@jini-ai/ui`'s `useT()` hook for that: it reads `I18nContext` via `useContext`,
   * which only sees a provider mounted by an ANCESTOR. The `<I18nProvider>` this component renders
   * (below, wrapping `SettingsDialogShell`) is a *child* of `SettingsUi`, not a parent of it — a
   * component is never inside the context it itself provides. Calling `useT()` here would silently
   * hit `useI18n`'s `PASSTHROUGH_CONTEXT` and always return the raw key, with no error to catch it.
   * This inlines the exact same two-step resolution `I18nProvider`'s own `t` uses
   * (`dictionaries?.[locale]?.[key] ?? dictionaries?.[fallbackLocale]?.[key] ?? key`), against the
   * same `SETTINGS_DIALOG_DICTIONARIES` and the same locale value passed as `initialLocale` below —
   * so the visible result is identical to a real context read, without needing one.
   *
   * Third fallback tier added 2026-08-08: the 24 generic tab labels/subtitles (Instructions,
   * Notifications, Privacy, MCP server, Memory, Skills, Version, ...) moved out of `@jini-ai/ui`
   * into `@jini-ai/core/settings` — see project memory "Settings-dialog i18n relocation". Checking
   * `CMS_SETTINGS_DIALOG_DICTIONARIES` last (not first) costs nothing: the two dictionaries are
   * disjoint key sets, so ordering only matters for the final raw-key fallback.
   */
  const t = (key: string): string => {
    const own = tSettings({ locale: settingsLocale, key: key });
    if (own !== key) return own;
    const shared = dialogDictionaries[settingsLocale]?.[key] ?? dialogDictionaries.en?.[key];
    return shared ?? CMS_SETTINGS_DIALOG_DICTIONARIES[settingsLocale]?.[key] ?? translateApp({ locale: settingsLocale, key: key });
  };
  /** The 4 "no backend yet" capability-status notes below — see `settings-capabilities-i18n.ts`'s
   *  header for why these live in the host's own dictionary rather than `SETTINGS_DIALOG_DICTIONARIES`. */
  const tCap = ({ key }: { key: string }, _options = {}): string => translateCapability({ locale: settingsLocale, key });
  /** The Execution tab's own copy — the two stored-key asks (`lib/stored-credential-endpoint.ts`'s copy
   *  constants), the `AdminByokKeyFooter` status lines, and the Local CLI scope label — none of which
   *  either settings-dialog dictionary behind `t` carries. See `settings-execution-i18n.ts`'s header. */
  const tExecution = (key: string): string => tSettingsExecution({ locale: settingsLocale, key: key });

  return { t, tCap, tExecution };
}

export function createSettingsTabChange(_required: Record<string, never>, _options = {}) {
  /**
   * Keeps `?tab=` in sync as the operator switches tabs, so the URL is always a correct deep link
   * back to whatever is on screen — not just the one the panel happened to open on. `replace`, not a
   * new history entry per click: switching tabs is not a navigation Back should step through one at
   * a time, the same reasoning `navigate()`'s own legacy-hash-redirect caller applies.
   *
   * Fires even before any `?tab=` is present (`requestedTabId` is `undefined` then, so the shell
   * manages the active tab itself) — `useSettingsDialogShell`'s `setActiveTabId` calls
   * `onActiveTabIdChange` unconditionally, controlled or not. That is what turns the very first tab
   * click into the point the URL starts tracking the panel, with no local "which tab" state needed
   * here to make that happen.
   */
  return (nextTabId: string) => {
    navigate({ routePath: `/settings?tab=${nextTabId}` }, { replace: true });
  };

}
