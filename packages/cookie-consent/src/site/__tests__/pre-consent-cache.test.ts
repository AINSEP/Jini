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

it("leaves public caching alone when no scripts are gated or a consent choice already exists", () => {
  const cacheControl = "public, max-age=36";
  const html = '<script type="application/json" id="site-consent">{"scripts":[{"src":"/stats.js","consent":["analytics"]}]}</script>';
  const hasConsentChoice = vi.fn(() => true);
  expect(preConsentCacheControl({ html, cacheControl, configId: "site-consent", hasConsentChoice })).toBe(cacheControl);
  expect(hasConsentChoice.mock.calls).toEqual([[{}]]);
  expect(preConsentCacheControl({ html, cacheControl, configId: "other-page-consent", hasConsentChoice: () => false })).toBe(cacheControl);
  expect(hasConsentGatedScripts({ html: '<script type="application/json" id="site-consent">{"scripts":"not-an-array"}</script>', configId: "site-consent" })).toBe(false);
});
