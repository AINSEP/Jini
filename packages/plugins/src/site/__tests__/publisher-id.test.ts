import assert from "node:assert/strict";
import { test } from "vitest";

import { LIPAY_MANIFEST } from "../lipay/manifest.js";
import { STORE_MANIFEST } from "../store/manifest.js";

/**
 * @file The bundled first-party data modules declare the engine's own publisher id. The publisher is
 * persisted in `_plugin_identity` and compared strictly on every boot, so a change here is a
 * migration, not a rename — this test makes any change to it deliberate.
 */
for (const [label, manifest] of [["lipay", LIPAY_MANIFEST], ["store", STORE_MANIFEST]] as const) {
  test(`${label}: provenance publisher is the engine's first-party id`, () => {
    assert.deepEqual(manifest.provenance, { sourceUrl: `builtin://${label}`, publisher: "jini-core" });
  });
}
