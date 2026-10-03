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

async function waitForProcessExit(child: TauriChildProcessLike, timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let exited = false;
    child.onExit({ listener: () => {
      exited = true;
      resolve(true);
    } });
    setTimeout(() => {
      if (!exited) resolve(false);
    }, timeoutMs);
  });
}

async function waitUntilReady<T>(child: TauriChildProcessLike, options: SidecarReadyOptions<T>): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const startedAt = Date.now();
  let lastError: unknown;
  let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.onExit({ listener: ({ code, signal }) => {
    exited = { code, signal };
  } });

  while (Date.now() - startedAt < timeoutMs) {
    if (exited !== null) {
      const info: { code: number | null; signal: NodeJS.Signals | null } = exited;
      throw new Error(`sidecar exited before reporting ready (code=${info.code}, signal=${info.signal ?? 'none'})`);
    }
    try {
      const status = await options.probe();
      if (options.isReady({ status })) return status;
    } catch (error) {
      lastError = error;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`timed out waiting for sidecar to become ready${lastError instanceof Error ? ` (${lastError.message})` : ''}`);
}

async function shutdownChild(child: TauriChildProcessLike, options: SidecarShutdownOptions = {}): Promise<void> {
  if (options.requestShutdown != null) {
    try {
      await options.requestShutdown();
    } catch {
      // Fall through to process-level termination below.
    }
  }
  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  if (await waitForProcessExit(child, gracefulTimeoutMs)) return;
  child.kill({}, { signal: 'SIGKILL' });
  await waitForProcessExit(child, gracefulTimeoutMs);
}

export function createTauriSidecarLauncher({ api }: { api: TauriSidecarCommandApi }): SidecarLauncherPort {
  return {
    async launch(requiredArgs: Pick<SidecarLaunchOptions, 'command'>, optionalArgs: Omit<SidecarLaunchOptions, 'command'> = {}): Promise<SidecarHandle> {
      const options = { ...optionalArgs, ...requiredArgs };
      const child = await api.spawnSidecar({ binaryName: options.command, args: options.args ?? [] }, { env: options.env as Record<string, string> | undefined });
      const processHandle: SidecarProcessHandle = {
        pid: child.pid,
        onExit: ({ listener }) => child.onExit({ listener: ({ code, signal }) => listener({ code, signal }) }),
        kill: (_requiredArgs, { signal } = {}) => child.kill({}, { signal }),
      };
      return {
        process: processHandle,
        logPath: null,
        waitUntilReady: (requiredArgs, optionalArgs = {}) => waitUntilReady(child, { ...optionalArgs, ...requiredArgs }),
        shutdown: (_requiredArgs, shutdownOptions) => shutdownChild(child, shutdownOptions),
      };
    },
  };
}
