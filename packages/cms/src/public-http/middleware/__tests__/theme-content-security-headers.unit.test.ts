import { expect, test } from "vitest";
import { themeAssetSecurityHeaderSet } from "../theme-content-security-headers.js";

// Named mutations rejected: dropping `sandbox`, matching the font extension case-sensitively, and
// granting CORS to a non-font path.
test("every theme file gets nosniff and the sandboxed CSP, in that order", () => {
  expect(Object.entries(themeAssetSecurityHeaderSet({ path: "/css/site.css" }))).toEqual([
    ["X-Content-Type-Options", "nosniff"],
    ["Content-Security-Policy", "default-src 'none'; sandbox"],
  ]);
});

test("font files (any case) are also readable cross-origin; nothing else is", () => {
  expect(themeAssetSecurityHeaderSet({ path: "/fonts/Inter.WOFF2" })["Access-Control-Allow-Origin"]).toBe("*");
  expect(themeAssetSecurityHeaderSet({ path: "/logo.svg" })).not.toHaveProperty("Access-Control-Allow-Origin");
});
