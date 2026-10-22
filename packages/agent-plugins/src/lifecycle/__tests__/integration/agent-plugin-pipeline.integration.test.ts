import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "../legacy-test.js";

import { forceRemove } from "../fixtures/force-remove.js";
import { readInstalledSkillMarkdown } from "../test-support.js";

import { installAgentPlugin } from "../test-support.js";
import { type AgentPluginArchiveEntry, type AgentPluginArchiveReaderPort } from "../../install.js";
import { resolveAgentPluginLayout } from "../test-support.js";

import { parseAgentPluginMcpConfig } from "../test-support.js";


/**
 * @file End-to-end proof that layout + install + manifest + capability-projection compose into one
 * coherent slice, not four units that only pass in isolation. Mirrors a real caller's own sequence:
 * resolve where bytes go, extract+verify an archive, parse its optional `mcp.json`, and read the
 * installed files back through the same containment guarantee — no step here reaches around another
 * (no direct disk reads bypassing `package-paths.ts`'s containment check, no hand-built
 * `InstalledAgentPlugin` fixture).
 */

function fileEntry(entryPath: string, content: string): AgentPluginArchiveEntry {
  const bytes = Buffer.from(content, "utf8");
  return {
    kind: "file",
    entryPath,
    declaredSize: bytes.byteLength,
    executable: false,
    async *openReadStream() {
      yield bytes;
    },
  };
}

function reader(entries: readonly AgentPluginArchiveEntry[]): AgentPluginArchiveReaderPort {
  return {
    async *entries() {
      yield* entries;
    },
  };
}

test("install -> parse mcp.json -> read installed files through the containment guarantee, end to end, for a plugin with both a skill and an MCP server", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "host-agent-plugin-pipeline-test-"));
  try {
    const instanceLayout = resolveAgentPluginLayout({ cwd, env: {} });
    const workspaceId = "11111111-1111-4111-8111-111111111111";

    const manifest = JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "ui-ux-design",
      version: "1.1.0",
      description: "AI Dev Shop UI/UX and interface design guidance.",
    });
    const mcpConfig = JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: { main: { type: "stdio", command: "./server/index.js" } },
    });
    const skillMarkdown = "# UI/UX Design\n\nGuidance for interface work.";

    const archive = new Uint8Array(Buffer.from("integration-fixture-archive"));
    const digest = createHash("sha256").update(archive).digest("hex");

    const installed = await installAgentPlugin({
      archive,
      expectedSha256: digest,
      archiveReader: reader([
        fileEntry("plugin.json", manifest),
        fileEntry("mcp.json", mcpConfig),
        fileEntry("skills/ui-ux-design/SKILL.md", skillMarkdown),
      ]),
      layout: instanceLayout,
      workspaceId,
    });

    assert.equal(installed.pluginId, "ui-ux-design");

    // A real caller reads mcp.json THROUGH the same containment guarantee installed skills use —
    // proving `readInstalledSkillMarkdown`'s containment primitive generalizes to any installed file,
    // not only the one path shape its own unit tests exercise.
    const mcpConfigRaw = await readInstalledSkillMarkdown(installed.packageRoot, "mcp.json");
    const parsedMcp = parseAgentPluginMcpConfig(JSON.parse(mcpConfigRaw));
    assert.equal(parsedMcp.ok, true);
    const mcpServerIds = parsedMcp.ok ? parsedMcp.config.serverIds : [];
    assert.deepEqual(mcpServerIds, ["main"]);

    // The same primitive reads a skill's authored markdown back byte-for-byte, at its real
    // package-relative path.
    const readBackSkill = await readInstalledSkillMarkdown(installed.packageRoot, "skills/ui-ux-design/SKILL.md");
    assert.equal(readBackSkill, skillMarkdown);

    // Re-installing the SAME archive bytes (as a second workspace "installing" the same plugin@version
    // would) still deduplicates publication — Layout B stages again to identify the plugin before
    // choosing its content-addressed directory. The installed root and contents stay unchanged.
    const secondInstall = await installAgentPlugin({
      archive,
      expectedSha256: digest,
      archiveReader: reader([
        fileEntry("plugin.json", manifest),
        fileEntry("mcp.json", mcpConfig),
        fileEntry("skills/ui-ux-design/SKILL.md", skillMarkdown),
      ]),
      layout: instanceLayout,
      workspaceId,
    });
    assert.equal(secondInstall.packageRoot, installed.packageRoot);
    assert.deepEqual(secondInstall, installed);
  } finally {
    await forceRemove(cwd);
  }
});
