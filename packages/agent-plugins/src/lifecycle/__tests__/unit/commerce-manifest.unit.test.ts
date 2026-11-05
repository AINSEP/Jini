import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { parseAgentPluginManifest } from "../../manifest.js";

it("validates the packaged commerce manifest without claiming a payment provider", async () => {
  const value = JSON.parse(await readFile(new URL("../../../../commerce/plugin.json", import.meta.url), "utf8"));
  const result = parseAgentPluginManifest({ value }, { identityNamespace: "tovu" });
  expect(result).toMatchObject({ ok: true, manifest: { name: "commerce", id: "jini/commerce", provides: ["commerce"] } });
  expect(value.extensions.tovu).not.toHaveProperty("providerPlugin");
});
