import { createDefaultConnect } from "../stdio/default-connect.js";
import { stdioLaunchResolverFromEnv } from "../stdio/stdio-launch-resolver.js";
import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, onTestFinished, vi } from "vitest";

import type { ToolDescriptor, ToolRegistration, ToolRegistry } from "@jini-ai/core";

import { attachFederatedMcpTools } from "../bootstrap.js";
import { FEDERATED_CONNECTION_DEFAULTS } from "../config.js";
import type { FederatedMcpConnectionConfig, McpStdioLaunchSpec } from "../ports.js";

/**
 * @file End-to-end proof that the desktop-npx resolver is WIRED, not just correct in isolation:
 * `attachFederatedMcpTools` with no injected `connect` or `stdioLaunchResolver` must pick the
 * resolver from its `env`, and the REAL `spawnMcpStdioChannel` must hand the child the resolver's
 * rewritten command/args and its `launchEnv`. The unit tests of the resolver and of
 * `buildMcpChildEnv` both passed with either wire cut; a real child reporting its own argv and env
 * is what catches that.
 *
 * The fixture stands in for npm's `bin/npx-cli.js`: it writes `report.json` next to itself, then
 * answers the MCP handshake. `process.execPath` here is plain node, which ignores
 * `ELECTRON_RUN_AS_NODE`, so the rewritten launch runs as it would inside the packaged app.
 */

const FIXTURE_SERVER = `
const fs = require("node:fs");
const path = require("node:path");
const keys = ["ELECTRON_RUN_AS_NODE", "PATH", "npm_config_cache", "npm_config_prefix", "EXAMPLE_NODE_TOOLCHAIN_DIR", "EXAMPLE_BUNDLED_NPM_ROOT"];
const env = {};
for (const key of keys) if (process.env[key] !== undefined) env[key] = process.env[key];
fs.writeFileSync(path.join(__dirname, "report.json"), JSON.stringify({ argv: process.argv.slice(1), env, envKeys: Object.keys(process.env).sort() }));
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\\n")) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.id === undefined) continue;
    if (message.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1" } } }) + "\\n");
    } else if (message.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [] } }) + "\\n");
    }
  }
});
`;

const CONFIG: FederatedMcpConnectionConfig = {
  connectionId: "fixture",
  label: "Fixture",
  allowedToolNames: [],
  writeAllowedToolNames: [],
  connectTimeoutMs: 10_000,
  callTimeoutMs: FEDERATED_CONNECTION_DEFAULTS.callTimeoutMs,
  maxResultBytes: FEDERATED_CONNECTION_DEFAULTS.maxResultBytes,
  maxTools: FEDERATED_CONNECTION_DEFAULTS.maxTools,
};

function fakeRegistry(): ToolRegistry {
  const descriptors: ToolDescriptor[] = [];
  return {
    register(registration: ToolRegistration) {
      descriptors.push(registration.descriptor);
    },
    has: ({ toolId }: { toolId: string }) => descriptors.some((descriptor) => descriptor.id === toolId),
    list: () => descriptors,
  };
}

interface ChildReport {
  argv: string[];
  env: Record<string, string>;
  envKeys: string[];
}

/** Attaches one stdio connection through the production `defaultConnect`, closes it, and returns
 *  what the real child reported about itself. */
async function attachAndReport(launch: McpStdioLaunchSpec, env: NodeJS.ProcessEnv, reportPath: string): Promise<ChildReport> {
  const warnings: string[] = [];
  const result = await attachFederatedMcpTools({ connect: createDefaultConnect({
      resolver: stdioLaunchResolverFromEnv({ env, toolchainDirEnvVar: "EXAMPLE_NODE_TOOLCHAIN_DIR", npmRootEnvVar: "EXAMPLE_BUNDLED_NPM_ROOT", messages: federationMessages }),
      clientInfo, messages: federationMessages, bearerToken: () => undefined,
    }), registry: fakeRegistry(), deps: { messages: federationMessages, errorCode: "EXTERNAL_MCP", permissionGate: testPermissionGate({ authorize: async () => ({ allowed: true, reason: "matched" }), scope: "ws-toolchain" }), scope: "ws-toolchain" } }, { connections: [{ config: CONFIG, launch }], logger: { error: () => undefined, info: () => undefined, warn: ({ message }: { message: string }) => warnings.push(message) }, env });
  await Promise.all(result.sessions.map((session) => session.close({})));
  assert.deepEqual(warnings, [], "the fixture connection must attach cleanly");
  return JSON.parse(fs.readFileSync(reportPath, "utf8")) as ChildReport;
}

test("with the desktop toolchain env set, a bare npx launch really spawns execPath + bundled npx-cli.js with the resolver's launchEnv", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "example-toolchain-spawn-"));
  try {
    const toolchainDir = path.join(root, "node-toolchain");
    const npmRoot = path.join(root, "npm");
    const npxCli = path.join(npmRoot, "bin", "npx-cli.js");
    fs.mkdirSync(path.dirname(npxCli), { recursive: true });
    fs.writeFileSync(npxCli, FIXTURE_SERVER);

    const report = await attachAndReport(
      { command: "npx", args: ["-y", "some-mcp-server"], env: {} },
      { PATH: "/usr/bin:/bin", HOME: root, EXAMPLE_NODE_TOOLCHAIN_DIR: toolchainDir, EXAMPLE_BUNDLED_NPM_ROOT: npmRoot },
      path.join(npmRoot, "bin", "report.json"),
    );

    assert.deepEqual(report.argv, [npxCli, "-y", "some-mcp-server"]);
    assert.equal(report.env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(report.env.npm_config_cache, path.join(toolchainDir, "npm-cache"));
    assert.equal(report.env.npm_config_prefix, path.join(toolchainDir, "npm-prefix"));
    assert.equal(report.env.PATH?.split(path.delimiter)[0], path.join(toolchainDir, "bin"));
    assert.equal(report.env.EXAMPLE_NODE_TOOLCHAIN_DIR, undefined, "the resolver-selection vars must never reach the child");
    assert.equal(report.env.EXAMPLE_BUNDLED_NPM_ROOT, undefined, "the resolver-selection vars must never reach the child");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("without the desktop toolchain env, the real spawn is unchanged: same command and args, no launch env added", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "example-toolchain-identity-"));
  try {
    const server = path.join(root, "server.js");
    fs.writeFileSync(server, FIXTURE_SERVER);

    const report = await attachAndReport(
      { command: process.execPath, args: [server, "--flag"], env: { API_KEY: "k" } },
      { PATH: "/usr/bin:/bin", HOME: root },
      path.join(root, "report.json"),
    );

    assert.deepEqual(report.argv, [server, "--flag"]);
    assert.equal(report.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(report.env.npm_config_cache, undefined);
    assert.equal(report.env.PATH, process.env.PATH, "PATH is the inherited parent PATH, untouched");
    for (const key of report.envKeys) {
      assert.ok(["API_KEY", "HOME", "PATH", "TMPDIR"].includes(key) || key.startsWith("__CF"), `unexpected child env key ${key}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
