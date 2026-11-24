import { t as translateForAdminByokKeyPanel } from "./shared-components-i18n.js";

/** Bind this screen's copy to the current locale. */
export function createAdminByokKeyPanelTranslator({ locale }: { locale: string }, _options = {}) {
  return ({ key }: { key: string }, _options: Record<string, never> = {}): string => translateForAdminByokKeyPanel({ locale, key });
}
