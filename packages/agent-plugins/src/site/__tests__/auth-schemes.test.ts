/** @file Unit tests for `auth-schemes.ts` and `bundled-contribution-sources.ts` over a temp bundled-source root. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";

import { createPluginContributionLoader } from "../../lifecycle/contribution-loader.js";
import { CREDENTIAL_SCHEMES_FILENAME, loadBundledCredentialSchemeRegistry, loadCredentialSchemeRegistry, loadCredentialSchemeRegistryFromSource, type ParseCredentialSchemesFile } from "../auth-schemes.js";
import { listBundledContributionSources } from "../bundled-contribution-sources.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

/** A minimal parser double: `{ schemaVersion: 1, schemes }` or a refusal reason. */
const parseCredentialSchemesFile: ParseCredentialSchemesFile = ({ raw }) => {
  const value = JSON.parse(raw) as { schemaVersion?: number; schemes?: { id: string; prefix: string; scheme: string }[] };
  return value.schemaVersion === 1 && value.schemes ? { ok: true, rules: value.schemes } : { ok: false, reason: "schemaVersion must be 1" };
};

const loader = createPluginContributionLoader({
  findPackages: async () => [],
  readFile: async ({ plugin, filename }) => readFile(path.join(plugin.packageRoot, filename), "utf8"),
  importModule: async () => "no modules",
});
const loadFromSource = loader.loadPluginContributionsFromSource;

async function sourceRoot(packages: Record<string, Record<string, string | null>>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "jini-auth-schemes-"));
  roots.push(root);
  for (const [pluginId, files] of Object.entries(packages)) {
    await mkdir(path.join(root, pluginId), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      if (content === null) await mkdir(path.join(root, pluginId, name));
      else await writeFile(path.join(root, pluginId, name), content);
    }
  }
  return root;
}

const schemes = (...rules: { id: string; prefix: string; scheme: string }[]): string => JSON.stringify({ schemaVersion: 1, schemes: rules });

test("listBundledContributionSources keeps manifest-and-file packages, drops retired ids, and sorts by plugin id", async () => {
  const root = await sourceRoot({
    zeta: { "plugin.json": "{}", "data.json": "{}" }, alpha: { "plugin.json": "{}", "data.json": "{}" },
    retired: { "plugin.json": "{}", "data.json": "{}" }, "no-manifest": { "data.json": "{}" }, "no-file": { "plugin.json": "{}" },
  });
  await writeFile(path.join(root, "loose.json"), "{}");
  const listed = listBundledContributionSources({ sourceRoot: root, filename: "data.json", retired: new Set(["retired"]) });
  assert.deepEqual(listed, [{ pluginId: "alpha", packageRoot: path.join(root, "alpha") }, { pluginId: "zeta", packageRoot: path.join(root, "zeta") }]);
});

test("loadCredentialSchemeRegistryFromSource reads the rules a source package ships", async () => {
  const root = await sourceRoot({ host: { [CREDENTIAL_SCHEMES_FILENAME]: schemes({ id: "a", prefix: "AV1", scheme: "AV1" }) } });
  const registry = await loadCredentialSchemeRegistryFromSource({ pluginId: "host", packageRoot: path.join(root, "host"), loadFromSource, parseCredentialSchemesFile });
  assert.deepEqual(registry, { rules: [{ id: "a", prefix: "AV1", scheme: "AV1" }], refusals: [] });
});

test("loadCredentialSchemeRegistryFromSource: a package without the file contributes nothing; any other read fault propagates", async () => {
  const root = await sourceRoot({ empty: {}, unreadable: { [CREDENTIAL_SCHEMES_FILENAME]: null } });
  assert.deepEqual(await loadCredentialSchemeRegistryFromSource({ pluginId: "empty", packageRoot: path.join(root, "empty"), loadFromSource, parseCredentialSchemesFile }), { rules: [], refusals: [] });
  await assert.rejects(loadCredentialSchemeRegistryFromSource({ pluginId: "unreadable", packageRoot: path.join(root, "unreadable"), loadFromSource, parseCredentialSchemesFile }), { code: "EISDIR" });
});

test("loadBundledCredentialSchemeRegistry unions bundled sources and drops every id more than one plugin declares", async () => {
  const root = await sourceRoot({
    one: { "plugin.json": "{}", [CREDENTIAL_SCHEMES_FILENAME]: schemes({ id: "dup", prefix: "D1", scheme: "D1" }, { id: "keep", prefix: "K1", scheme: "K1" }) },
    two: { "plugin.json": "{}", [CREDENTIAL_SCHEMES_FILENAME]: schemes({ id: "dup", prefix: "D2", scheme: "D2" }) },
  });
  const sources = ({ sourceRoot, filename }: { readonly sourceRoot: string; readonly filename: string }) =>
    listBundledContributionSources({ sourceRoot, filename, retired: new Set() }).map((plugin) => ({ ...plugin }));
  const seenFilenames: string[] = [];
  const registry = await loadBundledCredentialSchemeRegistry({
    sourceRoot: root, loadFromSource, parseCredentialSchemesFile,
    sources: (required) => { seenFilenames.push(required.filename); return sources(required); },
  });
  assert.deepEqual(seenFilenames, [CREDENTIAL_SCHEMES_FILENAME]);
  assert.deepEqual(registry, { rules: [{ id: "keep", prefix: "K1", scheme: "K1" }], refusals: ["credential scheme 'dup' was not loaded: more than one plugin declares it"] });
});

test("loadCredentialSchemeRegistry asks the installed loader to skip the activation gate and reports invalid files", async () => {
  const calls: unknown[] = [];
  const registry = await loadCredentialSchemeRegistry({ workspaceId: "ws", parseCredentialSchemesFile,
    loadContributions: async (input, options) => {
      calls.push({ workspaceId: input.workspaceId, filename: input.definition.filename, options });
      const parsed = input.definition.parse({ raw: JSON.stringify({ schemaVersion: 2 }) });
      return { items: [], refusals: parsed.ok ? [] : [parsed.reason] };
    },
  });
  assert.deepEqual(calls, [{ workspaceId: "ws", filename: CREDENTIAL_SCHEMES_FILENAME, options: { requireActive: false } }]);
  assert.deepEqual(registry, { rules: [], refusals: ["schemaVersion must be 1"] });
});
