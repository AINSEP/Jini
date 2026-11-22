import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

import { definePlugin } from "../../__tests__/support/fixture-sdk.js";
import { createInvocationCoreDeps, pluginSdkBinding } from "../../__tests__/support/fixture-bindings.js";
import { registerTier2ImportPolicy, tier2ImportPolicyData, type Tier2ImportPolicy } from "../import-policy.js";
import type { Tier2Request } from "../protocol.js";
import { startTier2Worker } from "../start.js";

/**
 * @file The Tier-2 import policy's host-side inputs and its place in the worker start. The hook's
 * refusals run in real workers in the host's own integration test; here every registration is a spy.
 *
 * Requirement-to-test map:
 * - SDK-only by default: no trusted entry means only the host's SDK specifiers are allowed by name.
 * - a host trust decision adds its EXACT specifiers, and only for the entry it names.
 * - the policy package is the entry's grandparent (`<package>/server/index.mjs`) as a `/`-ended URL.
 * - the worker registers the policy and the SDK resolver on the real-import path, inside the call's
 *   import-stage error handling: a malformed entry URL becomes a structured `stage: "import"` reply
 *   and registers nothing.
 * - an injected importer registers neither the policy nor the resolver.
 */

const SDK = ["@example/plugin-sdk", "@example/legacy-sdk"] as const;
const binding = { pluginSdkBinding, createInvocationCoreDeps };

async function withPackage(run: (root: string, entry: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "jini-tier2-policy-"));
  try {
    await run(root, path.join(root, "server", "index.mjs"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("policy data: SDK-only by default, package = entry's grandparent, path and file URL forms agree", async () => {
  await withPackage(async (root, entry) => {
    const policy: Tier2ImportPolicy = { sdkSpecifiers: SDK };
    const expected = { packageUrl: `${pathToFileURL(root).href}/`, allowedSpecifiers: [...SDK], sdkSpecifiers: [...SDK] };
    assert.deepEqual(tier2ImportPolicyData({ entryPath: entry, policy }), expected);
    assert.deepEqual(tier2ImportPolicyData({ entryPath: pathToFileURL(entry).href, policy }), expected);
  });
});

test("policy data: a trusted entry gets exactly its own extra specifiers; any other entry stays SDK-only", async () => {
  await withPackage(async (root, entry) => {
    const other = path.join(root, "other", "server", "index.mjs");
    const policy: Tier2ImportPolicy = { sdkSpecifiers: SDK, trustedImports: [{ entryPath: pathToFileURL(entry).href, specifiers: ["@example/cms/seo", "#src/slug"] }] };
    assert.deepEqual(tier2ImportPolicyData({ entryPath: entry, policy }).allowedSpecifiers, [...SDK, "@example/cms/seo", "#src/slug"]);
    assert.deepEqual(tier2ImportPolicyData({ entryPath: other, policy }).allowedSpecifiers, [...SDK]);
  });
});

test("registerTier2ImportPolicy() hands the computed data to the injected register, once", async () => {
  await withPackage(async (root, entry) => {
    const calls: Array<{ specifier: string; data: unknown }> = [];
    registerTier2ImportPolicy({ entryPath: entry, policy: { sdkSpecifiers: SDK } }, { register: (specifier, options) => calls.push({ specifier, data: options.data }) });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.specifier, /^data:text\/javascript,/);
    assert.deepEqual(calls[0]!.data, { packageUrl: `${pathToFileURL(root).href}/`, allowedSpecifiers: [...SDK], sdkSpecifiers: [...SDK] });
  });
});

function probe(entryPath: string): Tier2Request {
  return { kind: "probe", plugin: { pluginId: "t2", entryPath, capabilities: [], hooks: [] } };
}

test("worker start: a malformed entry URL is a structured import-stage reply and registers nothing", async () => {
  const order: string[] = [];
  const posted: unknown[] = [];
  await startTier2Worker(
    {
      workerData: probe("file:///plugins/%2Fbad/server/index.mjs"), parentPort: { postMessage: (m) => posted.push(m) }, binding,
      importPolicy: { sdkSpecifiers: SDK }, registerSdkResolver: () => order.push("resolver"), realImport: async () => { order.push("import"); return {}; },
    },
    { registerImportPolicy: () => order.push("policy") },
  );
  assert.deepEqual(order, []);
  assert.equal(posted.length, 1);
  assert.deepEqual({ ...(posted[0] as object), error: undefined }, { ok: false, stage: "import", error: undefined });
});

test("worker start: a policy that cannot be computed is an import-stage reply, before the resolver or the import", async () => {
  const order: string[] = [];
  const posted: unknown[] = [];
  await startTier2Worker(
    {
      workerData: probe("/plugins/t2/server/index.mjs"), parentPort: { postMessage: (m) => posted.push(m) }, binding,
      importPolicy: { sdkSpecifiers: SDK }, registerSdkResolver: () => order.push("resolver"), realImport: async () => { order.push("import"); return {}; },
    },
    { registerImportPolicy: () => { order.push("policy"); throw new Error("policy refused"); } },
  );
  assert.deepEqual(order, ["policy"]);
  assert.deepEqual(posted, [{ ok: false, stage: "import", error: "policy refused" }]);
});

test("worker start: policy, then resolver, then the real import of the same entry", async () => {
  const order: string[] = [];
  const posted: unknown[] = [];
  const importPolicy: Tier2ImportPolicy = { sdkSpecifiers: SDK };
  await startTier2Worker(
    {
      workerData: probe("/plugins/t2/server/index.mjs"), parentPort: { postMessage: (m) => posted.push(m) }, binding, importPolicy,
      registerSdkResolver: () => order.push("resolver"),
      realImport: async (p) => { order.push(`import ${p}`); return { default: definePlugin({ setup: () => undefined }) }; },
    },
    { registerImportPolicy: (required) => { assert.equal(required.policy, importPolicy); order.push(`policy ${required.entryPath}`); } },
  );
  assert.deepEqual(order, ["policy /plugins/t2/server/index.mjs", "resolver", "import /plugins/t2/server/index.mjs"]);
  assert.equal((posted[0] as { ok: boolean }).ok, true);
});

test("worker start: an injected importer registers neither the policy nor the resolver", async () => {
  const order: string[] = [];
  await startTier2Worker(
    {
      workerData: probe("/plugins/t2/server/index.mjs"), parentPort: { postMessage: () => undefined }, binding,
      importPolicy: { sdkSpecifiers: SDK }, registerSdkResolver: () => order.push("resolver"), realImport: async () => { order.push("real"); return {}; },
    },
    { importModule: async () => { order.push("injected"); return {}; }, registerImportPolicy: () => order.push("policy") },
  );
  assert.deepEqual(order, ["injected"]);
});
