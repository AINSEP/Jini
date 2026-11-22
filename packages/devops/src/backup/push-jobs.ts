/**
 * @file Runs `site_backup_push`'s upload as an in-process job, so a backup can outlast one tool call.
 *
 * Why: a delegated tool call is cut off after 6 minutes (`@jini-ai/mcp`'s
 * `DEFAULT_DELEGATED_TOOL_TIMEOUT_MS`), and a 212 MiB backup — about 283 MB of base64 on the wire,
 * plus any rate-limit waits — can take longer on a home connection. The push call waits for its job
 * up to a budget; if the job is still running then, the call returns its progress, and calling
 * `site_backup_push` again with the same planId waits on the SAME job. A second call never starts a
 * second upload, and the backup is still exactly one commit.
 *
 * A job is keyed by its planId and bound to the principal and workspace that started it, like the
 * plan itself. Its outcome is handed to the first call that sees it finish, then forgotten, so a
 * later call with that planId reads as not found. A finished outcome nobody collected is dropped
 * after {@link FINISHED_JOB_TTL_MS}. In memory only: a server restart drops every job.
 */

/** How far a push has got, updated in place as files go up. The manifest is not counted. */
export interface SiteBackupPushProgress {
  filesDone: number;
  readonly filesTotal: number;
  bytesDone: number;
  readonly bytesTotal: number;
}

export interface PushJobKey {
  readonly planId: string;
  readonly principalId: string;
  readonly workspaceId: string;
}

export interface PushJob<T> {
  readonly key: PushJobKey;
  readonly controller: AbortController;
  readonly progress: SiteBackupPushProgress;
  readonly startedAtMs: number;
  /** Never rejects: a thrown run is carried as `{ ok: false, error }` so an unwatched job cannot
   *  become an unhandled rejection. */
  readonly settled: Promise<{ ok: true; result: T } | { ok: false; error: unknown }>;
  finishedAtMs?: number;
}

export type PushJobWait<T> =
  | { readonly state: "done"; readonly result: T }
  | { readonly state: "running"; readonly progress: SiteBackupPushProgress; readonly elapsedMs: number }
  | { readonly state: "abandoned" };

export const FINISHED_JOB_TTL_MS = 60 * 60 * 1000;

export class SiteBackupPushJobs<T> {
  private readonly jobs = new Map<string, PushJob<T>>();
  private readonly now: () => number;

  constructor(_required: Record<string, never>, { now }: { now?: () => number } = {}) {
    this.now = now ?? Date.now;
  }

  /** The running or uncollected job for this planId, when the same principal and workspace started
   *  it. @complexity O(jobs) for the sweep. */
  find(key: PushJobKey, _optional: Record<string, never> = {}): PushJob<T> | undefined {
    this.sweep();
    const job = this.jobs.get(key.planId);
    return job && job.key.principalId === key.principalId && job.key.workspaceId === key.workspaceId ? job : undefined;
  }

  /** Starts `run` now; it keeps running whether or not anyone waits. @complexity O(jobs). */
  start({ key, progress, run }: { key: PushJobKey; progress: SiteBackupPushProgress; run: (required: { signal: AbortSignal; progress: SiteBackupPushProgress }) => Promise<T> }, _optional: Record<string, never> = {}): PushJob<T> {
    this.sweep();
    const controller = new AbortController();
    const job: PushJob<T> = {
      key,
      controller,
      progress,
      startedAtMs: this.now(),
      settled: run({ signal: controller.signal, progress }).then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error })
      ),
    };
    void job.settled.then(() => {
      job.finishedAtMs = this.now();
    });
    this.jobs.set(key.planId, job);
    return job;
  }

  /**
   * Waits for `job` up to `budgetMs`. Finished: its outcome, and the job is forgotten. The caller's
   * run stopped while waiting: the job is stopped too (no file after the current ones, no commit).
   * Otherwise its progress, and it keeps running.
   *
   * @throws What the job's run threw, to the call that collects it.
   * @complexity O(1) besides the wait.
   */
  async wait({ job, signal, budgetMs }: { job: PushJob<T>; signal: AbortSignal; budgetMs: number }, _optional: Record<string, never> = {}): Promise<PushJobWait<T>> {
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    const budget = new Promise<"budget">((resolve) => {
      timer = setTimeout(() => resolve("budget"), budgetMs);
    });
    const aborted = new Promise<"aborted">((resolve) => {
      onAbort = () => resolve("aborted");
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const outcome = await Promise.race([job.settled, budget, aborted]);
      if (outcome === "budget") return { state: "running", progress: { ...job.progress }, elapsedMs: this.now() - job.startedAtMs };
      this.jobs.delete(job.key.planId);
      if (outcome === "aborted") {
        job.controller.abort();
        return { state: "abandoned" };
      }
      if (!outcome.ok) throw outcome.error;
      return { state: "done", result: outcome.result };
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  private sweep(): void {
    const now = this.now();
    for (const [planId, job] of this.jobs) {
      if (job.finishedAtMs !== undefined && now - job.finishedAtMs > FINISHED_JOB_TTL_MS) this.jobs.delete(planId);
    }
  }
}
