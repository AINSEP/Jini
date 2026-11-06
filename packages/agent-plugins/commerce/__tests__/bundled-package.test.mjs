import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.equal(pkg.exports["./commerce/server"].import, "./core/commerce-server.mjs");
  assert.equal(pkg.jini.entries["./commerce/server"], "node");
  assert.equal(pkg.peerDependenciesMeta["@jini-ai/commerce"].optional, true);
});
test("commerce server imports only the generic kernel and never another plugin", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", root), "utf8"));
  const files = [pkg.exports["./commerce/server"].import, pkg.exports["./commerce/server"].types];
  assert.deepEqual(files, ["./core/commerce-server.mjs", "./core/commerce-server.d.ts"]);
  for (const file of files) {
    const source = await readFile(new URL(file, new URL("../", root)), "utf8");
    assert.doesNotMatch(source, /agent-plugins\/stripe|payments-stripe|provider-plugins|TOVU_/);
    assert.match(source, /@jini-ai\/commerce/);
  }
});

test("the public commerce Node entry resolves the existing generic kernel functions", async () => {
  const entry = await import("@jini-ai/agent-plugins/commerce/server");
  const kernel = await import("@jini-ai/commerce");
  for (const name of ["createCommerceServer", "readOwnedCommerceOrder", "normalizedCommerceOrigin", "CommerceUnavailableError"]) {
    assert.equal(typeof entry[name], "function");
    assert.equal(entry[name], kernel[name]);
  }
});
