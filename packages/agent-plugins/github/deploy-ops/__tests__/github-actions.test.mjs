import assert from "node:assert/strict";
import test from "node:test";

import actions from "../github-actions.mjs";

// The Actions observer/dispatcher against a hand-built host ctx: `get` answers by URL from a route
// table (first matching suffix/RegExp), `fail` throws like the host's, and every request is recorded.

const REPO = "https://api.github.com/repos/acme/site";
const SHA = "a".repeat(40);

function ctxWith(routes, { send } = {}) {
  const gets = [];
  const sends = [];
  const sleeps = [];
  const ctx = {
    async get(url) {
      gets.push(url);
      const row = routes.find(([match]) => (match instanceof RegExp ? match.test(url) : url.endsWith(match)));
      if (!row) throw new Error(`unrouted ${url}`);
      const answer = typeof row[1] === "function" ? row[1](url) : row[1];
      return { truncated: false, ...answer };
    },
    async send(request) { sends.push(request); return { json: send }; },
    async sleep(ms) { sleeps.push(ms); },
    fail(message) { throw new Error(message); },
    nowIso: () => "2030-01-01T00:00:00.000Z",
  };
  return { ctx, gets, sends, sleeps };
}

const run = (extra) => ({ id: 7, status: "completed", conclusion: "success", name: "CI", head_sha: SHA, ...extra });
const jobsRoute = (jobs, total) => [/\/runs\/\d+\/jobs\?per_page=100$/, { json: { jobs, ...(total !== undefined ? { total_count: total } : {}) } }];

test("targets must be owner/repo with no dot segment", async () => {
  for (const target of ["acme", "acme/.", "acme/..", "-x/y", "a/b/c", 5]) {
    await assert.rejects(actions.status(ctxWith([]).ctx, { target }), { message: "Target must be owner/repo." });
  }
});

test("status: the latest run on a branch, its jobs, and the failed steps; the run URL only on github.com", async () => {
  const jobs = [
    { id: 1, name: "build", status: "completed", conclusion: "failure", steps: [{ name: "lint", conclusion: "failure" }, { name: "test", conclusion: "success" }] },
    { id: 2, name: "deploy", status: "queued" },
  ];
  const { ctx, gets } = ctxWith([[/runs\?per_page=5&branch=feat%2Fx$/, { json: { workflow_runs: [run({ html_url: "https://github.com/acme/site/actions/runs/7" })] } }], jobsRoute(jobs, 3)]);
  const result = await actions.status(ctx, { target: "acme/site", branch: "feat/x" });
  assert.deepEqual(result, {
    platform: "github-actions", target: "acme/site", state: "healthy",
    summary: `CI: completed/success; head_sha=${SHA}; jobs truncated`,
    items: [
      { id: "1", name: "build", state: "failure", detail: "status=completed; conclusion=failure; failed steps: lint" },
      { id: "2", name: "deploy", state: "queued", detail: "status=queued; conclusion=; failed steps: " },
    ],
    url: "https://github.com/acme/site/actions/runs/7",
    checkedAt: "2030-01-01T00:00:00.000Z",
  });
  assert.deepEqual(gets, [`${REPO}/actions/runs?per_page=5&branch=feat%2Fx`, `${REPO}/actions/runs/7/jobs?per_page=100`]);
});

test("status: run states map conservatively; an unknown conclusion stays unknown", async () => {
  const cases = [
    [{ status: "in_progress", conclusion: null }, "deploying"],
    [{ status: "weird" }, "unknown"],
    [{ conclusion: "timed_out" }, "failing"],
    [{ conclusion: "cancelled" }, "stopped"],
    [{ conclusion: "mystery" }, "unknown"],
  ];
  for (const [extra, state] of cases) {
    const { ctx } = ctxWith([[/runs\/7$/, { json: run({ ...extra, html_url: "https://evil.example/x" }) }], jobsRoute([])]);
    const result = await actions.status(ctx, { target: "acme/site", runId: "7" });
    assert.equal(result.state, state);
    assert.equal("url" in result, false);
  }
});

test("status: no run is unknown with no items; invalid run ids and responses fail", async () => {
  const none = await actions.status(ctxWith([[/runs\?per_page=5$/, { json: { workflow_runs: [] } }]]).ctx, { target: "acme/site" });
  assert.deepEqual(none, { platform: "github-actions", target: "acme/site", state: "unknown", summary: "No workflow runs found.", items: [], checkedAt: "2030-01-01T00:00:00.000Z" });
  await assert.rejects(actions.status(ctxWith([]).ctx, { target: "acme/site", runId: "7x" }), { message: "runId must contain only digits." });
  await assert.rejects(actions.status(ctxWith([[/runs\?per_page=5$/, { json: {} }]]).ctx, { target: "acme/site" }), { message: "Workflow response must contain workflow_runs." });
  await assert.rejects(actions.status(ctxWith([[/runs\?per_page=5$/, { json: null }]]).ctx, { target: "acme/site" }), { message: "Workflow response must contain workflow_runs." });
  for (const bad of [run({ id: "x" }), run({ status: 1 })]) {
    await assert.rejects(actions.status(ctxWith([[/runs\/7$/, { json: bad }]]).ctx, { target: "acme/site", runId: "7" }), { message: "Workflow run response is invalid." });
  }
  await assert.rejects(actions.status(ctxWith([[/runs\/7$/, { json: run() }], [/jobs/, { json: {} }]]).ctx, { target: "acme/site", runId: "7" }), { message: "Workflow jobs response must contain jobs." });
  const badJobs = [null, { id: "x", status: "s" }, { id: 1, status: 2 }, { id: 1, status: "s", steps: "x" }, { id: 1, status: "s", steps: [null] }, { id: 1, status: "s", steps: [{ name: 3 }] }];
  for (const job of badJobs) {
    await assert.rejects(actions.status(ctxWith([[/runs\/7$/, { json: run() }], jobsRoute([job])]).ctx, { target: "acme/site", runId: "7" }), { message: "Workflow jobs response contains an invalid job." });
  }
});

test("status: more than 100 jobs are cut to 100 and reported truncated", async () => {
  const jobs = Array.from({ length: 101 }, (_, i) => ({ id: i + 1, status: "queued" }));
  const result = await actions.status(ctxWith([[/runs\/7$/, { json: run({ name: undefined }) }], jobsRoute(jobs)]).ctx, { target: "acme/site", runId: "7" });
  assert.equal(result.items.length, 100);
  assert.match(result.summary, /^: completed\/success; .*; jobs truncated$/);
});

test("logs: failed steps then each failed job's annotations, with paths and levels", async () => {
  const jobs = [
    { id: 11, name: "build", status: "completed", conclusion: "failure", steps: [{ name: "compile", conclusion: "failure" }, { name: "", conclusion: "timed_out" }] },
    { id: 12, name: "lint", status: "completed", conclusion: "success", steps: [{ name: "eslint", conclusion: "cancelled" }] },
    { id: 13, name: "ok", status: "completed", conclusion: "success" },
  ];
  const { ctx, gets } = ctxWith([[/runs\/7$/, { json: run() }], jobsRoute(jobs),
    [/check-runs\/11\//, { json: [{ path: "src/a.ts", start_line: 4, message: "bad", annotation_level: "warning" }, { path: "b.ts", message: "no line" }, { message: "plain" }, {}] }],
    [/check-runs\/12\//, { json: [] }]]);
  const result = await actions.logs(ctx, { target: "acme/site", runId: "7", limit: 50 });
  assert.deepEqual(result, { platform: "github-actions", target: "acme/site", truncated: false, lines: [
    { source: "build", level: "error", message: "Failed step: compile" },
    { source: "build", level: "error", message: "Failed step: " },
    { source: "build", level: "warning", message: "src/a.ts:4: bad" },
    { source: "build", level: "error", message: "b.ts:: no line" },
    { source: "build", level: "error", message: "plain" },
    { source: "build", level: "error", message: "" },
    { source: "lint", level: "error", message: "Failed step: eslint" },
  ] });
  assert.deepEqual(gets.slice(2), [`${REPO}/check-runs/11/annotations?per_page=100`, `${REPO}/check-runs/12/annotations?per_page=100`]);
});

test("logs: truncation for the line cap (stopping further requests), long messages, full pages and over 10 failed jobs", async () => {
  const failing = (id) => ({ id, name: `j${id}`, status: "completed", conclusion: "failure" });
  const capped = ctxWith([[/runs\/7$/, { json: run() }], jobsRoute([failing(1), failing(2)]), [/check-runs\//, { json: [{ message: "a" }, { message: "b" }] }]]);
  const r1 = await actions.logs(capped.ctx, { target: "acme/site", runId: "7", limit: 1 });
  assert.deepEqual([r1.lines.length, r1.truncated, capped.gets.length], [1, true, 3]);

  const long = "x".repeat(2001);
  const longStep = ctxWith([[/runs\/7$/, { json: run() }], jobsRoute([{ ...failing(1), steps: [{ name: long, conclusion: "failure" }] }]), [/check-runs\//, { json: [] }]]);
  assert.equal((await actions.logs(longStep.ctx, { target: "acme/site", runId: "7", limit: 10 })).truncated, true);
  const longNote = ctxWith([[/runs\/7$/, { json: run() }], jobsRoute([failing(1)]), [/check-runs\//, { json: [{ message: long }] }]]);
  const r2 = await actions.logs(longNote.ctx, { target: "acme/site", runId: "7", limit: 10 });
  assert.deepEqual([r2.truncated, r2.lines[0].message.length], [true, 2000]);

  const fullPage = ctxWith([[/runs\/7$/, { json: run() }], jobsRoute([failing(1)]), [/check-runs\//, { json: Array.from({ length: 100 }, () => ({ message: "m" })) }]]);
  assert.equal((await actions.logs(fullPage.ctx, { target: "acme/site", runId: "7", limit: 500 })).truncated, true);
  const hostCut = ctxWith([[/runs\/7$/, { json: run() }], jobsRoute([failing(1)]), [/check-runs\//, { json: [], truncated: true }]]);
  assert.equal((await actions.logs(hostCut.ctx, { target: "acme/site", runId: "7", limit: 5 })).truncated, true);

  const many = ctxWith([[/runs\/7$/, { json: run() }], jobsRoute(Array.from({ length: 12 }, (_, i) => failing(i + 1))), [/check-runs\//, { json: [] }]]);
  const r3 = await actions.logs(many.ctx, { target: "acme/site", runId: "7", limit: 5 });
  assert.deepEqual([r3.truncated, many.gets.length], [true, 12]);

  const lastJobAtCap = ctxWith([[/runs\/7$/, { json: run() }], jobsRoute([failing(1)]), [/check-runs\//, { json: [{ message: "a" }] }]]);
  assert.equal((await actions.logs(lastJobAtCap.ctx, { target: "acme/site", runId: "7", limit: 1 })).truncated, false);
});

test("logs: an invalid job id or annotation response fails", async () => {
  const failing = { id: 1, name: "j", status: "completed", conclusion: "failure" };
  await assert.rejects(actions.logs(ctxWith([[/runs\/7$/, { json: run() }], jobsRoute([failing]), [/check-runs\//, { json: {} }]]).ctx, { target: "acme/site", runId: "7", limit: 5 }), { message: "Check annotations response must be an array." });
  for (const entry of [null, "x"]) {
    await assert.rejects(actions.logs(ctxWith([[/runs\/7$/, { json: run() }], jobsRoute([failing]), [/check-runs\//, { json: [entry] }]]).ctx, { target: "acme/site", runId: "7", limit: 5 }), { message: "Check annotations response contains an invalid entry." });
  }
});

test("deploy: resolves the ref to a full SHA, dispatches pinned to it, and reports the run GitHub returned directly", async () => {
  const { ctx, sends, gets } = ctxWith([[/commits\/release\/v1$/, { json: { sha: SHA } }]], { send: { workflow_run_id: 99, html_url: "https://github.com/acme/site/actions/runs/99" } });
  const result = await deploy(ctx, { target: "acme/site", ref: "release/v1" });
  assert.deepEqual(sends, [{ method: "POST", url: `${REPO}/actions/workflows/example-deploy.yml/dispatches`, body: { ref: "release/v1", inputs: { expected_sha: SHA } } }]);
  assert.deepEqual(gets, [`${REPO}/commits/release/v1`]);
  assert.deepEqual(result, {
    platform: "github-actions", target: "acme/site", started: true, sha: SHA, runId: "99", url: "https://github.com/acme/site/actions/runs/99",
    summary: `Dispatched example-deploy.yml on 'release/v1' at ${SHA}; run 99. The workflow refuses to deploy if 'release/v1' no longer resolves to ${SHA} when it starts.`,
  });
});

test("deploy: without a direct run id it looks the run up by SHA, skipping other SHAs and stale runs, with a delay between lookups", async () => {
  let lookups = 0;
  const answers = [
    { workflow_runs: [{ id: 1, head_sha: "b".repeat(40), created_at: "2030-01-01T00:00:00Z" }, null] },
    { workflow_runs: [{ id: 2, head_sha: SHA, created_at: "2029-12-31T23:00:00Z" }, { id: "x", head_sha: SHA, created_at: "2030-01-01T00:00:00Z" }] },
    { workflow_runs: [{ id: 3, head_sha: SHA, created_at: "2029-12-31T23:59:45Z", html_url: "http://insecure" }] },
  ];
  const { ctx, sleeps } = ctxWith([[/commits\/main$/, { json: { sha: SHA } }], [/runs\?event=workflow_dispatch/, () => ({ json: answers[lookups++] })]], { send: undefined });
  const result = await deploy(ctx, { target: "acme/site" });
  assert.equal(result.runId, "3");
  assert.equal("url" in result, false);
  assert.deepEqual(sleeps, [2000, 2000]);
});

test("deploy: a run never visible is still reported as dispatched; a non-numeric direct id falls back to lookup", async () => {
  const { ctx, gets, sleeps } = ctxWith([[/commits\/main$/, { json: { sha: SHA } }], [/runs\?event=workflow_dispatch/, { json: { workflow_runs: [] } }]], { send: { workflow_run_id: "abc" } });
  const result = await deploy(ctx, { target: "acme/site", ref: "main" });
  assert.deepEqual(result, { platform: "github-actions", target: "acme/site", started: true, sha: SHA,
    summary: `Dispatched example-deploy.yml on 'main' at ${SHA}, but its run was not visible yet. The workflow refuses to deploy if 'main' no longer resolves to ${SHA} when it starts. Check deployment_ops_status with branch 'main' in a minute.` });
  assert.equal(gets.length, 6);
  assert.deepEqual(sleeps, [2000, 2000, 2000, 2000]);
});

test("deploy: refuses bad refs, bare SHAs, unresolvable refs and malformed run lookups", async () => {
  for (const ref of ["-x", "a/", "a..b", "a//b", "x.lock", "has space", 5, "a".repeat(201), ".hidden"]) {
    await assert.rejects(deploy(ctxWith([]).ctx, { target: "acme/site", ref }), { message: "ref must be a branch or tag name." });
  }
  await assert.rejects(deploy(ctxWith([]).ctx, { target: "acme/site", ref: "A".repeat(40) }), /cannot dispatch a workflow at a bare commit SHA/);
  for (const json of [{ sha: "short" }, null, { sha: 5 }]) {
    await assert.rejects(deploy(ctxWith([[/commits\/main$/, { json }]]).ctx, { target: "acme/site" }), { message: "Could not resolve 'main' to a full commit SHA." });
  }
  await assert.rejects(deploy(ctxWith([[/commits\/main$/, { json: { sha: SHA } }], [/runs\?event/, { json: {} }]]).ctx, { target: "acme/site" }), { message: "Workflow runs response must contain workflow_runs." });
});

const deploy = (ctx, input) => actions.deploy(ctx, { workflowFiles: ["example-deploy.yml"], workflowFile: "example-deploy.yml", ...input });
