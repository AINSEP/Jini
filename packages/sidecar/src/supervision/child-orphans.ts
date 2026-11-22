import { orFallbackSync } from "@jini-ai/core/errors/idioms";

/** Identity and parentage are host policy; a persisted pid alone never authorizes a signal. */
export interface ChildRegistryProcesses<Row extends { pid: number }> {
  isAlive(required: { pid: number }): boolean;
  isOrphan(required: { pid: number }): boolean;
  isLiveRow(required: { row: Row }): boolean;
  signal(required: { pid: number; signal: NodeJS.Signals }): void;
}

// Match the grace given to a child started by the current host, including its graceful drain.
const DEFAULT_TERMINATE_GRACE_MS = 5_000;
const TERMINATE_POLL_MS = 200;

/** The caller bounds the number of polls. */
function sleep({ ms }: { ms: number }, _optional = {}): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Re-prove identity before force: the OS can recycle a pid during the grace window.
 * A successful force request is not observed exit; the final bounded poll lets the OS reap it. */
async function finishOrphanTermination<Row extends { pid: number }>(
  { row, processes }: { row: Row; processes: ChildRegistryProcesses<Row> }, _optional = {},
): Promise<void> {
  if (processes.isAlive({ pid: row.pid }) && processes.isLiveRow({ row })) {
    const signalled = orFallbackSync({ work: () => { processes.signal({ pid: row.pid, signal: "SIGKILL" }); return true; }, fallback: false, step: "force-orphan" });
    if (!signalled) return; // Already gone in the signal race.
    const killDeadline = Date.now() + DEFAULT_TERMINATE_GRACE_MS;
    while (processes.isAlive({ pid: row.pid }) && Date.now() < killDeadline) {
      await sleep({ ms: TERMINATE_POLL_MS });
    }
  }
}

/** Package-internal termination of an already-proven orphan; reconciliation owns the first proof. */
export async function terminateConfirmedOrphan<Row extends { pid: number }>(
  { row, processes }: { row: Row; processes: ChildRegistryProcesses<Row> },
  { graceMs = DEFAULT_TERMINATE_GRACE_MS }: { graceMs?: number } = {},
): Promise<void> {
  const signalled = orFallbackSync({ work: () => { processes.signal({ pid: row.pid, signal: "SIGTERM" }); return true; }, fallback: false, step: "terminate-orphan" });
  if (!signalled) return; // Already gone in the signal race.
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!processes.isAlive({ pid: row.pid })) return;
    await sleep({ ms: TERMINATE_POLL_MS });
  }
  await finishOrphanTermination({ row, processes });
}

/** Prove liveness, command identity and parentage before any signal.
 * Live siblings match their own rows exactly; only parentage distinguishes them from orphans.
 * Reports retain rows selected for termination even if the process exits in a signal race. */
export async function reconcileRows<Row extends { pid: number }>(
  { rows, processes }: { rows: Row[]; processes: ChildRegistryProcesses<Row> }, _optional = {},
): Promise<Row[]> {
  const reconciled: Row[] = [];
  for (const row of rows) {
    if (!processes.isAlive({ pid: row.pid }) || !processes.isLiveRow({ row }) || !processes.isOrphan({ pid: row.pid })) continue;
    reconciled.push(row);
    await terminateConfirmedOrphan({ row, processes });
  }
  return reconciled;
}
