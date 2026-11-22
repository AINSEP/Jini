import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const root = new URL("../", import.meta.url);
test("commerce publishes an isolated dormant payload with no host-kernel entry or peer", async () => {
  const manifest = JSON.parse(await readFile(new URL("plugin.json", root), "utf8"));
  assert.equal(manifest.name, "commerce");
  assert.equal(manifest.extensions.jini.id, "jini/commerce");
  assert.deepEqual(manifest.extensions.jini.provides, ["commerce"]);
  assert.equal(manifest.extensions.jini.providerPlugin, undefined);
  const pkg = JSON.parse(await readFile(new URL("../package.json", root), "utf8"));
  assert.equal(pkg.exports["./commerce"], "./commerce/plugin.json");
  assert.equal(pkg.exports["./commerce/server"], undefined);
  assert.equal(pkg.jini.entries["./commerce/server"], undefined);
  assert.equal(pkg.peerDependencies["@jini-ai/commerce"], undefined);
});
