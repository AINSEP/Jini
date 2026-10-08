import assert from "node:assert/strict";
import test from "node:test";
import { activateStore } from "../store-plugin.js";
/** Preparation failures must prevent seeding and every SQL operation. */
test("store preparation failure never enters a repository", async () => {
  const fault = new Error("storage not approved");
  const kernel = { transaction: () => { assert.fail("SQL must not start after refused preparation"); } } as unknown as Parameters<typeof activateStore>[0]["kernel"];
  await assert.rejects(activateStore({ kernel, prepareStorage: async () => { throw fault; } }), error => error === fault);
});
