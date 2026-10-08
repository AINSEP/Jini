import assert from "node:assert/strict";
import { test } from "vitest";

import { HOOK_CONTENT_ENTRY_BEFORE_SAVE, type BeforeSaveFilter, type ContentEntryDraft, type PluginSdk } from "../support/fixture-sdk.js";

import { readDefinedPlugin } from "../support/fixture-sdk.js";
import type { PluginManifest } from "../support/manifest.js";
import type { Tier2Reply, Tier2Request } from "../support/protocol.js";
import { createTier2ImportSeam } from "../support/import-seam.js";

/**
 * @file `createTier2ImportSeam()` — the server-side `importModule` a Tier-2 plugin's `loadPlugin()`
 * receives: it probes the plugin in a worker and hands back a proxy `definePlugin()` module whose
 * filter is an RPC. The plugin's own module is never imported here.
 *
 * Requirement-to-test map:
 * - probe failures map onto loadPlugin's own reasons (import -> reject, export -> no default,
 *   setup -> throwing setup) -> the probe-failure tests.
 * - the proxy attaches an RPC filter only when the probe saw one -> the attach tests.
 * - each filter call is one beforeSave request; a failed reply or a transport rejection throws
 *   -> the RPC tests.
 * - a site plugin's worker imports the snapshot path, not the live install path -> resolveWorkerEntry test.
 */

const manifest: PluginManifest = {
  id: "t2",
  name: "T2",
  version: "1.0.0",
  sdkRange: "^0.1.0",
  engine: 1,
  tier: "tier-2",
  capabilities: ["content.read", "hooks.attach"],
  hooks: [HOOK_CONTENT_ENTRY_BEFORE_SAVE],
  fields: [{ path: "ext.t2.n", type: "integer", queryable: false }],
  integrity: {},
};
const entry: ContentEntryDraft = { id: "e", workspaceId: "ws", title: "T", slug: "t", status: "draft", bodyJson: {}, ext: {} };
const ctx = { pluginId: "t2", workspaceId: "ws" };

function fakeRunner(replies: Array<Tier2Reply | Error>) {
  const requests: Tier2Request[] = [];
  const runCall = async (request: Tier2Request): Promise<Tier2Reply> => {
    requests.push(request);
    const next = replies.shift();
    if (next === undefined) throw new Error("unexpected call");
    if (next instanceof Error) throw next;
    return next;
  };
  return { runCall, requests };
}

/** Runs the proxy's setup with a recording SDK and returns the filter it attached (if any). */
async function setupProxy(moduleValue: unknown): Promise<BeforeSaveFilter | null> {
  const plugin = readDefinedPlugin(moduleValue);
  assert.ok(plugin, "the seam must return a definePlugin() module");
  let attached: BeforeSaveFilter | null = null;
  const sdk = {
    addFilter: (_hook: string, filter: BeforeSaveFilter) => { attached = filter; },
  } as unknown as PluginSdk;
  await plugin.definition.setup(sdk);
  return attached;
}

const PROBE_OK: Tier2Reply = { ok: true, kind: "probe", hooks: [HOOK_CONTENT_ENTRY_BEFORE_SAVE] };

test("the probe request carries the manifest's id, capabilities and hooks plus the entry path", async () => {
  const { runCall, requests } = fakeRunner([PROBE_OK]);
  await createTier2ImportSeam({ manifest, runCall })("/abs/plugin.js");
  assert.deepEqual(requests, [
    { kind: "probe", plugin: { pluginId: "t2", entryPath: "/abs/plugin.js", capabilities: manifest.capabilities, hooks: manifest.hooks } },
  ]);
});

test("resolveWorkerEntry decides what the worker imports (a site plugin's snapshot)", async () => {
  const { runCall, requests } = fakeRunner([PROBE_OK]);
  const seen: string[] = [];
  await createTier2ImportSeam({ manifest, runCall }, { resolveWorkerEntry: async (p) => { seen.push(p); return "file:///snap/server/index.mjs"; } })("/live/server/index.mjs");
  assert.deepEqual(seen, ["/live/server/index.mjs"]);
  assert.equal(requests[0]!.plugin.entryPath, "file:///snap/server/index.mjs");
});

test("a probe transport failure rejects the import (loadPlugin -> CODE_ENTRY_MISSING)", async () => {
  const { runCall } = fakeRunner([new Error("worker exceeded 5000ms timeout")]);
  await assert.rejects(createTier2ImportSeam({ manifest, runCall })("/p"), { message: "worker exceeded 5000ms timeout" });
});

test("an import-stage probe failure rejects the import", async () => {
  const { runCall } = fakeRunner([{ ok: false, stage: "import", error: "missing" }]);
  await assert.rejects(createTier2ImportSeam({ manifest, runCall })("/p"), { message: "missing" });
});

test("an export-stage probe failure yields a module with no definePlugin export (PLUGIN_EXPORT_INVALID)", async () => {
  const { runCall } = fakeRunner([{ ok: false, stage: "export", error: "no export" }]);
  const moduleValue = await createTier2ImportSeam({ manifest, runCall })("/p");
  assert.equal(readDefinedPlugin(moduleValue), null);
});

for (const stage of ["setup", "hook"] as const) {
  test(`a ${stage}-stage probe failure yields a proxy whose setup throws that error (PLUGIN_SETUP_FAILED)`, async () => {
    const { runCall } = fakeRunner([{ ok: false, stage, error: "bad setup" }]);
    const moduleValue = await createTier2ImportSeam({ manifest, runCall })("/p");
    await assert.rejects(setupProxy(moduleValue), { message: "bad setup" });
  });
}

test("a probe answered with a non-probe success rejects the import", async () => {
  const { runCall } = fakeRunner([{ ok: true, kind: "beforeSave", patch: {} }]);
  await assert.rejects(createTier2ImportSeam({ manifest, runCall })("/p"), { message: "invalid tier-2 worker reply" });
});

test("no filter is attached when the probe saw none (composition -> PLUGIN_HOOK_NOT_ATTACHED)", async () => {
  const { runCall } = fakeRunner([{ ok: true, kind: "probe", hooks: [] }]);
  assert.equal(await setupProxy(await createTier2ImportSeam({ manifest, runCall })("/p")), null);
});

test("each filter call is one beforeSave request and resolves to the worker's patch", async () => {
  const { runCall, requests } = fakeRunner([PROBE_OK, { ok: true, kind: "beforeSave", patch: { n: 3 } }]);
  const filter = await setupProxy(await createTier2ImportSeam({ manifest, runCall })("/abs/plugin.js"));
  assert.deepEqual(await filter!(entry, ctx), { n: 3 });
  assert.deepEqual(requests[1], { kind: "beforeSave", plugin: requests[0]!.plugin, entry, ctx });
});

test("a failed beforeSave reply throws its error (hook-registry fail-closed + quarantine)", async () => {
  const { runCall } = fakeRunner([PROBE_OK, { ok: false, stage: "hook", error: "filter blew up" }]);
  const filter = await setupProxy(await createTier2ImportSeam({ manifest, runCall })("/p"));
  await assert.rejects(Promise.resolve(filter!(entry, ctx)), { message: "filter blew up" });
});

test("a beforeSave transport failure (timeout) rejects the filter", async () => {
  const { runCall } = fakeRunner([PROBE_OK, new Error("exceeded 5000ms timeout")]);
  const filter = await setupProxy(await createTier2ImportSeam({ manifest, runCall })("/p"));
  await assert.rejects(Promise.resolve(filter!(entry, ctx)), { message: "exceeded 5000ms timeout" });
});

test("a beforeSave answered with a probe success rejects the filter", async () => {
  const { runCall } = fakeRunner([PROBE_OK, PROBE_OK]);
  const filter = await setupProxy(await createTier2ImportSeam({ manifest, runCall })("/p"));
  await assert.rejects(Promise.resolve(filter!(entry, ctx)), { message: "invalid tier-2 worker reply" });
});
