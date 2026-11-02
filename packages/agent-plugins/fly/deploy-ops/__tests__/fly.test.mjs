import assert from "node:assert/strict";
import test from "node:test";

import fly from "../fly.mjs";

// The Fly observer/secrets adapter against a hand-built host ctx (the port the host passes in): `get`
// and `send` answer from a script, `fail` throws like the host's does, and every request is recorded.

function ctxWith(answers = {}) {
  const gets = [];
  const sends = [];
  const ctx = {
    async get(url) {
      gets.push(url);
      const answer = typeof answers.get === "function" ? answers.get(url) : answers.get;
      return { text: "", truncated: false, ...answer };
    },
    async send(request) { sends.push(request); return { json: answers.send }; },
    fail(message) { throw new Error(message); },
    nowIso: () => "2030-01-01T00:00:00.000Z",
  };
  return { ctx, gets, sends };
}

const machine = (extra) => ({ id: "m1", state: "started", ...extra });

test("app names are validated before any request; a bad one fails", async () => {
  for (const target of ["Bad_Name", "-x", "", 7, "a".repeat(64)]) {
    const { ctx, gets } = ctxWith();
    await assert.rejects(fly.status(ctx, { target }), { message: "Target must be a Fly app name." });
    assert.deepEqual(gets, []);
  }
});

test("status: reduces machine states; unchecked or unknown states are never healthy", async () => {
  const cases = [
    [[machine({ checks: [{ status: "passing" }, { status: "critical" }] })], "failing"],
    [[machine(), machine({ id: "m2", state: "replacing" })], "deploying"],
    [[machine({ state: "weird" })], "unknown"],
    [[machine({ state: "stopped" }), machine({ id: "m2", state: "suspended" })], "stopped"],
    [[], "stopped"],
    [[machine({ checks: [{ status: "passing" }] }), machine({ id: "m2" })], "healthy"],
    [[machine({ checks: [{ status: "warning" }] })], "unknown"],
  ];
  for (const [json, state] of cases) {
    const { ctx, gets } = ctxWith({ get: { json } });
    const result = await fly.status(ctx, { target: "my-app" });
    assert.equal(result.state, state, JSON.stringify(json));
    assert.equal(result.summary, `${json.length} machines: ${state}`);
    assert.equal(result.checkedAt, "2030-01-01T00:00:00.000Z");
    assert.deepEqual(gets, ["https://api.machines.dev/v1/apps/my-app/machines"]);
  }
});

test("status: item detail prefers the resolved image reference over the config tag", async () => {
  const json = [
    machine({ id: "a", image_ref: "reg/img:1", region: "ams", checks: [{ name: "http", status: "passing" }], updated_at: "t1" }),
    machine({ id: "b", image_ref: { registry: "registry.fly.io", repository: "app", tag: "v2", digest: "sha256:x" } }),
    machine({ id: "c", image_ref: { repository: "app" } }),
    machine({ id: "d", image_ref: {}, config: { image: "cfg:3" } }),
    machine({ id: "e" }),
  ];
  const { ctx } = ctxWith({ get: { json } });
  const { items, platform, target } = await fly.status(ctx, { target: "my-app" });
  assert.deepEqual({ platform, target }, { platform: "fly", target: "my-app" });
  assert.deepEqual(items.map((i) => i.detail), [
    "region=ams; image=reg/img:1; checks=http:passing; updated_at=t1",
    "region=; image=registry.fly.io/app:v2@sha256:x; checks=; updated_at=",
    "region=; image=app; checks=; updated_at=",
    "region=; image=cfg:3; checks=; updated_at=",
    "region=; image=; checks=; updated_at=",
  ]);
  assert.deepEqual(items[0], { id: "a", state: "started", detail: items[0].detail });
});

test("status: a response that is not a well-formed machine array fails", async () => {
  const bad = [{}, [null], [{ id: 1, state: "started" }], [{ id: "a", state: 2 }], [machine({ checks: "x" })], [machine({ checks: [null] })], [machine({ checks: [{ status: 1 }] })]];
  for (const json of bad) {
    await assert.rejects(fly.status(ctxWith({ get: { json } }).ctx, { target: "a" }), { message: "Machine status response must be an array." });
  }
});

test("logs: an array, a logs wrapper, JSON lines or plain text all become bounded lines", async () => {
  const entries = [
    "plain string",
    { timestamp: "t1", instance: "i1", level: "info", message: "hello" },
    { at: "t2", source: "s2", msg: "from msg" },
    {},
  ];
  const fromArray = await fly.logs(ctxWith({ get: { json: entries } }).ctx, { target: "a", limit: 10 });
  assert.deepEqual(fromArray, { platform: "fly", target: "a", truncated: false, lines: [
    { message: "plain string" },
    { at: "t1", source: "i1", level: "info", message: "hello" },
    { at: "t2", source: "s2", message: "from msg" },
    { message: "" },
  ] });
  const { ctx, gets } = ctxWith({ get: { json: { logs: ["x"] } } });
  assert.deepEqual((await fly.logs(ctx, { target: "a", limit: 10 })).lines, [{ message: "x" }]);
  assert.deepEqual(gets, ["https://api.fly.io/api/v1/apps/a/logs"]);
  const text = '{"message":"json line"}\r\nnot json\n\n{"msg":"m"}';
  assert.deepEqual((await fly.logs(ctxWith({ get: { json: undefined, text } }).ctx, { target: "a", limit: 10 })).lines, [{ message: "json line" }, { message: "not json" }, { message: "m" }]);
});

test("logs: truncation is reported for a host-truncated body, more entries than the limit, or an over-long message", async () => {
  const long = "x".repeat(2001);
  const cases = [
    [{ json: ["a"], truncated: true }, 10, true],
    [{ json: ["a", "b"] }, 1, true],
    [{ json: [long] }, 10, true],
    [{ json: [{ message: long }] }, 10, true],
    [{ json: [{ msg: long }] }, 10, true],
    [{ json: [{}] }, 10, false],
  ];
  for (const [answer, limit, truncated] of cases) {
    const result = await fly.logs(ctxWith({ get: answer }).ctx, { target: "a", limit });
    assert.equal(result.truncated, truncated);
  }
  const capped = await fly.logs(ctxWith({ get: { json: [long] } }).ctx, { target: "a", limit: 10 });
  assert.equal(capped.lines[0].message.length, 2000);
});

test("logs: an entry that is null, an array or a number fails", async () => {
  for (const entry of [null, [1], 5]) {
    await assert.rejects(fly.logs(ctxWith({ get: { json: [entry] } }).ctx, { target: "a", limit: 5 }), { message: "Log response contains an invalid entry." });
  }
});

test("listTargets: personal org by default, an explicit org encoded, apps array or wrapper, status only when given", async () => {
  const personal = ctxWith({ get: { json: [{ name: "one", status: "deployed" }, { name: "two" }] } });
  assert.deepEqual(await fly.listTargets(personal.ctx), { platform: "fly", targets: [{ id: "one", name: "one", state: "deployed" }, { id: "two", name: "two" }] });
  assert.deepEqual(personal.gets, ["https://api.machines.dev/v1/apps?org_slug=personal"]);
  const org = ctxWith({ get: { json: { apps: [{ name: "x" }] } } });
  assert.deepEqual((await fly.listTargets(org.ctx, { org: "my org" })).targets, [{ id: "x", name: "x" }]);
  assert.deepEqual(org.gets, ["https://api.machines.dev/v1/apps?org_slug=my%20org"]);
  await assert.rejects(fly.listTargets(ctxWith({ get: { json: { apps: "no" } } }).ctx), { message: "App list response must contain an apps array." });
  for (const app of [null, { name: 1 }, { name: "" }]) {
    await assert.rejects(fly.listTargets(ctxWith({ get: { json: [app] } }).ctx), { message: "App list response contains an invalid app." });
  }
});

test("listSecrets: names, digests and update times only; over 500 is truncated", async () => {
  const { ctx, gets } = ctxWith({ get: { json: { secrets: [{ name: "A", digest: "d", updated_at: "u", value: "never" }, { name: "B", digest: 1 }] } } });
  assert.deepEqual(await fly.listSecrets(ctx, { target: "app" }), { secrets: [{ name: "A", digest: "d", updatedAt: "u" }, { name: "B" }], truncated: false });
  assert.deepEqual(gets, ["https://api.machines.dev/v1/apps/app/secrets"]);
  const many = Array.from({ length: 501 }, (_, i) => ({ name: `S${i}` }));
  const result = await fly.listSecrets(ctxWith({ get: { json: many } }).ctx, { target: "app" });
  assert.equal(result.secrets.length, 500);
  assert.equal(result.truncated, true);
  for (const json of [{}, [null], [{ name: "" }], [{ name: 3 }]]) {
    await assert.rejects(fly.listSecrets(ctxWith({ get: { json } }).ctx, { target: "app" }), { message: "Secret list response must contain a secrets array." });
  }
});

test("readSecret: an absent name is reported without fetching; a present one is read with show_secrets", async () => {
  const absent = ctxWith({ get: { json: [{ name: "OTHER" }] } });
  assert.deepEqual(await fly.readSecret(absent.ctx, { target: "app", name: "API_KEY" }), { absent: true });
  assert.equal(absent.gets.length, 1);
  const present = ctxWith({ get: (url) => ({ json: url.endsWith("/secrets") ? [{ name: "API_KEY" }] : { value: "v" } }) });
  assert.deepEqual(await fly.readSecret(present.ctx, { target: "app", name: "API_KEY" }), { value: "v" });
  assert.equal(present.gets[1], "https://api.machines.dev/v1/apps/app/secrets/API_KEY?show_secrets=true");
  const noValue = ctxWith({ get: (url) => ({ json: url.endsWith("/secrets") ? [{ name: "API_KEY" }] : {} }) });
  await assert.rejects(fly.readSecret(noValue.ctx, { target: "app", name: "API_KEY" }), { message: "Fly did not return the secret's value; the token may lack permission to read secrets." });
  const nothing = ctxWith({ get: (url) => ({ json: url.endsWith("/secrets") ? [{ name: "API_KEY" }] : undefined }) });
  await assert.rejects(fly.readSecret(nothing.ctx, { target: "app", name: "API_KEY" }), /did not return the secret's value/);
  for (const name of ["1BAD", "a-b", 5]) {
    await assert.rejects(fly.readSecret(ctxWith().ctx, { target: "app", name }), { message: "Secret name must be an environment variable name." });
  }
});

test("setSecret and unsetSecret stage through POST/DELETE and report Fly's version only when it is an integer", async () => {
  const set = ctxWith({ send: { version: 4 } });
  assert.deepEqual(await fly.setSecret(set.ctx, { target: "app", name: "K", value: "v" }), { version: 4 });
  assert.deepEqual(set.sends, [{ method: "POST", url: "https://api.machines.dev/v1/apps/app/secrets/K", body: { value: "v" } }]);
  assert.deepEqual(await fly.setSecret(ctxWith({ send: { version: "4" } }).ctx, { target: "app", name: "K", value: "v" }), {});
  const unset = ctxWith({ send: { version: 5 } });
  assert.deepEqual(await fly.unsetSecret(unset.ctx, { target: "app", name: "K" }), { version: 5 });
  assert.deepEqual(unset.sends, [{ method: "DELETE", url: "https://api.machines.dev/v1/apps/app/secrets/K" }]);
  assert.deepEqual(await fly.unsetSecret(ctxWith({ send: undefined }).ctx, { target: "app", name: "K" }), {});
  assert.deepEqual(fly.secretCapabilities, { appliesOn: "next-deploy", supportsStaging: true });
});
