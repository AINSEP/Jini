import { orFallbackSync } from "@jini-ai/core/errors/idioms";

export interface ChildProcessInspectionRequired {
  runPs(required: { args: string[] }): string;
}
export interface ChildProcessInspection {
  isProcessAlive(required: { pid: number }, optional?: Record<string, never>): boolean;
  readProcessCommand(required: { pid: number }, optional?: Record<string, never>): string | null;
  readProcessParentPid(required: { pid: number }, optional?: Record<string, never>): number | null;
  isOrphanedProcess(required: { pid: number }, optional?: Record<string, never>): boolean;
}

/** Signal zero asks only whether the kernel knows a signalable process, without reading secrets. */
function isProcessAlive({ pid }: { pid: number }, _optional = {}): boolean {
  return orFallbackSync({ work: () => { process.kill(pid, 0); return true; }, fallback: false, step: "child-liveness" });
}

/** Argv-only probes never request environment columns, which may contain live credentials.
 * Windows has no ps: return before invoking the port. Unknown identity means no reaping,
 * preferring a leaked orphan over killing an unrelated or live sibling process.
 * Parentage is read from the running process, so rows of every vintage are protected immediately;
 * a persisted owner field would not protect children recorded by an older host.
 * A detached process leads its process group but retains its parent until that parent exits. */
export function createChildProcessInspection(
  { runPs }: ChildProcessInspectionRequired, { platform = process.platform }: { platform?: NodeJS.Platform } = {},
): ChildProcessInspection {
  function readProcessCommand({ pid }: { pid: number }, _optional = {}): string | null {
    if (platform === "win32") return null;
    return orFallbackSync({ work: () => runPs({ args: ["-o", "command=", "-p", String(pid)] }).trim() || null, fallback: null, step: "child-command" });
  }
  function readProcessParentPid({ pid }: { pid: number }, _optional = {}): number | null {
    if (platform === "win32") return null;
    return orFallbackSync({ work: () => {
      const parsed = Number.parseInt(runPs({ args: ["-o", "ppid=", "-p", String(pid)] }).trim(), 10);
      return Number.isNaN(parsed) ? null : parsed;
    }, fallback: null, step: "child-parent" });
  }
  function isOrphanedProcess({ pid }: { pid: number }, _optional = {}): boolean {
    // Fail closed: only a confirmed reparent to pid 1 establishes orphanhood.
    return readProcessParentPid({ pid }) === 1;
  }
  return { isProcessAlive, readProcessCommand, readProcessParentPid, isOrphanedProcess };
}
