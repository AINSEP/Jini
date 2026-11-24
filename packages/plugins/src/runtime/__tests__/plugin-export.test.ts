import assert from "node:assert/strict";
import { test } from "vitest";

import { definePlugin } from "../../host/__tests__/support/fixture-sdk.js";

import { readDefinedPlugin } from "../plugin-export.js";

/**
 * @file `readDefinedPlugin()` — only a `definePlugin()` default export is a valid plugin module
 * (shared by `Jini/packages/plugins/src/host/node/loader.ts` step 4 and the Tier-2 worker).
 */

test("accepts a definePlugin() default export and returns it", () => {
  const plugin = definePlugin({ setup() {} });
  assert.equal(readDefinedPlugin({ moduleValue: { default: plugin } }), plugin);
});

const rejected: ReadonlyArray<[string, unknown]> = [
  ["a non-object module", "module"],
  ["a null module", null],
  ["a module without default", {}],
  ["a null default", { default: null }],
  ["a bare { setup } default (not wrapped by definePlugin)", { default: { setup() {} } }],
  ["a null definition", { default: { definition: null } }],
  ["a definition without a setup function", { default: { definition: { setup: 1 } } }],
];
for (const [label, moduleValue] of rejected) {
  test(`rejects ${label}`, () => {
    assert.equal(readDefinedPlugin({ moduleValue }), null);
  });
}
