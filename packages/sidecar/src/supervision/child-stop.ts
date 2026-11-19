import type { Writable } from "node:stream";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";

/** Native structural surface, so hosts and test doubles need no casts to ChildProcess. */
export interface StoppableChild {
  pid?: number | undefined;
  stdin?: Writable | null;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  removeListener(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}
export type ChildStopFailure =
  | { type: "timeout"; pid: number | undefined; graceMs: number }
  | { type: "missing-pid"; phase: "windows-tree" | "force" };
export interface ChildStopRequired {
  child: StoppableChild;
  graceMs: number;
  killTree(required: { pid: number }): void;
  describeFailure(required: ChildStopFailure): string;
}
export interface ChildStopOptions {
  platform?: NodeJS.Platform;
  forceGroup?: (required: { pid: number }) => void;
}

function forceProcessGroup({ pid }: { pid: number }, _optional = {}): void {
  process.kill(-pid, "SIGKILL");
}

/** Windows ignores signal names and terminates the immediate child, which would cancel escalation
 * and orphan descendants if done first. Without stdin EOF, tree kill must be the first request.
 * A missing native command or disappearing pid falls back to killing only the direct child. */
function killWin32Tree({ child, killTree, describeFailure }: ChildStopRequired, _optional = {}): void {
  if (child.pid == null) throw new Error(describeFailure({ type: "missing-pid", phase: "windows-tree" }));
  const killed = orFallbackSync({ work: () => { killTree({ pid: child.pid! }); return true; }, fallback: false, step: "stop-child-windows-tree" });
  if (!killed) child.kill("SIGTERM");
}

/** Closing stdin asks the Windows child to drain. An EPIPE if it exited first must not become an
 * unhandled stream error. POSIX SIGTERM reaches the child's own graceful descendant cleanup. */
function requestGracefulStop(
  { request, platform }: { request: ChildStopRequired; platform: NodeJS.Platform }, _optional = {},
): void {
  const { child } = request;
  if (platform === "win32") {
    if (child.stdin) child.stdin.once("error", () => undefined).end();
    else killWin32Tree(request);
  } else child.kill("SIGTERM");
}

/** A wedged child has not drained its descendants: force targets its whole POSIX group or Windows
 * tree. Without a Windows stdin pipe, the initial request already attempted the whole tree. */
function requestForcedStop(
  { request, platform, forceGroup }: {
    request: ChildStopRequired; platform: NodeJS.Platform; forceGroup: NonNullable<ChildStopOptions["forceGroup"]>;
  }, _optional = {},
): void {
  const { child, describeFailure } = request;
  if (platform === "win32") {
    if (child.stdin) killWin32Tree(request);
  } else {
    // Stop normally receives an already-spawned child, so a missing pid is a failure.
    if (child.pid == null) throw new Error(describeFailure({ type: "missing-pid", phase: "force" }));
    forceGroup({ pid: child.pid });
  }
}

/** Resolve only after actual exit, even when force was accepted or a signal failed.
 * A second grace window bounds forced-exit confirmation; callers must retain recovery rows on
 * failure. The most recent signal error remains the timeout cause, including ESRCH races.
 * @complexity O(1) state, waiting at most twice graceMs. */
export function stopSpawnedChild(
  required: ChildStopRequired, { platform = process.platform, forceGroup = forceProcessGroup }: ChildStopOptions = {},
): Promise<void> {
  const { child, graceMs, describeFailure } = required;
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    let signalError: unknown;
    const timer = setTimeout(() => {
      // Arm confirmation before signalling: a synchronous exit must cancel both timers.
      exitTimer = setTimeout(() => {
        child.removeListener("exit", onExit);
        reject(new Error(describeFailure({ type: "timeout", pid: child.pid, graceMs }), { cause: signalError }));
      }, graceMs);
      try { requestForcedStop({ request: required, platform, forceGroup }); }
      catch (error) { signalError = error; }
    }, graceMs);
    const onExit = () => {
      clearTimeout(timer);
      clearTimeout(exitTimer);
      resolve();
    };
    child.once("exit", onExit);
    try { requestGracefulStop({ request: required, platform }); }
    catch (error) { signalError = error; }
  });
}
