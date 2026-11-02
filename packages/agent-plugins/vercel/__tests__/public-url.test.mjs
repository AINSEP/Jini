import assert from "node:assert/strict";
import test from "node:test";
import { bindVercel } from "../targets/vercel.mjs";
import { createFakeDeployHostKit } from "../../__tests__/fake-deploy-host-kit.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function targetWith(fetch) {
  const kit = { ...createFakeDeployHostKit(), fetch };
  const { VercelDeployTarget } = bindVercel(kit);
  return new VercelDeployTarget({ token: "synthetic-token", teamId: "team_1" });
}

test("Vercel resolves the API-reported production domain before rendering, including a renamed alias", async () => {
  const calls = [];
  const target = targetWith(async (url, init, options) => {
    calls.push({ url, init, options });
    return json({ domains: [{ name: "renamed.vercel.app", verified: true }], pagination: { next: null } });
  });
  assert.equal(await target.resolvePublicUrl({ projectName: "Zoran" }), "https://renamed.vercel.app");
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v9/projects/zoran/domains");
  for (const [key, value] of Object.entries({ teamId: "team_1", production: "true", redirects: "false", verified: "true", limit: "100" })) assert.equal(url.searchParams.get(key), value);
  assert.equal(calls[0].init.headers.Authorization, "Bearer synthetic-token");
  assert.ok(calls[0].options.timeoutMs > 0);
});

test("a first publish creates the missing project, then reads its assigned domain instead of guessing", async () => {
  const calls = [];
  const responses = [json({ error: { code: "not_found" } }, 404), json({ id: "prj_1" }), json({ domains: [{ name: "zoran-unique.vercel.app", verified: true }], pagination: { next: null } })];
  const target = targetWith(async (url, init) => { calls.push({ url, init }); return responses.shift(); });
  assert.equal(await target.resolvePublicUrl({ projectName: "Zoran" }), "https://zoran-unique.vercel.app");
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[1].url).pathname, "/v11/projects");
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), { name: "zoran", framework: null });
});

test("a denied domain lookup never provisions a project or guesses its URL", async () => {
  let calls = 0;
  const target = targetWith(async () => { calls++; return json({ error: { message: "denied" } }, 403); });
  await assert.rejects(target.resolvePublicUrl({ projectName: "Zoran" }), /denied/);
  assert.equal(calls, 1);
});

test("missing or oversized domain inventories fail before upload", async () => {
  for (const body of [{ domains: [] }, { domains: [{ name: "zoran.vercel.app", verified: true }], pagination: { next: 1 } }, { domains: Array.from({ length: 101 }, () => ({ name: "zoran.vercel.app", verified: true })) }]) {
    const target = targetWith(async () => json(body));
    await assert.rejects(target.resolvePublicUrl({ projectName: "Zoran" }), /public domain|100/);
  }
});
