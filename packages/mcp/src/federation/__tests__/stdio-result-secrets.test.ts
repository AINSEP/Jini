import assert from "node:assert/strict";
import { test } from "vitest";
import { createDefaultConnect } from "../stdio/default-connect.js";
import { IDENTITY_STDIO_LAUNCH_RESOLVER } from "../stdio/stdio-launch-resolver.js";
import { McpProtocolError } from "../mcp-protocol.js";
import { ScriptedMcpStdioChannel } from "../testing/adapter.memory.js";
import { clientInfo, messages } from "./fixtures.js";

const CANARY = 'fixture-stdio-"quoted"-\\credential';
const MARKER = "[REDACTED:exact_secret]";
const config = { connectionId: "fixture", label: "Fixture", allowedToolNames: [], writeAllowedToolNames: [],
  connectTimeoutMs: 1000, callTimeoutMs: 1000, maxResultBytes: 4096, maxTools: 2 };

async function fixture({ reply, env = { API_TOKEN: CANARY }, launchEnv = {} }: {
  reply: object; env?: Record<string, string>; launchEnv?: Record<string, string>;
}) {
  const channel = new ScriptedMcpStdioChannel({ messages, respond: ({ message }) => {
    if (message.method === "notifications/initialized") return undefined;
    return { jsonrpc: "2.0", id: message.id, ...(message.method === "initialize"
      ? { result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture" } } }
      : reply) };
  } });
  const connect = createDefaultConnect({ messages, clientInfo, bearerToken: () => undefined,
    resolver: { resolve: required => ({ ...IDENTITY_STDIO_LAUNCH_RESOLVER.resolve(required), launchEnv }) },
  }, { spawnChannel: ({ resolved }) => {
    assert.deepEqual(resolved.env, env);
    assert.deepEqual(resolved.launchEnv, launchEnv);
    return channel;
  } });
  return connect({ connection: { config, launch: { command: "fixture", args: [], env } } });
}

test("default stdio wiring scrubs the connection's own env credentials from text, nested values and keys", async () => {
  const session = await fixture({ reply: { result: {
    content: [{ type: "text", text: `echo ${CANARY}; ordinary output` }],
    structuredContent: { nested: [{ credential: CANARY }], [CANARY]: "retained" },
  } } });
  try {
    assert.deepEqual(await session.callTool({ name: "inspect", arguments: {} }), {
      content: [{ type: "text", text: `echo ${MARKER}; ordinary output` }],
      structuredContent: { nested: [{ credential: MARKER }], [MARKER]: "retained" }, isError: false,
    });
  } finally { await session.close({}); }
});

test("default stdio wiring scrubs own credentials from remote JSON-RPC errors", async () => {
  const session = await fixture({ reply: { error: { code: -32000, message: `reflected ${CANARY}` } } });
  try {
    await assert.rejects(session.callTool({ name: "inspect", arguments: {} }), (error: unknown) => {
      assert.ok(error instanceof McpProtocolError);
      assert.equal(error.message.includes(CANARY), false);
      assert.equal(error.message.includes(MARKER), true);
      return true;
    });
  } finally { await session.close({}); }
});

test("stdio result scrubbing uses own env values, leaving launch environment and JSON primitives intact", async () => {
  const session = await fixture({ env: { API_TOKEN: "1" }, launchEnv: { PATH: "fixture-launch-path" }, reply: { result: {
    content: [{ type: "text", text: "1; fixture-launch-path; unchanged" }],
    structuredContent: { amount: 1, enabled: true, absent: null },
  } } });
  try {
    assert.equal((session as typeof session & { serverProtocolVersion: string }).serverProtocolVersion, "2025-06-18");
    assert.deepEqual(await session.callTool({ name: "inspect", arguments: {} }), {
      content: [{ type: "text", text: `${MARKER}; fixture-launch-path; unchanged` }],
      structuredContent: { amount: 1, enabled: true, absent: null }, isError: false,
    });
  } finally { await session.close({}); }
});
