/** Actions observer and deploy dispatcher: requests stay on api.github.com; job-log archive redirects are never requested. */
const PLATFORM = "github-actions";
const text = value => String(value ?? "").slice(0, 2000);
/** Reject path injection and build a fixed-host repository URL. */
function base(ctx, target) {
  if (typeof target !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/.test(target) || [".", ".."].includes(target.split("/")[1])) ctx.fail("Target must be owner/repo.");
  return `https://api.github.com/repos/${target.split("/").map(encodeURIComponent).join("/")}`;
}
function invalidJob({ job }, _options = {}) {
  if (!job || !/^\d+$/.test(String(job.id)) || typeof job.status !== "string") return true;
  return job.steps !== undefined && (!Array.isArray(job.steps) || job.steps.some(s => !s || typeof s.name !== "string"));
}
async function selectWorkflowRun({ ctx, input, runs }, _options = {}) {
  let run;
  if (input.runId !== undefined) {
    if (!/^\d+$/.test(input.runId)) ctx.fail("runId must contain only digits.");
    run = (await ctx.get(`${runs}/${input.runId}`)).json;
  } else {
    const branch = input.branch ? `&branch=${encodeURIComponent(input.branch)}` : "";
    const response = (await ctx.get(`${runs}?per_page=5${branch}`)).json;
    if (!Array.isArray(response?.workflow_runs)) ctx.fail("Workflow response must contain workflow_runs.");
    run = response.workflow_runs[0];
  }
  return run;
}
/** Select the requested run or latest branch run, then fetch at most 100 jobs. O(1) requests. */
async function readRun(ctx, input) {
  const repo = base(ctx, input.target); const runs = `${repo}/actions/runs`;
  const run = await selectWorkflowRun({ ctx, input, runs });
  if (!run) return { repo, run: undefined, jobs: [], moreJobs: false };
  if (!/^\d+$/.test(String(run.id)) || typeof run.status !== "string") ctx.fail("Workflow run response is invalid.");
  const result = (await ctx.get(`${runs}/${run.id}/jobs?per_page=100`)).json;
  if (!Array.isArray(result?.jobs)) ctx.fail("Workflow jobs response must contain jobs.");
  if (result.jobs.some(job => invalidJob({ job }))) ctx.fail("Workflow jobs response contains an invalid job.");
  return { repo, run, jobs: result.jobs.slice(0, 100), moreJobs: result.total_count > result.jobs.length || result.jobs.length > 100 };
}
/** Unknown conclusions remain unknown so wait-until-finished cannot invent completion. */
function state(run) {
  if (["queued", "in_progress", "waiting", "requested", "pending"].includes(run.status)) return "deploying";
  if (run.status !== "completed") return "unknown";
  if (run.conclusion === "success") return "healthy";
  if (["failure", "timed_out", "action_required", "startup_failure", "stale"].includes(run.conclusion)) return "failing";
  if (["cancelled", "skipped", "neutral"].includes(run.conclusion)) return "stopped";
  return "unknown";
}
const failedSteps = job => (Array.isArray(job.steps) ? job.steps : []).filter(s => ["failure", "timed_out", "cancelled"].includes(s.conclusion));
/** Normalize a run and its jobs; never return the raw workflow/job bodies. */
async function status(ctx, input) {
  const { run, jobs, moreJobs } = await readRun(ctx, input);
  if (!run) return { platform: PLATFORM, target: input.target, state: "unknown", summary: "No workflow runs found.", items: [], checkedAt: ctx.nowIso() };
  return { platform: PLATFORM, target: input.target, state: state(run), summary: text(`${text(run.name)}: ${text(run.status)}/${text(run.conclusion)}; head_sha=${text(run.head_sha)}${moreJobs ? "; jobs truncated" : ""}`), items: jobs.map(j => ({ id: text(j.id), name: text(j.name), state: text(j.conclusion ?? j.status), detail: text(`status=${text(j.status)}; conclusion=${text(j.conclusion)}; failed steps: ${failedSteps(j).map(s => text(s.name)).join(", ")}`) })), ...(typeof run.html_url === "string" && run.html_url.startsWith("https://github.com/") ? { url: text(run.html_url) } : {}), checkedAt: ctx.nowIso() };
}
function addFailedStepLines({ job, add }, _options = {}) {
  let truncated = false;
  for (const step of failedSteps(job)) {
    const message = `Failed step: ${String(step.name ?? "")}`;
    if (message.length > 2000) truncated = true;
    add({ source: text(job.name), level: "error", message: text(message) });
  }
  return truncated;
}
function annotationMessage({ annotation }, _options = {}) {
  const location = annotation.path ? `${String(annotation.path)}:${String(annotation.start_line ?? "")}: ` : "";
  return `${location}${String(annotation.message ?? "")}`;
}
function addAnnotationLine({ ctx, job, annotation, add }, _options = {}) {
  if (!annotation || typeof annotation !== "object") ctx.fail("Check annotations response contains an invalid entry.");
  const message = annotationMessage({ annotation });
  add({ source: text(job.name), level: text(annotation.annotation_level ?? "error"), message: text(message) });
  return message.length > 2000;
}
async function addAnnotationLines({ ctx, repo, job, add }, _options = {}) {
  if (!/^\d+$/.test(String(job.id))) ctx.fail("Workflow job id is invalid.");
  // The API supports at most 100 annotations per page. Read enough to determine overflow, never redirect.
  const response = await ctx.get(`${repo}/check-runs/${job.id}/annotations?per_page=100`);
  if (!Array.isArray(response.json)) ctx.fail("Check annotations response must be an array.");
  let truncated = false;
  for (const annotation of response.json) {
    if (addAnnotationLine({ ctx, job, annotation, add })) truncated = true;
  }
  if (response.truncated || response.json.length >= 100) truncated = true;
  return truncated;
}
/** Return failed steps plus bounded check-run annotations; stop fetching once the line cap is full. */
async function logs(ctx, input) {
  const { repo, jobs, moreJobs } = await readRun(ctx, input);
  const lines = []; let truncated = moreJobs;
  const failed = jobs.filter(j => ["failure", "timed_out", "action_required", "cancelled"].includes(j.conclusion) || failedSteps(j).length);
  const add = line => {
    if (lines.length < input.limit) lines.push(line);
    else truncated = true;
    if (String(line.message).length > 2000) truncated = true;
  };
  // Bound per-job I/O: at most 10 annotation requests plus the run/jobs requests.
  if (failed.length > 10) truncated = true;
  for (const [index, job] of failed.slice(0, 10).entries()) {
    if (addFailedStepLines({ job, add })) truncated = true;
    if (await addAnnotationLines({ ctx, repo, job, add })) truncated = true;
    if (lines.length >= input.limit && index < failed.length - 1) { truncated = true; break; }
  }
  return { platform: PLATFORM, target: input.target, lines, truncated };
}
const FULL_SHA = /^[0-9a-f]{40}$/;
const RUN_LOOKUPS = 5;
const RUN_LOOKUP_DELAY_MS = 2000;
/** Host and GitHub clocks differ; a run created this long before our dispatch can still be ours. */
const CLOCK_SKEW_MS = 30_000;
/** Branch or tag names only: the dispatch API runs a workflow on a ref, never at a bare commit. */
function refName(ctx, ref) {
  const value = ref ?? "main";
  if (typeof value !== "string" || value.length > 200 || !/^[A-Za-z0-9._/-]+$/.test(value) || /^[-/.]|[/.]$|\.\.|\/\/|\.lock$/.test(value)) ctx.fail("ref must be a branch or tag name.");
  if (/^[0-9a-fA-F]{40}$/.test(value)) ctx.fail("ref must be a branch or tag name; GitHub cannot dispatch a workflow at a bare commit SHA. Push the commit to a branch first.");
  return value;
}
/** Find our run: this workflow, this exact SHA, created no earlier than just before the dispatch. At most RUN_LOOKUPS GETs. */
async function findRun(ctx, workflow, sha, since) {
  for (let attempt = 0; attempt < RUN_LOOKUPS; attempt++) {
    if (attempt > 0) await ctx.sleep(RUN_LOOKUP_DELAY_MS);
    const response = (await ctx.get(`${workflow}/runs?event=workflow_dispatch&head_sha=${sha}&per_page=10`)).json;
    if (!Array.isArray(response?.workflow_runs)) ctx.fail("Workflow runs response must contain workflow_runs.");
    // A run on another SHA is never reported as this deploy, even if it is the newest.
    const run = response.workflow_runs.find(r => r && r.head_sha === sha && /^\d+$/.test(String(r.id)) && Date.parse(r.created_at) >= since);
    if (run) return run;
  }
  return undefined;
}
/** Resolve ref -> full SHA, dispatch the deploy workflow pinned to it, then return the run id. O(1) + bounded lookups.
 *  The host supplies the repo's deploy workflow (`input.workflowFile`, declared by the deploy-config owner; plugins never
 *  import each other). Its dispatch input `expected_sha` makes it refuse to deploy a ref that moved. */
async function deploy(ctx, input) {
  const repo = base(ctx, input.target);
  const selection = selectWorkflow({ input });
  if (selection.reason) return { platform: PLATFORM, target: input.target, started: false, summary: selection.reason };
  const workflowFile = selection.file;
  const ref = refName(ctx, input.ref);
  const commit = (await ctx.get(`${repo}/commits/${ref.split("/").map(encodeURIComponent).join("/")}`)).json;
  if (typeof commit?.sha !== "string" || !FULL_SHA.test(commit.sha)) ctx.fail(`Could not resolve '${ref}' to a full commit SHA.`);
  const sha = commit.sha;
  const workflow = `${repo}/actions/workflows/${workflowFile}`;
  const since = Date.parse(ctx.nowIso()) - CLOCK_SKEW_MS;
  const dispatched = await ctx.send({ method: "POST", url: `${workflow}/dispatches`, body: { ref, inputs: { expected_sha: sha } } });
  // Newer API versions may answer with the run directly; otherwise (204) look it up by SHA.
  const run = await dispatchedRun({ ctx, dispatched, workflow, sha, since });
  const pinned = `The workflow refuses to deploy if '${ref}' no longer resolves to ${sha} when it starts.`;
  if (!run) return { platform: PLATFORM, target: input.target, started: true, sha, summary: text(`Dispatched ${workflowFile} on '${ref}' at ${sha}, but its run was not visible yet. ${pinned} Check deployment_ops_status with branch '${ref}' in a minute.`) };
  return { platform: PLATFORM, target: input.target, started: true, sha, runId: String(run.id), ...(typeof run.html_url === "string" && run.html_url.startsWith("https://github.com/") ? { url: text(run.html_url) } : {}), summary: text(`Dispatched ${workflowFile} on '${ref}' at ${sha}; run ${run.id}. ${pinned}`) };
}
export default { status, logs, deploy };

/** Select only a host-declared active workflow; ambiguity is an actionable no-dispatch result. O(files). */
function selectWorkflow({ input }, _options = {}) {
  const files = (input.workflowFiles ?? []).filter(file => typeof file === "string" && /^[a-zA-Z0-9_-]+\.ya?ml$/.test(file));
  if (input.workflowFile !== undefined) return files.includes(input.workflowFile) ? { file: input.workflowFile }
    : { reason: `Nothing dispatched: workflowFile must match an installed, active declaration. Available: ${files.join(", ") || "none"}.` };
  if (files.length === 1) return { file: files[0] };
  return { reason: files.length ? `Nothing dispatched: choose workflowFile from ${files.join(", ")}.`
    : "Nothing dispatched: no active plugin declares a deployment workflow. Install or enable the hosting plugin first." };
}

/** New API versions return a run id directly; older ones require the existing bounded lookup. */
async function dispatchedRun({ ctx, dispatched, workflow, sha, since }, _options = {}) {
  const directId = dispatched.json?.workflow_run_id;
  return directId !== undefined && /^\d+$/.test(String(directId)) ? { id: directId, html_url: dispatched.json.html_url } : findRun(ctx, workflow, sha, since);
}
