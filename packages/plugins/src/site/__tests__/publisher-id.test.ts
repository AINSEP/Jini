import assert from "node:assert/strict";
import { test } from "vitest";

import { createLipayManifest } from "../lipay/manifest.js";
import { createStoreManifest } from "../store/manifest.js";

/**
 * @file The bundled first-party data modules declare the publisher id the HOST injects. The publisher
 * is persisted in `_plugin_identity` and compared strictly on every boot, so the engine must not pick
 * one: a site whose rows were minted under its host's id keeps adopting its namespace only while the
 * host keeps passing that same id. These pins make any change to that pass-through deliberate.
 */
for (const [label, create] of [["lipay", createLipayManifest], ["store", createStoreManifest]] as const) {
  test(`${label}: provenance publisher is exactly the host-injected id`, () => {
    assert.deepEqual(create({ publisher: "host-first-party" }).provenance, { sourceUrl: `builtin://${label}`, publisher: "host-first-party" });
  });
  test(`${label}: tables are independent of the injected publisher`, () => {
    assert.deepEqual(create({ publisher: "a" }).tables, create({ publisher: "b" }).tables);
    assert.equal(create({ publisher: "a" }).pluginId, label);
  });
}
