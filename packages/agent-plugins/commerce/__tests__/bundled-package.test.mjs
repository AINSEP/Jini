import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
const root = new URL("../", import.meta.url);
test("commerce publishes an isolated dormant payload and explicit Node entry", async () => {
  const manifest = JSON.parse(await readFile(new URL("plugin.json", root), "utf8"));
  assert.equal(manifest.name, "commerce");
  assert.equal(manifest.extensions.tovu.id, "jini/commerce");
  assert.deepEqual(manifest.extensions.tovu.provides, ["commerce"]);
  assert.equal(manifest.extensions.tovu.providerPlugin, undefined);
  const pkg = JSON.parse(await readFile(new URL("../package.json", root), "utf8"));
  assert.equal(pkg.exports["./commerce"], "./commerce/plugin.json");
  assert.equal(pkg.exports["./commerce/server"].import, "./commerce/server/index.mjs");
  assert.equal(pkg.jini.entries["./commerce/server"], "node");
  assert.equal(pkg.peerDependenciesMeta["@jini-ai/commerce"].optional, true);
});
test("commerce server imports only the generic kernel and never another plugin", async () => {
  const files = await readdir(new URL("server/", root));
  for (const file of files) {
    const source = await readFile(new URL(`server/${file}`, root), "utf8");
    assert.doesNotMatch(source, /agent-plugins\/stripe|payments-stripe|provider-plugins|TOVU_/);
    assert.match(source, /@jini-ai\/commerce/);
  }
});
