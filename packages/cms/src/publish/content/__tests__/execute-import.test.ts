import assert from "node:assert/strict";
import { test } from "vitest";

import { executePublishContentImport, RestorePointUnavailableError } from "../execute-import.js";

// F4.4/F2.5: the restore-point gate alone decides whether the real gateway may run.
test("unavailable restore point is still a hard refusal with no attestation override", async () => {
  const writes: string[] = [];
  await assert.rejects(executePublishContentImport({
    workspaceId: "destination-ws", costClass: "unavailable",
    gatewayExecute: async () => { writes.push("imported"); return "imported"; },
  }), {
    constructor: RestorePointUnavailableError,
    name: "RestorePointUnavailableError",
    message: "workspace 'destination-ws' has restore-point costClass 'unavailable' — publish-content import " +
      "is refused with no attestation override",
  });
  assert.deepEqual(writes, []);
});

for (const costClass of ["cheap", "expensive"] as const) {
  test(`${costClass} restore points execute the gateway exactly once and preserve its result`, async () => {
    const writes: string[] = [];
    const result = { runId: "run-42", applied: 3 };
    const actual = await executePublishContentImport({
      workspaceId: "destination-ws", costClass,
      gatewayExecute: async () => { writes.push("run-42"); return result; },
    });
    assert.equal(actual, result);
    assert.deepEqual(actual, { runId: "run-42", applied: 3 });
    assert.deepEqual(writes, ["run-42"]);
  });

  test(`${costClass} restore points propagate gateway failure and permit a subsequent attempt`, async () => {
    let calls = 0;
    const failure = new Error("destination write failed");
    const request = {
      workspaceId: "destination-ws", costClass,
      gatewayExecute: async () => {
        if (++calls === 1) throw failure;
        return { runId: "retry-42" };
      },
    };
    await assert.rejects(executePublishContentImport(request), (error) => error === failure);
    assert.deepEqual(await executePublishContentImport(request), { runId: "retry-42" });
    assert.equal(calls, 2);
  });
}
