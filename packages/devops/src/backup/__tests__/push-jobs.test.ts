import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { FINISHED_JOB_TTL_MS, SiteBackupPushJobs } from "../push-jobs.js";

afterEach(() => vi.useRealTimers());

// The registration suite covers upload resumption; these cases own registry lifetime and isolation.
const key = { planId: "plan", principalId: "owner", workspaceId: "workspace" };
const progress = () => ({ filesDone: 0, filesTotal: 2, bytesDone: 0, bytesTotal: 20 });

test("lookup requires the original plan, principal and workspace", async () => {
  const jobs = new SiteBackupPushJobs<number>({}, { now: () => 100 });
  const job = jobs.start({ key, progress: progress(), run: async () => 42 });
  assert.equal(jobs.find({ ...key, planId: "missing" }), undefined);
  assert.equal(jobs.find({ ...key, principalId: "intruder" }), undefined);
  assert.equal(jobs.find({ ...key, workspaceId: "other" }), undefined);
  assert.equal(jobs.find(key), job);
  await job.settled;
  assert.deepEqual(await jobs.wait({ job, signal: new AbortController().signal, budgetMs: 1000 }), { state: "done", result: 42 });
  assert.equal(jobs.find(key), undefined);
});

test("a rejected run is retained without an unhandled rejection and rethrown only when collected", async () => {
  const jobs = new SiteBackupPushJobs<number>({});
  const failure = new Error("upload failed");
  const job = jobs.start({ key, progress: progress(), run: async () => { throw failure; } });
  assert.deepEqual(await job.settled, { ok: false, error: failure });
  assert.equal(jobs.find(key), job);
  await assert.rejects(jobs.wait({ job, signal: new AbortController().signal, budgetMs: 1000 }), error => error === failure);
  assert.equal(jobs.find(key), undefined);
});

test("an uncollected outcome expires strictly after the TTL, leaving a running job alone", async () => {
  let now = 0;
  const jobs = new SiteBackupPushJobs<number>({}, { now: () => now });
  const finished = jobs.start({ key, progress: progress(), run: async () => 1 });
  await finished.settled;
  let finishRunning!: (result: number) => void;
  const runningKey = { ...key, planId: "running" };
  const running = jobs.start({ key: runningKey, progress: progress(), run: () => new Promise(resolve => { finishRunning = resolve; }) });
  now += FINISHED_JOB_TTL_MS;
  assert.equal(jobs.find(key), finished, "the exact TTL boundary remains collectable");
  now += 1;
  assert.equal(jobs.find(key), undefined);
  assert.equal(jobs.find(runningKey), running);
  finishRunning(2);
  assert.deepEqual(await jobs.wait({ job: running, signal: new AbortController().signal, budgetMs: 1000 }), { state: "done", result: 2 });
});

test("a wait budget returns a progress snapshot and leaves the same upload collectable", async () => {
  vi.useFakeTimers();
  let now = 100;
  const jobs = new SiteBackupPushJobs<number>({}, { now: () => now });
  let complete!: (result: number) => void;
  const state = progress();
  const job = jobs.start({ key, progress: state, run: ({ progress: current }) => {
    current.filesDone = 1;
    current.bytesDone = 8;
    return new Promise(resolve => { complete = resolve; });
  } });
  now = 150;
  const waiting = jobs.wait({ job, signal: new AbortController().signal, budgetMs: 50 });
  vi.advanceTimersByTime(50);
  const outcome = await waiting;
  assert.deepEqual(outcome, { state: "running", progress: { filesDone: 1, filesTotal: 2, bytesDone: 8, bytesTotal: 20 }, elapsedMs: 50 });
  state.bytesDone = 20;
  assert.equal(outcome.state === "running" && outcome.progress.bytesDone, 8, "reported progress is a snapshot");
  assert.equal(jobs.find(key), job);
  assert.equal(job.controller.signal.aborted, false);
  complete(42);
  assert.deepEqual(await jobs.wait({ job, signal: new AbortController().signal, budgetMs: 50 }), { state: "done", result: 42 });
});

test("an already stopped caller aborts and forgets the pending upload", async () => {
  const jobs = new SiteBackupPushJobs<number>({});
  let finish!: (result: number) => void;
  const job = jobs.start({ key, progress: progress(), run: () => new Promise(resolve => { finish = resolve; }) });
  const caller = new AbortController();
  caller.abort();
  assert.deepEqual(await jobs.wait({ job, signal: caller.signal, budgetMs: 1000 }), { state: "abandoned" });
  assert.equal(job.controller.signal.aborted, true);
  assert.equal(jobs.find(key), undefined);
  finish(1);
  await job.settled;
  assert.equal(jobs.find(key), undefined, "a late result must not resurrect the abandoned job");
});
