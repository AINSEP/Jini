import { execFileSync, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { createCommandInvocation } from "@jini-ai/platform/command";
import { collectProcessTreePids, listProcessSnapshots, stopProcesses, waitForProcessExit } from "@jini-ai/platform/process";
import { readLiveDaemonRegistryRecord, removeDaemonRegistryRecordIfCurrent, writeDaemonRegistryRecord } from "./daemon-registry.js";
import type { LocalDaemonRegistryRecord } from "./daemon-registry.js";
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
  return {
    spawnDaemonProcess() {
      const win32 = (options.platform ?? process.platform) === "win32";
      const invocation = createCommandInvocation({ command: required.command, args: [...required.args], env: required.env });
      // detached creates a POSIX process group so teardown reaches the daemon below a
      // launcher hop; windowsHide avoids an otherwise visible detached Windows console.
      // Pipe output through the parent instead of inheriting its descriptors: an orphan
      // retaining those descriptors previously kept parent/test teardown waiting forever.
      const spawnOptions: SpawnOptions = {
        cwd: required.cwd, env: { ...required.env, ...(win32 ? { JINI_STOP_ON_STDIN_EOF: "1" } : {}) }, detached: true, windowsHide: true,
        stdio: [win32 ? "pipe" : "ignore", "pipe", "pipe"],
        ...(invocation.windowsVerbatimArguments === undefined ? {} : { windowsVerbatimArguments: invocation.windowsVerbatimArguments }),
      };
      const child = options.spawn
        ? options.spawn({ command: invocation.command, args: invocation.args, options: spawnOptions }, {})
        : spawn(invocation.command, invocation.args, spawnOptions);
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
