import assert from "node:assert/strict";
import test from "node:test";
import { context, AT } from "./module-fixture.mjs";
import fly from "../fly.mjs";
const url = "https://api.machines.dev/v1/apps/shop/machines";
test("Fly status normalizes machines without exposing vendor fields", async () => {
  const ctx = context({ [url]: [{ id: "m1", region: "lax", state: "started", config: { image: "registry/image:v2", secret: "hidden" }, checks: [{ name: "web", status: "passing" }], updated_at: AT }] });
  assert.deepEqual(await fly.status(ctx, { target: "shop" }), { platform: "fly", target: "shop", state: "healthy", summary: "1 machines: healthy", items: [{ id: "m1", state: "started", detail: `region=lax; image=registry/image:v2; checks=web:passing; updated_at=${AT}` }], checkedAt: AT });
  assert.deepEqual(ctx.calls, [url]);
});
for (const [machine, state] of [
  [{ state: "started", checks: [] }, "healthy"], [{ state: "starting" }, "deploying"], [{ state: "replacing" }, "deploying"],
  [{ state: "updating" }, "deploying"],
  [{ state: "stopped" }, "stopped"], [{ state: "suspended" }, "stopped"], [{ state: "created" }, "stopped"],
  [{ state: "destroyed" }, "stopped"], [{ state: "destroying" }, "stopped"], [{ state: "stopping" }, "stopped"],
  [{ state: "started", checks: [{ status: "critical" }] }, "failing"], [{ state: "started", checks: [{ status: "warning" }] }, "unknown"],
  [{ state: "mystery" }, "unknown"],
]) test(`Fly maps ${JSON.stringify(machine)} to ${state}`, async () => {
  assert.equal((await fly.status(context({ [url]: [{ id: "m1", ...machine }] }), { target: "shop" })).state, state);
});
test("Fly critical beats replacing regardless of order; empty apps are stopped", async () => {
  const machines = [{ id: "a", state: "starting" }, { id: "b", state: "started", checks: [{ status: "critical" }] }];
  for (const input of [machines, [...machines].reverse()]) assert.equal((await fly.status(context({ [url]: input }), { target: "shop" })).state, "failing");
  assert.equal((await fly.status(context({ [url]: [] }), { target: "shop" })).state, "stopped");
});
test("Fly logs cap lines and indicate truncation; listing uses the requested org", async () => {
  assert.deepEqual(await fly.logs(context({ "https://api.fly.io/api/v1/apps/shop/logs": [{ timestamp: AT, instance: "m1", level: "error", message: "oops" }, { message: "later" }] }), { target: "shop", limit: 1 }), { platform: "fly", target: "shop", lines: [{ at: AT, source: "m1", level: "error", message: "oops" }], truncated: true });
  assert.deepEqual(await fly.listTargets(context({ "https://api.machines.dev/v1/apps?org_slug=team": { apps: [{ name: "shop", status: "deployed", secret: "hidden" }] } }), { org: "team" }), { platform: "fly", targets: [{ id: "shop", name: "shop", state: "deployed" }] });
});
test("Fly refuses malformed data instead of inventing health", async () => {
  await assert.rejects(fly.status(context({ [url]: {} }), { target: "shop" }), { message: "Machine status response must be an array." });
});
test("Fly reports the resolved machine image ref and defaults target listing to personal", async () => {
  const result = await fly.status(context({ [url]: [{ id: "m1", state: "started", region: "lax", config: { image: "shop:latest" }, image_ref: { registry: "registry.fly.io", repository: "shop", tag: "release", digest: "sha256:abc" }, checks: [], updated_at: AT }] }), { target: "shop" });
  assert.equal(result.items[0].detail, `region=lax; image=registry.fly.io/shop:release@sha256:abc; checks=; updated_at=${AT}`);
  assert.deepEqual(await fly.listTargets(context({ "https://api.machines.dev/v1/apps?org_slug=personal": { apps: [] } }), {}), { platform: "fly", targets: [] });
});
test("Fly malformed log and app entries produce reported refusals", async () => {
  await assert.rejects(fly.logs(context({ "https://api.fly.io/api/v1/apps/shop/logs": [null] }), { target: "shop", limit: 100 }), { message: "Log response contains an invalid entry." });
  await assert.rejects(fly.listTargets(context({ "https://api.machines.dev/v1/apps?org_slug=personal": { apps: [null] } }), {}), { message: "App list response contains an invalid app." });
});
