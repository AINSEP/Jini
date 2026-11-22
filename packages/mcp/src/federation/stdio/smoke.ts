/**
 * @file Bounded stdio MCP handshake for release checks: spawn a server, `initialize`, `tools/list`,
 * assert identity and one expected tool, then always tear the child down. Any MCP server package can
 * smoke its own launch command with it. It never invokes a tool or a model.
 *
 * Why it is shaped this way: a release gate must fail loudly and never hang. One watchdog covers the
 * whole exchange, stdout is bounded, stderr is kept only for failure diagnostics, and the child is
 * SIGKILLed and awaited on every path (spawn error, failed initialize, success). The child gets only
 * a small baseline of the host environment plus the entry's own variables, so developer credentials
 * and `NODE_PATH` can never leak into the server under test. The failure text is sanitized, and the
 * host's `redact` port runs first because only the host knows which local paths and secrets to hide.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { sanitizeUntrustedText } from "@jini-ai/core/text";

export interface StdioSmokeEntry {
  /** Names the server in failure messages. */
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** Expected `serverInfo.name` from `initialize`. */
  readonly serverName: string;
  /** A tool `tools/list` must include. Trusted metadata, so exempt from redaction. */
  readonly toolName: string;
}

export interface StdioSmokeRequired {
  readonly entry: StdioSmokeEntry;
  /** The host's environment, read only for the baseline keys. */
  readonly hostEnv: Readonly<Record<string, string | undefined>>;
  /** Hides host-local paths and secrets in failure text. */
  readonly redact: (required: { text: string }) => string;
}

export interface StdioSmokeOptions {
  readonly spawnServer?: typeof spawn;
  readonly watchdogMs?: number;
  readonly cwd?: string;
}

const BASELINE_KEYS = ["PATH", "HOME", "TMPDIR", "SHELL", "LANG", "USER"] as const;
const MAX_STDOUT = 1_000_000;
const MAX_STDERR = 65_536;

/** The baseline host variables, then the entry's own; nothing else reaches the child. */
export function buildSmokeEnv(
  { hostEnv, entryEnv = {} }: { hostEnv: Readonly<Record<string, string | undefined>>; entryEnv?: Readonly<Record<string, string>> },
  _optional: Record<string, never> = {},
): Record<string, string> {
  const baseline: Record<string, string> = {};
  for (const key of BASELINE_KEYS) {
    const value = hostEnv[key];
    if (value !== undefined) baseline[key] = value;
  }
  return { ...baseline, ...entryEnv };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate one JSON-RPC line; an unrelated reply or notification cannot satisfy the pending request. */
export function parseStdioReply(
  { line, id }: { line: string; id: number },
  _optional: Record<string, never> = {},
): Record<string, unknown> | undefined {
  const reply: unknown = JSON.parse(line);
  if (!isRecord(reply) || reply.jsonrpc !== "2.0") throw new Error("invalid MCP JSON-RPC reply");
  if (reply.id !== id) return undefined;
  if (reply.error !== undefined || !isRecord(reply.result)) throw new Error(`MCP request ${id} failed`);
  return reply.result;
}

/** Check the server's identity and static tool roster. */
export function assertStdioHandshake(
  { initialize, tools, serverName, toolName }: {
    initialize: Record<string, unknown>; tools: Record<string, unknown>; serverName: string; toolName: string;
  },
  _optional: Record<string, never> = {},
): void {
  if (!isRecord(initialize.serverInfo) || initialize.serverInfo.name !== serverName) {
    throw new Error(`initialize did not identify ${serverName}`);
  }
  if (!Array.isArray(tools.tools) || !tools.tools.some(tool => isRecord(tool) && tool.name === toolName)) {
    throw new Error(`tools/list did not include ${toolName}`);
  }
}

/** The two-step request/reply state machine, independent of the child's streams. */
function createHandshake(
  { entry, send, done }: { entry: StdioSmokeEntry; send: (message: object) => void; done: () => void },
): { start: () => void; onLine: (line: string) => void } {
  let id = 1;
  let initialize: Record<string, unknown> | undefined;
  return {
    start: () => send({ jsonrpc: "2.0", id, method: "initialize", params: {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "release-smoke", version: "0" },
    } }),
    onLine(line) {
      const reply = parseStdioReply({ line, id });
      if (!reply) return;
      if (id === 1) {
        initialize = reply;
        id = 2;
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({ jsonrpc: "2.0", id, method: "tools/list", params: {} });
        return;
      }
      if (!initialize) throw new Error("MCP tools reply arrived without an initialize reply");
      assertStdioHandshake({ initialize, tools: reply, serverName: entry.serverName, toolName: entry.toolName });
      done();
    },
  };
}

/** Keep stderr for diagnostics only, replacing it with a marker once it is oversized. */
function captureStderr({ child }: { child: ChildProcess }): () => string {
  let stderr = "";
  let overflow = false;
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    if (overflow) return;
    overflow = stderr.length + chunk.length > MAX_STDERR;
    stderr = overflow ? "[oversized stderr omitted]" : stderr + chunk;
  });
  return () => stderr;
}

/** Split stdout into lines for the handshake; a failure or an oversized buffer rejects. */
function pumpStdout(
  { child, onLine, reject }: { child: ChildProcess; onLine: (line: string) => void; reject: (error: unknown) => void },
): void {
  let buffer = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length > MAX_STDOUT) { reject(new Error("MCP stdout exceeded smoke buffer limit")); return; }
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try { onLine(line); } catch (error) { reject(error); return; }
    }
  });
}

/** One watchdog covers the whole exchange; the returned timer is cleared by the caller. */
function startHandshake(
  { child, entry, watchdogMs }: { child: ChildProcess; entry: StdioSmokeEntry; watchdogMs: number },
): { promise: Promise<void>; timer: ReturnType<typeof setTimeout> } {
  let timer!: ReturnType<typeof setTimeout>;
  const promise = new Promise<void>((resolve, reject) => {
    const send = (message: object) => child.stdin?.write(`${JSON.stringify(message)}\n`);
    const handshake = createHandshake({ entry, send, done: resolve });
    timer = setTimeout(() => reject(new Error(`MCP watchdog exceeded ${watchdogMs} ms`)), watchdogMs);
    child.once("error", reject);
    child.stdin?.on("error", reject);
    child.once("close", (code, signal) => reject(new Error(`server closed before completing MCP handshake (code ${code ?? "none"}, signal ${signal ?? "none"})`)));
    pumpStdout({ child, onLine: handshake.onLine, reject });
    handshake.start();
  });
  return { promise, timer };
}

/** Handshake one stdio MCP server and tear it down on every path.
 * @example await smokeStdioServer({ entry, hostEnv: process.env, redact });
 * @throws A sanitized error naming `entry.label` and any stderr, redacted by the host port.
 * @complexity O(output) bounded by the stdout/stderr limits and the watchdog.
 */
export async function smokeStdioServer(
  { entry, hostEnv, redact }: StdioSmokeRequired,
  { spawnServer = spawn, watchdogMs = 30_000, cwd }: StdioSmokeOptions = {},
): Promise<void> {
  const child = spawnServer(entry.command, [...entry.args], {
    env: buildSmokeEnv({ hostEnv, entryEnv: entry.env }), stdio: ["pipe", "pipe", "pipe"], ...(cwd ? { cwd } : {}),
  });
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  const readStderr = captureStderr({ child });
  const { promise, timer } = startHandshake({ child, entry, watchdogMs });
  try {
    await promise;
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    const diagnostics = readStderr() ? `\n${readStderr()}` : "";
    // The expected tool name is trusted metadata; without the exemption a missing-tool failure reads "[redacted]".
    throw new Error(sanitizeUntrustedText({ text: redact({ text: `${entry.label}: ${errorText}${diagnostics}` }) },
      { maxLength: 2_000, diagnosticToolIds: [entry.toolName] }));
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL");
    await closed;
  }
}
