/** Two-stage boot orchestration. Modules clean up their own partially failed stage. */
export type ModuleLifecycleStatus =
  | { status: 'ready' }
  | { status: 'disabled'; reasonCode: string; remediationHint: string }
  | { status: 'failed'; reasonCode: string; remediationHint: string };
export type BootCriticality = 'critical' | 'optional';
export interface BootModule {
  name: string;
  owner: string;
  criticality: BootCriticality;
  /** Acquire reversible resources; do not start external work yet. */
  prepare(): Promise<void>;
  start(): Promise<void>;
  /** Idempotent; never called on the module whose current stage failed. */
  stop(): Promise<void>;
}
export interface BootModuleResult {
  name: string;
  owner: string;
  criticality: BootCriticality;
  lifecycle: ModuleLifecycleStatus;
}
export interface BootResult { ok: boolean; modules: BootModuleResult[] }
export interface ReadinessStore {
  set(required: { snapshot: BootResult }): void;
  get(): BootResult;
}
export interface LifecycleReporter {
  report(required: { result: BootResult }): void;
}

async function stopInReverse(modules: readonly BootModule[]): Promise<void> {
  for (const module of [...modules].reverse()) {
    try { await module.stop(); } catch { /* Preserve the original failure and continue cleanup. */ }
  }
}

/**
 * Preserve source rollback semantics: prepare failure unwinds completed preparations;
 * start failure unwinds completed starts only. Failing modules own their partial cleanup.
 * Prepared modules not yet started on a start-stage abort remain host-owned.

 * Contract rationale (including readiness ownership):
 * Ports: `BootModule`, `ReadinessStore`, optional `LifecycleReporter`. `runBootLifecycle({ modules }, { readiness, reporter })` runs all preparations before starts. Optional failures do not set `ok=false`; critical failures stop the stage and unwind completed modules in reverse order. The failing module self-cleans. The existing start-stage rollback stops only modules that completed start, leaving other prepared resources host-owned; this extraction deliberately preserves that source behavior. A ready record for an unwound module retains the original source status.
 *
 * `createReadinessStore({}, { initial })` owns defensive snapshot copies per instance. No module-global state or synthetic daemon name. Keep daemon health latching in the host and compose it with this store. Duplicate module names now reject before acquisition; reporter failure is best effort. Lifecycle calls can be concurrent only if callers provide separate modules/stores or coordinate their own boot.
 */
export async function runBootLifecycle(
  required: { modules: readonly BootModule[] },
  optional: { readiness?: ReadinessStore; reporter?: LifecycleReporter } = {},
): Promise<BootResult> {
  const modules = [...required.modules];
  if (new Set(modules.map(module => module.name)).size !== modules.length) {
    throw new Error('boot module names must be unique');
  }
  const results = new Map<string, BootModuleResult>();
  const prepared: BootModule[] = [];
  const ready: BootModule[] = [];
  let aborted = false;
  for (const stage of ['prepare', 'start'] as const) {
    const completed = stage === 'prepare' ? prepared : ready;
    for (const module of stage === 'prepare' ? modules : prepared) {
      try {
        await module[stage]();
        completed.push(module);
        if (stage === 'start') results.set(module.name, {
          name: module.name, owner: module.owner, criticality: module.criticality,
          lifecycle: { status: 'ready' },
        });
      } catch (error) {
        results.set(module.name, {
          name: module.name, owner: module.owner, criticality: module.criticality,
          lifecycle: {
            status: 'failed', reasonCode: error instanceof Error ? error.message : String(error),
            remediationHint: 'check the boot log for the underlying error and retry after fixing it',
          },
        });
        if (module.criticality === 'critical') {
          await stopInReverse(completed);
          aborted = true;
          break;
        }
      }
    }
    if (aborted) break;
  }
  const ordered = modules.flatMap(module => {
    const result = results.get(module.name);
    return result === undefined ? [] : [result];
  });
  const result = {
    ok: ordered.every(module => module.criticality !== 'critical' || module.lifecycle.status === 'ready'),
    modules: ordered,
  };
  optional.readiness?.set({ snapshot: result });
  // A reporter must never turn a completed boot into an apparent failure.
  try { optional.reporter?.report({ result }); } catch { /* Best-effort reporting. */ }
  return result;
}
