/**
 * Generalized from OD `apps/packaged/src/sidecars.ts`'s spawn/discover/
 * shutdown mechanics (`startPackagedSidecars`/`waitForStatus`/
 * `closeManagedChild`) — NOT a lift of that file, which is ~620 lines deep
 * in OD's own two-sidecar (daemon+web) model, `@open-design/sidecar-proto`'s
 * JSON-IPC wire format, PostHog/telemetry env forwarding, and legacy-data
 * migration timeouts. None of that is generic. What C7 actually names
 * ("sidecar launch/discovery... shutdown, crash recovery") is: spawn a
 * child process with output captured to a log file, poll a
 * caller-supplied readiness probe until it reports ready — racing the
 * child's own exit so a sidecar that crashes at startup fails fast instead
 * of hanging out the full timeout — then, on shutdown, ask the child to
 * stop gracefully with a caller-supplied request and fall back to a signal
 * kill if it doesn't exit in time. This file rebuilds exactly that,
 * transport-agnostic (the probe/shutdown-request functions are the
 * caller's business, not a specific IPC wire format this package invents).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFile, mkdir, open, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export interface SidecarProcessHandle {
  readonly pid: number | undefined;
  onExit({ listener }: { listener: (args: { code: number | null; signal: NodeJS.Signals | null }) => void }): void;
  kill(requiredArgs: Record<string, never>, optionalArgs?: { signal?: NodeJS.Signals }): boolean;
}

export interface SidecarLaunchOptions {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  logPath?: string;
}

export interface SidecarReadyOptions<T> {
  probe: () => Promise<T>;
  isReady: (args: { status: T }) => boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface SidecarShutdownOptions {
  requestShutdown?: () => Promise<void>;
  gracefulTimeoutMs?: number;
}

export interface SidecarHandle {
  readonly process: SidecarProcessHandle;
  readonly logPath: string | null;
  waitUntilReady<T>(requiredArgs: Pick<SidecarReadyOptions<T>, 'probe' | 'isReady'>, optionalArgs?: Omit<SidecarReadyOptions<T>, 'probe' | 'isReady'>): Promise<T>;
  shutdown(requiredArgs: Record<string, never>, options?: SidecarShutdownOptions): Promise<void>;
}

export interface SidecarLauncherPort {
  launch(requiredArgs: Pick<SidecarLaunchOptions, 'command'>, optionalArgs?: Omit<SidecarLaunchOptions, 'command'>): Promise<SidecarHandle>;
}

const DEFAULT_READY_TIMEOUT_MS = 35_000;
const DEFAULT_POLL_INTERVAL_MS = 150;
const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000;

async function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

async function waitUntilReady<T>(
  child: ChildProcess,
  logPath: string | null,
  options: SidecarReadyOptions<T>,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let lastError: unknown;
  const exitError = (code: number | null, signal: NodeJS.Signals | null) => new Error(
    `sidecar exited before reporting ready (code=${code}, signal=${signal ?? 'none'})${
      logPath == null ? '' : `; see ${logPath} for details`
    }`,
  );
  const timeoutError = () => new Error(
    `timed out waiting for sidecar to become ready${lastError instanceof Error ? ` (${lastError.message})` : ''}`,
  );
  if (child.exitCode !== null || child.signalCode !== null) throw exitError(child.exitCode, child.signalCode);
  if (timeoutMs <= 0) throw timeoutError();

  let onExit!: (code: number | null, signal: NodeJS.Signals | null) => void;
  const exited = new Promise<never>((_resolve, reject) => {
    onExit = (code, signal) => reject(exitError(code, signal));
    child.once('exit', onExit);
  });
  let timer!: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(timeoutError()), timeoutMs);
  });
  let stopped = false;
  const controller = new AbortController();
  const poll = async (): Promise<T> => {
    while (!stopped) {
      try {
        const status = await options.probe();
        if (!stopped && options.isReady({ status })) return status;
      } catch (error) {
        lastError = error;
      }
      if (!stopped) await sleep(pollIntervalMs, undefined, { signal: controller.signal });
    }
    throw timeoutError();
  };

  try {
    // Race the whole polling task, including a probe or sleep that has not settled yet.
    return await Promise.race([exited, deadline, poll()]);
  } finally {
    stopped = true;
    controller.abort();
    clearTimeout(timer);
    child.off('exit', onExit);
  }
}

async function shutdownChild(child: ChildProcess, options: SidecarShutdownOptions = {}): Promise<void> {
  if (options.requestShutdown != null) {
    try {
      await options.requestShutdown();
    } catch {
      // Fall through to process-level termination below.
    }
  }
  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  if (await waitForProcessExit(child, gracefulTimeoutMs)) return;
  child.kill('SIGKILL');
  await waitForProcessExit(child, gracefulTimeoutMs);
}

async function openLogHandle(logPath: string | undefined): Promise<FileHandle | null> {
  if (logPath == null) return null;
  await mkdir(dirname(logPath), { recursive: true });
  return await open(logPath, 'a');
}

export function createNodeSidecarLauncher(_requiredArgs: Record<string, never>): SidecarLauncherPort {
  return {
    async launch(requiredArgs: Pick<SidecarLaunchOptions, 'command'>, optionalArgs: Omit<SidecarLaunchOptions, 'command'> = {}): Promise<SidecarHandle> {
      const options = { ...optionalArgs, ...requiredArgs };
      const logHandle = await openLogHandle(options.logPath);
      const child = spawn(options.command, options.args ?? [], {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', logHandle?.fd ?? 'ignore', logHandle?.fd ?? 'ignore'],
      });
      await new Promise<void>((resolveSpawn, rejectSpawn) => {
        child.once('error', rejectSpawn);
        child.once('spawn', resolveSpawn);
      });

      const processHandle: SidecarProcessHandle = {
        pid: child.pid,
        onExit({ listener }) {
          child.on('exit', (code, signal) => listener({ code, signal }));
        },
        kill(_requiredArgs, { signal } = {}) {
          return child.kill(signal);
        },
      };

      return {
        process: processHandle,
        logPath: options.logPath ?? null,
        waitUntilReady: (requiredArgs, optionalArgs = {}) => waitUntilReady(child, options.logPath ?? null, { ...optionalArgs, ...requiredArgs }),
        async shutdown(_requiredArgs, shutdownOptions) {
          try {
            await shutdownChild(child, shutdownOptions);
          } finally {
            await logHandle?.close().catch(() => undefined);
          }
        },
      };
    },
  };
}

export async function appendSidecarLifecycleLog({ logPath, message }: { logPath: string; message: string }): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${message}\n`, 'utf8').catch(() => undefined);
}
