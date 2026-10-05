import assert from "node:assert/strict";
import { test } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRestorePoint } from "../../tools/restore-points.js";

/**
 * @file `backup_create_restore_point`.
 *
 * Assumed seam design:
 *
 * ```ts
 * export class ValidationError extends Error {}
 * export class RestorePointUnavailableError extends Error {}
 *
 * export interface RestorePointSummary { id: string; costClass: "cheap"|"expensive"|"unavailable"; kind: string; }
 *
 * export async function createRestorePoint(
 * required: {
 * costClass: "cheap" | "expensive" | "unavailable";
 * kind: string;
 * costAck?: boolean;
 * capture:  => Promise<{ artifactRef: string; watermarkAtCapture: number }>;
 * },
 * optional?: {}
 * ): Promise<RestorePointSummary>;
 * ```
 * See docs/decisions/DR-002-restore-point-precondition.md.
 */

test("AC-26 / REQ-22: createRestorePoint on an 'expensive' site without costAck is rejected with ValidationError", async () => {
  let captures = 0;
  await assert.rejects(
    createRestorePoint({
      costClass: "expensive",
      kind: "file-snapshot",
      capture: async () => { captures += 1; return { artifactRef: "/tmp/x", watermarkAtCapture: 1 }; },
    }),
    (err: unknown) => (err as Error).name === "ValidationError"
  );
  assert.equal(captures, 0);
});

test("AC-27 / REQ-22: createRestorePoint on an 'expensive' site WITH costAck=true mints the restore point", async () => {
  const artifacts: { artifactRef: string; watermarkAtCapture: number }[] = [];
  const result = await createRestorePoint({
    costClass: "expensive",
    costAck: true,
    kind: "file-snapshot",
    capture: async () => { const artifact = { artifactRef: "/tmp/x", watermarkAtCapture: 5 }; artifacts.push(artifact); return artifact; },
  });

  assert.ok(result.id);
  assert.equal(result.costClass, "expensive");
  assert.equal(result.kind, "file-snapshot");
  assert.deepEqual(artifacts, [{ artifactRef: "/tmp/x", watermarkAtCapture: 5 }]);
});

test("createRestorePoint on a 'cheap' site succeeds without costAck (only 'expensive' requires it)", async () => {
  const artifacts: { artifactRef: string; watermarkAtCapture: number }[] = [];
  const result = await createRestorePoint({
    costClass: "cheap",
    kind: "file-snapshot",
    capture: async () => { const artifact = { artifactRef: "/tmp/x", watermarkAtCapture: 3 }; artifacts.push(artifact); return artifact; },
  });
  assert.ok(result.id);
  assert.equal(result.costClass, "cheap");
  assert.equal(result.kind, "file-snapshot");
  assert.deepEqual(artifacts, [{ artifactRef: "/tmp/x", watermarkAtCapture: 3 }]);
});

// REGRESSION: fails if createRestorePoint hardcodes kind "file-snapshot" — a Postgres host's
// logical dump was recorded as a file snapshot, mislabeling every Postgres restore point.
test("createRestorePoint reports the host's real restore kind, not a hardcoded file-snapshot", async () => {
  const result = await createRestorePoint({
    costClass: "expensive",
    costAck: true,
    kind: "logical-dump",
    capture: async () => ({ artifactRef: "pg-dump://site", watermarkAtCapture: 2 }),
  });
  assert.equal(result.costClass, "expensive");
  assert.equal(result.kind, "logical-dump");
});

test("EC-04 / REQ-22: createRestorePoint on an 'unavailable' site is rejected with RestorePointUnavailableError, regardless of costAck", async () => {
  let captures = 0;
  await assert.rejects(
    createRestorePoint({
      costClass: "unavailable",
      kind: "logical-dump",
      costAck: true,
      capture: async () => { captures += 1; return { artifactRef: "/tmp/x", watermarkAtCapture: 1 }; },
    }),
    (err: unknown) => (err as Error).name === "RestorePointUnavailableError"
  );
  assert.equal(captures, 0);
});

test("createRestorePoint propagates capture failure instead of minting a usable summary", async () => {
  const error = new Error("snapshot disk full");
  let captures = 0;
  await assert.rejects(createRestorePoint({ costClass: "cheap", kind: "file-snapshot", capture: async () => { captures += 1; throw error; } }),
    (actual) => actual === error);
  assert.equal(captures, 1);
});

for (const costClass of ["cheap", "expensive"] as const) {
  test(`createRestorePoint awaits the ${costClass} snapshot artifact`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "restore-point-artifact-"));
    t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
    const artifactRef = join(dir, "snapshot");
    const result = await createRestorePoint({ costClass, kind: "file-snapshot", costAck: true, capture: async () => {
      await writeFile(artifactRef, "snapshot bytes");
      return { artifactRef, watermarkAtCapture: 7 };
    } });
    assert.equal(await readFile(artifactRef, "utf8"), "snapshot bytes");
    assert.equal(result.costClass, costClass);
    assert.equal(result.kind, "file-snapshot");
  });
}

test("restore-point refusals preserve operator guidance without specification IDs and never capture", async () => {
  let captures = 0;
  const capture = async () => { captures += 1; return { artifactRef: "unused", watermarkAtCapture: 1 }; };
  await assert.rejects(createRestorePoint({ costClass: "unavailable", kind: "logical-dump", costAck: true, capture }), {
    name: "RestorePointUnavailableError",
    message: "no restore-point mechanism is available for the source; migration is refused with no attestation override",
  });
  await assert.rejects(createRestorePoint({ costClass: "expensive", kind: "logical-dump", capture }), {
    name: "ValidationError",
    message: "an 'expensive' restore point requires an explicit costAck; the confirmer must acknowledge the cost/disk estimate first",
  });
  assert.equal(captures, 0);
});
