import { t } from "./email-i18n.js";

/** Resolve tab copy from the screen's existing labels table. */
export function createEmailTabLabel<T extends string>({ locale, labels }: { locale: string; labels: Record<T, string> }, _options = {}) {
  return (id: T) => t({ locale, key: labels[id] });
}

/** This app's URL shape for a tab and its section; a section id is user-visible data, so it is encoded. */
export function createEmailNavigate({ deps }: { deps: {
  routePath: string; tabKey: string; partKey: string;
  navigate: (required: { routePath: string }, optional: { replace: boolean }) => void;
} }, _optional = {}) {
  return ({ tabId, part }: { tabId: string; part: string | null }, _optional = {}) =>
    deps.navigate({ routePath: part === null ? `${deps.routePath}?${deps.tabKey}=${tabId}` : `${deps.routePath}?${deps.tabKey}=${tabId}&${deps.partKey}=${encodeURIComponent(part)}` }, { replace: true });
}
