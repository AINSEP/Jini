import type { AdminNavLabelTranslator } from "../../shell/lib/admin-nav-i18n.js";

/**
 * @file The "Soon" tags on the Agent Plugins and Plugins tab labels: "Add a plugin" (owner,
 * 2026-10-06) and "Marketplace" (owner, 2026-10-17). A tagged tab stays fully clickable and usable;
 * the tag only says the flow is still settling. To drop a tag from both pages, set
 * {@link ADD_PLUGIN_TAB_SOON} or {@link MARKETPLACE_TAB_SOON} to `false`.
 */
export const ADD_PLUGIN_TAB_SOON = false;

/** The Marketplace tab's tag: nothing is fetched or listed there yet (see each page's panel). */
export const MARKETPLACE_TAB_SOON = true;

/**
 * The tag text for the "Add a plugin" tab: the admin sidebar's own translated "Soon" word, so the
 * tab and the sidebar badge read the same in every locale.
 *
 * @param required.locale Admin locale code; an unknown one falls back to English.
 * @param required.translateAdminNavLabel The host's bound sidebar-label translator (the package ships
 *   the dictionary, the host binds the callable).
 * @param optional.enabled Defaults to {@link ADD_PLUGIN_TAB_SOON}; passed explicitly by tests, and by Plugins
 *   on a server that refuses local installs.
 * @returns The tag text, or `undefined` (an untagged tab) when the flag is off.
 */
export function addPluginTabSoonTag({ locale, translateAdminNavLabel }: { locale: string; translateAdminNavLabel: AdminNavLabelTranslator }, { enabled = ADD_PLUGIN_TAB_SOON }: { enabled?: boolean } = {}): string | undefined {
  return enabled ? translateAdminNavLabel({ locale: locale, key: "Soon" }) : undefined;
}

/**
 * The tag text for the "Marketplace" tab — the same translated "Soon" word as
 * {@link addPluginTabSoonTag}.
 *
 * @param required.locale Admin locale code; an unknown one falls back to English.
 * @param required.translateAdminNavLabel See {@link addPluginTabSoonTag}.
 * @param optional.enabled Defaults to {@link MARKETPLACE_TAB_SOON}; passed explicitly only by tests.
 * @returns The tag text, or `undefined` (an untagged tab) when the flag is off.
 */
export function marketplaceTabSoonTag({ locale, translateAdminNavLabel }: { locale: string; translateAdminNavLabel: AdminNavLabelTranslator }, { enabled = MARKETPLACE_TAB_SOON }: { enabled?: boolean } = {}): string | undefined {
  return addPluginTabSoonTag({ locale, translateAdminNavLabel }, { enabled });
}
