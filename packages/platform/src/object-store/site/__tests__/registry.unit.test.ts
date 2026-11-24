import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";

import { OBJECT_STORE_CONTRACT } from "@jini-ai/core/object-store";

import {
  loadBundledObjectStoreRegistry, loadObjectStoreRegistry, OBJECT_STORES_FILENAME, readBundledObjectStoreEnvDeclarations,
  type LoadedObjectStoreContributions, type ObjectStoreContributionPorts, type ObjectStoreContributionSpec, type SiteObjectStoreProvider,
} from "../registry.js";

/**
 * @file The generic site object-store registry loader with fake contribution ports: `local` is
 * seeded and default, plugin items reach the registry through the injected `contributeProviders`,
 * the injected `defineProviderContribution` receives the object-store spec, and bundled env
 * declarations are read in order and refused on a duplicate selector or an invalid manifest.
 * The real agent-plugins seam and the shipped bundle are exercised by the host's wiring tests.
 */

type Host = { readonly tag: string };
const fakeProvider = (): SiteObjectStoreProvider<Host> => ({ create: () => { throw new Error("not called"); } });

const specs: ObjectStoreContributionSpec<Host>[] = [];
const ports: ObjectStoreContributionPorts<Host, ObjectStoreContributionSpec<Host>> = {
  defineProviderContribution: (spec) => { specs.push(spec); return spec; },
  contributeProviders: ({ registry, loaded }) => {
    const before = registry.refusals().length;
    for (const item of loaded.items) registry.contribute({ definition: item.definition, pluginId: item.pluginId, contract: item.contract });
    return { refusals: [...loaded.refusals, ...registry.refusals().slice(before).map((refusal) => refusal.message)] };
  },
};

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "jini-object-store-site-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  specs.length = 0;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("loadObjectStoreRegistry: local is seeded and default; plugin items are contributed; loader and registry refusals merge in order", async () => {
  const uploadsDir = await tempDir();
  const pluginProvider = fakeProvider();
  const calls: unknown[] = [];
  const loadContributions = async (input: { readonly workspaceId: string; readonly definition: ObjectStoreContributionSpec<Host> }, optional: { readonly orderByPluginId: boolean }): Promise<LoadedObjectStoreContributions<Host>> => {
    calls.push({ workspaceId: input.workspaceId, filename: input.definition.filename, contract: input.definition.contract, optional });
    return {
      items: [
        { contract: OBJECT_STORE_CONTRACT, pluginId: "gcs", definition: { id: "gcs_bucket", provider: pluginProvider, label: "GCS" } },
        { contract: OBJECT_STORE_CONTRACT, pluginId: "rogue", definition: { id: "local", provider: fakeProvider() } },
      ],
      refusals: ["loader refusal"],
    };
  };

  const { registry, refusals } = await loadObjectStoreRegistry({ workspaceId: "ws-1", uploadsDir, loadContributions, ...ports });

  assert.deepEqual(calls, [{ workspaceId: "ws-1", filename: OBJECT_STORES_FILENAME, contract: OBJECT_STORE_CONTRACT, optional: { orderByPluginId: true } }]);
  assert.equal(registry.getDefault()?.id, "local");
  assert.equal(registry.get({ id: "local" })?.label, "This server's disk");
  assert.equal(registry.get({ id: "gcs_bucket" })?.provider, pluginProvider);
  assert.deepEqual(registry.list().map((entry) => entry.id), ["local", "gcs_bucket"]);
  assert.equal(refusals[0], "loader refusal");
  assert.equal(refusals.length, 2);
  assert.match(refusals[1]!, /rogue/);
});

test("the contribution spec parses the object-stores manifest and validates exports as providers", async () => {
  await loadObjectStoreRegistry({ workspaceId: "ws", uploadsDir: await tempDir(), loadContributions: async () => ({ items: [], refusals: [] }), ...ports });
  const [spec] = specs;
  assert.ok(spec);
  assert.deepEqual(spec.parse({ raw: JSON.stringify({ schemaVersion: 1, providers: [{ id: "a", module: "a.mjs" }] }) }), { ok: true, descriptors: [{ id: "a", module: "a.mjs" }] });
  const provider = fakeProvider();
  assert.equal(spec.validate({ exported: provider }), provider);
  assert.equal(typeof spec.validate({ exported: { notCreate: true } }), "string");
});

test("loadObjectStoreRegistry: the seeded local provider writes under uploadsDir", async () => {
  const uploadsDir = await tempDir();
  const { registry } = await loadObjectStoreRegistry({ workspaceId: "ws", uploadsDir, loadContributions: async () => ({ items: [], refusals: [] }), ...ports });
  const created = registry.get({ id: "local" })!.provider.create({ settings: {}, host: { tag: "unused" } });
  assert.equal(created.status, "ok");
  if (created.status !== "ok") return;
  await created.value.put({ key: "ws/a/blobs/ab/abc", bytes: new Uint8Array([1, 2, 3]) });
  assert.deepEqual(new Uint8Array(await readFile(path.join(uploadsDir, "ws/a/blobs/ab/abc"))), new Uint8Array([1, 2, 3]));
});

test("loadBundledObjectStoreRegistry: each bundled source is loaded with the shared definition and its refusals collected", async () => {
  const seen: unknown[] = [];
  const good = fakeProvider();
  const { registry, refusals } = await loadBundledObjectStoreRegistry({
    uploadsDir: "/nonexistent-uploads", sourceRoot: "/bundle", ...ports,
    bundledContributionSources: ({ sourceRoot, filename }) => { seen.push({ sourceRoot, filename }); return [{ pluginId: "a", packageRoot: "/bundle/a" }, { pluginId: "b", packageRoot: "/bundle/b" }]; },
    loadPluginContributionsFromSource: async ({ plugin, definition }) => {
      seen.push({ pluginId: plugin.pluginId, filename: definition.filename });
      return plugin.pluginId === "a" ? { items: [], refusals: ["a refused"] } : { items: [{ contract: OBJECT_STORE_CONTRACT, pluginId: "b", definition: { id: "good_store", provider: good } }], refusals: [] };
    },
  });
  assert.deepEqual(seen, [{ sourceRoot: "/bundle", filename: OBJECT_STORES_FILENAME }, { pluginId: "a", filename: OBJECT_STORES_FILENAME }, { pluginId: "b", filename: OBJECT_STORES_FILENAME }]);
  assert.deepEqual(refusals, ["a refused"]);
  assert.deepEqual(registry.list().map((entry) => entry.id), ["local", "good_store"]);
});

const env = (selector: string) => ({ selector, settings: { bucket: "B_BUCKET" }, credentialFields: { region: "B_REGION" }, secret: "B_SECRET", required: ["B_BUCKET", "B_REGION", "B_SECRET"] });

async function bundleWith(manifests: Record<string, unknown>): Promise<{ root: string; sources: () => { pluginId: string; packageRoot: string }[] }> {
  const root = await tempDir();
  for (const [pluginId, manifest] of Object.entries(manifests)) {
    await mkdir(path.join(root, pluginId), { recursive: true });
    await writeFile(path.join(root, pluginId, OBJECT_STORES_FILENAME), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  }
  return { root, sources: () => Object.keys(manifests).map((pluginId) => ({ pluginId, packageRoot: path.join(root, pluginId) })) };
}

test("readBundledObjectStoreEnvDeclarations: declarations come back in order with their provider id; undeclared providers are skipped", async () => {
  const bundle = await bundleWith({
    a: { schemaVersion: 1, providers: [{ id: "a_store", module: "a.mjs", env: env("a") }, { id: "plain", module: "p.mjs" }] },
    b: { schemaVersion: 1, providers: [{ id: "b_store", module: "b.mjs", env: env("b") }] },
  });
  const entries = readBundledObjectStoreEnvDeclarations({ sourceRoot: bundle.root, bundledContributionSources: bundle.sources });
  assert.deepEqual(entries, [{ ...env("a"), providerId: "a_store" }, { ...env("b"), providerId: "b_store" }]);
});

test("readBundledObjectStoreEnvDeclarations: an invalid manifest or a duplicate selector throws", async () => {
  const invalid = await bundleWith({ bad: "{ nope" });
  assert.throws(() => readBundledObjectStoreEnvDeclarations({ sourceRoot: invalid.root, bundledContributionSources: invalid.sources }), { message: "Object store env declarations from 'bad' were not loaded: not valid JSON" });
  const duplicate = await bundleWith({
    a: { schemaVersion: 1, providers: [{ id: "a_store", module: "a.mjs", env: env("s3") }] },
    b: { schemaVersion: 1, providers: [{ id: "b_store", module: "b.mjs", env: env("s3") }] },
  });
  assert.throws(() => readBundledObjectStoreEnvDeclarations({ sourceRoot: duplicate.root, bundledContributionSources: duplicate.sources }), { message: "Object store env selector 's3' is declared twice." });
});
