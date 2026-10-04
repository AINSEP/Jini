import assert from "node:assert/strict";
import { readInstalledMcpServerIds, readInstalledMcpServers, readInstalledSkillMarkdown } from "../test-support.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "../legacy-test.js";

import { classifyAgentPluginMcpServerTrust } from "../test-support.js";

import type { McpServerConfig } from "../../manifest.js";
import { PackagePathViolation } from "../../package-paths.js";

/**
 * @file `capability-projection.ts`'s real, used half — the `stdio` vs remote MCP trust classifier
 * and the disk readers that turn an installed package into skill markdown / parsed `mcp.json`.
 *
 * The candidate `projectInstalledAgentPluginCapabilities` descriptor projection this file used to
 * cover was removed 2026-09-15 (no production producer or consumer); see that module's own header
 * for why. These tests cover only what production callers actually use.
 */

const REMOTE_SERVER: McpServerConfig = { type: "streamable-http", url: "https://mcp.example.com/mcp" };
const STDIO_SERVER: McpServerConfig = { type: "stdio", command: "./server/index.js" };

test("readInstalledSkillMarkdown reads a real file through the containment check", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-capability-projection-test-"));
  try {
    await mkdir(path.join(root, "skills", "ui-ux-design"), { recursive: true });
    await writeFile(path.join(root, "skills", "ui-ux-design", "SKILL.md"), "# Real content");

    const content = await readInstalledSkillMarkdown(root, "skills/ui-ux-design/SKILL.md");
    assert.equal(content, "# Real content");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readInstalledSkillMarkdown rejects a path escaping the package root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-capability-projection-test-"));
  try {
    await assert.rejects(() => readInstalledSkillMarkdown(root, "../../../etc/passwd"), PackagePathViolation);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("classifyAgentPluginMcpServerTrust: stdio requires confirmation, remote transports auto-admit", () => {
  assert.equal(classifyAgentPluginMcpServerTrust(STDIO_SERVER), "requires-confirmation");
  assert.equal(classifyAgentPluginMcpServerTrust(REMOTE_SERVER), "auto-admit");
  assert.equal(classifyAgentPluginMcpServerTrust({ type: "sse" }), "auto-admit");
});

test("readInstalledMcpServerIds reads a real mcp.json and returns its server ids", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-capability-projection-mcp-test-"));
  try {
    await writeFile(
      path.join(root, "mcp.json"),
      JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: { "fly-cli": { type: "stdio", command: "fly-mcp" }, "another-server": { type: "stdio", command: "x" } },
      }),
    );

    const serverIds = await readInstalledMcpServerIds(root);
    assert.deepEqual([...serverIds].sort(), ["another-server", "fly-cli"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readInstalledMcpServerIds returns an empty array when mcp.json does not exist — optional per spec, not an error", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-capability-projection-mcp-test-"));
  try {
    assert.deepEqual(await readInstalledMcpServerIds(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readInstalledMcpServerIds returns an empty array for malformed JSON — fail-open, matches search's own discovery-tool posture", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-capability-projection-mcp-test-"));
  try {
    await writeFile(path.join(root, "mcp.json"), "{ not valid json");
    assert.deepEqual(await readInstalledMcpServerIds(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readInstalledMcpServerIds returns an empty array for a wrong-schema mcp.json rather than throwing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-capability-projection-mcp-test-"));
  try {
    await writeFile(path.join(root, "mcp.json"), JSON.stringify({ $schema: "wrong", mcpServers: {} }));
    assert.deepEqual(await readInstalledMcpServerIds(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readInstalledMcpServers reads a real mcp.json and returns each server's full validated transport config", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-capability-projection-mcp-test-"));
  try {
    await writeFile(
      path.join(root, "mcp.json"),
      JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: {
          "fly-cli": { type: "stdio", command: "fly-mcp", args: ["deploy"] },
          remote: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
        },
      }),
    );

    const servers = await readInstalledMcpServers(root);
    // A null-prototype map, so a hostile server id such as "__proto__" stays an ordinary key.
    assert.deepEqual(servers, Object.assign(Object.create(null), {
      "fly-cli": { type: "stdio", command: "fly-mcp", args: ["deploy"] },
      remote: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
    }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readInstalledMcpServers excludes a server whose declared shape does not validate, without throwing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-capability-projection-mcp-test-"));
  try {
    await writeFile(
      path.join(root, "mcp.json"),
      JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: { broken: { type: "stdio" }, ok: { type: "stdio", command: "x" } },
      }),
    );

    const servers = await readInstalledMcpServers(root);
    assert.deepEqual(Object.keys(servers), ["ok"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readInstalledMcpServers returns {} when mcp.json does not exist", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-capability-projection-mcp-test-"));
  try {
    assert.deepEqual(await readInstalledMcpServers(root), {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readInstalledMcpServers returns {} for malformed JSON — fail-open, same posture as readInstalledMcpServerIds", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-capability-projection-mcp-test-"));
  try {
    await writeFile(path.join(root, "mcp.json"), "{ not valid json");
    assert.deepEqual(await readInstalledMcpServers(root), {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
