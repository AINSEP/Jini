import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
/** A bundled plugin's source folder in this package (`packages/agent-plugins/<pluginId>`). */
const agentPluginSourceDir = ({ pluginId }: { pluginId: string }) => fileURLToPath(new URL(`../../../${pluginId}`, import.meta.url));


import {
  createBundledSourceManifestReader, parseSupersedes, readSupersessions,
  supersededDescriptorRefusal, supersededPackageRefusal, type PluginSupersession,
} from "../supersession.js";

/**
 * @file `supersession.ts`: the replacing plugin's own `extensions.jini.supersedes` declaration, read
 * generically from trusted verdicts. The cloudflare cases pin the exact refusal lines existing
 * installs already produce, now sourced from the bundled manifest instead of core.
 */

const manifest = (supersedes: unknown) => JSON.stringify({ name: "p", extensions: { jini: { supersedes } } });
const ENTRY = { fromPlugins: ["a"], descriptorId: "d", label: "thing" };

test("parseSupersedes reads a full declaration and defaults omitted lists to empty", () => {
  assert.deepEqual(parseSupersedes({ manifestText: manifest({ packages: ["x"], contributions: [ENTRY] }) }), { packages: ["x"], contributions: [ENTRY] });
  assert.deepEqual(parseSupersedes({ manifestText: manifest({}) }), { packages: [], contributions: [] });
});

test("parseSupersedes reads no declaration from missing, unparsable or undeclaring manifests", () => {
  for (const manifestText of [undefined, "{not json", "[]", JSON.stringify({ name: "p" }), JSON.stringify({ extensions: { other: {} } }),
    JSON.stringify({ extensions: { jini: {} } }), manifest(["x"])]) {
    assert.equal(parseSupersedes({ manifestText }), undefined, String(manifestText));
  }
});

test("parseSupersedes drops a declaration with any malformed part rather than half-applying it", () => {
  for (const supersedes of [{ packages: "x" }, { packages: [1] }, { contributions: {} }, { contributions: [null] },
    { contributions: [{ ...ENTRY, fromPlugins: "a" }] }, { contributions: [{ ...ENTRY, descriptorId: 1 }] }, { contributions: [{ ...ENTRY, label: null }] },
    { contributions: [ENTRY, []] }]) {
    assert.equal(parseSupersedes({ manifestText: manifest(supersedes) }), undefined, JSON.stringify(supersedes));
  }
});

test("readSupersessions prefers the installed manifest, falls back to the bundled source, and skips refusals", async () => {
  const installed: Record<string, string> = { fresh: manifest({ packages: ["old-fresh"] }), stale: JSON.stringify({ name: "stale" }) };
  const source: Record<string, string> = { fresh: manifest({ packages: ["ignored"] }), stale: manifest({ packages: ["old-stale"] }) };
  const read = (table: Record<string, string>, id: string) => table[id] === undefined ? Promise.reject(new Error("ENOENT")) : Promise.resolve(table[id]!);
  const supersessions = await readSupersessions({
    verdicts: [{ refusal: "nope" }, ...["fresh", "stale", "absent"].map(pluginId => ({ trusted: { pluginId, packageRoot: `/r/${pluginId}` } }))],
    manifests: { readInstalled: ({ plugin }) => read(installed, plugin.pluginId), readBundledSource: ({ pluginId }) => read(source, pluginId) },
  });
  assert.deepEqual(supersessions, [
    { successorId: "fresh", packages: ["old-fresh"], contributions: [] },
    { successorId: "stale", packages: ["old-stale"], contributions: [] },
  ]);
});

test("refusal lines name the package or descriptor, the label and the trusted successor; anything else passes", () => {
  const supersessions: readonly PluginSupersession[] = [
    { successorId: "first", packages: [], contributions: [{ fromPlugins: ["other"], descriptorId: "d", label: "thing" }] },
    { successorId: "second", packages: ["old"], contributions: [ENTRY] },
  ];
  assert.equal(supersededPackageRefusal({ supersessions, pluginId: "old" }), "contributions from 'old' were superseded by trusted 'second'");
  assert.equal(supersededPackageRefusal({ supersessions, pluginId: "a" }), undefined);
  assert.equal(supersededDescriptorRefusal({ supersessions, pluginId: "a", descriptor: { id: "d" } }), "thing 'd' is provided by the trusted 'second' replacement");
  assert.equal(supersededDescriptorRefusal({ supersessions, pluginId: "a", descriptor: { id: "e" } }), undefined);
  assert.equal(supersededDescriptorRefusal({ supersessions, pluginId: "b", descriptor: { id: "d" } }), undefined);
  assert.equal(supersededDescriptorRefusal({ supersessions, pluginId: "a", descriptor: null }), undefined);
  assert.equal(supersededDescriptorRefusal({ supersessions, pluginId: "a", descriptor: "d" }), undefined);
});

test("the bundled source reader propagates a missing supplied root without discovering another", async () => {
  const failure = new Error("missing supplied root");
  const paths: string[] = [];
  const reader = createBundledSourceManifestReader({ bundledSourceRoot: "/missing" }, {
    readText: async file => { paths.push(file); throw failure; },
  });
  await assert.rejects(reader({ pluginId: "example" }), error => error === failure);
  assert.deepEqual(paths, [path.join("/missing", "example", "plugin.json")]);
});

test("the bundled source reader reads <root>/<id>/plugin.json and refuses ids that are not one path segment", async () => {
  const paths: string[] = [];
  const reader = createBundledSourceManifestReader({ bundledSourceRoot: "/root" }, { readText: async filePath => { paths.push(filePath); return "{}"; } });
  assert.equal(await reader({ pluginId: "ok" }), "{}");
  assert.deepEqual(paths, [path.join("/root", "ok", "plugin.json")]);
  for (const pluginId of ["", ".", "..", "a/b"]) {
    await assert.rejects(() => reader({ pluginId }), /is not a bundled plugin directory name/, pluginId);
  }
  assert.deepEqual(paths.length, 1);
});

test("the shipped cloudflare manifest declares exactly the supersession core used to hard-code", async () => {
  // cloudflare ships from @jini-ai/agent-plugins/cloudflare (D-W3): the reader takes the folder holding it.
  const reader = createBundledSourceManifestReader({ bundledSourceRoot: path.dirname(agentPluginSourceDir({ pluginId: "cloudflare" })) });
  const supersessions = await readSupersessions({ verdicts: [{ trusted: { pluginId: "cloudflare", packageRoot: "/unused" } }],
    manifests: { readInstalled: () => Promise.reject(new Error("an old install predates the declaration")), readBundledSource: reader } });
  assert.equal(supersededPackageRefusal({ supersessions, pluginId: "cloudflare-pages" }), "contributions from 'cloudflare-pages' were superseded by trusted 'cloudflare'");
  for (const pluginId of ["deploy", "cloudflare-pages"]) {
    assert.equal(supersededDescriptorRefusal({ supersessions, pluginId, descriptor: { id: "cloudflare-pages" } }),
      "deploy target 'cloudflare-pages' is provided by the trusted 'cloudflare' replacement");
  }
  assert.equal(supersededPackageRefusal({ supersessions, pluginId: "deploy" }), undefined);
  assert.equal(supersededDescriptorRefusal({ supersessions, pluginId: "deploy", descriptor: { id: "netlify" } }), undefined);
  assert.equal(supersededDescriptorRefusal({ supersessions, pluginId: "cloudflare", descriptor: { id: "cloudflare-pages" } }), undefined);
});
