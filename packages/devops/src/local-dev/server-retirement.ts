/** Fence local dev-server intake before asking an async activity owner whether eviction is safe.
 * Unobservable background work remains protected for this process lifetime. Failed/timed-out
 * probes reopen intake; a successful retirement remains fenced until stop or explicit cancel.
 * @returns Intake accounting and a cancellable retirement decision; releases are idempotent.
 * @throws When begin is called after intake has been fenced.
 * @complexity O(1) state per server and at most one bounded activity probe per retirement.
 */
export function createDevServerRetirement({ hasWork }: { hasWork: () => Promise<boolean> },
  { activityTimeoutMs = 1000 } = {}) {
  let fenced = false;
  let active = 0;
  let background = false;
  let generation = 0;
  return {
    accepting(_required = {}, _options = {}) { return !fenced; },
    cancel(_required = {}, _options = {}) { generation++; fenced = false; },
    begin(_required = {}, _options = {}) {
      if (fenced) throw new Error('Dev server intake is fenced');
      active++;
      let released = false;
      return ({ background: accepted = false }: { background?: boolean }, _options = {}) => {
        if (released) return;
        released = true; active--; background ||= accepted;
      };
    },
    async retire(_required = {}, _options = {}): Promise<boolean> {
      if (fenced || active > 0 || background) return false;
      fenced = true;
      const attempt = ++generation;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const uncertain = new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), activityTimeoutMs); });
      try { if (!await Promise.race([hasWork(), uncertain]) && generation === attempt) return true; }
      catch { /* Uncertainty preserves the server. */ }
      finally { clearTimeout(timer); }
      if (generation === attempt) fenced = false;
      return false;
    },
  };
}
