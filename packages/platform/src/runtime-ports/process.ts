/**
 * @module runtime-ports/process
 *
 * Node binding of core's `ProcessControlPort` over this package's process functions. Hosts import
 * {@link nodeProcessControl} instead of hand-copying the adapter: two of the port members take their
 * arguments in a different shape from the function they wrap (`{ pids }` vs a positional array,
 * `{ pid }` vs a positional pid), so a binding that merely typechecks can silently reshape an
 * argument. The builder takes the wrapped functions as arguments so a test can hand it recording
 * fakes and assert exactly what each receives. The file lock and atomic writer bind in
 * `./runtime-ports/fs` (a separate entry: subpath isolation keeps the `os` and `fs` domains apart).
 * `command` has no binding on purpose: core's pure `planCommandInvocation` is the planner, and
 * `createCommandInvocation` reads its arguments from the other object. The planner's two host inputs
 * come from {@link nodeCommandShell}; process start comes from {@link nodeSpawnPort}.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { ProcessControlPort, RuntimePlatform } from "@jini-ai/core/contracts/runtime";
import { listProcessSnapshots, stopProcesses, waitForProcessExit } from "../process.js";

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

/** The one `node:child_process` function the spawn port wraps. */
export type SpawnFunction = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/**
 * Adapts Node's positional `spawn(command, args, options)` to the object-argument spawn port. Returns the
 * child in the same synchronous turn it was spawned: the caller attaches its `'error'` listeners before
 * yielding, and an `async` adapter here would let the child's first event fire with nobody listening.
 * The args reach `spawn` as a new mutable array (the port's array is readonly); an absent `options` is `{}`.
 * @complexity O(a) in the argument count for the copy; otherwise what `spawn` costs.
 */
export function createSpawnPort(required: { readonly spawn: SpawnFunction }, _optional: Record<string, never> = {}) {
  const { spawn: spawnFunction } = required;
  return ({ command, args }: { readonly command: string; readonly args: readonly string[] }, options: SpawnOptions = {}): ChildProcess =>
    spawnFunction(command, [...args], options);
}

/** The Node implementation of the spawn port, ready for a host to hand to daemon. */
export const nodeSpawnPort = createSpawnPort({ spawn });

/**
 * The two host inputs of core's pure `planCommandInvocation`: the platform and the `ComSpec` a Windows
 * `.cmd` shim falls back to when the child's own env has none. The host passes the env it already owns
 * (this module never reads the ambient process env); the platform defaults to the running one.
 */
export function nodeCommandShell(
  { env }: { readonly env: Readonly<Record<string, string | undefined>> },
  { platform = process.platform }: { readonly platform?: RuntimePlatform } = {},
): { readonly platform: RuntimePlatform; readonly fallbackComSpec: string | undefined } {
  return { platform, fallbackComSpec: env.ComSpec };
}
