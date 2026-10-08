import assert from "node:assert/strict";
import { test } from "vitest";

import { HOOK_CONTENT_ENTRY_BEFORE_SAVE } from "../support/fixture-sdk.js";
import { buildCapabilityScopedSdk, CapabilityDeniedError, type CapabilityScopedSdkCoreDeps } from "../support/capability-sdk.js";
import type { PluginCapability } from "../support/manifest.js";

/**
 * @file C-009 `buildCapabilityScopedSdk()` — SPEC-005 REQ-04, AC-05, EC-06, INV-02, BR-04-cap.
 * **CIC U-003 (Binding, ESCALATE_SECURITY): stub-vs-absent for ungranted surfaces.** This is the
 * dedicated, direct coverage the TDD dispatch requires for U-003 — every one of the 2^3 = 8
 * capability-subset combinations is exercised, asserting every ungranted surface throws
 * `CapabilityDeniedError` specifically (never a bare `TypeError` on `undefined`) when invoked.
 *
 * TDD-certified against the stub in `../../capability-sdk.ts`; currently RED —
 * `buildCapabilityScopedSdk` throws "not implemented". These assertions describe the contract the
 * Programmer stage must satisfy.
 */

const ALL_CAPABILITIES: readonly PluginCapability[] = ["content.read", "content.extend", "hooks.attach"];

function fakeCoreDeps(): CapabilityScopedSdkCoreDeps {
  return {
    getCurrentEntry: () => ({
      id: "entry-1",
      workspaceId: "ws-1",
      title: "Distinctive article",
      slug: "s",
      status: "draft",
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Plugin content" }] }] },
      ext: { analytics: { words: 37 } },
    }),
    writeExtField: () => {},
    attachFilter: () => {},
  };
}

/** Every combination of the 3 capability tokens present/absent — 2^3 = 8, per CIC U-003's own
 * prescribed verification surface ("unit test constructing the SDK with each of the 8 possible
 * capability-subset combinations"). */
function allCapabilitySubsets(): PluginCapability[][] {
  const subsets: PluginCapability[][] = [];
  for (let mask = 0; mask < 8; mask += 1) {
    const subset: PluginCapability[] = [];
    if (mask & 1) subset.push("content.read");
    if (mask & 2) subset.push("content.extend");
    if (mask & 4) subset.push("hooks.attach");
    subsets.push(subset);
  }
  return subsets;
}

test("CIC U-003 sanity: allCapabilitySubsets() enumerates exactly 8 combinations, matching 2^3", () => {
  assert.equal(allCapabilitySubsets().length, 8);
});

for (const capabilities of allCapabilitySubsets()) {
  const label = capabilities.length === 0 ? "(none granted)" : capabilities.join("+");

  test(`CIC U-003-B1 (ESCALATE_SECURITY) [${label}]: every surface is always present as a callable, regardless of grant`, () => {
    const sdk = buildCapabilityScopedSdk({ pluginId: "p", capabilities, coreDeps: fakeCoreDeps() });

    assert.equal(typeof sdk.content?.read, "function", `content.read must be a callable even when ungranted [${label}]`);
    assert.equal(typeof sdk.content?.extend, "function", `content.extend must be a callable even when ungranted [${label}]`);
    assert.equal(typeof sdk.addFilter, "function", `addFilter must be a callable even when ungranted [${label}]`);
    assert.equal(typeof sdk.addAction, "function", `addAction must be a callable even when ungranted [${label}]`);
    assert.equal(typeof sdk.addContribution, "function", `addContribution must be a callable even when ungranted [${label}]`);
    // v1 has no action/contribution hook names; an ungranted call must still deny first.
    if (!capabilities.includes("hooks.attach")) {
      for (const invoke of [() => sdk.addAction("uncatalogued" as never, (() => {}) as never), () => sdk.addContribution("uncatalogued" as never, (() => {}) as never)]) {
        assert.throws(invoke, (error: unknown) => {
          assert.ok(error instanceof CapabilityDeniedError);
          assert.equal(error.pluginId, "p");
          assert.equal(error.capability, "hooks.attach");
          return true;
        });
      }
    }
  });

  test(`CIC U-003-B1 (ESCALATE_SECURITY) [${label}]: content.read() throws CapabilityDeniedError iff content.read is NOT granted`, () => {
    const sdk = buildCapabilityScopedSdk({ pluginId: "p", capabilities, coreDeps: fakeCoreDeps() });
    const granted = capabilities.includes("content.read");

    if (granted) {
      assert.doesNotThrow(() => sdk.content.read());
      assert.deepEqual(sdk.content.read(), {
        id: "entry-1", workspaceId: "ws-1", title: "Distinctive article", slug: "s", status: "draft",
        bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Plugin content" }] }] },
        ext: { analytics: { words: 37 } },
      });
    } else {
      assert.throws(() => sdk.content.read(), CapabilityDeniedError);
    }
  });

  test(`CIC U-003-B1 (ESCALATE_SECURITY) [${label}]: content.extend() throws CapabilityDeniedError iff content.extend is NOT granted`, () => {
    const sdk = buildCapabilityScopedSdk({ pluginId: "p", capabilities, coreDeps: fakeCoreDeps() });
    const granted = capabilities.includes("content.extend");

    if (granted) {
      assert.doesNotThrow(() => sdk.content.extend("count", 5));
    } else {
      assert.throws(() => sdk.content.extend("count", 5), CapabilityDeniedError);
    }
  });

  test(`CIC U-003-B1 (ESCALATE_SECURITY) [${label}]: addFilter() throws CapabilityDeniedError iff hooks.attach is NOT granted`, () => {
    const attached: unknown[] = [];
    const coreDeps = fakeCoreDeps();
    coreDeps.attachFilter = (hookName, filter) => { attached.push({ hookName, filter }); };
    const sdk = buildCapabilityScopedSdk({ pluginId: "p", capabilities, coreDeps });
    const granted = capabilities.includes("hooks.attach");
    const noop = () => ({});

    if (granted) {
      assert.doesNotThrow(() => sdk.addFilter(HOOK_CONTENT_ENTRY_BEFORE_SAVE, noop));
      assert.deepEqual(attached, [{ hookName: HOOK_CONTENT_ENTRY_BEFORE_SAVE, filter: noop }]);
    } else {
      assert.throws(() => sdk.addFilter(HOOK_CONTENT_ENTRY_BEFORE_SAVE, noop), CapabilityDeniedError);
    }
  });
}

test("REQ-04/AC-05: an ungranted-surface invocation throws an error carrying the exact denied capability and pluginId, not a generic message", () => {
  const sdk = buildCapabilityScopedSdk({ pluginId: "my-plugin", capabilities: [], coreDeps: fakeCoreDeps() });

  try {
    sdk.content.extend("count", 1);
    assert.fail("expected content.extend() to throw when ungranted");
  } catch (error) {
    assert.ok(error instanceof CapabilityDeniedError);
    assert.equal((error as CapabilityDeniedError).pluginId, "my-plugin");
    assert.equal((error as CapabilityDeniedError).capability, "content.extend");
  }
});

test("REQ-04: a granted content.extend() call delegates to coreDeps.writeExtField with the exact field/value given", () => {
  let received: { field: string; value: unknown } | null = null;
  const coreDeps = fakeCoreDeps();
  coreDeps.writeExtField = (field, value) => {
    received = { field, value };
  };

  const sdk = buildCapabilityScopedSdk({ pluginId: "p", capabilities: ["content.extend"], coreDeps });
  sdk.content.extend("count", 5);

  assert.deepEqual(received, { field: "count", value: 5 });
});

test("REQ-04: buildCapabilityScopedSdk builds a fresh object per call — two loads never share the same SDK instance", () => {
  const first = buildCapabilityScopedSdk({ pluginId: "p", capabilities: ALL_CAPABILITIES, coreDeps: fakeCoreDeps() });
  const second = buildCapabilityScopedSdk({ pluginId: "p", capabilities: ALL_CAPABILITIES, coreDeps: fakeCoreDeps() });

  assert.notEqual(first, second, "each load must construct a fresh handle, never a shared module-level singleton (ADR Decision item 2)");
});
