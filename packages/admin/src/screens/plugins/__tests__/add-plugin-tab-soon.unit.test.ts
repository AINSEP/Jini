import { expect, it } from "vitest";

import { createDictionaryTranslator } from "@jini-ai/core/text";
import { ADMIN_COMMON_I18N } from "../../../core/i18n-common.js";
import { ADMIN_NAV_DICT } from "../../../shell/lib/admin-nav-i18n.js";
import { ADD_PLUGIN_TAB_SOON, MARKETPLACE_TAB_SOON, addPluginTabSoonTag, marketplaceTabSoonTag } from "../add-plugin-tab-soon.js";

/** The binding a host makes once at module scope: the package dictionary plus the shared common words. */
const translateAdminNavLabel = createDictionaryTranslator({ featureDictionary: ADMIN_NAV_DICT }, { commonDictionary: ADMIN_COMMON_I18N });

it("leaves working Add tabs untagged by default", () => {
  expect(ADD_PLUGIN_TAB_SOON).toBe(false);
  expect(addPluginTabSoonTag({ locale: "en", translateAdminNavLabel })).toBeUndefined();
  expect(addPluginTabSoonTag({ locale: "es", translateAdminNavLabel })).toBeUndefined();
});

it("uses the translated sidebar badge when explicitly enabled", () => {
  expect(addPluginTabSoonTag({ locale: "en", translateAdminNavLabel }, { enabled: true })).toBe("Soon");
  expect(addPluginTabSoonTag({ locale: "es", translateAdminNavLabel }, { enabled: true })).toBe("Próximamente");
});

it("leaves the tab untagged once the flag is off", () => {
  expect(addPluginTabSoonTag({ locale: "en", translateAdminNavLabel }, { enabled: false })).toBeUndefined();
});

it("tags Marketplace tabs Soon by default, in the sidebar badge's own words", () => {
  expect(MARKETPLACE_TAB_SOON).toBe(true);
  expect(marketplaceTabSoonTag({ locale: "en", translateAdminNavLabel })).toBe("Soon");
  expect(marketplaceTabSoonTag({ locale: "es", translateAdminNavLabel })).toBe("Próximamente");
  expect(marketplaceTabSoonTag({ locale: "en", translateAdminNavLabel }, { enabled: false })).toBeUndefined();
});
