import { createConsoleLogger } from '@jini-ai/core/primitives';
import { listProcessSnapshots, stopProcesses } from '@jini-ai/platform/process';
import type { ChildProcess } from 'node:child_process';
import type {
  TerminateChildTreeDeps, AgentCleanupFailurePhase, AgentCleanupFailureContext,
  ClassifyFailure, FailureClassificationContext,
} from './contracts.js';

/**
 * Enumerates `child`'s full descendant process tree and stops it (SIGTERM →
 * SIGKILL escalation, via the injected `stopProcesses` port).
 * @param deps - The process-snapshot/tree-collection/stop ports (real `@jini-ai/platform` implementations by default — see {@link CreateAgentExecutorOptions}).
 * @param child - The child whose descendant tree should be terminated.
 * @returns Resolves once escalation completes (or immediately, as a no-op, if `child.pid` was never assigned — spawn never actually started).
 * @complexity O(p) in the number of live OS processes (`listProcessSnapshots`'s own cost) plus O(1) escalation rounds.
 * @overallScore 100/100
 */
async function terminateChildTree(deps: TerminateChildTreeDeps, child: ChildProcess): Promise<void> {
  if (child.pid == null) return;
  const processes = await deps.listProcessSnapshots();
  const pids = deps.collectProcessTreePids({ processes, rootPids: [child.pid] });
  await deps.stopProcesses({ pids });
}

/** Default sink when a host does not supply `onCleanupFailure`: still observable, never silent. Redacted per SEC-007 (a spawn/permission error can embed paths/host detail). */
export function defaultCleanupFailureSink(context: AgentCleanupFailureContext): void {
  createConsoleLogger({ prefix: '' }).error({ message: `[@jini-ai/daemon] agent-executor: process-tree cleanup failed for run "${context.runId}" (${context.phase}, pid=${context.pid})` }, { error: context.error });
}

/**
 * Reports a contained post-close failure through the host's sink, absorbing a throwing sink.
 *
 * A diagnostic sink is host code too, and the whole point of these callers is that nothing
 * between `'close'` and `finish()` can strand the run — a sink that throws must not reintroduce
 * exactly that. Same reasoning `run-lifecycle.ts`'s `handleInactivityTimeout` already applies to its
 * own `onInternalError`.
 */
export function reportPostCloseFailure(
  onCleanupFailure: (context: AgentCleanupFailureContext) => void,
  context: AgentCleanupFailureContext,
): void {
  try {
    onCleanupFailure(context);
  } catch {
    // Nothing further can be done from here, and the terminal transition below still must happen.
  }
}

/** The subset of a close handler's context the two post-close guards below need. */
interface PostCloseGuardContext {
  readonly runId: string;
  readonly child: ChildProcess;
  readonly cleanupStagedFiles: () => Promise<void>;
  readonly onCleanupFailure: (context: AgentCleanupFailureContext) => void;
}

/**
 * Removes this run's staged files, reporting rather than propagating a failure.
 *
 * Unguarded, a rejecting cleanup (EBUSY, a temp directory yanked out from under the daemon, a host
 * stager bug) escaped the `void (async () => …)()` wrapper in each close handler and took `finish()`
 * with it: the child was already gone, yet the run stayed `'running'` forever — unfinishable and
 * unresumable — and the rejection surfaced only as an unhandled promise. A leaked temp file is a real
 * problem, but it is strictly smaller than a permanently stranded run, and reporting it keeps it
 * visible.
 */
export async function cleanupStagedFilesSafely(ctx: PostCloseGuardContext): Promise<void> {
  try {
    await ctx.cleanupStagedFiles();
  } catch (error) {
    reportPostCloseFailure(ctx.onCleanupFailure, {
      runId: ctx.runId,
      phase: 'staged-file-cleanup',
      pid: ctx.child.pid,
      error,
    });
  }
}

/**
 * Resolves `finish()`'s `resumable` flag from the host's classifier, falling back to `false` when the
 * classifier itself rejects.
 *
 * `classifyFailure` is host-supplied and may do real work (a keystore read, an HTTP call), so it can
 * fail for reasons unrelated to this run. `false` is the right fallback: it is already the answer for
 * every run with no classifier configured at all, so an unavailable classifier degrades to the
 * documented default rather than losing the run.
 */
export async function classifyFailureSafely(
  ctx: PostCloseGuardContext,
  classifyFailure: ClassifyFailure,
  context: FailureClassificationContext,
): Promise<boolean> {
  try {
    return await classifyFailure(context);
  } catch (error) {
    reportPostCloseFailure(ctx.onCleanupFailure, {
      runId: ctx.runId,
      phase: 'failure-classification',
      pid: ctx.child.pid,
      error,
    });
    return false;
  }
}

/**
 * Fire-and-forget-safe wrapper around {@link terminateChildTree} for the cancellation paths
 * (a synchronous `onCancelRequested` listener, an ACP attach-failure catch) that observed this
 * promise with a bare `void` — silently swallowing any `listProcessSnapshots`/`stopProcesses`
 * rejection (e.g. EPERM — see `packages/platform/src/__tests__/process.test.ts`) and letting it
 * become an unhandled rejection, with descendants possibly still running and no diagnostic at
 * all (SEC-007). This never rejects: a tree-stop failure is reported through `onCleanupFailure`
 * (redacted) and followed by a best-effort direct kill of `child` itself, since the immediate
 * child is still worth trying even when tree enumeration/escalation failed.
 */
export function terminateChildTreeBestEffort(
  deps: TerminateChildTreeDeps,
  child: ChildProcess,
  runId: string,
  phase: AgentCleanupFailurePhase,
  onCleanupFailure: (context: AgentCleanupFailureContext) => void,
): Promise<void> {
  return terminateChildTree(deps, child).catch((error: unknown) => {
    // `terminateChildTree` only reaches a rejecting call (rather than its own early return) once
    // its own `child.pid == null` guard has already passed, and a real ChildProcess's `pid` is
    // never unset after being assigned — so `child.pid` is provably a number here. The non-null
    // assertion documents that invariant instead of a `?? null` fallback that could never
    // actually be exercised (same pattern as `pi-rpc/session.ts`'s `resolveSessionPathChangedSince`).
    onCleanupFailure({ runId, phase, pid: child.pid!, error });
    try {
      if (child.pid != null && !child.killed) child.kill('SIGKILL');
    } catch {
      // Best-effort only — nothing further can be done from here.
    }
  });
}
