import assert from "node:assert/strict";
import { test } from "../legacy-test.js";

import { parseAgentPluginManifest as parseManifest, parseAgentPluginMcpConfig as parseMcp } from "../../manifest.js";
const parseAgentPluginManifest = (value: unknown) => parseManifest({ value });
// Fixtures express transport and client metadata together; production keeps the latter in a namespace.
function parseAgentPluginMcpConfig(value: unknown) {
  const servers = typeof value === 'object' && value !== null && 'mcpServers' in value
    ? value.mcpServers : undefined;
  const extensions: Record<string, unknown> = {};
  if (typeof servers === 'object' && servers !== null && !Array.isArray(servers)) {
    for (const [serverId, config] of Object.entries(servers)) {
      if (typeof config !== 'object' || config === null) continue;
      const fields: Record<string, unknown> = {};
      for (const key of ['authMode', 'defaultTools', 'tokenAuth', 'renamedTools']) {
        if (key in config) fields[key] = (config as Record<string, unknown>)[key];
      }
      extensions[serverId] = fields;
    }
  }
  return parseMcp({ value, extensionNamespace: 'org.example.host' }, { pluginManifest: {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'fixture',
    extensions: { 'org.example.host': { mcpServers: extensions } },
  } });
}

// Copied grammar, invalid transport and client-metadata characterization tests.

const SCHEMA_1_0_0 = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA_1_0_0 = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

test("a minimal valid manifest (only $schema + name) parses with no errors", () => {
  const result = parseAgentPluginManifest({ $schema: SCHEMA_1_0_0, name: "ui-ux-design" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.manifest.name, "ui-ux-design");
});

test("optional metadata fields pass through when present", () => {
  const result = parseAgentPluginManifest({
    $schema: SCHEMA_1_0_0,
    name: "ui-ux-design",
    version: "1.1.0",
    description: "AI Dev Shop UI/UX guidance.",
    author: "AI Dev Shop",
    license: "MIT",
    keywords: ["design", "ui"],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.manifest.version, "1.1.0");
    assert.equal(result.manifest.description, "AI Dev Shop UI/UX guidance.");
  }
});

test("an unrecognized top-level field is a non-fatal warning, not a rejection (spec: unknown fields warn, don't block)", () => {
  const result = parseAgentPluginManifest({ $schema: SCHEMA_1_0_0, name: "ui-ux-design", futureField: 1 });
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(result.warnings.some((w) => w.includes("futureField")));
});

test("a non-object manifest is rejected", () => {
  const result = parseAgentPluginManifest("not-an-object");
  assert.equal(result.ok, false);
});

test("a missing $schema is rejected", () => {
  const result = parseAgentPluginManifest({ name: "ui-ux-design" });
  assert.equal(result.ok, false);
});

test("a $schema pointing at an unrecognized version is rejected (loader pins v1.0.0, per spec churn risk)", () => {
  const result = parseAgentPluginManifest({ $schema: "https://agent-plugins.org/schemas/2.0.0/plugin.schema.json", name: "x" });
  assert.equal(result.ok, false);
});

test("a missing name is rejected", () => {
  const result = parseAgentPluginManifest({ $schema: SCHEMA_1_0_0 });
  assert.equal(result.ok, false);
});

for (const invalidName of ["My-Plugin", "-start", "end-", "has--double", "has..double", ".leading", "trailing.", "", "a".repeat(65)]) {
  test(`rejects the name grammar violation '${invalidName.slice(0, 20)}'`, () => {
    const result = parseAgentPluginManifest({ $schema: SCHEMA_1_0_0, name: invalidName });
    assert.equal(result.ok, false, `expected '${invalidName}' to be rejected`);
  });
}

for (const validName of ["my-plugin", "acme.tools", "lint3r", "a", "a".repeat(64)]) {
  test(`accepts the spec's own valid-name example '${validName.slice(0, 20)}'`, () => {
    const result = parseAgentPluginManifest({ $schema: SCHEMA_1_0_0, name: validName });
    assert.equal(result.ok, true, `expected '${validName}' to be accepted`);
  });
}

test("mcp.json: parses server ids from the mcpServers object", () => {
  const result = parseAgentPluginMcpConfig({
    $schema: MCP_SCHEMA_1_0_0,
    mcpServers: {
      main: { type: "stdio", command: "./server/index.js" },
    },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.config.serverIds, ["main"]);
});

test("mcp.json: a missing mcpServers object is rejected", () => {
  const result = parseAgentPluginMcpConfig({ $schema: MCP_SCHEMA_1_0_0 });
  assert.equal(result.ok, false);
});

test("mcp.json: a non-object manifest is rejected", () => {
  const result = parseAgentPluginMcpConfig(["not", "an", "object"]);
  assert.equal(result.ok, false);
});

test("mcp.json: the $schema VERSION segment must match plugin.json's (spec: a mismatch invalidates the MCP config)", () => {
  const result = parseAgentPluginMcpConfig(
    { $schema: "https://agent-plugins.org/schemas/2.0.0/mcp.schema.json", mcpServers: {} },
  );
  assert.equal(result.ok, false);
});

test("mcp.json: a stdio server's full transport config is parsed, not just its id", () => {
  const result = parseAgentPluginMcpConfig({
    $schema: MCP_SCHEMA_1_0_0,
    mcpServers: {
      main: { type: "stdio", command: "./server/index.js", args: ["--flag"], env: { API_KEY: "x" }, cwd: "./data" },
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.config.servers.main, {
    type: "stdio",
    command: "./server/index.js",
    args: ["--flag"],
    env: { API_KEY: "x" },
    cwd: "./data",
  });
});

test("mcp.json: a streamable-http server's url and headers are parsed", () => {
  const result = parseAgentPluginMcpConfig({
    $schema: MCP_SCHEMA_1_0_0,
    mcpServers: {
      remote: { type: "streamable-http", url: "https://mcp.example.com/mcp", headers: { "X-Trace": "1" } },
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.config.servers.remote, {
    type: "streamable-http",
    url: "https://mcp.example.com/mcp",
    headers: { "X-Trace": "1" },
  });
});

test("mcp.json: an sse server's url is parsed (legacy transport, same field shape as streamable-http)", () => {
  const result = parseAgentPluginMcpConfig({
    $schema: MCP_SCHEMA_1_0_0,
    mcpServers: { legacy: { type: "sse", url: "https://mcp.example.com/sse" } },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.config.servers.legacy, { type: "sse", url: "https://mcp.example.com/sse" });
});

test("mcp.json: the non-spec authMode extension passes through on a remote server", () => {
  const result = parseAgentPluginMcpConfig({
    $schema: MCP_SCHEMA_1_0_0,
    mcpServers: { remote: { type: "streamable-http", url: "https://mcp.example.com/mcp", authMode: "oauth" } },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.config.servers.remote as { authMode?: string }).authMode, "oauth");
});

test("mcp.json: defaultTools on a remote server passes through when write is a subset of allow", () => {
  const result = parseAgentPluginMcpConfig({
    $schema: MCP_SCHEMA_1_0_0,
    mcpServers: {
      remote: {
        type: "streamable-http",
        url: "https://mcp.example.com/mcp",
        defaultTools: { allow: ["list_things", "make_thing"], write: ["make_thing"] },
      },
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual((result.config.servers.remote as { defaultTools?: unknown }).defaultTools, {
    allow: ["list_things", "make_thing"],
    write: ["make_thing"],
    read: [],
  });
});

function parseTokenAuth(tokenAuth: unknown) {
  const result = parseAgentPluginMcpConfig({
    $schema: MCP_SCHEMA_1_0_0,
    mcpServers: { remote: { type: "streamable-http", url: "https://mcp.example.com/mcp", tokenAuth } },
  });
  assert.equal(result.ok, true);
  return result.ok ? (result.config.servers.remote as { tokenAuth?: unknown } | undefined) : undefined;
}

test("mcp.json: tokenAuth with https helpUrl and probeUrl passes through", () => {
  const auth = { helpUrl: "https://example.com/tokens", probeUrl: "https://api.example.com/v1/me" };
  assert.deepEqual(parseTokenAuth(auth)?.tokenAuth, auth);
});

test("mcp.json: tokenAuth with a non-https or missing URL excludes the server, so a token is never probed in the clear", () => {
  for (const bad of [
    { helpUrl: "https://example.com/tokens", probeUrl: "http://api.example.com/v1/me" },
    { helpUrl: "javascript:alert(1)", probeUrl: "https://api.example.com/v1/me" },
    { helpUrl: "https://example.com/tokens" },
    "https://example.com/tokens",
  ]) {
    assert.equal(parseTokenAuth(bad), undefined, JSON.stringify(bad));
  }
});

function parseRenamedTools(renamedTools: unknown) {
  const result = parseAgentPluginMcpConfig({
    $schema: MCP_SCHEMA_1_0_0,
    mcpServers: { remote: { type: "streamable-http", url: "https://mcp.example.com/mcp", renamedTools } },
  });
  assert.equal(result.ok, true);
  return result.ok ? (result.config.servers.remote as { renamedTools?: unknown } | undefined) : undefined;
}

test("mcp.json: renamedTools mapping valid old names to valid new names passes through", () => {
  const renames = { get_logs: "query_logs", list_things: "list_items" };
  assert.deepEqual(parseRenamedTools(renames)?.renamedTools, renames);
});

test("mcp.json: renamedTools that is malformed, renames a tool to itself, chains, or has over 64 entries excludes the server", () => {
  for (const bad of [
    ["get_logs", "query_logs"],
    { get_logs: 1 },
    { "has space": "query_logs" },
    { get_logs: "has space" },
    { get_logs: "get_logs" },
    { a: "b", b: "c" },
    Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`t${i}`, `n${i}`])),
  ]) {
    assert.equal(parseRenamedTools(bad), undefined, JSON.stringify(bad));
  }
});

test("mcp.json: defaultTools whose write names a tool outside allow excludes the server (like any shape error)", () => {
  const result = parseAgentPluginMcpConfig({
    $schema: MCP_SCHEMA_1_0_0,
    mcpServers: {
      remote: {
        type: "streamable-http",
        url: "https://mcp.example.com/mcp",
        defaultTools: { allow: ["list_things"], write: ["drop_everything"] },
      },
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.config.serverIds, ["remote"]);
  assert.equal(Object.hasOwn(result.config.servers, "remote"), false);
});

test("mcp.json: defaultTools with a malformed name, a non-array, or more than 64 names excludes the server", () => {
  const bad: readonly unknown[] = [
    { allow: ["has space"], write: [] },
    { allow: "list_things", write: [] },
    { allow: ["list_things"], write: "list_things" },
    { allow: Array.from({ length: 65 }, (_, i) => `t${i}`), write: [] },
  ];
  for (const defaultTools of bad) {
    const result = parseAgentPluginMcpConfig({
      $schema: MCP_SCHEMA_1_0_0,
      mcpServers: { remote: { type: "streamable-http", url: "https://mcp.example.com/mcp", defaultTools } },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(Object.hasOwn(result.config.servers, "remote"), false, JSON.stringify(defaultTools));
  }
});

test("mcp.json: a server with an unrecognized type still counts toward serverIds but is excluded from servers (fail-open)", () => {
  const result = parseAgentPluginMcpConfig({
    $schema: MCP_SCHEMA_1_0_0,
    mcpServers: { mystery: { type: "carrier-pigeon", command: "x" } },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.config.serverIds, ["mystery"]);
  assert.equal(Object.hasOwn(result.config.servers, "mystery"), false);
});

test("mcp.json: a stdio entry missing 'command' is excluded from servers but keeps its serverId (fail-open)", () => {
  const result = parseAgentPluginMcpConfig({
    $schema: MCP_SCHEMA_1_0_0,
    mcpServers: { broken: { type: "stdio" } },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.config.serverIds, ["broken"]);
  assert.equal(Object.hasOwn(result.config.servers, "broken"), false);
});

test("mcp.json: a remote entry missing 'url' is excluded from servers but keeps its serverId (fail-open)", () => {
  const result = parseAgentPluginMcpConfig({
    $schema: MCP_SCHEMA_1_0_0,
    mcpServers: { broken: { type: "streamable-http" } },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.config.serverIds, ["broken"]);
  assert.equal(Object.hasOwn(result.config.servers, "broken"), false);
});

test("mcp.json: a stdio entry setting the reserved PLUGIN_ROOT env key is excluded from servers", () => {
  const result = parseAgentPluginMcpConfig({
    $schema: MCP_SCHEMA_1_0_0,
    mcpServers: { broken: { type: "stdio", command: "x", env: { PLUGIN_ROOT: "/tmp" } } },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Object.hasOwn(result.config.servers, "broken"), false);
});

test("mcp.json: several servers of mixed transports and validity all resolve independently", () => {
  const result = parseAgentPluginMcpConfig({
    $schema: MCP_SCHEMA_1_0_0,
    mcpServers: {
      local: { type: "stdio", command: "fly-mcp" },
      remote: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
      broken: { type: "stdio" },
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual([...result.config.serverIds].sort(), ["broken", "local", "remote"]);
  assert.deepEqual(Object.keys(result.config.servers).sort(), ["local", "remote"]);
});
