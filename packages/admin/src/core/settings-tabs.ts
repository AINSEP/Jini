import type { LedgerCandidate } from "./ledger-slice.js";
import type { SettingScope } from "./ports/settings.js";
import * as preferences from "./settings-tab-preferences.js";
import * as privacy from "./settings-tab-privacy.js";
import * as appearance from "./settings-tab-appearance.js";
import type { AppearanceConfig } from "./settings-tab-appearance.js";
import type { InterfaceConfig } from "./settings-tab-preferences.js";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";

export type { AppearanceConfig, InterfaceConfig };

export function createPrivacyConsentBrowserAdapter({ deps }: { deps: {
  getBrowser: () => {
    readonly localStorage: { setItem: (key: string, value: string) => void; removeItem: (key: string) => void };
    dispatchEvent: (event: Event) => boolean;
  } | undefined;
  createEvent: (type: string, init: { detail: boolean }) => Event;
  observe: (required: { error: unknown; step: string }) => void;
  withdrawalKey: string; consentEvent: string; saveMarkerStep: string; clearMarkerStep: string;
} }, _optional = {}) {
  return {
    onMetricsWithdrawal: () => {
      const browser = deps.getBrowser();
      if (browser === undefined) return;
      /* Live teardown still applies. */
      orFallbackSync({ work: () => { browser.localStorage.setItem(deps.withdrawalKey, '1'); }, fallback: undefined, step: deps.saveMarkerStep }, { observe: deps.observe });
      browser.dispatchEvent(deps.createEvent(deps.consentEvent, { detail: false }));
    },
    onMetricsSaved: ({ metrics }: { metrics: boolean }, _optional = {}) => {
      const browser = deps.getBrowser();
      if (browser === undefined) return;
      /* The marker only denies. */
      orFallbackSync({ work: () => { browser.localStorage.removeItem(deps.withdrawalKey); }, fallback: undefined, step: deps.clearMarkerStep }, { observe: deps.observe });
      browser.dispatchEvent(deps.createEvent(deps.consentEvent, { detail: metrics }));
    },
  };
}

export function createSettingsTabs({ deps }: { deps: {
  loadNamespaceValues: (required: { namespace: string }) => Promise<Map<string, unknown>>;
  saveChangedEntries: (required: { namespace: string; scope: SettingScope; candidates: readonly LedgerCandidate[] }) => Promise<readonly string[]>;
  interfaceNamespace: string; legacyThemeId: string;
  DEFAULT_INSTRUCTIONS: string; DEFAULT_LOCALE: string;
  DEFAULT_NOTIFICATIONS: { soundEnabled: boolean; successSoundId: string; failureSoundId: string; desktopEnabled: boolean };
  DEFAULT_APPEARANCE: AppearanceConfig; DEFAULT_INTERFACE: InterfaceConfig;
  normalizeAccentColor: (required: { value: unknown }) => string | null;
  onMetricsWithdrawal: () => void;
  onMetricsSaved: (required: { metrics: boolean }) => void;
} }, _optional = {}) {
  return {
    loadInstructions: () => preferences.loadInstructions({ deps }),
    saveInstructions: (required: Omit<Parameters<typeof preferences.saveInstructions>[0], "deps">, _optional = {}) => preferences.saveInstructions({ ...required, deps }),
    loadNotifications: () => preferences.loadNotifications({ deps }),
    saveNotifications: (next: Parameters<typeof preferences.saveNotifications>[0]["next"], previous: Parameters<typeof preferences.saveNotifications>[0]["previous"]) => preferences.saveNotifications({ next, previous, deps }),
    loadPrivacy: () => privacy.loadPrivacy({ deps }),
    savePrivacy: (next: Parameters<typeof privacy.savePrivacy>[0]["next"], previous: Parameters<typeof privacy.savePrivacy>[0]["previous"]) => privacy.savePrivacy({ next, previous, deps }),
    loadLanguage: () => preferences.loadLanguage({ deps }),
    saveLanguage: (required: Omit<Parameters<typeof preferences.saveLanguage>[0], "deps">, _optional = {}) => preferences.saveLanguage({ ...required, deps }),
    loadAppearance: () => appearance.loadAppearance({ deps }),
    saveAppearance: (next: AppearanceConfig, previous: AppearanceConfig) => appearance.saveAppearance({ next, previous, deps }),
    loadInterface: () => preferences.loadInterface({ deps }),
    saveInterface: (next: InterfaceConfig, previous: InterfaceConfig) => preferences.saveInterface({ next, previous, deps }),
    adminThemeAccent: (required: Omit<Parameters<typeof appearance.adminThemeAccent>[0], "deps">, _optional = {}) => appearance.adminThemeAccent({ ...required, deps }),
    withAdminThemeAccent: (required: Omit<Parameters<typeof appearance.withAdminThemeAccent>[0], "deps">, _optional = {}) => appearance.withAdminThemeAccent({ ...required, deps }),
  };
}
