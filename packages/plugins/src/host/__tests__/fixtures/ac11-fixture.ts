import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { BuiltInPluginSource } from "../support/discovery.js";
import type { PluginManifest } from "../../manifest.js";

/**
 * @file The shared "AC-11 fixture" — built-in `word-count` plus one valid and one invalid site
 * plugin — reused verbatim by `discovery.integration.test.ts` (AC-11) and
 * `plugins-http.integration.test.ts` (AC-18, via the HTTP surface). Also mirrored (as a literal
 * JSON shape, not a shared import — `apps/admin` is a separate package with its own module
 * resolution) by `apps/admin/src/sections/__tests__/Plugins.test.tsx`'s mocked fetch response.
 *
 * RT-009 (Red-Team, v1.1.1 amendment pass): AC-18 explicitly reuses "the AC-11 fixture." Per the
 * 1.1.1 `plugin.tier` fix, `tier` is now a required manifest field with no safe default — a
 * manifest missing it is unconditionally `invalid` (`MANIFEST_MALFORMED`). This fixture's "valid"
 * site plugin therefore declares `tier: "tier-3"` explicitly, so it does not spuriously become
 * invalid under 1.1.1 and produce the wrong row distribution (two invalid rows instead of one
 * valid + one invalid). The "invalid" site plugin ALSO declares a valid `tier` — its invalidity is
 * isolated to exactly one unrelated condition (an undeclared hook point, `HOOK_UNKNOWN`) so this
 * fixture never conflates the tier concern with the "is this plugin supposed to be invalid" concern.
 */

export const WORD_COUNT_BUILT_IN: BuiltInPluginSource = {
  manifest: {
    id: "word-count",
    name: "Word Count",
    version: "1.0.0",
    sdkRange: "^1.0.0",
    engine: 1,
    tier: "tier-3",
    capabilities: ["content.read", "content.extend", "hooks.attach"],
    hooks: ["content.entry.beforeSave"],
    fields: [{ path: "ext.word-count.count", type: "integer", queryable: false }],
    integrity: {},
  },
};

const VALID_SITE_PLUGIN_MANIFEST: PluginManifest = {
  id: "valid-site-plugin",
  name: "Valid Site Plugin",
  version: "1.0.0",
  sdkRange: "^1.0.0",
  engine: 1,
  tier: "tier-3", // RT-009 — required, no safe default; must be present for this fixture to stay "valid".
  capabilities: ["content.read", "content.extend", "hooks.attach"],
  hooks: ["content.entry.beforeSave"],
  fields: [{ path: "ext.valid-site-plugin.marker", type: "string", queryable: false }],
  integrity: {},
};

const INVALID_SITE_PLUGIN_MANIFEST: PluginManifest = {
  id: "invalid-site-plugin",
  name: "Invalid Site Plugin",
  version: "1.0.0",
  sdkRange: "^1.0.0",
  engine: 1,
  tier: "tier-3", // present and valid — this fixture's invalidity is isolated to the hook below.
  capabilities: ["content.read"],
  hooks: ["content.entry.afterEverything"], // HOOK_UNKNOWN (EC-05) — the sole intended defect.
  fields: [],
  integrity: {},
};

/**
 * Materializes the two site plugins onto disk under a fresh temp `plugins/<id>/1.0.0/` tree
 * (REQ-02's install layout) and returns the install dir path plus the built-in source list, ready
 * to pass straight into `discoverPlugins({ installDir, builtIns })`.
 */
export async function buildAc11FixtureInstallDir(): Promise<{
  installDir: string;
  builtIns: readonly BuiltInPluginSource[];
}> {
  const root = await mkdtemp(path.join(tmpdir(), "tovu-plugin-ac11-"));
  const pluginsDir = path.join(root, "plugins");

  for (const manifest of [VALID_SITE_PLUGIN_MANIFEST, INVALID_SITE_PLUGIN_MANIFEST]) {
    const versionDir = path.join(pluginsDir, manifest.id, manifest.version);
    await mkdir(path.join(versionDir, "server"), { recursive: true });
    await writeFile(path.join(versionDir, "tovu.plugin.json"), JSON.stringify(manifest, null, 2), "utf8");
    await writeFile(
      path.join(versionDir, "server", "index.mjs"),
      "// fixture plugin entry — never real-imported by discovery.ts itself\nexport default {};\n",
      "utf8"
    );
  }

  return { installDir: pluginsDir, builtIns: [WORD_COUNT_BUILT_IN] };
}
