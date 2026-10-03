import type { FederationMessages } from "../messages.js";
import type { McpToolCallRequiredArgs, McpToolCallOptions, McpHttpRequestRequiredArgs, McpHttpRequestOptions } from "../ports.js";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

import {
  buildInitializeParams,
  drainToolsList,
  type JsonRpcResponse,
  McpProtocolError,
  parseCallToolResult,
  parseInitializeResult,
} from "../mcp-protocol.js";
import type { McpSessionPort, McpStdioChannel, RemoteToolDescriptor, RemoteToolResult, McpClientInfo } from "../ports.js";
import type { ResolvedStdioLaunch } from "./stdio-launch-resolver.js";

/**
 * @file The real `McpSessionPort` adapter: a minimal MCP client speaking newline-delimited JSON-RPC
 * 2.0 over a child process's stdio, which is the transport every locally-launched MCP server
 * (Supabase's `mcp-server-supabase` bin included) exposes.
 *
 * Purpose:
 * Turns "there is a program on disk that speaks MCP" into the three-method
 * `listTools`/`callTool`/`close` port the federation layer depends on. It performs the handshake
 * (`initialize` -> `notifications/initialized`), drains `tools/list` across its cursor pagination,
 * correlates `tools/call` responses by JSON-RPC id, and enforces a timeout on every request.
 *
 * Why hand-rolled rather than `@modelcontextprotocol/sdk`:
 * see `ports.ts`'s header. Short version — the SDK is not a dependency here, the wire format needed
 * is four methods of JSON-RPC, and this codebase's convention is a declared port with a real
 * adapter and a double rather than a vendored client.
 *
 * Why the {@link McpStdioChannel} seam:
 * this adapter takes a channel, not a `ChildProcess`. All the logic worth testing — that
 * `initialize` precedes everything, that `notifications/initialized` is sent and carries no id,
 * that a paginated `tools/list` is drained to completion and bounded, that a late reply to a
 * timed-out id is discarded rather than resolving the wrong call, that a channel closing mid-flight
 * rejects every in-flight request instead of hanging forever — is exercisable against a scripted
 * channel with no process at all. `spawnMcpStdioChannel` is the thin, deliberately logic-free
 * production implementation of that seam.
 *
 * Hostile-server posture (this file's share of it; `trust.ts` owns the rest):
 * a remote is assumed to be able to stall, flood, or lie. So: every request is timeout-bounded,
 * pagination is loop-bounded, a single inbound line is length-bounded, unparseable lines are
 * dropped rather than thrown on, and unsolicited server-to-client requests (including
 * `sampling/createMessage` — a remote asking host app to run inference on its behalf) are answered with
 * a JSON-RPC "method not found" rather than being honoured. Notifications, `tools/list_changed`
 * among them, are ignored by design: `trust.ts` R5 freezes the admitted set at connect.
 *
 * Architectural role:
 * Infrastructure adapter, co-located with its port under `assistant/mcp-federation` — mirroring
 * `features/database/adapter.sqlite.ts`'s co-location with the `DatabaseIntrospectionPort` it
 * implements, rather than `db/`'s older per-port-file convention, because this port is this
 * adapter's own invention rather than a cross-domain-shared one.
 */

/** Bound on a single inbound line. A remote that streams one unterminated multi-gigabyte "message"
 * would otherwise grow the reassembly buffer without limit. 4 MiB is far above any legitimate MCP
 * message and far below anything that threatens the daemon. */
const MAX_INBOUND_MESSAGE_BYTES = 4 * 1024 * 1024;

/** How much of a child's stderr survives into its exit reason — enough for a startup error message,
 *  not enough to turn the admissions report into a log viewer. */
const STDERR_TAIL_CHARS = 600;

/** How long an exit waits for the child's stderr to drain before the close reason is emitted. */
const STDERR_DRAIN_MS = 250;

/** Secret values shorter than this are not redacted: replacing every "1" or "on" in a message would
 *  destroy it, and a value that short is not a credential. */
const MIN_REDACTED_VALUE_LENGTH = 4;

/** Commands that fetch a package by name and run it — `npx -y some-mcp@latest`, the shape most
 *  published MCP servers document. Matched on the basename, without a Windows `.cmd`/`.exe`. */
const PACKAGE_RUNNER_COMMANDS: ReadonlySet<string> = new Set(["npx"]);

/**
 * The working directory one stdio child is spawned in.
 *
 * An explicit `cwd` always wins. Otherwise a package runner gets a neutral directory instead of the
 * daemon's own cwd, because npm reads the cwd's project tree BEFORE it runs anything: in this dev
 * checkout that tree links `@jini-ai/*` to a pnpm monorepo whose `workspace:*` ranges npm cannot
 * parse, so `npx -y namecom-mcp@latest` died with `EUNSUPPORTEDPROTOCOL` on every daemon boot
 * (2026-09-29) while the same command worked from any other directory. A package fetched by name
 * never needs host app's project directory; a host's own `package.json` is the wrong input for it.
 *
 * Anything else keeps inheriting the daemon's cwd exactly as before — a relative `command` (a
 * package runner given as `./node_modules/.bin/npx` included) or a server that reads files relative
 * to where it was started depends on it.
 *
 * @complexity O(1).
 */
export function resolveStdioChildCwd({ resolved }: { resolved: ResolvedStdioLaunch }, { neutralDir = os.tmpdir() }: { neutralDir?: string | undefined } = {}): string | undefined {
  if (resolved.cwd !== undefined) return resolved.cwd;
  // The command as configured, not as run: desktop's resolver rewrites `npx` to Electron running
  // `npx-cli.js`, whose basename says nothing about being a package runner.
  const command = resolved.requestedCommand ?? resolved.command;
  // A relative path (`./node_modules/.bin/npx`) is resolved against the child's cwd at exec time,
  // so moving the cwd would make the executable itself vanish.
  const pathModule = /[\\]/.test(command) || /^[a-z]:/i.test(command) ? path.win32 : path.posix;
  if (!pathModule.isAbsolute(command) && /[\\/]/.test(command)) return undefined;
  const name = pathModule.basename(command).replace(/\.(cmd|exe)$/i, "").toLowerCase();
  return PACKAGE_RUNNER_COMMANDS.has(name) ? neutralDir : undefined;
}

/**
 * Appends one stderr chunk and keeps only the last {@link STDERR_TAIL_CHARS} characters.
 * @complexity O(n) in the chunk length.
 */
export function keepStderrTail({ tail, chunk }: { tail: string; chunk: string }): string {
  return (tail + chunk).slice(-STDERR_TAIL_CHARS);
}

/** Intentionally retains the stderr channel's lowercase marker and minimum secret length;
 * the core PII scrubber would change both output and which values get masked.
 * Replaces every redactable `secretValues` entry in `text` with `[redacted]`. @complexity O(s · v). */
function redactSecrets(text: string, secretValues: readonly string[]): string {
  let said = text;
  for (const value of secretValues) {
    if (value.length >= MIN_REDACTED_VALUE_LENGTH) said = said.split(value).join("[redacted]");
  }
  return said;
}

/**
 * A child's stderr tail that is redacted BEFORE it is truncated.
 *
 * Truncating first cut a token printed just before ~600 characters of diagnostics in half, leaving a
 * fragment no exact-value replacement can match (codex review 2026-09-29). So each chunk is redacted
 * as it arrives, and the last `longest secret - 1` characters are held back from the kept tail until
 * the next chunk — they may be the start of a secret split across chunks. Only redacted text is
 * ever truncated, so the kept tail can begin mid-`[redacted]` but never mid-secret.
 *
 * @param secretValues - The child's own `env` values, as spawned.
 * @complexity O(c · v) per chunk of length c.
 */
export function createStderrTail({ secretValues }: { secretValues: readonly string[] }): { append(required: { chunk: string }): void; text(): string } {
  const redactable = secretValues.filter((value) => value.length >= MIN_REDACTED_VALUE_LENGTH);
  const holdBack = Math.max(0, ...redactable.map((value) => value.length - 1));
  let kept = "";
  let pending = "";
  return {
    append({ chunk }) {
      const redacted = redactSecrets(pending + chunk, redactable);
      const cut = Math.max(0, redacted.length - holdBack);
      kept = keepStderrTail({ tail: kept, chunk: redacted.slice(0, cut) });
      pending = redacted.slice(cut);
    },
    text: () => keepStderrTail({ tail: kept, chunk: redactSecrets(pending, redactable) }),
  };
}

/**
 * The close reason for a child that exited: code and signal, plus what it last printed to stderr.
 *
 * Every value of the connection's own `env` is replaced with `[redacted]` first. That env holds the
 * row's unsealed credentials, and a server that echoes its config on failure would otherwise carry a
 * token into `connectFailures` — which the admissions route serves to the admin UI and whose contract
 * (`bootstrap.ts`) is "never a raw env value or secret".
 *
 * @param secretValues - The child's own `env` values, as spawned.
 * @complexity O(s · v) in stderr length and env value count.
 */
export function describeChildExit({ code, signal, stderrTail, secretValues }: { code: number | null; signal: NodeJS.Signals | null; stderrTail: string; secretValues: readonly string[] }
): string {
  const base = `child process exited (code=${String(code)}, signal=${String(signal)})`;
  const said = redactSecrets(stderrTail, secretValues).replace(/\s+/g, " ").trim();
  return said ? `${base}: ${said}` : base;
}

/**
 * A connected MCP client session over one {@link McpStdioChannel}.
 *
 * Constructed by {@link connectMcpStdioSession} rather than directly, so a session that exists is
 * always a session whose handshake has completed — there is no half-initialized state a caller
 * could accidentally use.
 */
class McpStdioSession implements McpSessionPort {
  private readonly channel: McpStdioChannel;
  private readonly requestTimeoutMs: number;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly clientInfo: McpClientInfo;
  private readonly messages: FederationMessages;
  private nextId = 1;
  private closedReason: string | null = null;

  /** The protocol version the SERVER said it would speak, for diagnostics. */
  public serverProtocolVersion = "";
  /** The server's self-reported identity, for diagnostics and audit. Untrusted, like everything
   * else it sends — recorded, never acted on. */
  public serverInfo: { name?: string | undefined; version?: string | undefined } = {};

  constructor(deps: { channel: McpStdioChannel; requestTimeoutMs: number; clientInfo: McpClientInfo; messages: FederationMessages }) {
    this.channel = deps.channel;
    this.clientInfo = deps.clientInfo;
    this.messages = deps.messages;
    this.requestTimeoutMs = deps.requestTimeoutMs;
    this.channel.onMessage({ listener: ({ message: line }) => this.handleMessage(line) });
    this.channel.onClose({ listener: ({ reason }) => this.handleClose(reason) });
  }

  /**
   * @complexity O(p) in the number of `tools/list` pages, bounded by {@link MAX_LIST_TOOLS_PAGES}.
   */
  async listTools(): Promise<RemoteToolDescriptor[]> {
    return drainToolsList({ requestPage: ({ params }) => this.request("tools/list", params) });
  }

  /**
   * @complexity O(1) beyond the remote's own round-trip.
   */
  async callTool(request: McpToolCallRequiredArgs, options: McpToolCallOptions = {}): Promise<RemoteToolResult> {
    return parseCallToolResult({ result: await this.request("tools/call", { name: request.name, arguments: request.arguments }, options.signal) });
  }

  async close(_required: Record<string, never>): Promise<void> {
    this.handleClose(this.messages.closedByHost);
    this.channel.close({});
  }

  /** Sends the handshake. Separate from the constructor because it is the one part that can fail,
   * and a session object that exists must be one that completed it. */
  async initialize(): Promise<void> {
    const identity = parseInitializeResult({ result: await this.request("initialize", buildInitializeParams({ clientInfo: this.clientInfo })) });
    this.serverProtocolVersion = identity.protocolVersion;
    this.serverInfo = identity.info;
    // MCP requires this notification after a successful initialize, and requires that a
    // notification carry no `id` — a server is entitled to reject the session otherwise.
    this.channel.send({ message: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  }

  private request(method: string, params: Record<string, unknown>, signal?: AbortSignal | undefined): Promise<unknown> {
    if (this.closedReason !== null) {
      return Promise.reject(new McpProtocolError({ message: `mcp-federation: session is closed (${this.closedReason})` }));
    }
    const id = this.nextId++;

    return new Promise<unknown>((resolve, reject) => {
      // Deliberately NOT `unref()`ed. An unref'd timer lets the event loop drain while a request is
      // still in flight, which means the request's promise is abandoned unsettled rather than
      // rejected — a caller awaiting it simply never continues. It bought nothing anyway: shutdown
      // is `close()`, and `handleClose` already rejects every pending request and clears every
      // timer, so a session being torn down never waits on this timer regardless.
      const timer = setTimeout(() => {
        // Settle AND forget. Deleting the entry is what makes a late reply to this id a no-op
        // rather than a resolution of whatever call happens to be waiting later.
        this.pending.delete(id);
        reject(new McpProtocolError({ message: `mcp-federation: '${method}' timed out after ${this.requestTimeoutMs}ms` }));
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      if (signal) {
        if (signal.aborted) {
          this.settleRejection(id, new McpProtocolError({ message: `mcp-federation: '${method}' was aborted before it was sent` }));
          return;
        }
        signal.addEventListener("abort", () => this.settleRejection(id, new McpProtocolError({ message: `mcp-federation: '${method}' was aborted` })), {
          once: true,
        });
      }

      try {
        this.channel.send({ message: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
      } catch (error) {
        this.settleRejection(id, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private settleRejection(id: number, error: Error): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    entry.reject(error);
  }

  private handleMessage(line: string): void {
    if (line.length > MAX_INBOUND_MESSAGE_BYTES) return;
    const message = parseJsonRpcLine(line);
    // Servers routinely emit non-JSON banner noise on the same stream. Dropping it is correct;
    // throwing would let a stray log line kill an otherwise healthy session.
    if (!message) return;

    // An inbound message carrying a `method` is the server calling US. host app advertises no
    // capabilities in `initialize`, so there is nothing it may legitimately ask for — notably
    // `sampling/createMessage`, which would have host app run model inference on the remote's behalf.
    // Requests get a well-formed refusal; notifications (`tools/list_changed` included, see
    // `trust.ts` R5) are ignored.
    if (typeof message.method === "string") {
      this.refuseUnsupportedServerRequest(message);
      return;
    }

    this.resolvePendingRequest(message);
  }

  /** The "server called a method on us" half of {@link handleMessage} — split out purely to keep
   *  that function's complexity under the shop ceiling. A notification (no `id`) is silently
   *  ignored; a request gets a well-formed JSON-RPC refusal. */
  private refuseUnsupportedServerRequest(message: JsonRpcResponse): void {
    if (message.id === undefined || message.id === null) return;
    this.channel.send(
      { message: JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `method '${message.method}' is not supported by this client` } }) },
    );
  }

  /** The "this is a reply to one of our own requests" half of {@link handleMessage} — split out
   *  purely to keep that function's complexity under the shop ceiling. */
  private resolvePendingRequest(message: JsonRpcResponse): void {
    if (typeof message.id !== "number") return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);

    if (message.error) {
      entry.reject(new McpProtocolError({ message: `mcp-federation: remote returned JSON-RPC error ${message.error.code ?? "?"}: ${message.error.message ?? "(no message)"}` }));
      return;
    }
    entry.resolve(message.result);
  }

  private handleClose(reason: string): void {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    // Every in-flight request must be settled, or a caller awaits forever on a dead pipe.
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(new McpProtocolError({ message: `mcp-federation: session closed before the request completed (${reason})` }));
    }
  }
}

/**
 * Performs the MCP handshake over `channel` and returns the connected session.
 *
 * @param deps.channel - The transport seam. `spawnMcpStdioChannel` in production, a scripted
 * double in tests.
 * @param deps.requestTimeoutMs - Per-request ceiling, applied to the handshake too.
 * @throws {Error} If `initialize` fails, times out, or the channel dies during it.
 * @complexity O(1) beyond the remote's round-trip.
 */
export async function connectMcpStdioSession(deps: { channel: McpStdioChannel; requestTimeoutMs: number; clientInfo: McpClientInfo; messages: FederationMessages }): Promise<McpSessionPort> {
  const session = new McpStdioSession(deps);
  try {
    await session.initialize();
  } catch (error) {
    // A failed handshake must not leave a child process parented to the daemon forever.
    await session.close({}).catch(() => undefined);
    throw error;
  }
  return session;
}

/**
 * The production {@link McpStdioChannel}: a child process, its stdin, and newline-framed stdout.
 *
 * Deliberately logic-free — reassembly and nothing else — because everything above it is already
 * under test through the channel seam, and code that only runs when a real process exists is code
 * that only fails in production.
 *
 * `env` REPLACES rather than extends the parent environment, which is the security-relevant choice:
 * the daemon's own `process.env` holds `host daemon credential` (`daemon-auth.ts`), and handing
 * that to a third-party vendor's child process would give it host app's own daemon credential — the
 * exact inversion of the `mcp-injection.ts` grant, and a far worse one. A federated server receives
 * what `config.ts` explicitly puts in `env`, plus what {@link buildMcpChildEnv} inherits and nothing else.
 *
 * Takes a {@link ResolvedStdioLaunch} rather than an {@link McpStdioLaunchSpec} (S2 of the
 * desktop-npx plan): the launch has already passed through the injected `McpStdioLaunchResolver`
 * by the time it gets here, so `resolved.command`/`resolved.args` are already whatever the resolver
 * decided to run, and `resolved.launchEnv` is threaded into {@link buildMcpChildEnv} alongside the
 * connection's own `env`. On every non-desktop deployment `resolved` is the identity resolver's
 * output — `command`/`args`/`env` unchanged, `launchEnv: {}` — so this stays byte-identical to
 * before the resolver existed.
 *
 * @complexity O(n) in bytes received.
 */
export function spawnMcpStdioChannel(resolved: ResolvedStdioLaunch & { messages: FederationMessages }): McpStdioChannel {
  const child = spawn(resolved.command, [...resolved.args], {
    cwd: resolveStdioChildCwd({ resolved: resolved }),
    env: buildMcpChildEnv({ command: resolved.command, specEnv: resolved.env }, { launchEnv: resolved.launchEnv }),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const messageListeners: Array<(required: { message: string }) => void> = [];
  const closeListeners: Array<(required: { reason: string }) => void> = [];
  let buffer = "";
  let closed = false;
  // Set the instant the child exits, before the close reason is final (see the `exit` handler), so
  // `send` never writes into a dead pipe — an EPIPE on `stdin` has no listener and would crash the
  // daemon.
  let exited = false;
  const secretValues = Object.values(resolved.env);
  const stderrTail = createStderrTail({ secretValues: secretValues });

  const emitClose = (reason: string): void => {
    if (closed) return;
    closed = true;
    for (const listener of closeListeners) listener({ reason: reason });
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length > MAX_INBOUND_MESSAGE_BYTES) {
      // A remote streaming an unterminated line past the cap is not recoverable — the framing is
      // already lost. Drop the connection rather than growing the buffer.
      buffer = "";
      emitClose("inbound message exceeded the size cap");
      child.kill();
      return;
    }
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) for (const listener of messageListeners) listener({ message: line });
      newline = buffer.indexOf("\n");
    }
  });

  // stderr is a diagnostic channel for MCP servers, never a protocol one. Consumed so the pipe
  // cannot fill and deadlock the child, and never parsed — but its tail is kept, because when a
  // server dies at startup that is the ONLY place it says why (2026-09-29: `npx -y namecom-mcp`
  // failing with npm's EUNSUPPORTEDPROTOCOL reached the operator as a bare "exited (code=1)").
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail.append({ chunk: chunk });
  });

  child.on("error", (error: Error) => emitClose(`child process error: ${error.message}`));
  child.on("exit", (code, signal) => {
    exited = true;
    // `exit` can fire before the child's last stderr bytes are read; `end` means they have been.
    // Bounded, because a grandchild still holding the pipe (npx → node) could postpone `end` forever.
    const finish = (): void => emitClose(describeChildExit({ code: code, signal: signal, stderrTail: stderrTail.text(), secretValues: secretValues }));
    if (child.stderr.readableEnded) {
      finish();
      return;
    }
    const drainTimer = setTimeout(finish, STDERR_DRAIN_MS);
    child.stderr.once("end", () => {
      clearTimeout(drainTimer);
      finish();
    });
  });

  return {
    send({ message }: { message: string }): void {
      if (closed || exited) throw new Error("mcp-federation: cannot write to a closed stdio channel");
      child.stdin.write(`${message}\n`);
    },
    onMessage({ listener }) {
      messageListeners.push(listener);
    },
    onClose({ listener }) {
      closeListeners.push(listener);
    },
    close(_required: Record<string, never>): void {
      emitClose(resolved.messages.closedByHost);
      child.stdin.end();
      child.kill();
    },
  };
}

/**
 * The parent environment variables a federated server inherits on EVERY platform (win32 adds
 * {@link WIN32_INHERITED_ENV_VARS}) — an explicit allowlist, so
 * adding to it is a visible decision rather than a default.
 *
 * Not merely `PATH`: the Supabase preset launches via `npx`, which resolves its package cache under
 * `HOME` (and writes to `TMPDIR`). A child spawned with `PATH` alone would fail to start at all, or
 * silently re-download on every boot — the kind of bug that only appears in production, since no
 * test spawns a real process.
 *
 * Deliberately absent: everything else. `host daemon credential` most of all (see this function's
 * caller), but also proxy and CA variables — those can carry embedded credentials, and an operator
 * who genuinely needs them should put them in a connection's own `env` where the grant is written
 * down.
 */
const INHERITED_ENV_VARS = ["PATH", "HOME", "TMPDIR"] as const;

/**
 * win32 only: the further parent variables a Windows child needs to start at all. None carries a
 * secret — each names a system or per-user directory, or the executable-extension list.
 *
 * Without them a Windows child can fail in ways that name none of these: `SystemRoot`/`windir` are
 * read by Winsock and the C runtime during process start (a Node or Python child cannot open a
 * socket without `SystemRoot`), `ComSpec` and `PATHEXT` are how a child resolves and runs other
 * programs, `USERPROFILE`/`APPDATA`/`LOCALAPPDATA` are Windows' `HOME` (npm's prefix and cache live
 * under them), and `TEMP`/`TMP` are Windows' `TMPDIR`.
 */
const WIN32_INHERITED_ENV_VARS = [
  "SystemRoot",
  "windir",
  "ComSpec",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
] as const;

/** Electron's run-as-Node switch. Env-only: Electron has no command-line flag for it. */
const ELECTRON_RUN_AS_NODE = "ELECTRON_RUN_AS_NODE";

/** {@link buildMcpChildEnv}'s input. Everything past `specEnv` is a test seam that defaults to the
 *  real process; production passes only `command` and `specEnv`. */
interface McpChildEnvInput {
  /** The child's `command`, compared against `execPath` on win32. */
  readonly command: string;
  /** The connection's own `env`, which wins over anything inherited AND over `launchEnv`. */
  readonly specEnv: Readonly<Record<string, string>>;
  /**
   * The stdio launch resolver's own additions (S2 of the desktop-npx plan) — `ELECTRON_RUN_AS_NODE`,
   * `PATH`, `npm_config_*` — from `stdio-launch-resolver.ts`'s {@link ResolvedStdioLaunch.launchEnv}.
   * Layered between the inherited allowlist and `specEnv`: it can add variables the parent process
   * never had, but the connection's own `env` still wins over it, including an explicit `PATH` that
   * deliberately drops the toolchain shims — the user's own call, per plan §4. Defaults to `{}`, so
   * omitting it (every caller before this parameter existed, and every non-desktop deployment today)
   * leaves the result byte-identical.
   */
  readonly launchEnv?: Readonly<Record<string, string>> | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly parentEnv?: NodeJS.ProcessEnv | undefined;
  readonly execPath?: string | undefined;
}

/**
 * The complete environment one federated MCP child is spawned with.
 *
 * On every platform: {@link INHERITED_ENV_VARS} from the parent, then `launchEnv`, then the
 * connection's own `env` over the top of both. On darwin and linux, with `launchEnv` empty (every
 * non-desktop deployment), that is ALL — byte-identical to what this adapter has always sent.
 *
 * On win32, two further additions:
 *
 * 1. {@link WIN32_INHERITED_ENV_VARS}, which Windows programs need to start.
 * 2. `ELECTRON_RUN_AS_NODE`, but ONLY when the child's `command` is this process's own executable
 *    and this process itself runs with it set. host app Desktop registers its own Electron binary as the
 *    command of its `host-desktop` connection on win32, where no launcher script can be exec'd, and
 *    without this variable that binary opens a second GUI app instead of running the bridge script.
 *    Carrying it here rather than in the connection's `env` matters: a row's `env` is sealed with the
 *    site's root key, so a flag in it fails the whole save with `SECRET_STORE_UNCONFIGURED` on a
 *    site that has none. The rule is narrow on purpose — "a child that is this very binary runs in
 *    the mode this binary runs in" — so no third-party child ever has its runtime mode changed.
 *
 * Empty parent values are skipped, as they always were.
 *
 * @complexity O(k) in the number of inherited names.
 */
export function buildMcpChildEnv({
  command,
  specEnv,
}: Pick<McpChildEnvInput, "command" | "specEnv">, {
  launchEnv = {},
  platform = process.platform,
  parentEnv = process.env,
  execPath = process.execPath,
}: Omit<McpChildEnvInput, "command" | "specEnv"> = {}): Record<string, string> {
  const isWin32 = platform === "win32";
  const names: readonly string[] = isWin32 ? [...INHERITED_ENV_VARS, ...WIN32_INHERITED_ENV_VARS] : INHERITED_ENV_VARS;
  const inherited: Record<string, string> = {};
  for (const name of names) {
    const value = parentEnv[name];
    if (typeof value === "string" && value.length > 0) inherited[name] = value;
  }
  const runMode = parentEnv[ELECTRON_RUN_AS_NODE];
  if (isWin32 && typeof runMode === "string" && runMode.length > 0 && isSameWin32Path(command, execPath)) {
    inherited[ELECTRON_RUN_AS_NODE] = runMode;
  }
  return { ...inherited, ...launchEnv, ...specEnv };
}

/** Whether two win32 paths name the same file: resolved, then compared case-insensitively, as
 *  Windows' own file system does. @complexity O(n) in the path length. */
function isSameWin32Path(a: string, b: string): boolean {
  return path.win32.resolve(a).toLowerCase() === path.win32.resolve(b).toLowerCase();
}

/** Best-effort JSON-RPC parse of one inbound line, or `null` for anything that does not parse.
 *  Split out of {@link McpStdioSession.handleMessage} purely to keep that method's complexity under
 *  the shop ceiling. */
function parseJsonRpcLine(line: string): JsonRpcResponse | null {
  try {
    return JSON.parse(line) as JsonRpcResponse;
  } catch {
    return null;
  }
}


