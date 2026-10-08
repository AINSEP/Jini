import assert from "node:assert/strict";
import { test } from "vitest";

import { definePlugin, HOOK_CONTENT_ENTRY_BEFORE_SAVE, type ContentEntryDraft, type PluginSdk } from "../support/fixture-sdk.js";

import { CapabilityDeniedError } from "../support/capability-sdk.js";
import type { Tier2PluginRef, Tier2Request } from "../support/protocol.js";
import { runTier2Call } from "../support/run-call.js";

/**
 * @file `runTier2Call()` — the worker-side half of one Tier-2 call, run in-process here with a fake
 * importer (the real worker is exercised by the composition integration test).
 *
 * Requirement-to-test map:
 * - each failure stage (import / export / setup / hook) is reported, never thrown -> the stage tests.
 * - probe reports whether setup attached the beforeSave filter -> the probe tests.
 * - beforeSave runs the filter with content.read/extend live and the SAME capability gating as
 *   Tier 3 -> the beforeSave tests.
 * - the reply is structured-clone safe -> the non-cloneable patch test.
 */

const plugin: Tier2PluginRef = {
  pluginId: "t2",
  entryPath: "/plugins/t2/plugin.js",
  capabilities: ["content.read", "content.extend", "hooks.attach"],
  hooks: [HOOK_CONTENT_ENTRY_BEFORE_SAVE],
};
const entry: ContentEntryDraft = {
  id: "e1",
  workspaceId: "ws",
  title: "Hello",
  slug: "hello",
  status: "draft",
  bodyJson: { type: "doc" },
  ext: {},
};
const probe: Tier2Request = { kind: "probe", plugin };
const beforeSave: Tier2Request = { kind: "beforeSave", plugin, entry, ctx: { pluginId: "t2", workspaceId: "ws" } };

function moduleWith(setup: (sdk: PluginSdk) => void | Promise<void>) {
  return async () => ({ default: definePlugin({ setup }) });
}

test("the importer receives the plugin's entryPath", async () => {
  const seen: string[] = [];
  await runTier2Call({ request: probe, importModule: async (p) => { seen.push(p); return {}; } });
  assert.deepEqual(seen, ["/plugins/t2/plugin.js"]);
});

test("an import failure is reported as stage 'import'", async () => {
  const reply = await runTier2Call({ request: probe, importModule: async () => { throw new Error("no such file"); } });
  assert.deepEqual(reply, { ok: false, stage: "import", error: "no such file" });
});

test("a non-Error import rejection is stringified", async () => {
  const reply = await runTier2Call({ request: probe, importModule: () => Promise.reject("bare") });
  assert.deepEqual(reply, { ok: false, stage: "import", error: "bare" });
});

test("a module without a definePlugin() default export is stage 'export'", async () => {
  const reply = await runTier2Call({ request: probe, importModule: async () => ({ default: { setup() {} } }) });
  assert.deepEqual(reply, { ok: false, stage: "export", error: "plugin 't2' does not default-export definePlugin(...)" });
});

test("a throwing setup is stage 'setup'", async () => {
  const reply = await runTier2Call({ request: probe, importModule: moduleWith(() => { throw new Error("bad setup"); }) });
  assert.deepEqual(reply, { ok: false, stage: "setup", error: "bad setup" });
});

test("setup attaching an undeclared hook fails in setup, like Tier 3", async () => {
  const reply = await runTier2Call({
    request: { kind: "probe", plugin: { ...plugin, hooks: [] } },
    importModule: moduleWith((sdk) => sdk.addFilter(HOOK_CONTENT_ENTRY_BEFORE_SAVE, () => ({}))),
  });
  assert.deepEqual(reply, {
    ok: false,
    stage: "setup",
    error: "plugin 't2' attempted to attach undeclared hook 'content.entry.beforeSave'",
  });
});

test("probe reports the attached beforeSave hook and never runs the filter", async () => {
  let ran = false;
  const reply = await runTier2Call({
    request: probe,
    importModule: moduleWith((sdk) => sdk.addFilter(HOOK_CONTENT_ENTRY_BEFORE_SAVE, () => { ran = true; return {}; })),
  });
  assert.deepEqual(reply, { ok: true, kind: "probe", hooks: [HOOK_CONTENT_ENTRY_BEFORE_SAVE] });
  assert.equal(ran, false);
});

test("probe reports no hooks when setup attached nothing", async () => {
  const reply = await runTier2Call({ request: probe, importModule: moduleWith(() => {}) });
  assert.deepEqual(reply, { ok: true, kind: "probe", hooks: [] });
});

test("beforeSave runs the filter with the entry, ctx, content.read and content.extend", async () => {
  const reply = await runTier2Call({
    request: beforeSave,
    importModule: moduleWith((sdk) =>
      sdk.addFilter(HOOK_CONTENT_ENTRY_BEFORE_SAVE, async (draft, ctx) => {
        sdk.content.extend("fromExtend", sdk.content.read().slug);
        return { title: draft.title, ctx: ctx.pluginId };
      })
    ),
  });
  assert.deepEqual(reply, { ok: true, kind: "beforeSave", patch: { fromExtend: "hello", title: "Hello", ctx: "t2" } });
});

test("an ungranted capability is denied inside the worker exactly as in-process", async () => {
  const reply = await runTier2Call({
    request: { ...beforeSave, plugin: { ...plugin, capabilities: ["hooks.attach"] } },
    importModule: moduleWith((sdk) => sdk.addFilter(HOOK_CONTENT_ENTRY_BEFORE_SAVE, () => ({ t: sdk.content.read().title }))),
  });
  assert.equal(reply.ok, false);
  assert.equal(!reply.ok && reply.stage, "hook");
  assert.equal(!reply.ok && reply.error, new CapabilityDeniedError("t2", "content.read").message);
});

test("beforeSave without an attached filter is stage 'hook'", async () => {
  const reply = await runTier2Call({ request: beforeSave, importModule: moduleWith(() => {}) });
  assert.deepEqual(reply, { ok: false, stage: "hook", error: "plugin 't2' attached no beforeSave filter" });
});

test("a throwing filter is stage 'hook'", async () => {
  const reply = await runTier2Call({
    request: beforeSave,
    importModule: moduleWith((sdk) => sdk.addFilter(HOOK_CONTENT_ENTRY_BEFORE_SAVE, () => { throw new Error("filter blew up"); })),
  });
  assert.deepEqual(reply, { ok: false, stage: "hook", error: "filter blew up" });
});

test("a patch that cannot cross the worker boundary is stage 'hook', not a crash", async () => {
  const reply = await runTier2Call({
    request: beforeSave,
    importModule: moduleWith((sdk) => sdk.addFilter(HOOK_CONTENT_ENTRY_BEFORE_SAVE, (() => ({ fn: () => 1 })) as never)),
  });
  assert.equal(reply.ok, false);
  assert.equal(!reply.ok && reply.stage, "hook");
  assert.match(!reply.ok ? reply.error : "", /^plugin 't2' returned a value that cannot cross the worker boundary: /);
});
