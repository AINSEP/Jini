import { t as translateForLogin } from "./auth-i18n.js";

/** Bind this screen's copy to the current locale. */
export function createLoginTranslator({ locale }: { locale: string }, _options = {}) {
  return (key: string): string => translateForLogin({ locale, key });
}
