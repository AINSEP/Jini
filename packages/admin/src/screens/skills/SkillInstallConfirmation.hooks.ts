import { t as translateForSkillInstallConfirmation } from "./skills-i18n.js";

/** Bind this screen's copy to the current locale. */
export function createSkillInstallConfirmationTranslator({ locale }: { locale: string }, _options = {}) {
  return (key: string): string => translateForSkillInstallConfirmation({ locale, key });
}
