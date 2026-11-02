import assert from "node:assert/strict";
import test from "node:test";
import ops from "../render.mjs";
import { API, TARGET, context } from "./fixtures.mjs";

test("list returns names only, without values or invented revision metadata", async () => {
  const ctx = context([{ url: `${API}/services/${TARGET}/env-vars?limit=100`, json: [{ envVar: { key: "API_KEY", value: "must-not-leak", updatedAt: "not-a-revision" }, cursor: "one" }] }]);
  const result = await ops.listSecrets(ctx, { target: TARGET });
  assert.deepEqual(result, { secrets: [{ name: "API_KEY" }], truncated: false });
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false); assert.equal(ops.readSecret, undefined); ctx.done();
});
test("set is one escaped per-key PUT, never a whole-collection replace, and drops the echoed value", async () => {
  const ctx = context([{ method: "PUT", url: `${API}/services/${TARGET}/env-vars/A%2FB%20%3F%23`, body: { value: "private-value" }, json: { key: "A/B ?#", value: "private-value" } }]);
  assert.deepEqual(await ops.setSecret(ctx, { target: TARGET, name: "A/B ?#", value: "private-value" }), {});
  assert.deepEqual(ops.secretCapabilities, { appliesOn: "next-deploy", supportsStaging: true }); ctx.done();
});
test("unset exports only one per-key DELETE and drops the response", async () => {
  const ctx = context([{ method: "DELETE", url: `${API}/services/${TARGET}/env-vars/A%2FB`, json: { value: "must-not-leak" } }]);
  assert.deepEqual(await ops.unsetSecret(ctx, { target: TARGET, name: "A/B" }), {}); ctx.done();
});
for (const name of ["", ".", "..", "x\n", "x".repeat(129)]) test(`unsafe key ${JSON.stringify(name)} is refused`, async () => {
  const ctx = context(); await assert.rejects(ops.setSecret(ctx, { target: TARGET, name, value: "private-value" }), /valid Render environment/); ctx.done();
});
test("secret listing marks its five-page cap without exposing values", async () => {
  const steps = Array.from({ length: 5 }, (_, page) => ({ url: `${API}/services/${TARGET}/env-vars?limit=100${page ? `&cursor=p${page - 1}` : ""}`, json: Array.from({ length: 100 }, (_, i) => ({ envVar: { key: `KEY_${page}_${i}`, value: "private-value" }, cursor: `p${page}` })) }));
  const ctx = context(steps); const result = await ops.listSecrets(ctx, { target: TARGET });
  assert.equal(result.secrets.length, 500); assert.equal(result.truncated, true); assert.equal(JSON.stringify(result).includes("private-value"), false); ctx.done();
});
test("malformed secret responses fail without echoing values", async () => {
  const ctx = context([{ url: `${API}/services/${TARGET}/env-vars?limit=100`, json: [{ envVar: { value: "private-value" } }] }]);
  await assert.rejects(ops.listSecrets(ctx, { target: TARGET }), error => /invalid environment/.test(error.message) && !error.message.includes("private-value")); ctx.done();
});
