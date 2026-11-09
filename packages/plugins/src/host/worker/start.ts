/**
 * @file `startTier2Worker()` — the per-call wiring of ONE Tier-2 plugin call inside a
 * `worker_threads` worker (ADR-024 §3/§4). The host spawns its own worker entry file by path in a
 * fresh, heap-limited worker per call, and terminates it after the first reply or the timeout; that
 * entry calls this function with its own message port, request and product binding.
 *
 * The call logic is `run-call.ts`'s pure `runTier2Call()`; this file only wires the worker's own
 * message port and import mechanism to it. Importing this module starts nothing.
 */
import type { Tier2Request } from "./protocol.js";
import { runTier2Call, type RunTier2CallRequired } from "./run-call.js";

/**
 * Required inputs of {@link startTier2Worker}.
 *
 * @agent-note The worker entry is the host's own file: it reads `workerData`/`parentPort` from
 * `node:worker_threads`, supplies its product binding and SDK resolver, and decides when to call
 * this (normally only when not on the main thread). Jini never auto-starts a worker.
 */
export interface StartTier2WorkerRequired {
  /** The `Tier2Request` the host posted as `workerData` (built by the server from a validated manifest). */
  readonly workerData: unknown;
  /** @agent-note `null` (not inside a worker) throws before any registration or import. */
  readonly parentPort: { postMessage(message: unknown): void } | null;
  /** @agent-note The host's plugin SDK binding and invocation-deps factory, shared by every call
   * in this worker; the same binding the host's main thread uses. */
  readonly binding: Omit<RunTier2CallRequired, "request" | "importModule">;
  /** @agent-note Registers the host's SDK module resolver in THIS worker. Called once, before the
   * first real import of plugin code, and only when no `importModule` test seam is supplied.
   * Main-thread resolver hooks do not reach a worker spawned with empty `execArgv`. */
  readonly registerSdkResolver: () => void;
  /** @agent-note The host's real `import()` of a plugin entry, defined in the host's own worker
   * entry module so the host's loader (for example a dev transpiler's CJS interop) applies to it. */
  readonly realImport: (entryPath: string) => Promise<unknown>;
}

/** Optional inputs of {@link startTier2Worker}. */
export interface StartTier2WorkerOptional {
  /** Test seam. Omitted ⇒ register the SDK resolver in this worker, then `realImport`.
   * @agent-note When supplied, `registerSdkResolver` and `realImport` are never called. */
  readonly importModule?: (entryPath: string) => Promise<unknown>;
}

/**
 * Runs the posted request and posts its reply.
 *
 * @agent-note One call per worker: posts exactly one reply, then the host terminates the worker.
 * A plugin-side failure becomes a structured failed reply, never a rejection; a rejection here
 * (no parent port, or a reply that cannot be posted) becomes the worker's `error` event on the host.
 * The module's `default` export is what the plugin contributes; a non-object module yields none.
 * @throws When there is no parent port (not inside a worker).
 * @complexity O(1) own work plus the plugin's import/setup/filter cost.
 */
export async function startTier2Worker(required: StartTier2WorkerRequired, optional: StartTier2WorkerOptional = {}): Promise<void> {
  const port = required.parentPort;
  if (!port) throw new Error("the tier-2 plugin worker must run inside a worker_threads Worker");

  let importModule = optional.importModule;
  if (!importModule) {
    // CIC U-002, per worker: main-thread `module.register()` hooks do not reach a worker spawned
    // with `execArgv: []` (measured, Node v24.2.0), so without this a site plugin's
    // SDK imports (including the legacy alias) fail, or resolve to a copy planted next to the plugin. Registered
    // before the plugin's first import.
    required.registerSdkResolver();
    importModule = required.realImport;
  }
  const importEntry = importModule;
  port.postMessage(await runTier2Call({ ...required.binding, request: required.workerData as Tier2Request, importModule: async ({ modulePath }) => {
    const imported = await importEntry(modulePath);
    return { exported: typeof imported === "object" && imported !== null ? (imported as { default?: unknown }).default : undefined };
  } }));
}
