import assert from "node:assert/strict";
import test from "node:test";
import { AT } from "./module-fixture.mjs";
import fly from "../fly.mjs";
const API = "https://api.machines.dev/v1/apps/shop/secrets";

/** A bound-facade double: scripted GET bodies and recorded writes; no host, credential or network. */
function context(gets, sendResult = {}) {
  const calls = []; const sent = [];
  return { calls, sent, nowIso: () => AT, sleep: async () => {}, fail: (message) => { throw new Error(message); },
    get: async (url) => { calls.push(url); assert.equal(Object.hasOwn(gets, url), true, `unexpected GET ${url}`); return { status: 200, json: gets[url], text: JSON.stringify(gets[url]) }; },
    send: async (request) => { sent.push(request); return { status: 200, json: sendResult, text: JSON.stringify(sendResult) }; } };
}

test("Fly declares staged secrets and lists names, digests and times without values", async () => {
  assert.deepEqual(fly.secretCapabilities, { appliesOn: "next-deploy", supportsStaging: true });
  const ctx = context({ [API]: { secrets: [{ name: "A_KEY", digest: "abc", updated_at: AT, value: "hidden" }, { name: "B" }] } });
  assert.deepEqual(await fly.listSecrets(ctx, { target: "shop" }), { secrets: [{ name: "A_KEY", digest: "abc", updatedAt: AT }, { name: "B" }], truncated: false });
  assert.deepEqual(ctx.calls, [API]);
});

test("Fly reads a listed secret's value with show_secrets and reports an unlisted one as absent", async () => {
  const ctx = context({ [API]: { secrets: [{ name: "A_KEY" }] }, [`${API}/A_KEY?show_secrets=true`]: { name: "A_KEY", value: "v" } });
  assert.deepEqual(await fly.readSecret(ctx, { target: "shop", name: "A_KEY" }), { value: "v" });
  assert.deepEqual(await fly.readSecret(ctx, { target: "shop", name: "MISSING" }), { absent: true });
  assert.deepEqual(ctx.calls, [API, `${API}/A_KEY?show_secrets=true`, API]);
  await assert.rejects(fly.readSecret(context({ [API]: { secrets: [{ name: "A_KEY" }] }, [`${API}/A_KEY?show_secrets=true`]: { name: "A_KEY" } }), { target: "shop", name: "A_KEY" }), { message: "Fly did not return the secret's value; the token may lack permission to read secrets." });
});

test("Fly sets with POST {value} and unsets with DELETE on the named secret, returning only the version", async () => {
  const set = context({}, { name: "A_KEY", version: 4, value: "echoed" });
  assert.deepEqual(await fly.setSecret(set, { target: "shop", name: "A_KEY", value: "v" }), { version: 4 });
  assert.deepEqual(set.sent, [{ method: "POST", url: `${API}/A_KEY`, body: { value: "v" } }]);
  const unset = context({}, { version: 5 });
  assert.deepEqual(await fly.unsetSecret(unset, { target: "shop", name: "A_KEY" }), { version: 5 });
  assert.deepEqual(unset.sent, [{ method: "DELETE", url: `${API}/A_KEY` }]);
  assert.deepEqual(await fly.unsetSecret(context({}, {}), { target: "shop", name: "A_KEY" }), {});
});

test("Fly refuses path-injecting names and targets and malformed lists", async () => {
  for (const name of ["A/B", "../x", "1A", ""]) await assert.rejects(fly.setSecret(context({}), { target: "shop", name, value: "v" }), { message: "Secret name must be an environment variable name." });
  await assert.rejects(fly.unsetSecret(context({}), { target: "Shop/../x", name: "A" }), { message: "Target must be a Fly app name." });
  await assert.rejects(fly.listSecrets(context({ [API]: { secrets: [null] } }), { target: "shop" }), { message: "Secret list response must contain a secrets array." });
  await assert.rejects(fly.listSecrets(context({ [API]: {} }), { target: "shop" }), { message: "Secret list response must contain a secrets array." });
});
