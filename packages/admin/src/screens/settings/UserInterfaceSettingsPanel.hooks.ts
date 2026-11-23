import { t as translateForUserInterfaceSettingsPanel } from "./settings-interface-i18n.js";

/** Bind this screen's copy to the current locale. */
export function createUserInterfaceSettingsPanelTranslator({ locale }: { locale: string }, _options = {}) {
  return ({ key }: { key: string }, _options = {}): string => translateForUserInterfaceSettingsPanel({ locale, key });
}
