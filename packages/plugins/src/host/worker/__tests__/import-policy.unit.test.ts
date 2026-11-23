import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
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
 * - the policy package is the host-registered package root as a `/`-ended URL, for both the installed
 *   layout (`<package>/server/index.mjs`) and a built-in whose entry sits directly in its sourceDir;
 *   an entry outside that root is refused.
 * - both the entry and the root are compared by REAL path (the loader reports a module's real path as
 *   its `parentURL`): a root reached through a symlink still contains its entry and yields the real
 *   root's URL, and an entry path inside the root that is a symlink to a file outside it is refused.
 *   A trusted entry named through a symlink still matches the real entry.
 * - existing hosts that pass no policy keep the old call shape: resolver, then import, no policy.
 * - the worker registers the policy and the SDK resolver on the real-import path, inside the call's
 *   import-stage error handling: a malformed entry URL becomes a structured `stage: "import"` reply
 *   and registers nothing.
 * - an injected importer registers neither the policy nor the resolver.
 */

const SDK = ["@example/plugin-sdk", "@example/legacy-sdk"] as const;
const binding = { pluginSdkBinding, createInvocationCoreDeps };

async function touch(file: string): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "export default {};\n");
  return file;
}

async function withPackage(run: (root: string, entry: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "jini-tier2-policy-"));
  try {
    await run(root, await touch(path.join(root, "server", "index.mjs")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("policy data: SDK-only by default, package = the registered root (installed layout), path and file URL forms agree", async () => {
  await withPackage(async (root, entry) => {
    const policy: Tier2ImportPolicy = { sdkSpecifiers: SDK };
    const expected = { packageUrl: `${pathToFileURL(root).href}/`, allowedSpecifiers: [...SDK], sdkSpecifiers: [...SDK] };
    assert.deepEqual(tier2ImportPolicyData({ entryPath: entry, packageRoot: root, policy }), expected);
    assert.deepEqual(tier2ImportPolicyData({ entryPath: pathToFileURL(entry).href, packageRoot: root, policy }), expected);
  });
});

test("policy data: a trusted entry gets exactly its own extra specifiers; any other entry stays SDK-only", async () => {
  await withPackage(async (root, entry) => {
    const other = await touch(path.join(root, "other", "server", "index.mjs"));
    const policy: Tier2ImportPolicy = { sdkSpecifiers: SDK, trustedImports: [{ entryPath: pathToFileURL(entry).href, specifiers: ["@example/cms/seo", "#src/slug"] }] };
    assert.deepEqual(tier2ImportPolicyData({ entryPath: entry, packageRoot: root, policy }).allowedSpecifiers, [...SDK, "@example/cms/seo", "#src/slug"]);
    assert.deepEqual(tier2ImportPolicyData({ entryPath: other, packageRoot: path.join(root, "other"), policy }).allowedSpecifiers, [...SDK]);
  });
});

test("registerTier2ImportPolicy() hands the computed data to the injected register, once", async () => {
  await withPackage(async (root, entry) => {
    const calls: Array<{ specifier: string; data: unknown }> = [];
    registerTier2ImportPolicy({ entryPath: entry, packageRoot: root, policy: { sdkSpecifiers: SDK } }, { register: (specifier, options) => calls.push({ specifier, data: options.data }) });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.specifier, /^data:text\/javascript,/);
    assert.deepEqual(calls[0]!.data, { packageUrl: `${pathToFileURL(root).href}/`, allowedSpecifiers: [...SDK], sdkSpecifiers: [...SDK] });
  });
});

function probe(entryPath: string, packageRoot?: string): Tier2Request {
  return { kind: "probe", plugin: { pluginId: "t2", entryPath, ...(packageRoot === undefined ? {} : { packageRoot }), capabilities: [], hooks: [] } };
}

test("worker start: a malformed entry URL is a structured import-stage reply and registers nothing", async () => {
  const order: string[] = [];
  const posted: unknown[] = [];
  await startTier2Worker(
    {
      workerData: probe("file:///plugins/%2Fbad/server/index.mjs", "/plugins"), parentPort: { postMessage: (m) => posted.push(m) }, binding,
      registerSdkResolver: () => order.push("resolver"), realImport: async () => { order.push("import"); return {}; },
    },
    // The real policy computation, with only Node's register() replaced, so the URL is actually parsed.
    { importPolicy: { sdkSpecifiers: SDK }, registerImportPolicy: (required) => registerTier2ImportPolicy(required, { register: () => order.push("policy") }) },
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
      workerData: probe("/plugins/t2/server/index.mjs", "/plugins/t2"), parentPort: { postMessage: (m) => posted.push(m) }, binding,
      registerSdkResolver: () => order.push("resolver"), realImport: async () => { order.push("import"); return {}; },
    },
    { importPolicy: { sdkSpecifiers: SDK }, registerImportPolicy: () => { order.push("policy"); throw new Error("policy refused"); } },
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
      workerData: probe("/plugins/t2/server/index.mjs", "/plugins/t2"), parentPort: { postMessage: (m) => posted.push(m) }, binding,
      registerSdkResolver: () => order.push("resolver"),
      realImport: async (p) => { order.push(`import ${p}`); return { default: definePlugin({ setup: () => undefined }) }; },
    },
    { importPolicy, registerImportPolicy: (required) => { assert.equal(required.policy, importPolicy); order.push(`policy ${required.entryPath} in ${required.packageRoot}`); } },
  );
  assert.deepEqual(order, ["policy /plugins/t2/server/index.mjs in /plugins/t2", "resolver", "import /plugins/t2/server/index.mjs"]);
  assert.equal((posted[0] as { ok: boolean }).ok, true);
});

test("worker start: an injected importer registers neither the policy nor the resolver", async () => {
  const order: string[] = [];
  await startTier2Worker(
    {
      workerData: probe("/plugins/t2/server/index.mjs", "/plugins/t2"), parentPort: { postMessage: () => undefined }, binding,
      registerSdkResolver: () => order.push("resolver"), realImport: async () => { order.push("real"); return {}; },
    },
    { importPolicy: { sdkSpecifiers: SDK }, importModule: async () => { order.push("injected"); return {}; }, registerImportPolicy: () => order.push("policy") },
  );
  assert.deepEqual(order, ["injected"]);
});

test("policy data: a built-in whose entry sits directly in its sourceDir is its own package, not the whole built-ins folder", async () => {
  await withPackage(async (root) => {
    const sourceDir = path.join(root, "built-ins", "content-analyzer");
    const analyzer = await touch(path.join(sourceDir, "index.mjs"));
    const siblingDir = path.join(root, "built-ins", "other");
    const sibling = await touch(path.join(siblingDir, "index.mjs"));
    const policy: Tier2ImportPolicy = { sdkSpecifiers: SDK, trustedImports: [{ entryPath: analyzer, specifiers: ["@example/cms/seo"] }] };
    const data = tier2ImportPolicyData({ entryPath: analyzer, packageRoot: sourceDir, policy });
    assert.equal(data.packageUrl, `${pathToFileURL(sourceDir).href}/`);
    assert.deepEqual(data.allowedSpecifiers, [...SDK, "@example/cms/seo"]);
    const siblingData = tier2ImportPolicyData({ entryPath: sibling, packageRoot: siblingDir, policy });
    assert.equal(siblingData.packageUrl, `${pathToFileURL(siblingDir).href}/`, "a sibling built-in is not inside the analyzer's package");
    assert.deepEqual(siblingData.allowedSpecifiers, [...SDK], "extra trust stays keyed to the exact entry");
  });
});

test("policy data: an entry outside the registered package root (or the root itself) is refused in plain words", async () => {
  await withPackage(async (root, entry) => {
    const elsewhere = path.join(root, "elsewhere");
    await mkdir(elsewhere, { recursive: true });
    const policy: Tier2ImportPolicy = { sdkSpecifiers: SDK };
    assert.throws(() => tier2ImportPolicyData({ entryPath: entry, packageRoot: elsewhere, policy }), /is not inside its registered package/);
    assert.throws(() => tier2ImportPolicyData({ entryPath: root, packageRoot: root, policy }), /is not inside its registered package/);
  });
});

test("policy data (realpath): a package root reached through a symlink still contains its entry, as the real root's URL", async () => {
  await withPackage(async (root, entry) => {
    const link = `${root}-link`;
    await symlink(root, link, "dir");
    try {
      const realRoot = await realpath(root);
      const policy: Tier2ImportPolicy = { sdkSpecifiers: SDK, trustedImports: [{ entryPath: path.join(link, "server", "index.mjs"), specifiers: ["@example/extra"] }] };
      const expected = { packageUrl: `${pathToFileURL(realRoot).href}/`, allowedSpecifiers: [...SDK, "@example/extra"], sdkSpecifiers: [...SDK] };
      // Linked root + linked entry, linked root + real entry, real root + linked entry: one answer.
      assert.deepEqual(tier2ImportPolicyData({ entryPath: path.join(link, "server", "index.mjs"), packageRoot: link, policy }), expected);
      assert.deepEqual(tier2ImportPolicyData({ entryPath: entry, packageRoot: link, policy }), expected);
      assert.deepEqual(tier2ImportPolicyData({ entryPath: pathToFileURL(path.join(link, "server", "index.mjs")).href, packageRoot: root, policy }), expected);
    } finally {
      await rm(link, { force: true });
    }
  });
});

test("policy data (realpath): an entry inside the root that is a symlink to a file outside it is refused", async () => {
  await withPackage(async (root) => {
    const outside = await mkdtemp(path.join(tmpdir(), "jini-tier2-outside-"));
    try {
      const target = await touch(path.join(outside, "index.mjs"));
      const linkedEntry = path.join(root, "server", "linked.mjs");
      await symlink(target, linkedEntry, "file");
      assert.throws(
        () => tier2ImportPolicyData({ entryPath: linkedEntry, packageRoot: root, policy: { sdkSpecifiers: SDK } }),
        /is not inside its registered package/,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("worker start: the pre-policy call shape still works — resolver, then import, and no policy registered", async () => {
  const order: string[] = [];
  const posted: unknown[] = [];
  // Exactly the fields an existing host passed before the policy existed.
  const legacyRequired = {
    workerData: probe("/plugins/t2/server/index.mjs"), parentPort: { postMessage: (m: unknown) => posted.push(m) }, binding,
    registerSdkResolver: () => order.push("resolver"),
    realImport: async (p: string) => { order.push(`import ${p}`); return { default: definePlugin({ setup: () => undefined }) }; },
  };
  await startTier2Worker(legacyRequired, { registerImportPolicy: () => order.push("policy") });
  assert.deepEqual(order, ["resolver", "import /plugins/t2/server/index.mjs"]);
  assert.equal((posted[0] as { ok: boolean }).ok, true);
});

test("worker start: a policy without a host-registered package root fails closed at the import stage", async () => {
  const order: string[] = [];
  const posted: unknown[] = [];
  await startTier2Worker(
    {
      workerData: probe("/plugins/t2/server/index.mjs"), parentPort: { postMessage: (m) => posted.push(m) }, binding,
      registerSdkResolver: () => order.push("resolver"), realImport: async () => { order.push("import"); return {}; },
    },
    { importPolicy: { sdkSpecifiers: SDK }, registerImportPolicy: () => order.push("policy") },
  );
  assert.deepEqual(order, []);
  assert.equal((posted[0] as { stage: string }).stage, "import");
  assert.match((posted[0] as { error: string }).error, /package root/);
});
