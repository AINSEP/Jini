/**
 * CPU-bound synchronous work cannot be pre-empted by a Promise.race timer on that same
 * thread. A fresh worker lets the parent terminate runaway work and apply V8 heap limits
 * without wedging or exhausting the main server. Node workers avoid a native sandbox
 * build dependency and the known escape vulnerabilities of vm2.
 */
import { Worker } from "node:worker_threads";
import type { ResourceLimits } from "node:worker_threads";
import { isAbsolute } from "node:path";

export type WorkerSubscription =
  | { event: "message"; listener: (input: { message: unknown }) => void }
  | { event: "error"; listener: (input: { error: Error }) => void }
  | { event: "exit"; listener: (input: { code: number }) => void };

export interface WorkerHandle {
  once(input: WorkerSubscription): void;
  terminate(): Promise<number>;
}
export interface WorkerFactory {
  spawn<TPayload>(input: { workerEntry: string | URL; payload: TPayload; resourceLimits: ResourceLimits }): WorkerHandle;
}
/** Scheduling must defer run until after schedule returns; the returned function cancels it. */
export interface WorkerScheduler {
  schedule(input: { delayMs: number; run: () => void }): () => void;
}
export interface WorkerSandboxRequired<TPayload> {
  workerEntry: string | URL;
  input: TPayload;
  errorLabel: string;
  defaultTimeoutMs: number;
  defaultResourceLimits: ResourceLimits;
  workerFactory: WorkerFactory;
  scheduler: WorkerScheduler;
}
export interface WorkerSandboxOptions { timeoutMs?: number; resourceLimits?: ResourceLimits }
export type SandboxRenderResult = { ok: true; html: string } | { ok: false; error: string };

/**
 * Strictly parse a host-supplied timeout value, falling back on malformed or out-of-range values.
 * @param required Raw configuration and explicit default/maximum budgets in milliseconds.
 * @returns Valid positive integer timeout; no environment is read.
 * @complexity O(n) for n characters in rawValue.
 */
// Do not use parseInt: "5e3" becomes 5 milliseconds and "60000ms" silently becomes
// 60000. A malformed configuration must fall back, never masquerade as a deliberate budget.
export function resolveDefaultTimeoutMs({ rawValue, defaultTimeoutMs, maxTimeoutMs }: {
  rawValue: string | undefined;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
}): number {
  if (rawValue === undefined || !/^\d+$/.test(rawValue.trim())) return defaultTimeoutMs;
  const parsed = Number(rawValue.trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maxTimeoutMs) return defaultTimeoutMs;
  return parsed;
}

/**
 * Run structured-cloneable payloads in a fresh bounded worker using a caller-owned result codec.
 * @param required Entry, payload, budgets and worker/timer/decoder ports.
 * @param options Per-invocation timeout and resource limits.
 * @returns Decoded first reply; rejects on timeout, error, exit-without-reply or codec failure.
 * @throws RangeError (as a rejected promise) for an invalid timeout.
 * @complexity O(1) harness work, excluding structured clone, worker execution and decoding.
 */
export function runInWorkerSandbox<TPayload, TResult>(
  required: WorkerSandboxRequired<TPayload> & { decodeResult: (input: { message: unknown }) => TResult },
  options: WorkerSandboxOptions = {},
): Promise<TResult> {
  const timeoutMs = options.timeoutMs ?? required.defaultTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) {
    return Promise.reject(new RangeError("timeoutMs must be a positive integer within the Node timer range"));
  }
  return new Promise<TResult>((resolve, reject) => {
    const worker = required.workerFactory.spawn({ workerEntry: required.workerEntry, payload: required.input, resourceLimits: options.resourceLimits ?? required.defaultResourceLimits });
    let settled = false;
    let cancelTimer: (() => void) | undefined;
    function terminate(): void {
      // Teardown must never create a second rejection after the result has already settled.
      try { void worker.terminate().catch(() => {}); } catch { /* best effort */ }
    }
    function finish(run: () => void): void {
      if (settled) return;
      settled = true; cancelTimer?.();
      try { run(); } catch (error) { reject(error); }
      terminate();
    }
    try {
      worker.once({ event: "message", listener: ({ message }) => finish(() => resolve(required.decodeResult({ message }))) });
      worker.once({ event: "error", listener: ({ error }) => finish(() => reject(error)) });
      worker.once({ event: "exit", listener: ({ code }) => finish(() => reject(new Error(`${required.errorLabel} worker exited with code ${code}`))) });
      cancelTimer = required.scheduler.schedule({ delayMs: timeoutMs, run: () => finish(() => reject(new Error(`${required.errorLabel} exceeded ${timeoutMs}ms timeout`))) });
    } catch (error) { finish(() => reject(error)); }
  });
}

/**
 * Render-protocol convenience adapter; payloads are generic and host context types stay outside.
 * @param required Worker harness ports/settings and a structured-cloneable application payload.
 * @param options Per-render budgets.
 * @returns HTML from the existing {ok, html/error} wire shape.
 * @complexity O(1) protocol validation plus worker harness work.
 */
export function renderInWorkerSandbox<TPayload>(required: WorkerSandboxRequired<TPayload>, options: WorkerSandboxOptions = {}): Promise<string> {
  return runInWorkerSandbox({
    ...required, errorLabel: `${required.errorLabel} render`,
    decodeResult: ({ message }) => {
      if (message === null || typeof message !== "object") throw new Error("invalid worker render reply");
      const reply = message as Partial<SandboxRenderResult>;
      if (reply.ok === true && "html" in reply && typeof reply.html === "string") return reply.html;
      if (reply.ok === false && "error" in reply && typeof reply.error === "string") throw new Error(reply.error);
      throw new Error("invalid worker render reply");
    },
  }, options);
}

export interface NodeWorkerFactoryOptions {
  /** Explicit CommonJS registration module path for TypeScript entries (e.g. tsx/cjs/api). */
  typescriptBootstrap?: { registerModulePath: string };
}

/**
 * Native Node worker factory. TypeScript bootstrap configuration is explicit and host-owned.
 * @param required Environment copied to each worker; nothing reads the parent environment.
 * @param options Optional TypeScript registration module; its eval entry suppresses V8 coverage.
 * @returns WorkerFactory for caller-owned JS/TS entry paths, with no package-relative lookup.
 * @complexity O(e) environment copying for e variables, excluding native worker startup.
 */
export function createNodeWorkerFactory({ env }: { env: NodeJS.ProcessEnv }, options: NodeWorkerFactoryOptions = {}): WorkerFactory {
  return {
    spawn({ workerEntry, payload, resourceLimits }) {
      const workerEnv = { ...env };
      let worker: Worker;
      // A CommonJS-typed TS entry bypasses --import loader hooks for its first file and
      // can fail with "Cannot use import statement outside a module" despite the flag.
      // Register inside an eval CommonJS bootstrap before requiring the absolute TS path,
      // so that first file travels through an already registered tsx require hook.
      if (options.typescriptBootstrap !== undefined) {
        if (typeof workerEntry !== "string" || !isAbsolute(workerEntry)) throw new TypeError("TypeScript bootstrap requires an absolute filesystem entry path");
        // Eval/tsx loads a CJS image of files the parent covers as ESM. Merging both V8
        // profiles concatenates function tables and can clobber parent line hits with the
        // worker copy, corrupting coverage. Suppress only this TS worker profile; compiled
        // ESM workers retain coverage because their module image matches the parent.
        // Worker-only entries consequently need their own verification; no scratch profile
        // directory is created merely to leave cleanup behind.
        delete workerEnv.NODE_V8_COVERAGE;
        const bootstrap = `require(${JSON.stringify(options.typescriptBootstrap.registerModulePath)}).register();\nrequire(${JSON.stringify(workerEntry)});\n`;
        worker = new Worker(bootstrap, { eval: true, workerData: payload, resourceLimits, env: workerEnv, execArgv: [] });
      } else {
        worker = new Worker(workerEntry, { workerData: payload, resourceLimits, env: workerEnv, execArgv: [] });
      }
      return {
        once(input) {
          if (input.event === "message") worker.once("message", (message) => input.listener({ message }));
          else if (input.event === "error") worker.once("error", (error) => input.listener({ error }));
          else worker.once("exit", (code) => input.listener({ code }));
        },
        terminate: () => worker.terminate(),
      };
    },
  };
}

/**
 * Create the Node timeout adapter; construction has no timer effects.
 * @param required Empty required arguments object.
 * @returns WorkerScheduler using native timers.
 * @complexity O(1) per schedule/cancel.
 */
export function createNodeWorkerScheduler(_required: Record<string, never>): WorkerScheduler {
  return { schedule: ({ delayMs, run }) => { const timer = setTimeout(run, delayMs); return () => clearTimeout(timer); } };
}
