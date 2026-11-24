import { describe, expect, it } from "vitest";

import { ADMIN_COMMON_I18N } from "../../../core/i18n-common.js";
import { createSettingsCapabilitiesDictionary } from "../settings-capabilities-i18n.js";

const NAMES = { productName: "Acme", referenceProductName: "Reference" };
const SKILLS_KEY = "Acme has no skills backend yet. Skills lives in Settings here by design, unlike Reference's separate Integrations page. The control below is shown for reference and disabled until a real backend exists.";

describe("createSettingsCapabilitiesDictionary", () => {
  const { t } = createSettingsCapabilitiesDictionary({ commonDictionary: ADMIN_COMMON_I18N, ...NAMES });

  it("binds both product names into the English keys the host's call sites look up", () => {
    expect(t({ locale: "de", key: SKILLS_KEY })).toContain("Acme");
    expect(t({ locale: "de", key: SKILLS_KEY })).toContain("Reference");
    expect(t({ locale: "de", key: SKILLS_KEY })).not.toBe(SKILLS_KEY);
  });

  it("leaves no unbound placeholder in any key or value of any locale", () => {
    for (const block of Object.values(t.dictionary)) {
      for (const [key, value] of Object.entries(block)) {
        expect(`${key} ${value}`).not.toMatch(/\{(productName|referenceProductName)\}/);
      }
    }
  });

  it("carries the same seven capability notes in every locale", () => {
    const sizes = Object.values(t.dictionary).map((block) => Object.keys(block).length);
    expect(Object.keys(t.dictionary)).toHaveLength(21);
    expect(new Set(sizes)).toEqual(new Set([7]));
  });

  it("falls back to the English key on a miss", () => {
    expect(t({ locale: "de", key: "not in the dictionary" })).toBe("not in the dictionary");
  });

  it("uses the host's own names, not fixed ones", () => {
    const other = createSettingsCapabilitiesDictionary({ commonDictionary: {}, productName: "Zed", referenceProductName: "Ref" }).t;
    expect(other({ locale: "es", key: "Zed is a server CMS — new versions ship with a deployment, not an in-app updater." })).toContain("Zed es un CMS");
  });
});
