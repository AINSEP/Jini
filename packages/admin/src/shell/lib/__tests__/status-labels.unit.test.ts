import { describe, expect, it } from "vitest";

import { KNOWN_SERVER_LABELS, pluginMetadataLabel, recipientLabel, serverLabel } from "../status-labels.js";
import { SHARED_COMPONENTS_DICT } from "../../components/shared-components-i18n.js";

describe("serverLabel", () => {
  it("provides every mapped server label in all 21 supported locales", () => {
    expect(Object.keys(SHARED_COMPONENTS_DICT)).toHaveLength(21);
    for (const labels of Object.values(SHARED_COMPONENTS_DICT)) {
      for (const value of KNOWN_SERVER_LABELS) expect(labels[value]).toBeTruthy();
    }
  });

  it("localizes known server values and leaves future values readable", () => {
    expect(serverLabel({ value: "published", locale: "es" })).toBe("publicado");
    expect(serverLabel({ value: "unrecognized-state", locale: "es" })).toBe("unrecognized-state");
  });

  it("uses singular and plural recipient labels", () => {
    expect(recipientLabel({ count: 1, locale: "es" })).toBe("destinatario");
    expect(recipientLabel({ count: 2, locale: "es" })).toBe("destinatarios");
  });

  it("localizes each plugin metadata tag without changing its value order", () => {
    expect(pluginMetadataLabel({ values: ["built-in", "tier-3", "valid"], locale: "es" })).toBe("integrado · nivel 3 · válido");
  });
});

it("gives known English statuses human-readable fallback copy for an unsupported locale", () => {
  expect(serverLabel({ value: "auto_slug_change", locale: "zz-unknown" })).toBe("URL change");
  expect(serverLabel({ value: "dead", locale: "zz-unknown" })).toBe("Failed permanently");
  expect(serverLabel({ value: "future_vendor_status", locale: "zz-unknown" })).toBe("future_vendor_status");
});
