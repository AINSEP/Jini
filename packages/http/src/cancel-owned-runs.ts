/**
 * Terminate every still-active run scoped to a `contextRef` before the caller
 * deletes whatever host-side record that `contextRef` names (a workspace, a
 * conversation, a project — the kernel has no opinion). Ported from OD's
 * `apps/daemon/src/routes/project/cancel-owned-runs.ts` (`refactor/web-memory-slice`,
 * `cancelRunsOwnedBy`) — see `source-map.md`.
 *
 * Deleting the owning record must not orphan a live run: without this the
 * run's driver keeps consuming resources, the run stays non-terminal with no
 * remaining owner, and (for a filesystem-backed context) a driver may keep
 * writing into a directory that was just removed out from under it. The
 * `RunLifecycle` already knows how to stop a run — `cancel` records
 * cancellation intent and is a no-op on an already-terminal run — so a
 * delete handler just has to call this for the runs it would otherwise
 * strand.
 *
 * OD's original scoped on `{conversationId?, projectId?}` and filtered via a
 * `status: 'active'` argument to its own `list`. The kernel's `RunLifecycle`
 * keys runs on one opaque `contextRef` (extraction-plan §2.1) and its
 * `list(contextRef?)` has no status filter, so this port takes a single
 * `contextRef` and filters non-terminal runs client-side via
 * `isTerminalRunState` instead.
 */
import { isTerminalRunState, type RunCancelRequest, type RunState } from '@injini/protocol';

/**
 * The slice of `RunLifecycle` this helper needs. Kept structural (rather than
 * importing `@injini/daemon`'s full `RunLifecycle` type) so it is satisfied by
 * any run service exposing at least these two methods, and so this package
 * doesn't need a same-shape-as-production test double to unit test it.
 */
export interface RunCancellationService {
  list(contextRef?: string): Promise<readonly { readonly id: string; readonly state: RunState }[]>;
  cancel(request: RunCancelRequest): Promise<unknown>;
}

/**
 * Cancels every non-terminal run for `contextRef`. A per-run cancellation
 * failure is swallowed so it can never block the delete the caller is
 * performing — cancellation is best-effort cleanup, not a precondition.
 */
export async function cancelRunsOwnedBy(runs: RunCancellationService, contextRef: string): Promise<void> {
  const all = await runs.list(contextRef);
  const active = all.filter((run) => !isTerminalRunState(run.state));
  await Promise.all(active.map((run) => runs.cancel({ runId: run.id }).catch(() => {})));
}
