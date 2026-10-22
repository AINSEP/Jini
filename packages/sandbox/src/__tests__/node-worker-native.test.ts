import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import type { Worker, WorkerOptions } from "node:worker_threads";
import { test } from "vitest";
import { createNodeWorkerFactory, createNodeWorkerScheduler, renderInWorkerSandbox, runInWorkerSandbox } from "../node-worker.js";

// Pin the creation boundary for both entry modes; neither may auto-forward worker
// output to parent streams, and captured output must be drained to avoid backpressure.
test("native and bootstrap workers disable stdin and drain isolated stdout/stderr", () => {
  for (const typescriptBootstrap of [undefined, { registerModulePath: "/host/register.cjs" }]) {
    const native = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), terminate: async () => 0,
    });
    let createdOptions: WorkerOptions | undefined;
    const factory = createNodeWorkerFactory({ env: {} }, {
      ...(typescriptBootstrap ? { typescriptBootstrap } : {}),
      createWorker: ({ options }) => { createdOptions = options; return native as unknown as Worker; },
    });
    try {
      const handle = factory.spawn({ workerEntry: "/host/worker.js", payload: { value: 7 }, resourceLimits: {} });
      assert.ok(createdOptions);
      assert.equal(createdOptions.stdin, false);
      assert.equal(createdOptions.stdout, true);
      assert.equal(createdOptions.stderr, true);
      assert.equal(native.stdout.readableFlowing, true);
      assert.equal(native.stderr.readableFlowing, true);
      let reply: unknown;
      handle.once({ event: "message", listener: ({ message }) => { reply = message; } });
      native.emit("message", { ok: true, html: "rendered" });
      assert.deepEqual(reply, { ok: true, html: "rendered" });
    } finally {
      native.stdout.destroy();
      native.stderr.destroy();
    }
  }
});

test("the native adapter preserves the original exit-without-reply characterization", async () => {
  for (const errorLabel of ["Example", "Alternate"]) {
    await assert.rejects(renderInWorkerSandbox({
      workerEntry: new URL("./fixtures/exit-worker.cjs", import.meta.url), input: { value: 7 }, errorLabel,
      defaultTimeoutMs: 3000, defaultResourceLimits: {}, workerFactory: createNodeWorkerFactory({ env: { ...process.env } }),
      scheduler: createNodeWorkerScheduler({}),
    }), { message: `${errorLabel} render worker exited with code 7` });
  }
});

test("native workers structured-clone generic payloads and return decoded results", async () => {
  const result = await runInWorkerSandbox({
    workerEntry: new URL("./fixtures/reply-worker.cjs", import.meta.url), input: { value: 21 }, errorLabel: "Example",
    defaultTimeoutMs: 3000, defaultResourceLimits: {}, workerFactory: createNodeWorkerFactory({ env: { ...process.env } }),
    scheduler: createNodeWorkerScheduler({}),
    decodeResult: ({ message }) => (message as { value: number }).value * 2,
  });
  assert.equal(result, 42);
});

// Copied/generalized from the original eval-worker coverage corruption regression.
test("an eval-bootstrap worker emits no V8 coverage profile into its supplied aggregation directory", async () => {
  const probeDir = mkdtempSync(join(tmpdir(), "worker-coverage-"));
  try {
    await assert.rejects(renderInWorkerSandbox({
      workerEntry: fileURLToPath(new URL("./fixtures/exit-worker.cjs", import.meta.url)), input: { value: 7 }, errorLabel: "Example",
      defaultTimeoutMs: 3000, defaultResourceLimits: {}, scheduler: createNodeWorkerScheduler({}),
      workerFactory: createNodeWorkerFactory({ env: { ...process.env, NODE_V8_COVERAGE: probeDir } }, {
        typescriptBootstrap: { registerModulePath: fileURLToPath(new URL("./fixtures/register-worker.cjs", import.meta.url)) },
      }),
    }), { message: "Example render worker exited with code 7" });
    assert.deepEqual(readdirSync(probeDir), []);
  } finally { rmSync(probeDir, { recursive: true, force: true }); }
});

test("TypeScript bootstrap refuses a relative path or URL entry before creating any worker", async () => {
  let created = 0;
  const factory = createNodeWorkerFactory({ env: {} }, {
    typescriptBootstrap: { registerModulePath: "/host/register.cjs" },
    createWorker: () => { created++; throw new Error("must not create"); },
  });
  for (const workerEntry of ["worker.ts", new URL("file:///host/worker.ts")]) {
    assert.throws(() => factory.spawn({ workerEntry, payload: {}, resourceLimits: {} }), { name: "TypeError", message: "TypeScript bootstrap requires an absolute filesystem entry path" });
  }
  assert.equal(created, 0);
});
