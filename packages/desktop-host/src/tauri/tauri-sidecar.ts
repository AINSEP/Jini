/**
 * Same launch/discovery/shutdown contract as `../sidecar.ts`'s
 * `createNodeSidecarLauncher`, reimplemented against Tauri's sidecar
 * command API instead of `node:child_process` — a real Tauri webview has
 * no direct Node process-spawning access; sidecars are launched through
 * the shell plugin's allowlisted `Command.sidecar` mechanism. Duplicated
 * rather than shared because the two process handle shapes
 * (`node:child_process.ChildProcess` vs `TauriChildProcessLike`) are
 * different enough that a common implementation would need its own
 * abstraction layer for no real benefit at this package's size.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import type { SidecarHandle, SidecarLaunchOptions, SidecarLauncherPort, SidecarProcessHandle, SidecarReadyOptions, SidecarShutdownOptions } from '../sidecar.js';
import type { TauriChildProcessLike, TauriSidecarCommandApi } from './tauri-surfaces.js';

const DEFAULT_READY_TIMEOUT_MS = 35_000;
const DEFAULT_POLL_INTERVAL_MS = 150;
const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000;

interface TauriExitState {
  info: { code: number | null; signal: NodeJS.Signals | null } | null;
  exited: Promise<void>;
}

/** Observe the launch-time exit record; clear the deadline when the process exits first. */
async function waitForProcessExit({ exit }: { exit: TauriExitState }, { timeoutMs = DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS }: { timeoutMs?: number } = {}): Promise<boolean> {
  if (exit.info !== null) return true;
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      exit.exited.then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Poll readiness while retaining crashes delivered before this call. */
async function waitUntilReady<T>(
  { exit, probe, isReady }: { exit: TauriExitState } & Pick<SidecarReadyOptions<T>, 'probe' | 'isReady'>,
  options: Omit<SidecarReadyOptions<T>, 'probe' | 'isReady'> = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    if (exit.info !== null) {
      const info = exit.info;
      throw new Error(`sidecar exited before reporting ready (code=${info.code}, signal=${info.signal ?? 'none'})`);
    }
    try {
      const status = await probe();
      if (isReady({ status })) return status;
    } catch (error) {
      lastError = error;
    }
    await sleep(pollIntervalMs);
  }
  const detail = lastError instanceof Error ? ` (${lastError.message})` : '';
  throw new Error(`timed out waiting for sidecar to become ready${detail}`);
}

/** Use the host's shutdown request or SIGTERM, then bound the wait before SIGKILL. */
async function shutdownChild({ child, exit }: { child: TauriChildProcessLike; exit: TauriExitState }, options: SidecarShutdownOptions = {}): Promise<void> {
  if (exit.info !== null) return;
  if (options.requestShutdown != null) {
    try {
      await options.requestShutdown();
    } catch {
      // Fall through to process-level termination below.
    }
  } else {
    child.kill({}, { signal: 'SIGTERM' });
  }
  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  if (await waitForProcessExit({ exit }, { timeoutMs: gracefulTimeoutMs })) return;
  child.kill({}, { signal: 'SIGKILL' });
  await waitForProcessExit({ exit }, { timeoutMs: gracefulTimeoutMs });
}

/** Launch through the injected Tauri API and retain exit status for readiness and teardown. */
export function createTauriSidecarLauncher({ api }: { api: TauriSidecarCommandApi }, _optionalArgs: Record<string, never> = {}): SidecarLauncherPort {
  return {
    async launch(requiredArgs: Pick<SidecarLaunchOptions, 'command'>, optionalArgs: Omit<SidecarLaunchOptions, 'command'> = {}): Promise<SidecarHandle> {
      const options = { ...optionalArgs, ...requiredArgs };
      const child = await api.spawnSidecar({ binaryName: options.command, args: options.args ?? [] }, { env: options.env as Record<string, string> | undefined });
      let resolveExit!: () => void;
      const exit: TauriExitState = { info: null, exited: new Promise<void>((resolve) => { resolveExit = resolve; }) };
      // Tauri does not expose exitCode/signalCode: subscribe before handing the child to callers.
      child.onExit({ listener: (info) => {
        exit.info = info;
        resolveExit();
      } });
      const processHandle: SidecarProcessHandle = {
        pid: child.pid,
        onExit: ({ listener }) => child.onExit({ listener: ({ code, signal }) => listener({ code, signal }) }),
        kill: (_requiredArgs, { signal } = {}) => child.kill({}, { signal }),
      };
      return {
        process: processHandle,
        logPath: null,
        waitUntilReady: (requiredArgs, optionalArgs = {}) => waitUntilReady({ exit, ...requiredArgs }, optionalArgs),
        shutdown: (_requiredArgs, shutdownOptions) => shutdownChild({ child, exit }, shutdownOptions),
      };
    },
  };
}
