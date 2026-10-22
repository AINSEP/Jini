import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

import type { DefinedPlugin, PluginModuleImportPort } from "../../ports.js";
import { createInvocationCoreDeps, pluginSdkBinding } from "../../__tests__/support/fixture-bindings.js";
import { runTier2Call, type RunTier2CallRequired } from "../run-call.js";
import type { Tier2PluginRef, Tier2Request } from "../protocol.js";

const hook = pluginSdkBinding.beforeSaveHook;
const plugin: Tier2PluginRef = {
  pluginId: "pin", entryPath: "/plugins/pin/server/index.mjs",
  capabilities: ["content.read", "content.extend", "hooks.attach"], hooks: [hook],
};
const probe: Tier2Request = { kind: "probe", plugin };
const beforeSave: Extract<Tier2Request, { kind: "beforeSave" }> = {
  kind: "beforeSave", plugin, entry: { workspaceId: "ws", ext: {} },
  ctx: { pluginId: "pin", workspaceId: "ws" },
};

function call(
  { setup = () => {}, ...ports }: Partial<RunTier2CallRequired> & { setup?: DefinedPlugin["definition"]["setup"] },
  _optional: Record<string, never> = {},
) {
  return runTier2Call({
    request: probe, pluginSdkBinding, createInvocationCoreDeps,
    importModule: async () => ({ exported: pluginSdkBinding.definePlugin({ setup }) }), ...ports,
  });
}

test.each([
  ["/plugins/pin/server/index.mjs", "/plugins/pin"],
  [pathToFileURL("/plugins/pin space/server/index.mjs").href, "/plugins/pin space"],
])("imports %s unchanged with its decoded package root", async (entryPath, packageRoot) => {
  const seen: Parameters<PluginModuleImportPort>[0][] = [];
  const reply = await call({
    request: { kind: "probe", plugin: { ...plugin, entryPath } },
    importModule: async (input) => { seen.push(input); return "refused"; },
  });
  assert.deepEqual(seen, [{ plugin: { pluginId: "pin", packageRoot }, modulePath: entryPath }]);
  assert.deepEqual(reply, { ok: false, stage: "import", error: "refused" });
});

test("invalid file URLs fail as import errors before the importer runs", async () => {
  let imported = false;
  const reply = await call({
    request: { kind: "probe", plugin: { ...plugin, entryPath: "file:///plugins/%ZZ/server/index.mjs" } },
    importModule: async () => { imported = true; return { exported: undefined }; },
  });
  assert.equal(imported, false);
  assert.deepEqual(reply, { ok: false, stage: "import", error: "URI malformed" });
});

test("passes only the imported export to the host's export validator", async () => {
  const exported = { marker: "module" };
  const seen: unknown[] = [];
  const reply = await call({
    importModule: async () => ({ exported }),
    pluginSdkBinding: { ...pluginSdkBinding, readDefinedPlugin: ({ moduleValue }) => { seen.push(moduleValue); return null; } },
  });
  assert.deepEqual(seen, [{ default: exported }]);
  assert.deepEqual(reply, { ok: false, stage: "export", error: "plugin 'pin' does not default-export definePlugin(...)" });
});

test.each([new Error("boom"), "bare failure", null])("attributes thrown and rejected values to the failing plugin stage: %j", async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  assert.deepEqual(await call({ importModule: () => Promise.reject(error) }), { ok: false, stage: "import", error: message });
  assert.deepEqual(await call({ setup: () => Promise.reject(error) }), { ok: false, stage: "setup", error: message });
  assert.deepEqual(await call({
    request: beforeSave, setup: (sdk) => sdk.addFilter(hook, () => Promise.reject(error)),
  }), { ok: false, stage: "hook", error: message });
});

test("synchronous plugin throws retain their setup or hook stage", async () => {
  assert.deepEqual(await call({ setup: () => { throw new Error("setup throw"); } }), {
    ok: false, stage: "setup", error: "setup throw",
  });
  assert.deepEqual(await call({
    request: beforeSave, setup: (sdk) => sdk.addFilter(hook, () => { throw new Error("filter throw"); }),
  }), { ok: false, stage: "hook", error: "filter throw" });
});

test("probe reports no filter or the host's hook id without executing the filter", async () => {
  assert.deepEqual(await call({}), { ok: true, kind: "probe", hooks: [] });
  let runs = 0;
  const reply = await call({ setup: (sdk) => sdk.addFilter(hook, () => { runs++; return {}; }) });
  assert.deepEqual(reply, { ok: true, kind: "probe", hooks: [hook] });
  assert.equal(runs, 0);
});

test("beforeSave without a filter fails closed", async () => {
  assert.deepEqual(await call({ request: beforeSave }), {
    ok: false, stage: "hook", error: "plugin 'pin' attached no beforeSave filter",
  });
});

test("waits for setup and the filter, retaining entry/context identity and cloning the merged patch", async () => {
  const seen: unknown[] = [];
  const patch = { returned: true };
  let invocationInput: unknown;
  const reply = await call({
    request: beforeSave,
    createInvocationCoreDeps: (input) => { invocationInput = input; return createInvocationCoreDeps(input); },
    setup: async (sdk) => {
      await Promise.resolve();
      sdk.addFilter(hook, async (entry, ctx) => {
        await Promise.resolve();
        seen.push(entry, ctx, sdk.content.read());
        sdk.content.extend("written", "yes");
        return patch;
      });
    },
  });
  assert.deepEqual(invocationInput, { pluginId: "pin", declaredHooks: [hook] });
  assert.equal(seen[0], beforeSave.entry);
  assert.equal(seen[1], beforeSave.ctx);
  assert.equal(seen[2], beforeSave.entry);
  assert.deepEqual(reply, { ok: true, kind: "beforeSave", patch: { written: "yes", returned: true } });
  assert.deepEqual(patch, { returned: true });
});

test("returns an independent clone of the filter's patch", async () => {
  const patch = { value: 1 };
  const reply = await call({ request: beforeSave, setup: (sdk) => sdk.addFilter(hook, () => patch) });
  assert.deepEqual(reply, { ok: true, kind: "beforeSave", patch });
  assert.notEqual(reply.ok && reply.kind === "beforeSave" && reply.patch, patch);
});

test("clone failures receive the plugin-attributed boundary diagnostic", async () => {
  const patch = { get value(): string { throw new Error("clone getter failed"); } };
  const reply = await call({ request: beforeSave, setup: (sdk) => sdk.addFilter(hook, () => patch) });
  assert.deepEqual(reply, {
    ok: false, stage: "hook",
    error: "plugin 'pin' returned a value that cannot cross the worker boundary: clone getter failed",
  });
});

test("undeclared hooks and ungranted attachment remain setup failures", async () => {
  assert.deepEqual(await call({
    request: { kind: "probe", plugin: { ...plugin, hooks: [] } }, setup: (sdk) => sdk.addFilter(hook, () => ({})),
  }), { ok: false, stage: "setup", error: `plugin 'pin' attempted to attach undeclared hook '${hook}'` });
  assert.deepEqual(await call({
    request: { kind: "probe", plugin: { ...plugin, capabilities: [] } }, setup: (sdk) => sdk.addFilter(hook, () => ({})),
  }), { ok: false, stage: "setup", error: "plugin 'pin' invoked 'hooks.attach' without declaring it in its manifest capabilities" });
});

test("ungranted content access remains a hook failure", async () => {
  assert.deepEqual(await call({
    request: { ...beforeSave, plugin: { ...plugin, capabilities: ["hooks.attach"] } },
    setup: (sdk) => sdk.addFilter(hook, () => { sdk.content.read(); return {}; }),
  }), { ok: false, stage: "hook", error: "plugin 'pin' invoked 'content.read' without declaring it in its manifest capabilities" });
});

const hostFailure = new Error("host port failed");
const failingPorts: ReadonlyArray<readonly [string, Partial<RunTier2CallRequired>]> = [
  ["export validator", { pluginSdkBinding: { ...pluginSdkBinding, readDefinedPlugin: () => { throw hostFailure; } } }],
  ["invocation factory", { createInvocationCoreDeps: () => { throw hostFailure; } }],
  ["SDK builder", { pluginSdkBinding: { ...pluginSdkBinding, buildSdk: () => { throw hostFailure; } } }],
  ["filter accessor", { createInvocationCoreDeps: (input) => ({
    ...createInvocationCoreDeps(input), capturedFilter: () => { throw hostFailure; },
  }) }],
];
test.each(failingPorts)("host %s errors reject rather than become plugin failures", async (_label, ports) => {
  await assert.rejects(call(ports), (error: unknown) => error === hostFailure);
});
