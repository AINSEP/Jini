import { describe, expect, it } from "vitest";

import { isBrowserSafeFieldPattern, isSafeFieldPattern } from "../field-registry.js";
import { validateFieldDescriptors } from "../forms.js";

/**
 * @file Browsers compile `pattern` with the `v` flag and silently ignore one that fails there, so
 * `[0-9 +.-]{7,20}` (valid under `u`) was enforced only by the server (2026-10-11).
 */

describe("isBrowserSafeFieldPattern", () => {
  it("refuses u-valid classes a browser would drop", () => {
    for (const pattern of ["[0-9 +.-]{7,20}", "[a-z-]+"]) {
      expect(isSafeFieldPattern({ pattern })).toBe(true);
      expect(isBrowserSafeFieldPattern({ pattern })).toBe(false);
    }
  });

  it("accepts the escaped form and plain patterns", () => {
    for (const pattern of ["[0-9 +.\\-]{7,20}", "[a-z\\-]+", "\\d{5}", "[A-Z]{2}[0-9]"]) expect(isBrowserSafeFieldPattern({ pattern })).toBe(true);
  });

  it("still refuses unsafe patterns", () => {
    // Browser-valid syntax must still obey the server's one-repetition safety limit.
    for (const pattern of ["(a|b)", "[A-Z]{2}[0-9]+"]) {
      expect(isSafeFieldPattern({ pattern })).toBe(false);
      expect(isBrowserSafeFieldPattern({ pattern })).toBe(false);
    }
  });
});

describe("authoring a pattern", () => {
  it("rejects a browser-ignored pattern with a fix hint and accepts the escaped one", () => {
    const field = (pattern: string) => ({ id: "phone", label: "Phone", type: "phone", required: false, pattern }) as never;
    const bad = validateFieldDescriptors({ fields: [field("[0-9 +.-]{7,20}")] });
    expect(bad.valid).toBe(false);
    expect(JSON.stringify(bad)).toContain("ignored by browsers");
    expect(validateFieldDescriptors({ fields: [field("[0-9 +.\\-]{7,20}")] }).valid).toBe(true);
  });
});
