import assert from "node:assert/strict";
import { test } from "vitest";

import { attachLoadedPlugin } from "../support/loader.js";
import type { HookRegistry, HookRegistryFieldDecl } from "../support/hook-registry.js";

/**
 * @file `attachLoadedPlugin()` — ADR-057 Decision 2.1's extraction of `loadPlugin()`'s previously
 * dead step (5), widened to accept a `"glue"` source.
 *
 * Requirement-to-test map:
 * - "the extraction actually calls hookRegistry.attach(), not a no-op" -> the forwarding test.
 * - "the widened source union accepts 'glue' as well as the original 'built-in'/'site'" -> the
 *   per-source tests.
 * - "arguments reach hookRegistry.attach() unchanged" -> the exact-arguments test.
 */

function fakeHookRegistry(): { registry: HookRegistry; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const registry: HookRegistry = {
    attach: (...args: unknown[]) => {
      calls.push(args);
    },
    detach: () => {},
    runBeforeSave: async () => ({}),
    previewBeforeSave: async () => null,
  };
  return { registry, calls };
}

const fields: readonly HookRegistryFieldDecl[] = [{ path: "ext.m.count", type: "integer" }];
const filter = async () => ({ count: 1 });

for (const source of ["built-in", "site", "glue"] as const) {
  test(`attachLoadedPlugin forwards to hookRegistry.attach() for source '${source}'`, () => {
    const { registry, calls } = fakeHookRegistry();
    attachLoadedPlugin({ pluginId: "m", source, hookRegistry: registry, filter, declaredFields: fields });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["m", source, filter, fields]);
  });
}

test("ADR-057 Decision 2.1: before this extraction, nothing called hookRegistry.attach() in production — this is the first real caller, proven by exact argument forwarding with no transformation", () => {
  const { registry, calls } = fakeHookRegistry();
  attachLoadedPlugin({
    pluginId: "site-glue-example",
    source: "glue",
    hookRegistry: registry,
    filter,
    declaredFields: fields,
  });
  const [pluginId, source, forwardedFilter, forwardedFields] = calls[0] as [string, string, unknown, unknown];
  assert.equal(pluginId, "site-glue-example");
  assert.equal(source, "glue");
  assert.equal(forwardedFilter, filter, "the filter reference must reach hookRegistry.attach() unchanged");
  assert.equal(forwardedFields, fields, "declaredFields must reach hookRegistry.attach() unchanged");
});

test("attachLoadedPlugin propagates whatever hookRegistry.attach() itself throws, rather than swallowing it", () => {
  const throwingRegistry: HookRegistry = {
    attach: () => {
      throw new Error("boom from attach");
    },
    detach: () => {},
    runBeforeSave: async () => ({}),
    previewBeforeSave: async () => null,
  };
  assert.throws(
    () =>
      attachLoadedPlugin({
        pluginId: "m",
        source: "glue",
        hookRegistry: throwingRegistry,
        filter,
        declaredFields: fields,
      }),
    /boom from attach/
  );
});
