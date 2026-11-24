import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// Documentation-only regression (moved with the hook from the host's rationale suite): pin the
// advisory site-key rationale to its owning code, not merely somewhere in the file.
const source = readFileSync(fileURLToPath(new URL("../hooks/use-dashboard.hooks.ts", import.meta.url)), "utf8");

it("keeps advisory site-key rationale beside the read and its unknown state", () => {
  expect(source).toContain('// Site-key plan §A.6 — same advisory shape as the password status read:\n  // a failed fetch means no banner, not an error card.\n  const siteKeyQueryFetch =');
  expect(source).toContain('// undefined until the site-key status fetch settles (or forever if it fails).\n  // shouldShowSiteKeyBanner treats undefined as "don\'t show".\n  const siteKeyState =');
});

it("removes detached descriptions of replaced read lifecycles", () => {
  expect(source).not.toContain("Read-lifecycle rationale retained from the preceding implementation");
});
