export type ProcessSnapshot = {
  command: string;
  pid: number;
  ppid: number;
};

export type StopProcessesResult = {
  alreadyStopped: boolean;
  forcedPids: number[];
  matchedPids: number[];
  remainingPids: number[];
  stoppedPids: number[];
};

/**
 * Collect the transitive set of descendant PIDs (including the roots) from a
 * process snapshot list, returned sorted by numeric PID descending for deterministic ordering.
 * PID reuse and wraparound mean this does not guarantee children precede parents.
 *
 * @param processes - The full process snapshot list to walk.
 * @param rootPids - The root PIDs whose subtrees to collect (non-numbers ignored).
 * @returns The unique PIDs of the roots and all their descendants, descending.
 */
export function collectProcessTreePids(
  { processes, rootPids }: { processes: ProcessSnapshot[]; rootPids: Array<number | null | undefined> },
  _optional: Record<string, never> = {},
): number[] {
  const queue = [...new Set(rootPids.filter((pid): pid is number => typeof pid === "number"))];
  const visited = new Set<number>();
  const childrenByParent = new Map<number, number[]>();
  for (const processInfo of processes) {
    const children = childrenByParent.get(processInfo.ppid) ?? [];
    children.push(processInfo.pid);
    childrenByParent.set(processInfo.ppid, children);
  }
  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid == null || visited.has(pid)) continue;
    visited.add(pid);
    for (const childPid of childrenByParent.get(pid) ?? []) {
      if (!visited.has(childPid)) queue.push(childPid);
    }
  }
  return [...visited].sort((left, right) => right - left);
}

export interface ProcessControlPort {
  listProcessSnapshots(required?: Record<string, never>, optional?: { timeoutMs?: number; commandLines?: boolean }): Promise<ProcessSnapshot[]>;
  stopProcesses(required: { readonly pids: ReadonlyArray<number | null | undefined> }): Promise<StopProcessesResult>;
  waitForProcessExit(required: { readonly pid: number | null | undefined }, optional?: { timeoutMs?: number }): Promise<boolean>;
}
