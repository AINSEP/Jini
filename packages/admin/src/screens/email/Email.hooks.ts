import { t } from "./email-i18n.js";

/** Resolve tab copy from the screen's existing labels table. */
export function createEmailTabLabel<T extends string>({ locale, labels }: { locale: string; labels: Record<T, string> }, _options = {}) {
  return (id: T) => t({ locale, key: labels[id] });
}
