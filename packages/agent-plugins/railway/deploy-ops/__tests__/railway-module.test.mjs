import assert from "node:assert/strict";
import test from "node:test";
import railway from "../railway.mjs";
import { AT, PROJECT, ENVIRONMENT, SERVICE, RUN, OTHER, TARGET, request, connection, discovery, deployed, context, data } from "./fixtures.mjs";

test("Railway workspace discovery uses fixed GraphQL and returns actual instances", async () => {
  const ctx = context({ replies: [data({ value: discovery() })] });
  assert.deepEqual(await railway.listTargets(ctx, { org: OTHER }), { platform: "railway", targets: [{ id: TARGET, name: "Shop / production / web" }] });
  assert.deepEqual(ctx.calls, [request({ operation: "targets", variables: { workspaceId: OTHER } })]);
  assert.equal(ctx.calls[0].body.query.includes(OTHER), false);
  const personal = context({ replies: [data({ value: { projects: connection({ entries: [] }) } })] });
  assert.deepEqual(await railway.listTargets(personal, {}), { platform: "railway", targets: [] });
  assert.deepEqual(personal.calls, [request({ operation: "targets", variables: {} })]);
});
test("Railway refuses partial discovery at each connection and malformed entries", async () => {
  for (const depth of [0, 1, 2]) {
    const value = discovery();
    const connections = [value.projects, value.projects.edges[0].node.environments, value.projects.edges[0].node.environments.edges[0].node.serviceInstances];
    connections[depth].pageInfo.hasNextPage = true;
    await assert.rejects(railway.listTargets(context({ replies: [data({ value })] }), {}), /incomplete/);
  }
  for (const value of [{}, { projects: connection({ entries: [null] }) }]) {
    await assert.rejects(railway.listTargets(context({ replies: [data({ value })] }), {}), /discovery/);
  }
});
test("Railway GraphQL errors, including partial data, have value-free failures", async () => {
  const ctx = context({ replies: [{ json: { errors: [{ message: "secret-token", extensions: { value: "hidden" } }], data: discovery() } }] });
  await assert.rejects(railway.listTargets(ctx, {}), error => /could not complete/.test(error.message) && !/secret-token|hidden/.test(error.message));
  for (const reply of [{ truncated: true, json: { data: discovery() } }, { text: "clipped" }]) {
    await assert.rejects(railway.listTargets(context({ replies: [reply] }), {}), /incomplete response/);
  }
});
test("Railway deploy returns serviceInstanceDeployV2 ID and pins only explicit full SHAs", async () => {
  for (const ref of [undefined, "a".repeat(40)]) {
    const ctx = context({ replies: [data({ value: { serviceInstanceDeployV2: RUN } })] });
    const result = await railway.deploy(ctx, { target: TARGET, ...(ref ? { ref } : {}) });
    assert.equal(result.started, true);
    assert.equal(result.runId, RUN);
    assert.equal(result.sha, ref);
    assert.deepEqual(ctx.calls, [request({ operation: "deploy", variables: { serviceId: SERVICE, environmentId: ENVIRONMENT, ...(ref ? { commitSha: ref } : {}) } })]);
  }
});
test("Railway rejects unsupported refs and malformed targets before send", async () => {
  const ctx = context();
  for (const ref of ["main", "v1", "a".repeat(39), "a".repeat(41), "g".repeat(40), ""]) await assert.rejects(railway.deploy(ctx, { target: TARGET, ref }), /commit SHA/);
  for (const target of ["../x", "project:env:service", `${PROJECT}:${ENVIRONMENT}:${SERVICE}:extra`]) await assert.rejects(railway.deploy(ctx, { target }), /Railway/);
  assert.deepEqual(ctx.calls, []);
});
test("Railway never retries an ambiguous write and refuses missing deployment IDs", async () => {
  const error = new Error("Connection lost; check status before retrying.");
  const ctx = context({ replies: [error] });
  await assert.rejects(railway.deploy(ctx, { target: TARGET }), candidate => candidate === error);
  assert.equal(ctx.calls.length, 1);
  for (const value of [true, null, "../x"]) await assert.rejects(railway.deploy(context({ replies: [data({ value: { serviceInstanceDeployV2: value } })] }), { target: TARGET }), /UUID/);
});
for (const [vendor, state] of Object.entries({ SUCCESS: "healthy", BUILDING: "deploying", DEPLOYING: "deploying", INITIALIZING: "deploying", QUEUED: "deploying", WAITING: "deploying", FAILED: "failing", CRASHED: "failing", REMOVED: "stopped", REMOVING: "stopped", SLEEPING: "stopped", SKIPPED: "stopped", FUTURE: "unknown", toString: "unknown" })) {
  test(`Railway maps ${vendor} to ${state}`, async () => {
    const ctx = context({ replies: [data({ value: { deployment: deployed({ state: vendor }) } })] });
    const result = await railway.status(ctx, { target: TARGET, runId: RUN });
    assert.equal(result.state, state);
    assert.equal(result.checkedAt, AT);
    assert.deepEqual(result.items, [{ id: RUN, state: vendor }]);
    assert.deepEqual(ctx.calls, [request({ operation: "deployment", variables: { id: RUN } })]);
  });
}
test("Railway status reads latest deployment when no run ID is supplied", async () => {
  const ctx = context({ replies: [data({ value: { serviceInstance: { latestDeployment: deployed() } } })] });
  assert.equal((await railway.status(ctx, { target: TARGET })).state, "healthy");
  assert.deepEqual(ctx.calls, [request({ operation: "latest", variables: { serviceId: SERVICE, environmentId: ENVIRONMENT } })]);
  const empty = context({ replies: [data({ value: { serviceInstance: { latestDeployment: null } } })] });
  assert.equal((await railway.status(empty, { target: TARGET })).state, "stopped");
});
test("Railway refuses another service, environment or run in the same status query", async () => {
  for (const overrides of [{ serviceId: OTHER }, { environmentId: OTHER }, { id: OTHER }]) {
    const ctx = context({ replies: [data({ value: { deployment: deployed(overrides) } })] });
    await assert.rejects(railway.status(ctx, { target: TARGET, runId: RUN }), /does not belong|different deployment/);
    assert.equal(ctx.calls.length, 1);
  }
});
test("Railway logs verify ownership first, bound entries and clip messages", async () => {
  const ctx = context({ replies: [data({ value: { deployment: deployed() } }), data({ value: { deploymentLogs: [{ timestamp: AT, severity: "error", message: "x".repeat(2001), private: "hidden" }, { message: "next" }] } })] });
  assert.deepEqual(await railway.logs(ctx, { target: TARGET, runId: RUN, limit: 1 }), { platform: "railway", target: TARGET, lines: [{ message: "x".repeat(2000), at: AT, level: "error" }], truncated: true });
  assert.deepEqual(ctx.calls, [request({ operation: "deployment", variables: { id: RUN } }), request({ operation: "logs", variables: { deploymentId: RUN, limit: 2 } })]);
  const wrong = context({ replies: [data({ value: { deployment: deployed({ serviceId: OTHER }) } })] });
  await assert.rejects(railway.logs(wrong, { target: TARGET, runId: RUN, limit: 1 }), /does not belong/);
  assert.equal(wrong.calls.length, 1);
});
test("Railway rejects bad log limits before send and malformed logs safely", async () => {
  const ctx = context();
  for (const limit of [0, 501, 1.5]) await assert.rejects(railway.logs(ctx, { target: TARGET, limit }), /Log limit/);
  assert.equal(ctx.calls.length, 0);
  for (const entries of [null, [null]]) {
    const malformed = context({ replies: [data({ value: { deployment: deployed() } }), data({ value: { deploymentLogs: entries } })] });
    await assert.rejects(railway.logs(malformed, { target: TARGET, runId: RUN, limit: 1 }), /log entr/);
  }
});
