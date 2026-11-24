import { t } from "./email-i18n.js";
import type { MailProviderConfiguration } from "./email-api.types.js";

/** Resolve a configured provider name, preserving an unknown id as its fallback. */
export function createEmailProviderLabel({ locale, providers }: { locale: string; providers: readonly MailProviderConfiguration[] }, _options = {}) {
  return (id: string | null) => (id === null ? t({ locale, key: "None" }) : providers.find((p) => p.id === id)?.label ?? id);
}

/** Select a provider only when the add operation returned an id. */
export function createEmailProviderSelect({ props }: { props: { onSelect?: (id: string) => void } }, _options = {}) {
  return (id: string | undefined) => { if (id) props.onSelect?.(id); };
}
