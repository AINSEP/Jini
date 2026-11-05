import { execFileSync, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { Serializable } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createCommandInvocation } from "@jini-ai/platform/command";
import { omitEnvironmentKeys } from "@jini-ai/platform/child-environment";
import { collectProcessTreePids, listProcessSnapshots, stopProcesses, waitForProcessExit } from "@jini-ai/platform/process";
import { readLiveDaemonRegistryRecord, removeDaemonRegistryRecordIfCurrent, writeDaemonRegistryRecord } from "../daemon-registry.js";
import type { LocalDaemonRegistryRecord } from "../daemon-registry.js";
import type { SpawnedDaemonProcess, SupervisorScheduler } from "./supervisor.js";

export interface SupervisorRegistry {
  readLive(): Promise<LocalDaemonRegistryRecord | null>;
  write(input: { record: LocalDaemonRegistryRecord }): Promise<void>;
  removeIfCurrent(input: { pid: number }): Promise<void>;
}

/**
 * Reuse the sidecar registry's atomic records, liveness checks and ownership-guarded removal.
 * The child calls write only after it actually starts listening.
 * @param required Host-owned registry path.
 * @returns A registry port with object arguments at all data-bearing boundaries.
 * @complexity O(1) operations, excluding filesystem I/O.
 */
export function createSupervisorRegistry({ registryPath }: { registryPath: string }): SupervisorRegistry {
  return {
    readLive: () => readLiveDaemonRegistryRecord({ registryPath }),
    write: ({ record }) => writeDaemonRegistryRecord({ registryPath, record }),
    removeIfCurrent: ({ pid }) => removeDaemonRegistryRecordIfCurrent({ registryPath, pid }),
  };
}

export interface NodeDaemonProcessRequired {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  registry: SupervisorRegistry;
}
export interface NodeDaemonProcessOptions {
  /** Inherit a separate native control channel; stdin remains the Windows EOF shutdown pipe. */
  ipc?: boolean;
  /** Delivered once over native IPC, removed case-insensitively from the OS environment. */
  startupSecrets?: Readonly<Record<string, string>>;
  stdout?: Writable; stderr?: Writable; platform?: NodeJS.Platform;
  /** Native spawn effect port; the adapter still constructs argv, environment and process options. */
  spawn?: (input: { command: string; args: string[]; options: SpawnOptions }, optional?: Record<string, never>) => ChildProcess;
  /** Native effect ports retain their platform ABI so tests can supply DI fakes. */
  listProcessSnapshots?: typeof listProcessSnapshots;
  waitForProcessExit?: typeof waitForProcessExit;
  stopProcesses?: typeof stopProcesses;
  signalProcess?: typeof process.kill;
  execFileSync?: (file: string, args: readonly string[], options: { stdio: "ignore" }) => unknown;
}

function relayProcessOutput(
  { stream, sink }: { stream: Readable | null; sink: Writable | undefined },
  _options: Record<string, never> = {},
): void {
  // Sinks belong to the host and must survive EOF from a child that may respawn.
  if (sink !== undefined) stream?.pipe(sink, { end: false });
  else stream?.resume();
}

async function stopWindowsProcess(
  { child, pid }: { child: SpawnedDaemonProcess; pid: number },
  options: NodeDaemonProcessOptions = {},
): Promise<void> {
  // Windows has no group signal, so taskkill supplies the tree-stop escalation.
  // Windows has no POSIX group signal. Killing only the immediate launcher would
  // orphan its daemon; taskkill /T walks the entire descendant tree instead.
  let exited = false;
  if (child.closeStdin !== undefined) {
    try {
      child.closeStdin({});
      // Reuse platform's existing 5s grace before any forced Windows termination.
      exited = await (options.waitForProcessExit ?? waitForProcessExit)(pid);
    } catch { /* A broken pipe cannot request shutdown; escalate to the whole tree. */ }
  }
  if (!exited) {
    try {
      (options.execFileSync ?? execFileSync)("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch { child.kill({}, { signal: "SIGTERM" }); }
  }
}

/** Build an OS environment, reserving IPC for capabilities while stdin remains the stop pipe.
 * @returns A detached launch environment. @complexity O(e + k) for env entries and secret keys.
 */
function daemonLaunchEnvironment(required: NodeDaemonProcessRequired, options: NodeDaemonProcessOptions = {}): NodeJS.ProcessEnv {
  if (options.startupSecrets === undefined) return required.env;
  return { ...splitNodeStartupSecrets({ env: required.env, keys: Object.keys(options.startupSecrets) }).env,
    [STARTUP_SECRETS_ENV]: '1' };
}

/** Resolve command quoting and native descriptors without creating a process.
 * Detached groups enable tree stopping; parent output pipes cannot strand inherited descriptors.
 * @returns The command invocation, Windows mode and native spawn options. @complexity O(e) env copy.
 */
function daemonLaunchPlan(required: NodeDaemonProcessRequired, options: NodeDaemonProcessOptions = {}) {
  const win32 = (options.platform ?? process.platform) === 'win32';
  const env = daemonLaunchEnvironment(required, options);
  const invocation = createCommandInvocation({ command: required.command, args: [...required.args], env });
  const ipc = options.ipc || options.startupSecrets !== undefined;
  const spawnOptions: SpawnOptions = {
    cwd: required.cwd, env: { ...env, ...(win32 ? { JINI_STOP_ON_STDIN_EOF: '1' } : {}) }, detached: true, windowsHide: true,
    stdio: [win32 ? 'pipe' : 'ignore', 'pipe', 'pipe', ...(ipc ? ['ipc' as const] : [])],
    ...(invocation.windowsVerbatimArguments === undefined ? {} : { windowsVerbatimArguments: invocation.windowsVerbatimArguments }),
  };
  return { invocation, spawnOptions, win32 };
}

/**
 * Node launch/tree-stop adapter using platform command quoting, snapshots and signal escalation.
 * @param required Complete host launch settings and the shared sidecar registry port.
 * @param options Optional native spawn port and sinks; output is piped through the parent rather than inherited.
 * @returns Supervisor process ports. Construction has no process or filesystem effects.
 * @complexity Tree stop is O(p) for p process snapshots, plus platform exit polling.
 */
export function createNodeDaemonProcessAdapter(required: NodeDaemonProcessRequired, options: NodeDaemonProcessOptions = {}): {
  spawnDaemonProcess(): SpawnedDaemonProcess;
  terminateProcess(input: { child: SpawnedDaemonProcess }): Promise<void>;
} {
  // Validate/snapshot before spawning: a launch must not orphan a child when delivery is refused.
  const startupSecrets = options.startupSecrets === undefined ? undefined : startupSecretRecord(options.startupSecrets);
  const launchOptions = startupSecrets === undefined ? options : { ...options, startupSecrets };
  return {
    spawnDaemonProcess() {
      const { invocation, spawnOptions, win32 } = daemonLaunchPlan(required, launchOptions);
      const child = options.spawn
        ? options.spawn({ command: invocation.command, args: invocation.args, options: spawnOptions }, {})
        : spawn(invocation.command, invocation.args, spawnOptions);
      if (startupSecrets !== undefined) {
        const delivery = provideNodeStartupSecrets({ peer: child, secrets: startupSecrets });
        child.once('exit', () => delivery.dispose({}));
        child.once('error', () => delivery.dispose({}));
      }
      relayProcessOutput({ stream: child.stdout, sink: options.stdout });
      relayProcessOutput({ stream: child.stderr, sink: options.stderr });
      return {
        get pid() { return child.pid; },
        on(input) {
          if (input.event === "exit") child.on("exit", (code, signal) => input.listener({ code, signal }));
          else child.on("error", (error) => input.listener({ error }));
        },
        kill(_required, { signal } = {}) { return child.kill(signal); },
        ...(win32 && child.stdin ? { closeStdin(_required: Record<string, never>) {
          // EPIPE when the daemon exits first must not become an unhandled stream error.
          child.stdin!.once("error", () => undefined).end();
        } } : {}),
      };
    },
    async terminateProcess({ child }) {
      if (child.pid === undefined) return;
      const pid = child.pid;
      const snapshotRequest = (options.listProcessSnapshots ?? listProcessSnapshots)();
      // Request stop before the first await: even a parent exiting immediately starts tree teardown.
      if ((options.platform ?? process.platform) === "win32") {
        await stopWindowsProcess({ child, pid }, options);
      } else {
        try { (options.signalProcess ?? process.kill)(-pid, "SIGTERM"); }
        catch { child.kill({}, { signal: "SIGTERM" }); }
      }
      const snapshots = await snapshotRequest;
      const pids = collectProcessTreePids(snapshots, [pid]);
      const result = await (options.stopProcesses ?? stopProcesses)(pids);
      if (result.remainingPids.length > 0) throw new Error(`daemon processes still running: ${result.remainingPids.join(", ")}`);
      await required.registry.removeIfCurrent({ pid });
    },
  };
}

/**
 * Node timer adapter; importing/constructing it schedules no work.
 * @param required Empty required arguments object.
 * @returns Scheduler using setTimeout and clearTimeout.
 * @complexity O(1) per schedule/cancel.
 */
export function createNodeSupervisorScheduler(_required: Record<string, never>): SupervisorScheduler {
  return { schedule: ({ delayMs, run }) => { const timer = setTimeout(run, delayMs); return () => clearTimeout(timer); } };
}

/** A channel bound to one native child (or its process end), never an address supplied by a caller. */
export interface NodeIpcPeer {
  readonly connected?: boolean;
  send?: (message: Serializable, callback: (error: Error | null) => void) => boolean;
  on(event: "message" | "disconnect", listener: (message: unknown) => void): unknown;
  removeListener(event: "message" | "disconnect", listener: (message: unknown) => void): unknown;
}

/** Native deserialization supplies plain objects; accept only this channel's envelope. O(1). */
function isIpcEnvelope(message: unknown): message is { id: string; kind: unknown; payload?: unknown; ok?: unknown; channel?: unknown; refusalReason?: unknown } {
  if (typeof message !== "object" || message === null) return false;
  return "jiniIpc" in message && message.jiniIpc === 1 && "id" in message && typeof message.id === "string" && "kind" in message;
}

/** Only explicitly public, bounded refusal text may cross IPC. Raw handler messages stay private.
 * @complexity O(1); the caller owns choosing a reason that contains no private data.
 */
export function ipcRefusalReason({ value }: { value: unknown }, _optional = {}): string | undefined {
  if (typeof value !== "object" || value === null || !("refusalReason" in value)) return undefined;
  const reason = value.refusalReason;
  if (typeof reason !== "string") return undefined;
  return reason.length > 0 && reason.length <= 1024 ? reason : undefined;
}

/** Native request/reply with bounded pending work. Errors never echo a request, payload or raw handler error.
 * Handlers may opt into public diagnostics by throwing an error with a `refusalReason` string
 * (1–1024 characters), e.g. `Object.assign(new Error(), { refusalReason: "This session ended." })`.
 * @param required The actual spawned child or inherited process channel.
 * @param optional Handler, deadline and pending-request cap; construction starts no requests.
 * @returns Request and idempotent disposal; disconnect rejects and clears every pending request.
 * @throws On disconnected IPC, timeout, refusal, >1 MiB envelope or capacity overflow.
 * @complexity O(payload bytes) per send, O(p) disconnect for at most maxPending requests.
 */
export function createNodeIpcChannel({ peer }: { peer: NodeIpcPeer }, {
  handle, timeoutMs = 30_000, maxPending = 64, channel,
}: { handle?: (payload: unknown) => Promise<Serializable>; timeoutMs?: number; maxPending?: number; channel?: string } = {}) {
  const pending = new Map<string, { finish(error: Error | null, payload?: unknown): void }>();
  let disposed = false;
  let handling = 0;
  function send(envelope: Record<string, Serializable>): void {
    const message = channel === undefined ? envelope : { ...envelope, channel };
    if (disposed || !peer.connected || !peer.send) throw new Error("IPC disconnected");
    if (Buffer.byteLength(JSON.stringify(message)) > 1024 * 1024) throw new Error("IPC envelope too large");
    peer.send(message, error => { if (error) dispose({}); });
  }
  function reply(message: Record<string, Serializable>): void {
    try { send(message); } catch { dispose({}); } // A departing peer cannot receive a refusal.
  }
  /** Complete only a matching request, preserving explicit public refusals. O(1) lookup. */
  function receiveReply({ message }: { message: { id: string; ok?: unknown; payload?: unknown } }, _optional = {}): void {
    const refusalReason = ipcRefusalReason({ value: message });
    const error = message.ok === true ? null : Object.assign(new Error(refusalReason ?? "IPC request refused"),
      refusalReason === undefined ? {} : { refusalReason });
    pending.get(message.id)?.finish(error, message.payload);
  }
  function receive(message: unknown): void {
    if (disposed || !isIpcEnvelope(message) || message.channel !== channel) return;
    const { id } = message;
    if (message.kind === "reply") {
      receiveReply({ message });
    } else if (message.kind === "request" && handle) {
      if (handling >= maxPending) { reply({ jiniIpc: 1, kind: "reply", id, ok: false }); return; }
      handling++;
      void Promise.resolve().then(() => handle(message.payload)).then(
        payload => reply({ jiniIpc: 1, kind: "reply", id, ok: true, payload }),
        error => {
          const refusalReason = ipcRefusalReason({ value: error });
          reply({ jiniIpc: 1, kind: "reply", id, ok: false, ...(refusalReason ? { refusalReason } : {}) });
        },
      ).catch(() => {}).finally(() => { handling--; }); // A disconnected peer cannot receive its reply.
    }
  }
  function dispose(_required: Record<string, never>, _optional = {}): void {
    disposed = true;
    peer.removeListener("message", receive); peer.removeListener("disconnect", disconnect);
    for (const request of pending.values()) request.finish(new Error("IPC disconnected"));
  }
  const disconnect = () => dispose({});
  peer.on("message", receive); peer.on("disconnect", disconnect);
  return {
    request({ payload }: { payload: Serializable }, _optional = {}): Promise<unknown> {
      if (disposed || !peer.connected) return Promise.reject(new Error("IPC disconnected"));
      if (pending.size >= maxPending) return Promise.reject(new Error("IPC capacity exceeded"));
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => pending.get(id)?.finish(new Error("IPC request timed out")), timeoutMs);
        pending.set(id, { finish(error, value) { clearTimeout(timer); pending.delete(id); if (error) reject(error); else resolve(value); } });
        try { send({ jiniIpc: 1, kind: "request", id, payload }); }
        catch (error) {
          const reason = error instanceof Error && error.message === "IPC envelope too large" ? error.message : "IPC send failed";
          pending.get(id)?.finish(new Error(reason));
        }
      });
    },
    dispose,
  };
}

/** Non-secret launch marker; the payload itself never enters argv or process.env. */
export const STARTUP_SECRETS_ENV = 'JINI_STARTUP_SECRETS_IPC';

/** Separate host-selected capabilities from a launch environment without mutating it.
 * Windows case variants map to the canonical host key; absent values create no credential.
 * @returns Independent environment and capability records; throws beyond the 64 KiB/256-key limit.
 * @complexity O(e + k) time/space.
 * @example splitNodeStartupSecrets({ env, keys: ['HOST_TOKEN'] });
 */
export function splitNodeStartupSecrets({ env, keys }: {
  env: Readonly<NodeJS.ProcessEnv>; keys: readonly string[];
}, _optional: Record<string, never> = {}): { env: NodeJS.ProcessEnv; secrets: Record<string, string> } {
  const names = new Map(keys.map(key => [key.toUpperCase(), key]));
  const secrets = Object.fromEntries(Object.entries(env).flatMap(([key, value]) => {
    const name = names.get(key.toUpperCase());
    return name !== undefined && value !== undefined ? [[name, value]] : [];
  }));
  return { env: omitEnvironmentKeys({ env, keys }, { caseInsensitive: true }).env, secrets: startupSecretRecord(secrets) };
}

/** Validate the small startup record without echoing values into diagnostics. O(bytes), capped at 64 KiB. */
function startupSecretRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid startup credentials');
  const entries = Object.entries(value);
  if (entries.length > 256 || entries.some(([, secret]) => typeof secret !== 'string')) throw new Error('Invalid startup credentials');
  if (Buffer.byteLength(JSON.stringify(value)) > 65536) throw new Error('Startup credentials exceed limit');
  return Object.fromEntries(entries) as Record<string, string>;
}

/** Offer credentials to this native child once, sharing IPC with the existing control owner.
 * @returns A disposer for child exit/error; disconnect also clears the channel.
 * @throws For an invalid/oversized record. Refusals never contain credentials.
 * @complexity O(bytes) bounded copy; one in-memory record until the child's first read.
 * @example provideNodeStartupSecrets({ peer: child, secrets: { HOST_TOKEN: token } });
 */
export function provideNodeStartupSecrets({ peer, secrets }: {
  peer: NodeIpcPeer; secrets: Readonly<Record<string, string>>;
}, _optional: Record<string, never> = {}) {
  let remaining: Record<string, string> | undefined = startupSecretRecord(secrets);
  const channel = createNodeIpcChannel({ peer }, { channel: 'startup-secrets', handle: async payload => {
    if (payload !== 'read' || remaining === undefined) throw new Error('Startup credentials already consumed');
    const result = remaining;
    remaining = undefined;
    return result;
  } });
  return { dispose(_required: Record<string, never> = {}, _options: Record<string, never> = {}) { remaining = undefined; channel.dispose({}); } };
}

/** Read credentials over inherited IPC and release the receiver even on timeout/disconnect.
 * The caller retains the returned record in memory; it must never assign it to process.env.
 * @throws On unavailable IPC, refusal, timeout or malformed credentials.
 * @complexity O(bytes) bounded validation; one request with a 30s default deadline.
 * @example const secrets = await receiveNodeStartupSecrets({ peer: process });
 */
export async function receiveNodeStartupSecrets({ peer }: { peer: NodeIpcPeer }, {
  timeoutMs = 30_000,
}: { timeoutMs?: number } = {}): Promise<Record<string, string>> {
  const channel = createNodeIpcChannel({ peer }, { channel: 'startup-secrets', timeoutMs });
  try { return startupSecretRecord(await channel.request({ payload: 'read' }, {})); }
  finally { channel.dispose({}); }
}
