import assert from "node:assert/strict";
import test from "node:test";
import { context, AT } from "./module-fixture.mjs";
import github from "../github-actions.mjs";
// Moved from core deploy-ops/__tests__/github-actions-module.test.ts: the Actions adapter's own normalization.
const base = "https://api.github.com/repos/owner/repo/actions/runs";
const run = { id: 21, name: "Deploy", status: "completed", conclusion: "failure", html_url: "https://github.com/owner/repo/actions/runs/21", head_sha: "abc" };
const job = { id: 31, name: "build", status: "completed", conclusion: "failure", steps: [{ name: "install", conclusion: "success" }, { name: "compile", conclusion: "failure" }] };
test("Actions status selects branch, normalizes run and failed steps", async () => {
  const ctx = context({ [`${base}?per_page=5&branch=release%2Fnext`]: { workflow_runs: [run] }, [`${base}/21/jobs?per_page=100`]: { jobs: [job] } });
  assert.deepEqual(await github.status(ctx, { target: "owner/repo", branch: "release/next" }), { platform: "github-actions", target: "owner/repo", state: "failing", summary: "Deploy: completed/failure; head_sha=abc", items: [{ id: "31", name: "build", state: "failure", detail: "status=completed; conclusion=failure; failed steps: compile" }], url: run.html_url, checkedAt: AT });
  assert.deepEqual(ctx.calls, [`${base}?per_page=5&branch=release%2Fnext`, `${base}/21/jobs?per_page=100`]);
});
for (const [status, conclusion, state] of [
  ["queued", null, "deploying"], ["in_progress", null, "deploying"], ["waiting", null, "deploying"], ["requested", null, "deploying"], ["pending", null, "deploying"],
  ["completed", "success", "healthy"], ["completed", "failure", "failing"], ["completed", "timed_out", "failing"], ["completed", "action_required", "failing"],
  ["completed", "startup_failure", "failing"], ["completed", "stale", "failing"],
  ["completed", "mystery", "unknown"], ["completed", null, "unknown"],
  ["completed", "cancelled", "stopped"], ["completed", "skipped", "stopped"], ["completed", "neutral", "stopped"], ["mystery", null, "unknown"],
]) test(`Actions ${status}/${conclusion} -> ${state}`, async () => {
  assert.equal((await github.status(context({ [`${base}/21`]: { ...run, status, conclusion }, [`${base}/21/jobs?per_page=100`]: { jobs: [] } }), { target: "owner/repo", runId: "21" })).state, state);
});
test("Actions logs use annotations, never job logs redirects, and cap output", async () => {
  const ctx = context({ [`${base}/21`]: run, [`${base}/21/jobs?per_page=100`]: { jobs: [job] }, "https://api.github.com/repos/owner/repo/check-runs/31/annotations?per_page=100": [{ path: "src/a.ts", start_line: 7, annotation_level: "failure", message: "bad type" }, { message: "second" }] });
  assert.deepEqual(await github.logs(ctx, { target: "owner/repo", runId: "21", limit: 2 }), { platform: "github-actions", target: "owner/repo", lines: [{ source: "build", level: "error", message: "Failed step: compile" }, { source: "build", level: "failure", message: "src/a.ts:7: bad type" }], truncated: true });
  assert.deepEqual(ctx.calls, [`${base}/21`, `${base}/21/jobs?per_page=100`, "https://api.github.com/repos/owner/repo/check-runs/31/annotations?per_page=100"]);
});
test("Actions empty runs return unknown; target and run ids cannot inject URL paths", async () => {
  assert.deepEqual(await github.status(context({ [`${base}?per_page=5`]: { workflow_runs: [] } }), { target: "owner/repo" }), { platform: "github-actions", target: "owner/repo", state: "unknown", summary: "No workflow runs found.", items: [], checkedAt: AT });
  await assert.rejects(github.status(context({}), { target: "owner/../repo" }), { message: "Target must be owner/repo." });
  await assert.rejects(github.status(context({}), { target: "owner/repo", runId: "../logs" }), { message: "runId must contain only digits." });
});
test("Actions clips long annotation messages and reports that content was omitted", async () => {
  const ctx = context({ [`${base}/21`]: run, [`${base}/21/jobs?per_page=100`]: { jobs: [{ ...job, steps: [] }] }, "https://api.github.com/repos/owner/repo/check-runs/31/annotations?per_page=100": [{ message: "x".repeat(2500) }] });
  assert.deepEqual(await github.logs(ctx, { target: "owner/repo", runId: "21", limit: 100 }), { platform: "github-actions", target: "owner/repo", lines: [{ source: "build", level: "error", message: "x".repeat(2000) }], truncated: true });
});
test("Actions caps annotation fanout to ten failed jobs and reports omitted jobs", async () => {
  const jobs = Array.from({ length: 11 }, (_, i) => ({ ...job, id: 100 + i, steps: [] }));
  const responses = { [`${base}/21`]: run, [`${base}/21/jobs?per_page=100`]: { jobs } };
  const annotations = Array.from({ length: 10 }, (_, i) => `https://api.github.com/repos/owner/repo/check-runs/${100 + i}/annotations?per_page=100`);
  for (const url of annotations) responses[url] = [];
  const ctx = context(responses);
  assert.deepEqual(await github.logs(ctx, { target: "owner/repo", runId: "21", limit: 100 }), { platform: "github-actions", target: "owner/repo", lines: [], truncated: true });
  assert.deepEqual(ctx.calls, [`${base}/21`, `${base}/21/jobs?per_page=100`, ...annotations]);
});
test("Actions refuses malformed jobs before normalizing or fetching annotations", async () => {
  for (const invalid of [null, { id: 31, name: "build" }, { ...job, steps: [null] }]) {
    const ctx = context({ [`${base}/21`]: run, [`${base}/21/jobs?per_page=100`]: { jobs: [invalid] } });
    await assert.rejects(github.status(ctx, { target: "owner/repo", runId: "21" }), { message: "Workflow jobs response contains an invalid job." });
    assert.deepEqual(ctx.calls, [`${base}/21`, `${base}/21/jobs?per_page=100`]);
  }
});
