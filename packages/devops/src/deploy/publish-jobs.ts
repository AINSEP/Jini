/** @file Process-local snapshot storage extracted from a host's existing background publish path.
 * The host owns execution and persistence; this module owns bounded retention and scoped lookup.
 */
import type { DeployPublishProgress } from '../core/deploy-types.js';

/** A credential-free publish snapshot. Hosts authorize scopeId before reading it.
 * Results survive subsequent publishes, within the configured process-local retention bound.
 */
export interface PublishJobSnapshot<T> {
  readonly jobId: string;
  /** Host correlation for recovery after a response was lost; never a credential. */
  readonly requestId?: string;
  readonly status: 'running' | 'completed' | 'errored';
  readonly startedAtIso: string;
  readonly finishedAtIso: string | null;
  readonly target: string;
  readonly progress: DeployPublishProgress;
  readonly result?: T;
  readonly error?: string;
}

type BeginJob = { requestId?: string; jobId: string; scopeId: string; target: string; startedAtIso: string };
type SettleJob<T> = { jobId: string; status: 'completed' | 'errored'; finishedAtIso: string; result?: T; error?: string };

/** Storage behind an existing host background-publish workflow; no timers, I/O or credentials. */
export interface PublishJobStore<T> {
  begin(required: BeginJob, optional?: Record<string, never>): PublishJobSnapshot<T>;
  get(required: { scopeId: string; jobId?: string; requestId?: string }, optional?: Record<string, never>): PublishJobSnapshot<T> | undefined;
  /** Internal single-flight guard; never expose this unscoped read at a transport boundary. */
  latest(required?: Record<string, never>, optional?: Record<string, never>): PublishJobSnapshot<T> | undefined;
  progress(required: { jobId: string; progress: Partial<DeployPublishProgress> }, optional?: Record<string, never>): void;
  settle(required: SettleJob<T>, optional?: Record<string, never>): void;
}

/** Extracted publish-run snapshot owner: one running publish plus bounded terminal results.
 * @param _required - No dependencies: IDs and timestamps are supplied by the host.
 * @param optional.maxCompleted - Retained terminal jobs (default 20, range 1–1000).
 * @returns An isolated store. Snapshot envelopes and progress are frozen; hosts must treat their own result as immutable.
 * @throws RangeError for an invalid retention bound; begin throws while work is running or ID is reused.
 * @complexity O(1) ID reads/progress; O(maxCompleted) latest-scope reads and settlement eviction.
 * @example const jobs = createPublishJobStore<PublishOutcome>({}, { maxCompleted: 20 });
 */
export function createPublishJobStore<T>(
  _required: Record<string, never>,
  { maxCompleted = 20 }: { maxCompleted?: number } = {},
): PublishJobStore<T> {
  if (!Number.isInteger(maxCompleted) || maxCompleted < 1 || maxCompleted > 1000) throw new RangeError('Publish retention must be 1–1000 jobs.');
  const jobs = new Map<string, { scopeId: string; snapshot: PublishJobSnapshot<T> }>();
  let latestId: string | undefined;
  const latest = () => latestId === undefined ? undefined : jobs.get(latestId)?.snapshot;
  return {
    latest,
    begin({ jobId, scopeId, target, startedAtIso, requestId }) {
      if (latest()?.status === 'running') throw new Error('A publish is already running. Read its status before starting another.');
      if (jobs.has(jobId)) throw new Error('Publish job ID is already in use. Generate a new ID.');
      const snapshot: PublishJobSnapshot<T> = Object.freeze({ jobId, target, startedAtIso, ...(requestId ? { requestId } : {}), finishedAtIso: null, status: 'running',
        progress: Object.freeze({ phase: 'exporting', deploymentCreated: false, uploadedFiles: 0 }) });
      jobs.set(jobId, { scopeId, snapshot });
      latestId = jobId;
      return snapshot;
    },
    get({ scopeId, jobId, requestId }) {
      if (jobId !== undefined) {
        const record = jobs.get(jobId);
        return record?.scopeId === scopeId && (requestId === undefined || record.snapshot.requestId === requestId) ? record.snapshot : undefined;
      }
      return [...jobs.values()].reverse().find(record => record.scopeId === scopeId && (requestId === undefined || record.snapshot.requestId === requestId))?.snapshot;
    },
    progress({ jobId, progress }) {
      const record = jobs.get(jobId);
      if (record?.snapshot.status !== 'running') return;
      record.snapshot = Object.freeze({ ...record.snapshot, progress: Object.freeze({ ...record.snapshot.progress, ...progress }) });
    },
    settle({ jobId, ...outcome }) {
      const record = jobs.get(jobId);
      if (record?.snapshot.status !== 'running') return;
      record.snapshot = Object.freeze({ ...record.snapshot, ...outcome });
      // Keep the active job and a bounded tail of completed results; no whole-service inventory.
      const terminal = [...jobs].filter(([, value]) => value.snapshot.status !== 'running');
      for (const [id] of terminal.slice(0, Math.max(0, terminal.length - maxCompleted))) jobs.delete(id);
    },
  };
}

/** Human-readable recovery from a lost delegated response, based only on confirmed job facts.
 * @param required.job - Scoped snapshot for this request; omit when a matching job could not be confirmed.
 * @param required.statusToolId - Host tool to retrieve progress/final result; no provider polling here.
 * @returns Pasteable ID, upload count, URL/status and next step. Unknown stays explicit.
 * @complexity O(1), no I/O; output is independent of file count/export size.
 */
export function publishJobRecoveryMessage<T>({ job, statusToolId }: { job?: PublishJobSnapshot<T> | undefined; statusToolId: string }, _options = {}): string {
  if (!job) return `Publish job status could not be confirmed for this call. Deployment: unknown; uploaded files: unknown; URL/status: unknown. Call ${statusToolId} with {} and check the hosting dashboard before retrying.`;
  const progress = job.progress;
  const uploaded = progress.totalFiles === undefined ? 'unknown' : progress.uploadedFiles ?? 'unknown';
  const created = deploymentCreationLabel({ created: progress.deploymentCreated });
  return `Publish job ${job.jobId}: ${job.status}, phase ${progress.phase}. Deployment: ${created}; uploaded files: ${uploaded} of ${progress.totalFiles ?? 'unknown'} distinct files; already stored: ${progress.reusedFiles ?? 'unknown'}. Deployment ID: ${progress.deploymentId ?? 'unknown'}; URL: ${progress.url || 'unknown'}; provider status: ${progress.providerStatus ?? 'unknown'}. Call ${statusToolId} with {"jobId":"${job.jobId}"} for the final result before retrying. The publish can continue after the tool call times out; an old site's 200 does not confirm this deployment.`;
}

/** Translate the provider fact without interpreting a missing response as a refusal.
 * @complexity O(1) time/space, no I/O or errors.
 */
function deploymentCreationLabel({ created }: { created: boolean | "unknown" | undefined }, _options = {}): string {
  if (created === true) return 'created';
  return created === false ? 'not created' : 'unknown';
}
