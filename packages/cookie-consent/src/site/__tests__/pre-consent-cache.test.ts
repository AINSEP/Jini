import { expect, it, vi } from "vitest";
import { preConsentCacheControl, hasConsentGatedScripts } from "../pre-consent-cache.js";

it("malformed configured scripts force no-store without relaxing private directives", () => {
  const html = '<script type="application/json" id="config[1]">broken</script>';
  const hasConsentChoice = vi.fn(() => false);
  expect(preConsentCacheControl({ html, configId: "config[1]", cacheControl: "public, max-age=60", hasConsentChoice })).toBe("private, no-store");
  expect(hasConsentGatedScripts({ html, configId: "config1" })).toBe(false);
  hasConsentChoice.mockClear();
  expect(preConsentCacheControl({ html, configId: "config[1]", cacheControl: "private, max-age=5", hasConsentChoice })).toBe("private, max-age=5");
  expect(hasConsentChoice).not.toHaveBeenCalled();
  expect(hasConsentGatedScripts({ html: '<script type="application/json" id="c">{"scripts":[]}</script>', configId: "c" })).toBe(false);
  expect(hasConsentGatedScripts({ html: '<script type="application/json" id="c">{"scripts":[{}]}</script>', configId: "c" })).toBe(true);
});
