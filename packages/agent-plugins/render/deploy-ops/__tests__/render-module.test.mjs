import assert from "node:assert/strict";
import test from "node:test";
import ops from "../render.mjs";
import { API, TARGET, RUN, SERVICE, AT, context, response } from "./fixtures.mjs";
const service = json => ({ url: `${API}/services/${TARGET}`, json: json ?? SERVICE });

test("Render accepts HTTP 201 and retains the opaque deployment ID", async () => {
  const ctx = context([service(), { method: "POST", url: `${API}/services/${TARGET}/deploys`, body: {}, response: response({ id: RUN }, 201) }]);
  const result = await ops.deploy(ctx, { target: TARGET });
  assert.equal(result.started, true); assert.equal(result.runId, RUN); assert.equal(result.sha, undefined); ctx.done();
});
test("HTTP 202 is a queued deploy with no body: started, without a run ID", async () => {
  const ctx = context([service(), { method: "POST", url: `${API}/services/${TARGET}/deploys`, body: {}, response: { status: 202, text: "" } }]);
  const result = await ops.deploy(ctx, { target: TARGET });
  assert.equal(result.started, true); assert.equal(result.runId, undefined); assert.match(result.summary, /queued/); ctx.done();
});
test("an unexpected 2xx is not reported as started", async () => {
  const ctx = context([service(), { method: "POST", url: `${API}/services/${TARGET}/deploys`, body: {}, response: response({ id: RUN }, 200) }]);
  await assert.rejects(ops.deploy(ctx, { target: TARGET }), /did not confirm deployment acceptance/); ctx.done();
});
test("an invalid log limit is refused before any request", async () => {
  const ctx = context(); await assert.rejects(ops.logs(ctx, { target: TARGET, limit: 0 }), /between 1 and 1000/); ctx.done();
});
test("only a full explicit SHA becomes commitId", async () => {
  const sha = "a".repeat(40);
  const ctx = context([service(), { method: "POST", url: `${API}/services/${TARGET}/deploys`, body: { commitId: sha }, response: response({ id: RUN }, 201) }]);
  assert.equal((await ops.deploy(ctx, { target: TARGET, ref: sha })).sha, sha); ctx.done();
});
for (const ref of ["main", "v1", "abc123", "", "x".repeat(40)]) test(`unsupported ref ${JSON.stringify(ref)} fails before I/O`, async () => {
  const ctx = context(); await assert.rejects(ops.deploy(ctx, { target: TARGET, ref }), /full commit SHA/); ctx.done();
});
for (const type of ["static_site", "cron_job", "future_type"]) test(`${type} cannot dispatch`, async () => {
  const ctx = context([service({ ...SERVICE, type })]);
  await assert.rejects(ops.deploy(ctx, { target: TARGET }), /existing Render server service/); ctx.done();
});
test("a mismatched service refuses before dispatch", async () => {
  const ctx = context([service({ ...SERVICE, id: "srv-other" })]);
  await assert.rejects(ops.deploy(ctx, { target: TARGET }), /requested service/); ctx.done();
});
for (const [state, expected] of Object.entries({ live: "healthy", build_failed: "failing", update_failed: "failing", pre_deploy_failed: "failing", canceled: "stopped", deactivated: "stopped", created: "deploying", queued: "deploying", build_in_progress: "deploying", update_in_progress: "deploying", pre_deploy_in_progress: "deploying", future: "unknown" })) test(`status ${state} maps to ${expected}`, async () => {
  const ctx = context([{ url: `${API}/services/${TARGET}/deploys/${RUN}`, json: { id: RUN, status: state } }]);
  const result = await ops.status(ctx, { target: TARGET, runId: RUN });
  assert.equal(result.state, expected); assert.equal(result.checkedAt, AT); assert.equal(result.items[0].id, RUN); ctx.done();
});
test("latest deployment is selected with one bounded read", async () => {
  const ctx = context([{ url: `${API}/services/${TARGET}/deploys?limit=1`, json: [{ deploy: { id: RUN, status: "live" }, cursor: "next" }] }]);
  assert.equal((await ops.status(ctx, { target: TARGET })).state, "healthy"); ctx.done();
});
test("an empty deployment list stays unknown", async () => {
  const ctx = context([{ url: `${API}/services/${TARGET}/deploys?limit=1`, json: [] }]);
  assert.equal((await ops.status(ctx, { target: TARGET })).state, "unknown"); ctx.done();
});
test("run ownership uses the target-scoped path and refuses a wrong run", async () => {
  const ctx = context([{ url: `${API}/services/${TARGET}/deploys/${RUN}`, json: { id: "dep-other", status: "live" } }]);
  await assert.rejects(ops.status(ctx, { target: TARGET, runId: RUN }), /requested deployment/); ctx.done();
});
for (const target of ["srv-../x", "srv-a/b", "../x", "srv-a?x=y"]) test(`unsafe target ${target} never reaches HTTP`, async () => {
  const ctx = context(); await assert.rejects(ops.deploy(ctx, { target }), /valid Render/); ctx.done();
});
test("logs resolve ownerId from the service, honour limit and report more pages", async () => {
  const ctx = context([service(), { url: `${API}/logs?ownerId=tea-owner123&resource=${TARGET}&limit=1&direction=backward`, json: { logs: [{ timestamp: AT, message: "ready", labels: [{ name: "level", value: "info" }] }, { timestamp: AT, message: "extra", labels: [] }], hasMore: true } }]);
  const result = await ops.logs(ctx, { target: TARGET, limit: 1 });
  assert.deepEqual(result.lines, [{ at: AT, level: "info", message: "ready" }]); assert.equal(result.truncated, true); ctx.done();
});
test("log query escapes service owner and checks an explicit run in the same service", async () => {
  const ctx = context([service({ ...SERVICE, ownerId: "tea-owner&other" }), { url: `${API}/services/${TARGET}/deploys/${RUN}`, json: { id: RUN, status: "live" } }, { url: `${API}/logs?ownerId=tea-owner%26other&resource=${TARGET}&limit=2&direction=backward`, json: { logs: [], hasMore: false } }]);
  assert.equal((await ops.logs(ctx, { target: TARGET, limit: 2, runId: RUN })).truncated, false); ctx.done();
});
test("long log messages are clipped with truncation reported", async () => {
  const ctx = context([service(), { url: `${API}/logs?ownerId=tea-owner123&resource=${TARGET}&limit=1&direction=backward`, json: { logs: [{ timestamp: AT, labels: [], message: "x".repeat(2001) }], hasMore: false } }]);
  const result = await ops.logs(ctx, { target: TARGET, limit: 1 }); assert.equal(result.lines[0].message.length, 2000); assert.equal(result.truncated, true); ctx.done();
});
test("discovery omits static services and escapes workspace query", async () => {
  const ctx = context([{ url: `${API}/services?ownerId=tea-a%26b&limit=100`, json: [{ service: SERVICE, cursor: "a" }, { service: { ...SERVICE, id: "srv-static", type: "static_site" }, cursor: "b" }] }]);
  assert.deepEqual(await ops.listTargets(ctx, { org: "tea-a&b" }), { platform: "render", targets: [{ id: TARGET, name: "Tovu" }] }); ctx.done();
});
test("discovery follows bounded cursor pages", async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ service: { ...SERVICE, id: `srv-${i}` }, cursor: `page&${i}` }));
  const ctx = context([{ url: `${API}/services?limit=100`, json: rows }, { url: `${API}/services?limit=100&cursor=page%2699`, json: [] }]);
  assert.equal((await ops.listTargets(ctx, {})).targets.length, 100); ctx.done();
});
test("discovery refuses to invent completeness beyond five pages", async () => {
  const steps = Array.from({ length: 5 }, (_, page) => ({ url: `${API}/services?limit=100${page ? `&cursor=p${page - 1}` : ""}`, json: Array.from({ length: 100 }, (_, i) => ({ service: { ...SERVICE, id: `srv-${page}-${i}` }, cursor: `p${page}` })) }));
  const ctx = context(steps); await assert.rejects(ops.listTargets(ctx, {}), /500 services/); ctx.done();
});
test("ambiguous writes are not retried or returned as successful", async () => {
  const ctx = context([service(), { method: "POST", url: `${API}/services/${TARGET}/deploys`, body: {}, error: new Error("Ambiguous transport failure") }]);
  await assert.rejects(ops.deploy(ctx, { target: TARGET }), /Ambiguous/); ctx.done();
});
test("acceptance without a usable run ID gives check-before-retry guidance", async () => {
  const ctx = context([service(), { method: "POST", url: `${API}/services/${TARGET}/deploys`, response: response({ id: "../x", value: "private-value" }, 201) }]);
  await assert.rejects(ops.deploy(ctx, { target: TARGET }), error => /Check Render before retrying/.test(error.message) && !error.message.includes("private-value")); ctx.done();
});
test("log requests stay within Render's 100-line API maximum", async () => {
  const ctx = context([service(), { url: `${API}/logs?ownerId=tea-owner123&resource=${TARGET}&limit=100&direction=backward`, json: { logs: [], hasMore: true } }]);
  assert.equal((await ops.logs(ctx, { target: TARGET, limit: 500 })).truncated, true); ctx.done();
});
test("a service without ownerId cannot issue an unscoped log request", async () => {
  const ctx = context([service({ ...SERVICE, ownerId: undefined })]);
  await assert.rejects(ops.logs(ctx, { target: TARGET, limit: 10 }), /workspace ID/); ctx.done();
});
test("a run from another service fails at the scoped endpoint, with no log request", async () => {
  const ctx = context([service(), { url: `${API}/services/${TARGET}/deploys/${RUN}`, error: new Error("HTTP 404") }]);
  await assert.rejects(ops.logs(ctx, { target: TARGET, limit: 10, runId: RUN }), /404/); ctx.done();
});
test("a missing pagination cursor refuses an incomplete inventory", async () => {
  const ctx = context([{ url: `${API}/services?limit=100`, json: Array.from({ length: 100 }, () => ({ service: SERVICE })) }]);
  await assert.rejects(ops.listTargets(ctx, {}), /pagination cursor/); ctx.done();
});
test("transport-truncated inventory is never treated as a complete list", async () => {
  const ctx = context([{ url: `${API}/services?limit=100`, response: response([], 200, { truncated: true }) }]);
  await assert.rejects(ops.listTargets(ctx, {}), /incomplete or invalid/); ctx.done();
});
