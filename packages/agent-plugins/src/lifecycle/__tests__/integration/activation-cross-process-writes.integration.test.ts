import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "../legacy-test.js";
import { fileURLToPath } from "node:url";

import { forceRemove } from "../fixtures/force-remove.js";
import { resolveAgentPluginActivation } from "../test-support.js";

/**
 * @file X1-X3 — the cross-process half of the concurrency race `activation.ts`'s in-process chain
 * (`72dc4766`, `39e664ab`) never closed: two SEPARATE OS processes, not two async calls in one, both
 * writing one workspace's `activations.json` at once (t91 2026-09-16, plan
 * `agent-reports/2026-09-16-t91-plan-activations-lock.md` §5). Each test spawns real
 * `tsx`-run children against `../fixtures/activation-writer-child.ts` rather than mocking anything
 * cross-process, because the bug this closes IS the absence of any cross-process coordination.
 *
 * X1 is the RED that must fail at HEAD (before `exclusive-file-lock.ts` existed): B's small write
 * completes fully inside the window A is paused between its own read and its own rename, and A's
 * later rename silently erases B's disable the instant it lands.
 */

const FIXTURE = fileURLToPath(new URL("../fixtures/activation-writer-child.ts", import.meta.url));

interface ChildResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
}

function spawnChild(args: readonly string[]): { child: ChildProcess; result: Promise<ChildResult> } {
  const child = spawn(process.execPath, ["--import", "tsx", FIXTURE, ...args], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const result = new Promise<ChildResult>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal, stderr }));
  });
  return { child, result };
}

/** Waits for `filePath` to exist, or rejects with the child's own stderr if it exits first — so a
 *  fixture bug reads as a real assertion failure, not an opaque 30s timeout. */
async function waitForSignal(filePath: string, result: Promise<ChildResult>, timeoutMs: number): Promise<void> {
  const start = performance.now();
  let exited: ChildResult | undefined;
  result.then((outcome) => {
    exited = outcome;
  }).catch(() => undefined);

  for (;;) {
    try {
      await readFile(filePath);
      return;
    } catch {
      // not there yet
    }
    if (exited !== undefined) {
      throw new Error(`activation-writer-child exited (code=${exited.code}, signal=${exited.signal}) before writing ${filePath}\n${exited.stderr}`);
    }
    if (performance.now() - start > timeoutMs) throw new Error(`timed out after ${timeoutMs}ms waiting for ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

type ExitOutcome = ChildResult | "timeout";

async function waitForExit(result: Promise<ChildResult>, ms: number): Promise<ExitOutcome> {
  return Promise.race([result, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms))]);
}

async function freshRoots(): Promise<{ root: string; signalDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "host-activation-xproc-"));
  const signalDir = await mkdtemp(path.join(tmpdir(), "host-activation-xproc-signals-"));
  return { root, signalDir };
}

function killIfAlive(child: ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

test("X1: a second process's write during a first process's paused rename is not erased once the write is locked cross-process", async () => {
  const { root, signalDir } = await freshRoots();
  let childA: ChildProcess | undefined;
  let childB: ChildProcess | undefined;
  try {
    await writeFile(path.join(root, "activations.json"), '{"schemaVersion":1,"plugins":{}}\n', "utf8");

    const a = spawnChild(["pause-before-rename", root, signalDir, "plugin-a"]);
    childA = a.child;
    await waitForSignal(path.join(signalDir, "plugin-a.paused"), a.result, 30_000);

    const b = spawnChild(["plain", root, signalDir, "plugin-b"]);
    childB = b.child;
    await waitForSignal(path.join(signalDir, "plugin-b.started"), b.result, 30_000);

    // A genuine, awaited real-time wait — not a background race — so A stays paused (holding the
    // lock) for the whole window: only that proves B could not have finished DURING it. A background
    // race constructed right before releasing A would settle almost as soon as B unblocks, which
    // happens quickly after release regardless of whether the lock ever worked.
    const bEarlyOutcome = await waitForExit(b.result, 3000);

    await writeFile(path.join(signalDir, "plugin-a.release"), "1", "utf8");

    const [outcomeA, outcomeB] = await Promise.all([a.result, b.result]);

    assert.equal(outcomeA.code, 0, `process A must exit 0 — stderr: ${outcomeA.stderr}`);
    assert.equal(outcomeB.code, 0, `process B must exit 0 — stderr: ${outcomeB.stderr}`);
    assert.equal((await resolveAgentPluginActivation(root, "plugin-a")).verdict, "inactive");
    assert.equal(
      (await resolveAgentPluginActivation(root, "plugin-b")).verdict,
      "inactive",
      "plugin-b's disable was erased by a process that had read activations.json before plugin-b was written",
    );
    assert.equal(
      bEarlyOutcome,
      "timeout",
      "process B finished its write while process A was between its read and its rename, so there is no cross-process lock",
    );
    assert.deepEqual(await readdir(root), ["activations.json"], "no activations.json.lock may be left behind");
  } finally {
    if (childA) killIfAlive(childA);
    if (childB) killIfAlive(childB);
    await forceRemove(root);
    await forceRemove(signalDir);
  }
});

test("X2: an 80-write burst across two processes loses nothing and leaves no lock behind", async () => {
  const { root, signalDir } = await freshRoots();
  let childA: ChildProcess | undefined;
  let childB: ChildProcess | undefined;
  try {
    await writeFile(path.join(root, "activations.json"), '{"schemaVersion":1,"plugins":{}}\n', "utf8");

    const a = spawnChild(["burst", root, signalDir, "plugin-a", "40"]);
    childA = a.child;
    const b = spawnChild(["burst", root, signalDir, "plugin-b", "40"]);
    childB = b.child;

    await Promise.all([
      waitForSignal(path.join(signalDir, "plugin-a.ready"), a.result, 30_000),
      waitForSignal(path.join(signalDir, "plugin-b.ready"), b.result, 30_000),
    ]);
    await writeFile(path.join(signalDir, "go"), "1", "utf8");

    const [outcomeA, outcomeB] = await Promise.all([waitForExit(a.result, 60_000), waitForExit(b.result, 60_000)]);
    assert.notEqual(outcomeA, "timeout", "process A must finish its 40-write burst within 60s");
    assert.notEqual(outcomeB, "timeout", "process B must finish its 40-write burst within 60s");
    assert.equal((outcomeA as ChildResult).code, 0, `process A must exit 0 — stderr: ${(outcomeA as ChildResult).stderr}`);
    assert.equal((outcomeB as ChildResult).code, 0, `process B must exit 0 — stderr: ${(outcomeB as ChildResult).stderr}`);

    for (const prefix of ["plugin-a", "plugin-b"]) {
      for (let index = 0; index < 40; index++) {
        assert.equal((await resolveAgentPluginActivation(root, `${prefix}-${index}`)).verdict, "inactive", `${prefix}-${index} was lost`);
      }
    }
    assert.deepEqual(await readdir(root), ["activations.json"], "no activations.json.lock may be left behind");
  } finally {
    if (childA) killIfAlive(childA);
    if (childB) killIfAlive(childB);
    await forceRemove(root);
    await forceRemove(signalDir);
  }
});

test("X3: a lock left by a SIGKILLed holder is recovered by liveness, not by waiting out the age threshold", async () => {
  const { root, signalDir } = await freshRoots();
  let childA: ChildProcess | undefined;
  try {
    await writeFile(path.join(root, "activations.json"), '{"schemaVersion":1,"plugins":{}}\n', "utf8");

    const a = spawnChild(["pause-before-rename", root, signalDir, "plugin-a"]);
    childA = a.child;
    await waitForSignal(path.join(signalDir, "plugin-a.paused"), a.result, 30_000);

    const lockPath = path.join(root, "activations.json.lock");
    const lockRaw = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number };
    assert.equal(lockRaw.pid, childA.pid);

    const exited = new Promise<void>((resolve) => childA?.on("exit", () => resolve()));
    childA.kill("SIGKILL");
    await exited;

    const start = performance.now();
    const { setAgentPluginActivation } = await import("../test-support.js");
    await setAgentPluginActivation({ workspaceRoot: root, pluginId: "plugin-b", enabled: false, actor: "parent" });
    const elapsed = performance.now() - start;

    assert.ok(elapsed < 5000, `recovered by lock age, not by seeing the holder's process was gone (took ${elapsed}ms)`);
    assert.equal((await resolveAgentPluginActivation(root, "plugin-b")).verdict, "inactive");
    assert.equal((await resolveAgentPluginActivation(root, "plugin-a")).verdict, "active", "A never committed, so its own disable must not have landed");
    await assert.rejects(readFile(lockPath), { code: "ENOENT" });
  } finally {
    if (childA) killIfAlive(childA);
    await forceRemove(root);
    await forceRemove(signalDir);
  }
});
