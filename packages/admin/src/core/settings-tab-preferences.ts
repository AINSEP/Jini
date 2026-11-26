import { INSTRUCTIONS_NAMESPACE, NOTIFICATIONS_NAMESPACE, LANGUAGE_NAMESPACE } from "@jini-ai/core/settings";
import { readBoolean, readString, type LedgerCandidate } from "./ledger-slice.js";
import type { createSettingsTabs } from "./settings-tabs.js";

const WORKSPACE_SCOPE = "workspace";
const USER_SCOPE = "user";

// --- Instructions ---------------------------------------------------------

const INSTRUCTIONS_KEY = "custom";


export async function loadInstructions({ deps }: { deps: Parameters<typeof createSettingsTabs>[0]["deps"] }, _optional = {}): Promise<string> {
  const values = await deps.loadNamespaceValues({ namespace: INSTRUCTIONS_NAMESPACE });
  return readString({ values, key: INSTRUCTIONS_KEY, fallback: deps.DEFAULT_INSTRUCTIONS });
}

/**
 * `InstructionsTab` reports an all-empty textarea as `undefined` rather than
 * `''` (its documented `onChange` collapse), so `undefined` is normalised back
 * to the empty string the ledger actually stores. Without this the definition
 * would receive `undefined` as its value and the write would fail validation.
 */
export async function saveInstructions({ next, previous, deps }: { next: string | undefined; previous: string; deps: Parameters<typeof createSettingsTabs>[0]["deps"] }, _options = {}): Promise<readonly string[]> {
  const value = next ?? deps.DEFAULT_INSTRUCTIONS;
  return deps.saveChangedEntries({ namespace: INSTRUCTIONS_NAMESPACE, scope: WORKSPACE_SCOPE, candidates: [
    { key: INSTRUCTIONS_KEY, valueJson: value, changed: value !== previous },
  ] });
}

// --- Notifications --------------------------------------------------------

const NOTIFICATION_KEYS = {
  soundEnabled: "soundEnabled",
  successSoundId: "successSoundId",
  failureSoundId: "failureSoundId",
  desktopEnabled: "desktopEnabled",
} as const;

export async function loadNotifications({ deps }: { deps: Parameters<typeof createSettingsTabs>[0]["deps"] }, _optional = {}): Promise<Parameters<typeof createSettingsTabs>[0]["deps"]["DEFAULT_NOTIFICATIONS"]> {
  const values = await deps.loadNamespaceValues({ namespace: NOTIFICATIONS_NAMESPACE });
  return {
    soundEnabled: readBoolean({ values, key: NOTIFICATION_KEYS.soundEnabled, fallback: deps.DEFAULT_NOTIFICATIONS.soundEnabled }),
    successSoundId: readString({ values, key: NOTIFICATION_KEYS.successSoundId, fallback: deps.DEFAULT_NOTIFICATIONS.successSoundId }),
    failureSoundId: readString({ values, key: NOTIFICATION_KEYS.failureSoundId, fallback: deps.DEFAULT_NOTIFICATIONS.failureSoundId }),
    desktopEnabled: readBoolean({ values, key: NOTIFICATION_KEYS.desktopEnabled, fallback: deps.DEFAULT_NOTIFICATIONS.desktopEnabled }),
  };
}

export async function saveNotifications({ next, previous, deps }: { next: Parameters<typeof createSettingsTabs>[0]["deps"]["DEFAULT_NOTIFICATIONS"]; previous: Parameters<typeof createSettingsTabs>[0]["deps"]["DEFAULT_NOTIFICATIONS"]; deps: Parameters<typeof createSettingsTabs>[0]["deps"] }, _optional = {}): Promise<readonly string[]> {
  const candidates: LedgerCandidate[] = [
    {
      key: NOTIFICATION_KEYS.soundEnabled,
      valueJson: next.soundEnabled,
      changed: next.soundEnabled !== previous.soundEnabled,
    },
    {
      key: NOTIFICATION_KEYS.successSoundId,
      valueJson: next.successSoundId,
      changed: next.successSoundId !== previous.successSoundId,
    },
    {
      key: NOTIFICATION_KEYS.failureSoundId,
      valueJson: next.failureSoundId,
      changed: next.failureSoundId !== previous.failureSoundId,
    },
    {
      key: NOTIFICATION_KEYS.desktopEnabled,
      valueJson: next.desktopEnabled,
      changed: next.desktopEnabled !== previous.desktopEnabled,
    },
  ];
  return deps.saveChangedEntries({ namespace: NOTIFICATIONS_NAMESPACE, scope: USER_SCOPE, candidates });
}

// --- Language -------------------------------------------------------------

const LANGUAGE_KEY = "locale";


export async function loadLanguage({ deps }: { deps: Parameters<typeof createSettingsTabs>[0]["deps"] }, _optional = {}): Promise<string> {
  const values = await deps.loadNamespaceValues({ namespace: LANGUAGE_NAMESPACE });
  return readString({ values, key: LANGUAGE_KEY, fallback: deps.DEFAULT_LOCALE });
}

export async function saveLanguage({ next, previous, deps }: { next: string; previous: string; deps: Parameters<typeof createSettingsTabs>[0]["deps"] }, _options = {}): Promise<readonly string[]> {
  return deps.saveChangedEntries({ namespace: LANGUAGE_NAMESPACE, scope: USER_SCOPE, candidates: [
    { key: LANGUAGE_KEY, valueJson: next, changed: next !== previous },
  ] });
}

// --- User Interface -------------------------------------------------------

const INTERFACE_KEYS = { hideChatFabWhileOpen: "hideChatFabWhileOpen", wrapTabs: "wrapTabs", adminTheme: "adminTheme" } as const;

export interface InterfaceConfig {
  /** Hide the floating chat button while the assistant dock is open (the dock's ✕ closes it). */
  hideChatFabWhileOpen: boolean;
  /** Phone tab strips wrap onto more rows instead of scrolling sideways (owner, 2026-10-07). */
  wrapTabs: boolean;
  /** The operator's admin theme id (`admin-themes/registry.ts`); its scheme is Appearance's `theme`. */
  adminTheme: string;
}

export async function loadInterface({ deps }: { deps: Parameters<typeof createSettingsTabs>[0]["deps"] }, _optional = {}): Promise<InterfaceConfig> {
  const values = await deps.loadNamespaceValues({ namespace: deps.interfaceNamespace });
  return {
    hideChatFabWhileOpen: readBoolean({ values, key: INTERFACE_KEYS.hideChatFabWhileOpen, fallback: deps.DEFAULT_INTERFACE.hideChatFabWhileOpen }),
    wrapTabs: readBoolean({ values, key: INTERFACE_KEYS.wrapTabs, fallback: deps.DEFAULT_INTERFACE.wrapTabs }),
    adminTheme: readString({ values, key: INTERFACE_KEYS.adminTheme, fallback: deps.DEFAULT_INTERFACE.adminTheme }),
  };
}

export async function saveInterface({ next, previous, deps }: { next: InterfaceConfig; previous: InterfaceConfig; deps: Parameters<typeof createSettingsTabs>[0]["deps"] }, _optional = {}): Promise<readonly string[]> {
  return deps.saveChangedEntries({ namespace: deps.interfaceNamespace, scope: USER_SCOPE, candidates: [
    {
      key: INTERFACE_KEYS.hideChatFabWhileOpen,
      valueJson: next.hideChatFabWhileOpen,
      changed: next.hideChatFabWhileOpen !== previous.hideChatFabWhileOpen,
    },
    {
      key: INTERFACE_KEYS.wrapTabs,
      valueJson: next.wrapTabs,
      changed: next.wrapTabs !== previous.wrapTabs,
    },
    {
      key: INTERFACE_KEYS.adminTheme,
      valueJson: next.adminTheme,
      changed: next.adminTheme !== previous.adminTheme,
    },
  ] });
}
