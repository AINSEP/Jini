/**
 * @module process
 *
 * Node binding of core's `ProcessControlPort` over `@jini-ai/platform`'s process functions. Hosts import
 * {@link nodeProcessControl} instead of hand-copying the adapter: two of the port members take their
 * arguments in a different shape from the function they wrap (`{ pids }` vs a positional array,
 * `{ pid }` vs a positional pid), so a binding that merely typechecks can silently reshape an
 * argument. The builder takes the wrapped functions as arguments so a test can hand it recording
 * fakes and assert exactly what each receives. The file lock and atomic writer bind in
 * `@jini-ai/node-adapters/fs` (a separate entry: subpath isolation keeps the `os` and `fs` domains apart).
 * `command` has no binding on purpose: core's pure `planCommandInvocation` is the planner, and
 * `createCommandInvocation` reads its arguments from the other object.
 */
import type { ProcessControlPort } from "@jini-ai/core/contracts/runtime";
import { listProcessSnapshots, stopProcesses, waitForProcessExit } from "@jini-ai/platform/process";

/** The three platform process functions the process-control port wraps. */
export interface ProcessFunctions {
  readonly listProcessSnapshots: (required: Record<string, never>, optional: { timeoutMs?: number; commandLines?: boolean }) => ReturnType<typeof listProcessSnapshots>;
  readonly stopProcesses: (pids: Array<number | null | undefined>) => ReturnType<typeof stopProcesses>;
  readonly waitForProcessExit: (pid: number | null | undefined, timeoutMs?: number) => ReturnType<typeof waitForProcessExit>;
}

/**
 * Adapts positional platform process functions to {@link ProcessControlPort}.
 * `stopProcesses` receives a new mutable copy of the port's readonly array; an absent
 * `timeoutMs` reaches `waitForProcessExit` as `undefined` so its own default applies.
 * @complexity O(1) construction; each member costs what the wrapped function costs.
 */
export function createProcessControlPort(required: { readonly functions: ProcessFunctions }, _optional: Record<string, never> = {}): ProcessControlPort {
  const { functions } = required;
  return {
    listProcessSnapshots: (_required = {}, optional = {}) => functions.listProcessSnapshots({}, optional),
    stopProcesses: ({ pids }) => functions.stopProcesses([...pids]),
    waitForProcessExit: ({ pid }, { timeoutMs } = {}) => functions.waitForProcessExit(pid, timeoutMs),
  };
}

/** The Node implementation, ready for a host to hand to daemon. */
export const nodeProcessControl: ProcessControlPort = createProcessControlPort({ functions: { listProcessSnapshots, stopProcesses, waitForProcessExit } });
