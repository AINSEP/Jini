/**
 * @file Agent Plugins 1.1.0 support in `parseAgentPluginManifest()` / `parseAgentPluginMcpConfig()`.
 *
 * 1.1.0 changes only the `$schema` identifiers (spec text and both schemas otherwise match 1.0.0),
 * so these tests pin version selection: a real 1.1.0 package parses and installs, 1.1.0 grammar
 * violations are still refused, 1.0.0 keeps working, a plugin.json/mcp.json version mismatch
 * disables MCP (§10), an unknown 1.x is read with the newest known grammar plus one warning, and
 * a different major is refused.
 *
 * The fixture is Open Marketing's `content/agent-plugins/higgsfield-media` plugin.json + mcp.json,
 * copied verbatim at Open Marketing commit 13bbfa9.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "../legacy-test.js";
import { forceRemove } from "../fixtures/force-remove.js";
import { installAgentPlugin, resolveAgentPluginLayout } from "../test-support.js";
import type { AgentPluginArchiveEntry } from "../../install.js";
import { parseAgentPluginManifest, parseAgentPluginMcpConfig } from "../../manifest.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/open-marketing-higgsfield-media-1.1.0");
const OM_PLUGIN_TEXT = readFileSync(path.join(FIXTURE, "plugin.json"), "utf8");
const OM_PLUGIN = JSON.parse(OM_PLUGIN_TEXT) as Record<string, unknown>;
const OM_MCP = JSON.parse(readFileSync(path.join(FIXTURE, "mcp.json"), "utf8")) as Record<string, unknown>;
const OM_NAMESPACE = "io.github.ainsep.openmarketing";

const PLUGIN_1_0_0 = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const PLUGIN_1_1_0 = "https://agent-plugins.org/schemas/1.1.0/plugin.schema.json";
const MCP_1_0_0 = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const MCP_1_1_0 = "https://agent-plugins.org/schemas/1.1.0/mcp.schema.json";

function parseMcp(value: unknown, pluginManifest?: unknown) {
  return parseAgentPluginMcpConfig({ value, extensionNamespace: OM_NAMESPACE }, { pluginManifest });
}

test("a real 1.1.0 plugin.json (Open Marketing higgsfield-media) parses with its extension namespace intact", () => {
  assert.equal(OM_PLUGIN.$schema, PLUGIN_1_1_0);
  const result = parseAgentPluginManifest({ value: OM_PLUGIN });
  assert.equal(result.ok, true, result.ok ? "" : result.errors.join("; "));
  if (!result.ok) return;
  assert.equal(result.manifest.name, "higgsfield-media");
  assert.equal(result.manifest.version, "0.1.0");
  assert.deepEqual(Object.keys(result.manifest.extensions ?? {}), [OM_NAMESPACE]);
  assert.deepEqual(result.warnings.filter((warning) => warning.startsWith("unrecognized")), []);
});

test("a real 1.1.0 mcp.json parses its closed streamable-http server alongside its 1.1.0 plugin.json", () => {
  assert.equal(OM_MCP.$schema, MCP_1_1_0);
  const result = parseMcp(OM_MCP, OM_PLUGIN);
  assert.equal(result.ok, true, result.ok ? "" : result.errors.join("; "));
  if (!result.ok) return;
  assert.deepEqual(result.config.serverIds, ["higgsfield"]);
  assert.deepEqual(result.config.servers.higgsfield, { type: "streamable-http", url: "https://mcp.higgsfield.ai/mcp" });
});

test("a 1.1.0 stdio server keeps its ${PLUGIN_ROOT} placeholders verbatim for the launcher to expand", () => {
  const result = parseMcp({
    $schema: MCP_1_1_0,
    mcpServers: { local: { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/bin/server.mjs"], cwd: "${PLUGIN_ROOT}" } },
  }, { $schema: PLUGIN_1_1_0, name: "local-tools" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.config.servers.local, { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/bin/server.mjs"], cwd: "${PLUGIN_ROOT}" });
});

test("installAgentPlugin publishes a 1.1.0 package (the installer no longer pins 1.0.0)", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "host-agent-plugin-1-1-0-test-"));
  try {
    const archive = new Uint8Array(Buffer.from("archive-bytes-1.1.0"));
    const entries = [["plugin.json", OM_PLUGIN_TEXT], ["skills/higgsfield/SKILL.md", "# Higgsfield\n"]].map(([entryPath, text]) => {
      const bytes = Buffer.from(text!, "utf8");
      return { kind: "file", entryPath, declaredSize: bytes.byteLength, executable: false, async *openReadStream() { yield bytes; } } as AgentPluginArchiveEntry;
    });
    const installed = await installAgentPlugin({
      archive,
      expectedSha256: createHash("sha256").update(archive).digest("hex"),
      archiveReader: { async *entries() { yield* entries; } },
      layout: resolveAgentPluginLayout({ cwd, env: {} }),
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    assert.equal(installed.pluginId, "higgsfield-media");
    assert.equal(installed.license, "Apache-2.0");
  } finally {
    await forceRemove(cwd);
  }
});

test("1.1.0 grammar violations are still refused with the field named", () => {
  const badName = parseAgentPluginManifest({ value: { ...OM_PLUGIN, name: "Higgsfield Media" } });
  assert.equal(badName.ok, false);
  if (!badName.ok) assert.match(badName.errors.join("\n"), /'name' \('Higgsfield Media'\) must be 1-64 lowercase/);

  const noName = parseAgentPluginManifest({ value: { $schema: PLUGIN_1_1_0 } });
  assert.equal(noName.ok, false);
  if (!noName.ok) assert.deepEqual(noName.errors, ["plugin.json 'name' is required and must be a string"]);

  const noServers = parseMcp({ $schema: MCP_1_1_0 }, OM_PLUGIN);
  assert.equal(noServers.ok, false);
  if (!noServers.ok) assert.deepEqual(noServers.errors, ["mcp.json 'mcpServers' is required and must be an object"]);
});

test("a malformed 1.1.0 server entry is excluded without failing the file (§7.2.2 fail-open)", () => {
  const result = parseMcp({
    $schema: MCP_1_1_0,
    mcpServers: {
      reserved: { type: "stdio", command: "node", env: { PLUGIN_ROOT: "/elsewhere" } },
      unknown: { type: "websocket", url: "wss://example.com" },
      remote: { type: "sse", url: "https://example.com/sse" },
    },
  }, { $schema: PLUGIN_1_1_0, name: "mixed" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.config.serverIds, ["reserved", "unknown", "remote"]);
  assert.deepEqual(Object.keys(result.config.servers), ["remote"]);
});

test("1.0.0 manifests and MCP configs parse exactly as before", () => {
  const manifest = parseAgentPluginManifest({ value: { $schema: PLUGIN_1_0_0, name: "ui-ux-design" } });
  assert.equal(manifest.ok, true);
  const mcp = parseMcp({ $schema: MCP_1_0_0, mcpServers: { main: { type: "stdio", command: "./server.js" } } }, { $schema: PLUGIN_1_0_0, name: "ui-ux-design" });
  assert.equal(mcp.ok, true);
  if (mcp.ok) assert.deepEqual(mcp.config.servers.main, { type: "stdio", command: "./server.js" });
});

test("mcp.json is refused when its version differs from plugin.json's, in either direction (§10)", () => {
  const older = parseMcp({ ...OM_MCP, $schema: MCP_1_0_0 }, OM_PLUGIN);
  assert.equal(older.ok, false);
  if (!older.ok) assert.deepEqual(older.errors, ["mcp.json targets Agent Plugins 1.0.0 but plugin.json targets 1.1.0; the versions must match"]);

  const newer = parseMcp(OM_MCP, { $schema: PLUGIN_1_0_0, name: "higgsfield-media" });
  assert.equal(newer.ok, false);
  if (!newer.ok) assert.deepEqual(newer.errors, ["mcp.json targets Agent Plugins 1.1.0 but plugin.json targets 1.0.0; the versions must match"]);
});

test("mcp.json alone (no plugin.json supplied) is checked only against the supported versions", () => {
  assert.equal(parseMcp(OM_MCP).ok, true);
});

for (const schema of [
  "https://agent-plugins.org/schemas/1.1/plugin.schema.json",
  "http://agent-plugins.org/schemas/1.1.0/plugin.schema.json",
  MCP_1_1_0,
  undefined,
]) {
  test(`plugin.json refuses the non-canonical $schema '${schema}' and lists the accepted identifiers`, () => {
    const result = parseAgentPluginManifest({ value: { ...OM_PLUGIN, $schema: schema } });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.errors, [
        `plugin.json '$schema' must be '${PLUGIN_1_0_0}' or '${PLUGIN_1_1_0}' (Agent Plugins 1.0.0, 1.1.0, or another 1.x), got '${schema}'`,
      ]);
    }
  });
}

for (const version of ["1.2.0", "1.5.3"]) {
  test(`an unknown newer ${version} is read with the 1.1.0 grammar and exactly one warning naming the version`, () => {
    const pluginManifest = { ...OM_PLUGIN, $schema: `https://agent-plugins.org/schemas/${version}/plugin.schema.json` };
    const manifest = parseAgentPluginManifest({ value: pluginManifest });
    assert.equal(manifest.ok, true);
    if (manifest.ok) {
      assert.deepEqual(manifest.warnings.filter((warning) => warning.includes("Agent Plugins")), [
        `plugin.json targets Agent Plugins ${version}, newer than this loader knows; validated with the 1.1.0 grammar`,
      ]);
    }
    const mcp = parseMcp({ ...OM_MCP, $schema: `https://agent-plugins.org/schemas/${version}/mcp.schema.json` }, pluginManifest);
    assert.equal(mcp.ok, true);
    if (mcp.ok) assert.deepEqual(Object.keys(mcp.config.servers), ["higgsfield"]);
  });
}

test("an unknown 1.x still enforces the known grammar (bad name refused, unknown top-level field only warns)", () => {
  const schema = "https://agent-plugins.org/schemas/1.2.0/plugin.schema.json";
  const badName = parseAgentPluginManifest({ value: { $schema: schema, name: "Not Valid" } });
  assert.equal(badName.ok, false);
  const extra = parseAgentPluginManifest({ value: { $schema: schema, name: "ok", futureField: true } });
  assert.equal(extra.ok, true);
  if (extra.ok) assert.ok(extra.warnings.includes("unrecognized plugin.json field 'futureField' (ignored per spec)"));
});

test("a 1.2.0 mcp.json is refused beside a 1.1.0 plugin.json (versions must still match)", () => {
  const result = parseMcp({ ...OM_MCP, $schema: "https://agent-plugins.org/schemas/1.2.0/mcp.schema.json" }, OM_PLUGIN);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.errors, ["mcp.json targets Agent Plugins 1.2.0 but plugin.json targets 1.1.0; the versions must match"]);
});

for (const version of ["2.0.0", "0.9.0"]) {
  test(`a different major (${version}) is refused as an unsupported major version`, () => {
    const manifest = parseAgentPluginManifest({ value: { ...OM_PLUGIN, $schema: `https://agent-plugins.org/schemas/${version}/plugin.schema.json` } });
    assert.equal(manifest.ok, false);
    if (!manifest.ok) assert.deepEqual(manifest.errors, [`plugin.json targets Agent Plugins ${version}, an unsupported major version (supported: 1.x)`]);
    const mcp = parseMcp({ ...OM_MCP, $schema: `https://agent-plugins.org/schemas/${version}/mcp.schema.json` });
    assert.equal(mcp.ok, false);
    if (!mcp.ok) assert.deepEqual(mcp.errors, [`mcp.json targets Agent Plugins ${version}, an unsupported major version (supported: 1.x)`]);
  });
}
