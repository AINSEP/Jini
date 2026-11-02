import assert from "node:assert/strict";
import test from "node:test";
import railway from "../railway.mjs";
import { TARGET, IDS, request, context, data } from "./fixtures.mjs";

test("Railway stages writes and lists names only, without revision metadata or readback", async () => {
  assert.deepEqual(railway.secretCapabilities, { appliesOn: "next-deploy", supportsStaging: true });
  assert.equal(railway.readSecret, undefined);
  const ctx = context({ replies: [data({ value: { variables: { DATABASE_URL: "postgres://private", API_KEY: "hidden" } } })] });
  assert.deepEqual(await railway.listSecrets(ctx, { target: TARGET }), { secrets: [{ name: "DATABASE_URL" }, { name: "API_KEY" }], truncated: false });
  assert.deepEqual(ctx.calls, [request({ operation: "variables", variables: IDS })]);
});
test("Railway caps secret names without exposing values", async () => {
  const variables = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`KEY_${i}`, "hidden"]));
  const result = await railway.listSecrets(context({ replies: [data({ value: { variables } })] }), { target: TARGET });
  assert.equal(result.truncated, true);
  assert.equal(result.secrets.length, 500);
  assert.equal(JSON.stringify(result).includes("hidden"), false);
});
test("Railway sets one key with skipDeploys and returns no echoed value", async () => {
  const ctx = context({ replies: [data({ value: { variableUpsert: true, value: "hidden" } })] });
  assert.deepEqual(await railway.setSecret(ctx, { target: TARGET, name: "API_KEY", value: "hidden" }), {});
  assert.deepEqual(ctx.calls, [request({ operation: "set", variables: { input: { ...IDS, name: "API_KEY", value: "hidden", skipDeploys: true } } })]);
});
test("Railway required unset export defines only the per-key vendor mutation", async () => {
  const ctx = context({ replies: [data({ value: { variableDelete: true } })] });
  assert.deepEqual(await railway.unsetSecret(ctx, { target: TARGET, name: "API_KEY" }), {});
  assert.deepEqual(ctx.calls, [request({ operation: "unset", variables: { input: { ...IDS, name: "API_KEY" } } })]);
});
test("Railway refuses invalid names before send and malformed variable maps", async () => {
  const ctx = context();
  for (const name of ["A/B", "../x", "1A", "", "x".repeat(129)]) await assert.rejects(railway.setSecret(ctx, { target: TARGET, name, value: "hidden" }), /environment variable name/);
  assert.equal(ctx.calls.length, 0);
  for (const variables of [null, [], "hidden"]) await assert.rejects(railway.listSecrets(context({ replies: [data({ value: { variables } })] }), { target: TARGET }), /variables map/);
});
test("Railway refuses GraphQL write errors without values and never retries lost writes", async () => {
  const ctx = context({ replies: [{ json: { data: { variableUpsert: true }, errors: [{ message: "hidden" }] } }] });
  await assert.rejects(railway.setSecret(ctx, { target: TARGET, name: "A", value: "hidden" }), error => /could not complete/.test(error.message) && !error.message.includes("hidden"));
  const lost = context({ replies: [new Error("Write may have been accepted")] });
  await assert.rejects(railway.setSecret(lost, { target: TARGET, name: "A", value: "hidden" }), /may have been accepted/);
  assert.equal(lost.calls.length, 1);
  await assert.rejects(railway.setSecret(context({ replies: [data({ value: { variableUpsert: false } })] }), { target: TARGET, name: "A", value: "hidden" }), /did not confirm/);
});
