/**
 * @file In-memory fakes of the runtime ports (`FileLockPort`, `AtomicFileWriterPort`,
 * `ProcessControlPort`, `HttpFetchPort`, `GuardedHttpPort`) for tests of OTHER packages, so a
 * consumer's test passes a fake through the production argument instead of importing the Node
 * implementation from `@jini-ai/platform` or mocking it. Every fake records the arguments it was
 * given, in order, and does no I/O (no `node:` import: core is runtime-neutral).
 */
import type { HttpClientPort, HttpRequest, HttpResponse } from "../../primitives/index.js";
import type { AtomicFileWriterPort, AtomicWritePortOptions } from "./fs.js";
import type { FileLockPort, FileLockPortOptions, HeldFileLock } from "./file-lock.js";
import type { GuardedHttpPort, GuardedHttpRequired, HttpFetchPort } from "./http.js";
import { collectProcessTreePids, type ProcessControlPort, type ProcessSnapshot, type StopProcessesResult } from "./process.js";

export interface RecordedFileLockCall { readonly lockPath: string; readonly options: FileLockPortOptions | undefined }
export interface FakeFileLock extends FileLockPort {
  /** Every `withFileLock` call, in call order. */
  readonly calls: readonly RecordedFileLockCall[];
  /** Lock paths held right now; a path leaves the set when its `run` settles, also when it throws. */
  readonly held: ReadonlySet<string>;
}

/** Runs each critical section immediately and records the lock path and options it was asked for. */
export function fakeFileLock(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): FakeFileLock {
  const calls: RecordedFileLockCall[] = [];
  const held = new Set<string>();
  return {
    calls,
    held,
    async withFileLock<T>(required: { lockPath: string; run: (lock: HeldFileLock) => Promise<T> | T }, optional?: FileLockPortOptions): Promise<T> {
      calls.push({ lockPath: required.lockPath, options: optional });
      held.add(required.lockPath);
      try {
        return await required.run({ lockPath: required.lockPath, assertHeld: async () => undefined });
      } finally {
        held.delete(required.lockPath);
      }
    },
  };
}

export interface RecordedAtomicWrite {
  readonly method: "writeText" | "writeJson";
  readonly filePath: string;
  /** Options as the caller passed them (`createParent`, `mode`, …): recorded, never acted on. */
  readonly options: AtomicWritePortOptions | undefined;
}
export interface FakeAtomicWriter extends AtomicFileWriterPort {
  /** File contents by path; JSON is stored as the platform writer serializes it (2-space indent). */
  readonly files: Map<string, string | Uint8Array>;
  readonly writes: readonly RecordedAtomicWrite[];
  /** Paths `backupOriginalOnce` was asked about, in call order. */
  readonly backups: readonly string[];
}

/** Writes into a `Map`; `createParent`, `mode` and the other options are recorded, not honoured. */
export function fakeAtomicWriter(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): FakeAtomicWriter {
  const files = new Map<string, string | Uint8Array>();
  const writes: RecordedAtomicWrite[] = [];
  const backups: string[] = [];
  return {
    files,
    writes,
    backups,
    async writeText({ filePath, content }, optional) {
      writes.push({ method: "writeText", filePath, options: optional });
      files.set(filePath, content);
    },
    async writeJson({ filePath, data }, optional) {
      writes.push({ method: "writeJson", filePath, options: optional });
      const text = JSON.stringify(data, null, 2);
      if (text === undefined) throw new TypeError("writeJson was given data JSON cannot represent");
      files.set(filePath, optional?.trailingNewline ? `${text}\n` : text);
    },
    async backupOriginalOnce({ filePath }) {
      backups.push(filePath);
    },
  };
}

export interface FakeProcessControl extends ProcessControlPort {
  /** The pid lists `stopProcesses` was asked to stop, in call order. */
  readonly stopRequests: ReadonlyArray<ReadonlyArray<number | null | undefined>>;
  /** The pids `waitForProcessExit` was asked about, in call order. */
  readonly waited: ReadonlyArray<number | null | undefined>;
}

/**
 * A process table that `stopProcesses` empties: it stops the requested pids and their descendants
 * (the same tree walk the real port uses) and reports them as stopped, none forced.
 * `waitForProcessExit` answers true once the pid is no longer in the table.
 */
export function fakeProcessControl(_required: Record<string, never> = {}, optional: { readonly processes?: readonly ProcessSnapshot[] } = {}): FakeProcessControl {
  let table: ProcessSnapshot[] = [...(optional.processes ?? [])];
  const stopRequests: Array<ReadonlyArray<number | null | undefined>> = [];
  const waited: Array<number | null | undefined> = [];
  return {
    stopRequests,
    waited,
    async listProcessSnapshots() {
      return table.map((snapshot) => ({ ...snapshot }));
    },
    async stopProcesses({ pids }): Promise<StopProcessesResult> {
      stopRequests.push(pids);
      const matchedPids = collectProcessTreePids({ processes: table.map((snapshot) => ({ ...snapshot })), rootPids: [...pids] }).filter((pid) => table.some((snapshot) => snapshot.pid === pid));
      table = table.filter((snapshot) => !matchedPids.includes(snapshot.pid));
      return { alreadyStopped: matchedPids.length === 0, forcedPids: [], matchedPids, remainingPids: [], stoppedPids: matchedPids };
    },
    async waitForProcessExit({ pid }) {
      waited.push(pid);
      return typeof pid !== "number" || !table.some((snapshot) => snapshot.pid === pid);
    },
  };
}

export interface RecordedHttpFetch { readonly url: string; readonly timeoutMs: number; readonly init: RequestInit | undefined }
export interface FakeHttpFetch extends HttpFetchPort {
  readonly calls: readonly RecordedHttpFetch[];
}

/** Answers every request from `respond` (default: `200` with an empty body) and records it. */
export function fakeHttpFetch(_required: Record<string, never> = {}, optional: { readonly respond?: (request: { url: string; init: RequestInit | undefined }) => Response | Promise<Response> } = {}): FakeHttpFetch {
  const calls: RecordedHttpFetch[] = [];
  const respond = optional.respond ?? (() => new Response(""));
  return {
    calls,
    async fetchWithTimeout({ url, timeoutMs }, optional) {
      calls.push({ url: String(url), timeoutMs, init: optional?.init });
      return respond({ url: String(url), init: optional?.init });
    },
    async readResponseText({ response }) {
      return response.text();
    },
  };
}

/** A canned answer for one `METHOD url` (method upper-case, e.g. `"GET https://a.test/x"`). */
export type FakeGuardedRoutes = Readonly<Record<string, Partial<HttpResponse> | ((request: HttpRequest) => Partial<HttpResponse>)>>;
export interface FakeGuardedHttp extends GuardedHttpPort {
  /** Requests the clients it created were asked to send, in order. */
  readonly requests: readonly HttpRequest[];
  /** The `createClient` arguments, in call order. */
  readonly clients: readonly GuardedHttpRequired[];
}

/**
 * Serves `routes` through clients that never open a socket. A request that matches no route gets
 * a `404` so a test fails on the assertion about the answer, not on an exception inside the fake.
 */
export function fakeGuardedHttp(required: { readonly routes: FakeGuardedRoutes }, _optional: Record<string, never> = {}): FakeGuardedHttp {
  const requests: HttpRequest[] = [];
  const clients: GuardedHttpRequired[] = [];
  const send: HttpClientPort["send"] = async ({ request }) => {
    requests.push(request);
    const route = required.routes[`${request.method} ${request.url}`];
    const answer = typeof route === "function" ? route(request) : route;
    return { status: 404, headers: {}, bodyText: "", finalUrl: request.url, ...answer };
  };
  return {
    requests,
    clients,
    createClient(input) {
      clients.push(input);
      return { send };
    },
    async fetch({ client, url }, optional) {
      const response = await client.send({
        request: { method: (optional?.method ?? "GET") as HttpRequest["method"], url, headers: optional?.headers ?? {}, ...(typeof optional?.body === "string" ? { body: optional.body } : {}), idleTimeoutMs: optional?.idleTimeoutMs ?? 1 },
      });
      return new Response(response.bodyText, { status: response.status, headers: { ...response.headers } });
    },
  };
}
