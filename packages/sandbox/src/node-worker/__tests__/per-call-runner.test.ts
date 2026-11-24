import { describe, expect, it } from "vitest";

import type { WorkerFactory, WorkerScheduler, WorkerSubscription } from "../../node-worker.js";
import {
  createPerCallWorkerRunner,
  perCallWorkerEnv,
  resolvePerCallWorkerTimeoutMs,
  type CreatePerCallWorkerRunnerRequired,
} from "../per-call-runner.js";

/**
 * Moved from the host's `run-in-worker.unit.test.ts` (node:test -> vitest, every assertion kept;
 * the host's tier-2 reply codec, entry directory and env name are injected here as neutral fakes).
 *
 * Requirement-to-test map:
 * - the request is the worker payload, the entry is `<dir>/<name><ext>`, default heap limits and
 *   the env-resolved timeout apply -> the spawn test.
 * - the reply is decoded against the request -> the decode test.
 * - a timeout or crash rejects (the caller then fails closed) -> the timeout/error tests.
 * - timeout env parsing is strict -> the resolvePerCallWorkerTimeoutMs table.
 * - a compiled build spawns `worker.js` without the TS bootstrap -> the .js test.
 * - the worker env is an allowlist, never the server env -> the perCallWorkerEnv test.
 */

type FakeRequest = { readonly kind: "probe" | "beforeSave"; readonly id: string };
const request: FakeRequest = { kind: "probe", id: "t2" };
const LIMITS = { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, codeRangeSizeMb: 16 };
const ENV_KEY = "JINI_TEST_WORKER_TIMEOUT_MS";

function required(overrides: Partial<CreatePerCallWorkerRunnerRequired<FakeRequest, unknown>> = {}): CreatePerCallWorkerRunnerRequired<FakeRequest, unknown> {
  return {
    env: {},
    entryDirectory: "/host/guest",
    workerEntryName: "worker",
    moduleExtension: ".ts",
    typescriptBootstrapPath: "/host/guest/typescript-bootstrap.cjs",
    timeoutEnvKey: ENV_KEY,
    defaultTimeoutMs: 5_000,
    maxTimeoutMs: 60_000,
    defaultResourceLimits: LIMITS,
    errorLabel: ({ request: r }) => `guest '${r.id}'`,
    decodeResult: ({ message, request: r }) => {
      if ((message as { kind?: string }).kind !== r.kind) throw new Error("invalid worker reply");
      return message;
    },
    ...overrides,
  };
}

function fakePorts(reply: { message?: unknown; error?: Error } = {}) {
  const spawned: Array<{ workerEntry: string | URL; payload: unknown; resourceLimits: unknown }> = [];
  const timers: Array<{ delayMs: number; run: () => void }> = [];
  let terminated = 0;
  const workerFactory: WorkerFactory = {
    spawn(input) {
      spawned.push(input);
      return {
        once(sub: WorkerSubscription) {
          if (sub.event === "message" && "message" in reply) queueMicrotask(() => sub.listener({ message: reply.message }));
          if (sub.event === "error" && reply.error) queueMicrotask(() => sub.listener({ error: reply.error! }));
        },
        terminate: async () => { terminated += 1; return 0; },
      };
    },
  };
  const scheduler: WorkerScheduler = {
    schedule(input) {
      timers.push(input);
      return () => {};
    },
  };
  return { workerFactory, scheduler, spawned, timers, terminated: () => terminated };
}

describe("createPerCallWorkerRunner", () => {
  it("spawns the injected worker entry with the request as payload, default heap limits and the env timeout", async () => {
    const ports = fakePorts({ message: { ok: true, kind: "probe", hooks: [] } });
    const runCall = createPerCallWorkerRunner(required({ env: { [ENV_KEY]: "1234" } }), { workerFactory: ports.workerFactory, scheduler: ports.scheduler });
    expect(await runCall(request)).toEqual({ ok: true, kind: "probe", hooks: [] });
    expect(ports.spawned.length).toBe(1);
    expect(ports.spawned[0]!.workerEntry).toBe("/host/guest/worker.ts");
    expect(ports.spawned[0]!.payload).toEqual(request);
    expect(ports.spawned[0]!.resourceLimits).toEqual(LIMITS);
    expect(ports.timers[0]!.delayMs).toBe(1234);
    expect(ports.terminated(), "the worker is torn down after its one reply").toBe(1);
  });

  it("explicit timeout and resource limits override the defaults", async () => {
    const ports = fakePorts({ message: { ok: true, kind: "probe", hooks: [] } });
    const runCall = createPerCallWorkerRunner(required(), {
      workerFactory: ports.workerFactory,
      scheduler: ports.scheduler,
      timeoutMs: 77,
      resourceLimits: { maxOldGenerationSizeMb: 8 },
    });
    await runCall(request);
    expect(ports.timers[0]!.delayMs).toBe(77);
    expect(ports.spawned[0]!.resourceLimits).toEqual({ maxOldGenerationSizeMb: 8 });
  });

  it("a reply the codec rejects for this request rejects", async () => {
    const ports = fakePorts({ message: { ok: true, kind: "beforeSave", patch: {} } });
    const runCall = createPerCallWorkerRunner(required(), { workerFactory: ports.workerFactory, scheduler: ports.scheduler });
    await expect(runCall(request)).rejects.toThrow("invalid worker reply");
  });

  it("a worker error rejects with that error", async () => {
    const ports = fakePorts({ error: new Error("heap limit") });
    const runCall = createPerCallWorkerRunner(required(), { workerFactory: ports.workerFactory, scheduler: ports.scheduler });
    await expect(runCall(request)).rejects.toThrow("heap limit");
  });

  it("a timeout rejects with the injected label and terminates the worker", async () => {
    const ports = fakePorts();
    const runCall = createPerCallWorkerRunner(required(), { workerFactory: ports.workerFactory, scheduler: ports.scheduler, timeoutMs: 50 });
    const pending = runCall(request);
    ports.timers[0]!.run();
    await expect(pending).rejects.toThrow("guest 't2' exceeded 50ms timeout");
    expect(ports.terminated()).toBe(1);
  });

  it("a compiled build (.js) spawns worker.js with the real factory and no TypeScript bootstrap", async () => {
    // No worker.js exists in the injected directory, so the real worker fails to load it: the
    // rejection names worker.js, proving the entry choice and that no tsx bootstrap wrapped it.
    const runCall = createPerCallWorkerRunner(
      required({ entryDirectory: "/nonexistent-jini-guest", moduleExtension: ".js", typescriptBootstrapPath: "/nonexistent-bootstrap.cjs" }),
      { timeoutMs: 30_000 },
    );
    await expect(runCall(request)).rejects.toThrow(/nonexistent-jini-guest\/worker\.js/);
  });
});

const timeoutCases: ReadonlyArray<[string | undefined, number]> = [
  [undefined, 5_000],
  ["2500", 2_500],
  [" 60000 ", 60_000],
  ["60001", 5_000],
  ["5e3", 5_000],
  ["0", 5_000],
  ["abc", 5_000],
];
describe("resolvePerCallWorkerTimeoutMs", () => {
  for (const [raw, expected] of timeoutCases) {
    it(`${ENV_KEY}=${JSON.stringify(raw)} -> ${expected}ms`, () => {
      const env = raw === undefined ? {} : { [ENV_KEY]: raw };
      expect(resolvePerCallWorkerTimeoutMs({ env, timeoutEnvKey: ENV_KEY, defaultTimeoutMs: 5_000, maxTimeoutMs: 60_000 })).toBe(expected);
    });
  }
});

describe("perCallWorkerEnv", () => {
  it("keeps only the runtime/tooling allowlist, never server secrets", () => {
    expect(
      perCallWorkerEnv({ env: { NODE_ENV: "production", TZ: "UTC", TSX_TSCONFIG_PATH: "t.json", NODE_V8_COVERAGE: "/cov", APP_SITE_KEY: "site-key", DATABASE_URL: "postgres://u:p@h/db", PATH: "/bin" } }),
    ).toEqual({ NODE_ENV: "production", TZ: "UTC", TSX_TSCONFIG_PATH: "t.json", NODE_V8_COVERAGE: "/cov" });
    expect(perCallWorkerEnv({ env: {} })).toEqual({});
  });
});
