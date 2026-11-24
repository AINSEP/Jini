/**
 * @file `createPerCallWorkerRunner()` — runs each request in a FRESH Node worker over `../node-worker.ts`,
 * with a wall-clock timeout and V8 heap limits, and decodes the reply with a caller-owned codec. The
 * host owns its worker entry file, its TypeScript bootstrap module, its timeout variable name and its
 * budgets; this module owns the env allowlist, the strict timeout read and the `.ts`/`.js` entry choice.
 *
 * Why a fresh worker per call (an ABI-boundary slice, not yet a real process sandbox): a
 * main-thread `Promise.race` cannot interrupt a guest's synchronous loop, and a long-lived worker
 * would carry one call's module state into the next. A fresh worker gives the server a termination
 * boundary and a heap cap per call, and the guest's code never runs in the server's isolate.
 *
 * Every transport failure (timeout, crash, heap limit, malformed reply) rejects, so the caller can
 * fail closed exactly as for a throwing in-process call.
 */
import path from "node:path";
import type { ResourceLimits } from "node:worker_threads";

import {
  createNodeWorkerFactory,
  createNodeWorkerScheduler,
  resolveDefaultTimeoutMs,
  runInWorkerSandbox,
  type WorkerFactory,
  type WorkerScheduler,
} from "../node-worker.js";

/** The only environment variables a per-call worker receives. Guest code runs in that worker, so
 * the server's environment (API keys, database URLs, site keys) must never be copied in: these
 * are runtime/tooling settings only — `TSX_TSCONFIG_PATH` for the dev/test tsx bootstrap,
 * `NODE_V8_COVERAGE` so a compiled worker still reports coverage. */
export const PER_CALL_WORKER_ENV_KEYS = ["NODE_ENV", "TZ", "TSX_TSCONFIG_PATH", "NODE_V8_COVERAGE"] as const;

/**
 * The explicit minimal environment for one per-call worker: {@link PER_CALL_WORKER_ENV_KEYS} that
 * are set in `env`, nothing else.
 *
 * @complexity O(k) for the k allowlisted keys.
 */
export function perCallWorkerEnv(required: { readonly env: NodeJS.ProcessEnv }, _optional = {}): NodeJS.ProcessEnv {
  const workerEnv: NodeJS.ProcessEnv = {};
  for (const key of PER_CALL_WORKER_ENV_KEYS) {
    const value = required.env[key];
    if (value !== undefined) workerEnv[key] = value;
  }
  return workerEnv;
}

/** A host's timeout policy: the variable it reads and its default/maximum budgets in milliseconds. */
export interface PerCallWorkerTimeoutPolicy {
  readonly timeoutEnvKey: string;
  readonly defaultTimeoutMs: number;
  readonly maxTimeoutMs: number;
}

/**
 * Reads the host's timeout variable strictly (no `parseInt`: "5e3" must not become 5ms).
 *
 * @returns The configured positive budget, or the default for a missing, malformed or over-max value.
 * @complexity O(n) for n characters in the configured value.
 */
export function resolvePerCallWorkerTimeoutMs(
  required: PerCallWorkerTimeoutPolicy & { readonly env: NodeJS.ProcessEnv },
  _optional = {},
): number {
  return resolveDefaultTimeoutMs({
    rawValue: required.env[required.timeoutEnvKey],
    defaultTimeoutMs: required.defaultTimeoutMs,
    maxTimeoutMs: required.maxTimeoutMs,
  });
}

export interface CreatePerCallWorkerRunnerRequired<TRequest, TResult> extends PerCallWorkerTimeoutPolicy {
  /** Read for the timeout; only its {@link perCallWorkerEnv} subset reaches the worker. The host
   * passes its process environment (Jini never reads `process.env` itself). */
  readonly env: NodeJS.ProcessEnv;
  /** Directory holding the host's worker entry (`<workerEntryName><moduleExtension>`). */
  readonly entryDirectory: string;
  readonly workerEntryName: string;
  /** `.ts` under tsx, `.js` in a compiled build — the host's own module extension. */
  readonly moduleExtension: string;
  /** The host's CommonJS registration module, used only for a `.ts` entry. */
  readonly typescriptBootstrapPath: string;
  readonly defaultResourceLimits: ResourceLimits;
  /** Names the call in timeout/exit errors. */
  readonly errorLabel: (required: { readonly request: TRequest }) => string;
  readonly decodeResult: (required: { readonly message: unknown; readonly request: TRequest }) => TResult;
}

export interface CreatePerCallWorkerRunnerOptional {
  /** Per-call wall-clock budget. Omitted ⇒ {@link resolvePerCallWorkerTimeoutMs} at call time. */
  readonly timeoutMs?: number;
  readonly resourceLimits?: ResourceLimits;
  /** Test seams over the worker/timer ports. */
  readonly workerFactory?: WorkerFactory;
  readonly scheduler?: WorkerScheduler;
}

/**
 * Builds a runner that spawns one fresh bounded worker per request.
 *
 * @returns A runner that rejects on timeout, worker error, exit without reply, or invalid reply.
 * @complexity O(1) own work per call (a fixed-size env allowlist), excluding worker startup and
 * guest work.
 */
export function createPerCallWorkerRunner<TRequest, TResult>(
  required: CreatePerCallWorkerRunnerRequired<TRequest, TResult>,
  optional: CreatePerCallWorkerRunnerOptional = {},
): (request: TRequest) => Promise<TResult> {
  return (request) => {
    const env = required.env;
    const workerFactory =
      optional.workerFactory ??
      createNodeWorkerFactory({ env: perCallWorkerEnv({ env }) }, {
        // tsx's CJS hook alone cannot load a `.ts` guest through the worker's dynamic `import()`.
        ...(required.moduleExtension === ".ts"
          ? { typescriptBootstrap: { registerModulePath: required.typescriptBootstrapPath } }
          : {}),
      });
    return runInWorkerSandbox({
      workerEntry: path.join(required.entryDirectory, `${required.workerEntryName}${required.moduleExtension}`),
      input: request,
      errorLabel: required.errorLabel({ request }),
      defaultTimeoutMs: optional.timeoutMs ?? resolvePerCallWorkerTimeoutMs({ ...required, env }),
      defaultResourceLimits: optional.resourceLimits ?? required.defaultResourceLimits,
      workerFactory,
      scheduler: optional.scheduler ?? createNodeWorkerScheduler({}),
      decodeResult: ({ message }) => required.decodeResult({ message, request }),
    });
  };
}
