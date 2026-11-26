import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it.each([
  ["cms", "./core/days-remaining"],
  ["cms", "./admin-http/routes/external-mcp/provider-refusal"],
  ["cms", "./publish/content/peer-transport-error"],
  ["cms", "./publish/trust/handshake-error"],
  ["core", "./contracts/standing-draft"],
])("classifies %s %s as universal", (pkg, entry) => {
  const manifest = JSON.parse(readFileSync(new URL(`../../packages/${pkg}/package.json`, import.meta.url), "utf8"));
  expect(manifest.jini.entries[entry]).toBe("universal");
});
