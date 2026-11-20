/** Stdio handshake smoke with a fake child (second-host entry): ordering, teardown, bounds and redaction. */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { spawn } from "node:child_process";
import { describe, expect, test } from "vitest";
import { assertStdioHandshake, buildSmokeEnv, parseStdioReply, smokeStdioServer, type StdioSmokeEntry } from "../smoke.js";

const entry: StdioSmokeEntry = { label: "acme", command: "acme-mcp", args: ["--stdio"], env: { ACME_MODE: "1" }, serverName: "acme", toolName: "acme.read" };
const redact = ({ text }: { text: string }) => text.replaceAll("/home/secret", "[path]");
type Mode = "ok" | "bad-tool" | "silent" | "close" | "flood" | "notify-first" | "string-error";

function fake(mode: Mode) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const sent: Array<{ method?: string }> = [];
  const signals: string[] = [];
  const kill = (signal: string) => { signals.push(signal); queueMicrotask(() => child.emit("close", null, signal)); return true; };
  let spawnOptions: unknown;
  child.stdin.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      const message = JSON.parse(line) as { method?: string };
      sent.push(message);
      if (message.method === "initialize") {
        if (mode === "close") { child.stderr.write("boom /home/secret\n"); child.emit("close", 3, null); return; }
        if (mode === "flood") { child.stderr.write("x".repeat(70_000)); child.stdout.write("y".repeat(1_000_001)); return; }
        if (mode === "string-error") { child.emit("error", "bare"); return; }
        if (mode === "silent") return;
        if (mode === "notify-first") child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message" })}\n`);
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "acme" } } })}\n`);
      } else if (message.method === "tools/list") {
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: mode === "bad-tool" ? [] : [{ name: "acme.read" }] } })}\n`);
      }
    }
  });
  const spawnServer = ((_command: string, _args: string[], options: unknown) => { spawnOptions = options; return Object.assign(child, { kill }); }) as unknown as typeof spawn;
  return { spawnServer, sent, signals, options: () => spawnOptions };
}

describe("smokeStdioServer", () => {
  test("handshakes in order, passes only baseline + entry env, and kills the child", async () => {
    const server = fake("ok");
    await smokeStdioServer({ entry, hostEnv: { PATH: "/bin", NODE_PATH: "/dev" }, redact }, { spawnServer: server.spawnServer, cwd: "/gate" });
    expect(server.sent.map(m => m.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(server.signals).toEqual(["SIGKILL"]);
    expect(server.options()).toEqual({ env: { PATH: "/bin", ACME_MODE: "1" }, stdio: ["pipe", "pipe", "pipe"], cwd: "/gate" });
  });
  test("a notification before the initialize reply is skipped", async () => {
    const server = fake("notify-first");
    await smokeStdioServer({ entry, hostEnv: {}, redact }, { spawnServer: server.spawnServer });
    expect(server.signals).toEqual(["SIGKILL"]);
  });
  test.each([
    ["bad-tool" as const, /acme: tools\/list did not include acme\.read/],
    ["close" as const, /code 3, signal none\)\nboom \[path\]/],
    ["silent" as const, /MCP watchdog exceeded 10 ms/],
    ["string-error" as const, /^acme: bare$/],
    ["flood" as const, /^acme: MCP stdout exceeded smoke buffer limit\n\[oversized stderr omitted\]$/],
  ])("%s fails with a redacted message and kills the child", async (mode, expected) => {
    const server = fake(mode);
    await expect(smokeStdioServer({ entry, hostEnv: {}, redact }, { spawnServer: server.spawnServer, watchdogMs: 10 })).rejects.toThrow(expected);
    expect(server.signals).toEqual(["SIGKILL"]);
  });
});

describe("handshake helpers", () => {
  test("buildSmokeEnv keeps only the baseline", () => {
    expect(buildSmokeEnv({ hostEnv: { PATH: "/bin", HOME: "/h", SECRET: "s" }, entryEnv: { A: "1" } })).toEqual({ PATH: "/bin", HOME: "/h", A: "1" });
    expect(buildSmokeEnv({ hostEnv: {} })).toEqual({});
  });
  test("parseStdioReply skips other ids and rejects malformed or errored replies", () => {
    const result = { ok: true };
    expect(parseStdioReply({ line: JSON.stringify({ jsonrpc: "2.0", id: 1, result }), id: 1 })).toEqual(result);
    expect(parseStdioReply({ line: JSON.stringify({ jsonrpc: "2.0", id: 9, result }), id: 1 })).toBeUndefined();
    for (const [line, message] of [
      ["[]", /^invalid MCP JSON-RPC reply$/],
      [JSON.stringify({ jsonrpc: "1.0" }), /^invalid MCP JSON-RPC reply$/],
      [JSON.stringify({ jsonrpc: "2.0", id: 1, error: {} }), /^MCP request 1 failed$/],
      [JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] }), /^MCP request 1 failed$/],
    ] satisfies [string, RegExp][]) {
      expect(() => parseStdioReply({ line, id: 1 })).toThrow(message);
    }
  });
  test("assertStdioHandshake checks identity and roster", () => {
    const ok = { initialize: { serverInfo: { name: "acme" } }, tools: { tools: [{ name: "acme.read" }] }, serverName: "acme", toolName: "acme.read" };
    expect(() => assertStdioHandshake(ok)).not.toThrow();
    expect(() => assertStdioHandshake({ ...ok, initialize: { serverInfo: { name: "x" } } })).toThrow(/did not identify acme/);
    expect(() => assertStdioHandshake({ ...ok, tools: { tools: "no" } })).toThrow(/did not include acme\.read/);
  });
});
