import { describe, expect, test } from "vitest";
import { messages as federationMessages, clientInfo } from "./fixtures.js";
import { ScriptedMcpStdioChannel } from "../testing/adapter.memory.js";
import type { McpStdioChannel } from "../ports.js";
import { buildMcpChildEnv, connectMcpStdioSession, spawnMcpStdioChannel } from "../stdio/adapter.stdio.js";

// Characterization pins for adapter.stdio.ts (SEC: the child env allowlist and the session's
// handling of what a remote sends back).
const INIT = { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "s", version: "1" } };
const EXE = "C:\\Program Files\\Example\\Example.exe";

describe("buildMcpChildEnv", () => {
  test("off win32 the run mode is never carried, even for this very executable", () => {
    const env = buildMcpChildEnv({ command: "/app/example", specEnv: {} }, { platform: "linux", parentEnv: { ELECTRON_RUN_AS_NODE: "1", PATH: "/p" }, execPath: "/app/example" });
    expect(env).toEqual({ PATH: "/p" });
  });

  test("on win32 a different executable never receives the run mode", () => {
    const env = buildMcpChildEnv({ command: "C:\\other\\server.exe", specEnv: {} }, { platform: "win32", parentEnv: { ELECTRON_RUN_AS_NODE: "1" }, execPath: EXE });
    expect(env).toEqual({});
  });

  test("on win32 an empty run mode is not carried to this very executable", () => {
    const env = buildMcpChildEnv({ command: EXE, specEnv: {} }, { platform: "win32", parentEnv: { ELECTRON_RUN_AS_NODE: "" }, execPath: EXE });
    expect(env).toEqual({});
  });

  test("on win32 the carried run mode keeps the parent's exact value", () => {
    const env = buildMcpChildEnv({ command: EXE, specEnv: {} }, { platform: "win32", parentEnv: { ELECTRON_RUN_AS_NODE: "yes" }, execPath: EXE });
    expect(env).toEqual({ ELECTRON_RUN_AS_NODE: "yes" });
  });

  test("launchEnv and then specEnv override the carried run mode", () => {
    const options = { platform: "win32" as const, parentEnv: { ELECTRON_RUN_AS_NODE: "1" }, execPath: EXE };
    expect(buildMcpChildEnv({ command: EXE, specEnv: {} }, { ...options, launchEnv: { ELECTRON_RUN_AS_NODE: "launch" } })).toEqual({ ELECTRON_RUN_AS_NODE: "launch" });
    expect(buildMcpChildEnv({ command: EXE, specEnv: { ELECTRON_RUN_AS_NODE: "spec" } }, { ...options, launchEnv: { ELECTRON_RUN_AS_NODE: "launch" } })).toEqual({ ELECTRON_RUN_AS_NODE: "spec" });
  });

  test("win32-only names are not inherited off win32", () => {
    const env = buildMcpChildEnv({ command: "x", specEnv: {} }, { platform: "darwin", parentEnv: { SystemRoot: "C:\\Windows", APPDATA: "a", HOME: "/h" }, execPath: "/e" });
    expect(env).toEqual({ HOME: "/h" });
  });

  test("an empty win32 variable is not inherited", () => {
    const env = buildMcpChildEnv({ command: "x", specEnv: {} }, { platform: "win32", parentEnv: { SystemRoot: "", TEMP: "t" }, execPath: EXE });
    expect(env).toEqual({ TEMP: "t" });
  });

  test("names outside the allowlist are never inherited, whatever the platform", () => {
    const secret = "gh" + "p_" + "x".repeat(36);
    for (const platform of ["linux", "win32"] as const) {
      expect(buildMcpChildEnv({ command: "x", specEnv: {} }, { platform, parentEnv: { GITHUB_TOKEN: secret, HTTPS_PROXY: "http://u:p@h" }, execPath: EXE })).toEqual({});
    }
  });
});

/** A channel whose `send` throws `thrown` for any method other than `initialize`. */
function throwingChannel(thrown: unknown): McpStdioChannel {
  const scripted = new ScriptedMcpStdioChannel({ messages: federationMessages, respond: ({ message }) => ({ jsonrpc: "2.0", id: message.id, result: INIT }) });
  return {
    send: ({ message }) => {
      if (!message.includes('"initialize"') && !message.includes("notifications/initialized")) throw thrown;
      scripted.send({ message });
    },
    onMessage: input => scripted.onMessage(input),
    onClose: input => scripted.onClose(input),
    close: input => scripted.close(input),
  };
}

describe("McpStdioSession requests", () => {
  async function connected(respond: ConstructorParameters<typeof ScriptedMcpStdioChannel>[0]["respond"], requestTimeoutMs = 1_000) {
    const channel = new ScriptedMcpStdioChannel({ messages: federationMessages, respond });
    const session = await connectMcpStdioSession({ clientInfo, messages: federationMessages, channel, requestTimeoutMs });
    return { channel, session };
  }
  const initOnly: ConstructorParameters<typeof ScriptedMcpStdioChannel>[0]["respond"] = ({ message }) => (message.method === "initialize" ? { jsonrpc: "2.0", id: message.id, result: INIT } : undefined);

  test("an already aborted signal rejects before anything is sent", async () => {
    const { channel, session } = await connected(initOnly);
    const controller = new AbortController();
    controller.abort();
    await expect(session.callTool({ name: "t", arguments: {} }, { signal: controller.signal })).rejects.toThrow("mcp-federation: 'tools/call' was aborted before it was sent");
    expect(channel.sent.map(message => message.method)).toEqual(["initialize", "notifications/initialized"]);
  });

  test("an abort after the reply settled is a no-op", async () => {
    const { session } = await connected(({ message }) => ({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize" ? INIT : { content: [] } }));
    const controller = new AbortController();
    await expect(session.callTool({ name: "t", arguments: {} }, { signal: controller.signal })).resolves.toMatchObject({ content: [] });
    expect(() => controller.abort()).not.toThrow();
  });

  test("a send that throws an Error rejects the request with that error", async () => {
    const thrown = new Error("pipe broke");
    const session = await connectMcpStdioSession({ clientInfo, messages: federationMessages, channel: throwingChannel(thrown), requestTimeoutMs: 1_000 });
    await expect(session.callTool({ name: "t", arguments: {} })).rejects.toBe(thrown);
  });

  test("a send that throws a non-Error rejects with an Error carrying its string form", async () => {
    const session = await connectMcpStdioSession({ clientInfo, messages: federationMessages, channel: throwingChannel("raw failure"), requestTimeoutMs: 1_000 });
    await expect(session.callTool({ name: "t", arguments: {} })).rejects.toThrow(new Error("raw failure"));
  });

  test("a JSON-RPC error without code or message is reported with placeholders", async () => {
    const { session } = await connected(({ message }) => (message.method === "initialize" ? { jsonrpc: "2.0", id: message.id, result: INIT } : { jsonrpc: "2.0", id: message.id, error: {} }));
    await expect(session.listTools()).rejects.toThrow("mcp-federation: remote returned JSON-RPC error ?: (no message)");
  });

  test("a reply whose id is not a number never settles a pending request", async () => {
    const { channel, session } = await connected(initOnly, 50);
    const pending = session.callTool({ name: "t", arguments: {} });
    const id = channel.idFor({ method: "tools/call" });
    channel.deliver({ message: { jsonrpc: "2.0", id: String(id), result: { content: [{ type: "text", text: "forged" }] } } });
    await expect(pending).rejects.toThrow("mcp-federation: 'tools/call' timed out after 50ms");
  });

  test("an inbound line over the 4 MiB cap is dropped unparsed", async () => {
    const { channel, session } = await connected(initOnly, 50);
    const pending = session.callTool({ name: "t", arguments: {} });
    const id = channel.idFor({ method: "tools/call" });
    const huge = JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "x".repeat(4 * 1024 * 1024) }] } });
    channel.deliver({ message: huge });
    await expect(pending).rejects.toThrow("timed out after 50ms");
  });

  test("an inbound line exactly at the 4 MiB cap is still processed", async () => {
    const { channel, session } = await connected(initOnly);
    const pending = session.callTool({ name: "t", arguments: {} });
    const id = channel.idFor({ method: "tools/call" });
    const skeleton = JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "" }] } });
    channel.deliver({ message: JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "x".repeat(4 * 1024 * 1024 - skeleton.length) }] } }) });
    await expect(pending).resolves.toMatchObject({ content: [{ type: "text" }] });
  });
});

describe("spawnMcpStdioChannel exit draining", () => {
  function closeReason(script: string): Promise<{ reason: string; ms: number }> {
    const started = Date.now();
    const channel = spawnMcpStdioChannel({ messages: federationMessages, command: "/bin/sh", args: ["-c", script], env: {}, launchEnv: {} });
    return new Promise(resolve => channel.onClose({ listener: ({ reason }) => resolve({ reason, ms: Date.now() - started }) }));
  }

  test("stderr a still-running grandchild writes before the pipe ends is waited for", { timeout: 5_000 }, async () => {
    const { reason } = await closeReason("(sleep 0.05; echo late >&2) & exit 2");
    expect(reason).toBe("child process exited (code=2, signal=null): late");
  });

  test("a grandchild holding stderr open cannot postpone the close reason past the drain bound", { timeout: 5_000 }, async () => {
    const { reason, ms } = await closeReason("(sleep 0.8; echo late >&2) & exit 2");
    expect(reason).toBe("child process exited (code=2, signal=null)");
    expect(ms).toBeLessThan(750);
    // Let the grandchild finish so the test leaves no process behind.
    await new Promise(resolve => setTimeout(resolve, 900));
  });
});
