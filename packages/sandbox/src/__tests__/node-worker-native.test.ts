import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { createNodeWorkerFactory, createNodeWorkerScheduler, renderInWorkerSandbox, runInWorkerSandbox } from "../node-worker.js";

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
