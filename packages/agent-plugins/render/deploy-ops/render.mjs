/** Render REST adapter. The host owns credentials, HTTP policy, cancellation and polling. */
const API = "https://api.render.com/v1";
const SERVER_TYPES = ["web_service", "private_service", "background_worker"];

/** Validate before encoding: a target or deployment is one bounded opaque path segment. */
function segment({ ctx, value, prefix }, _options = {}) {
  if (typeof value !== "string" || !value.startsWith(prefix) || !/^[A-Za-z0-9_-]+$/.test(value)) ctx.fail("Use a valid Render service or deployment ID.");
  if (value.length <= prefix.length || value.length > 128) ctx.fail("Use a valid Render service or deployment ID.");
  return encodeURIComponent(value);
}
function serviceUrl({ ctx, target }, _options = {}) {
  return `${API}/services/${segment({ ctx, value: target, prefix: "srv-" })}`;
}
/** Reject unsuitable services rather than dispatching a static site or provisioning resources. */
async function service({ ctx, target }, _options = {}) {
  const response = await ctx.get(serviceUrl({ ctx, target }));
  const found = response.json;
  if (response.truncated || found?.id !== target) ctx.fail("Render did not return the requested service.");
  if (!SERVER_TYPES.includes(found.type)) ctx.fail("Choose an existing Render server service; static sites and cron jobs are not supported.");
  return found;
}
/** Read at most five 100-row pages. A full last page means the result may be incomplete.
 * Values are projected away on each page, before they can enter an operation result. */
async function pages({ ctx, url, field, project }, _options = {}) {
  const items = []; let cursor;
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const response = await ctx.get(`${url}${url.includes("?") ? "&" : "?"}${query}`);
    const rows = listPage({ ctx, response });
    items.push(...rows.map(row => project({ ctx, value: row?.[field] })));
    if (rows.length < 100) return { items, truncated: false };
    cursor = nextCursor({ ctx, rows, cursor });
  }
  return { items, truncated: true };
}
function listPage({ ctx, response }, _options = {}) {
  const rows = response.json;
  if (response.truncated || !Array.isArray(rows) || rows.length > 100) ctx.fail("Render returned an incomplete or invalid list.");
  return rows;
}
function nextCursor({ ctx, rows, cursor }, _options = {}) {
  const next = rows.at(-1)?.cursor;
  if (typeof next !== "string" || !next || next.length > 2000 || next === cursor) ctx.fail("Render did not return a usable pagination cursor.");
  return next;
}
function targetInfo({ ctx, value }, _options = {}) {
  segment({ ctx, value: value?.id, prefix: "srv-" });
  if (typeof value.name !== "string" || typeof value.type !== "string") ctx.fail("Render returned an invalid service entry.");
  return { id: value.id, name: value.name.slice(0, 2000), type: value.type };
}
/** Discovery is bounded; never present a capped inventory as a complete choice list. */
async function listTargets(ctx, { org } = {}) {
  const query = org === undefined ? "" : `?ownerId=${encodeURIComponent(org)}`;
  const result = await pages({ ctx, url: `${API}/services${query}`, field: "service", project: targetInfo });
  if (result.truncated) ctx.fail("Render service discovery reached 500 services. Narrow it with the workspace ID in org.");
  return { platform: "render", targets: result.items.filter(item => SERVER_TYPES.includes(item.type)).map(({ id, name }) => ({ id, name })) };
}
/** Unknown provider states remain unknown so waiting cannot invent completion. */
function overall({ state }, _options = {}) {
  if (state === "live") return "healthy";
  if (["build_failed", "update_failed", "pre_deploy_failed"].includes(state)) return "failing";
  if (["canceled", "deactivated"].includes(state)) return "stopped";
  if (["created", "queued", "build_in_progress", "pre_deploy_in_progress", "update_in_progress"].includes(state)) return "deploying";
  return "unknown";
}
function deployment({ ctx, value, runId }, _options = {}) {
  segment({ ctx, value: value?.id, prefix: "dep-" });
  if (typeof value.status !== "string" || (runId !== undefined && value.id !== runId)) ctx.fail("Render did not return the requested deployment.");
  return value;
}
/** The service-scoped endpoint enforces run ownership in this read, with no membership pre-query. */
async function readDeployment({ ctx, target, runId }, _options = {}) {
  const base = `${serviceUrl({ ctx, target })}/deploys`;
  const suffix = runId === undefined ? "?limit=1" : `/${segment({ ctx, value: runId, prefix: "dep-" })}`;
  const response = await ctx.get(`${base}${suffix}`);
  if (response.truncated) ctx.fail("Render returned an incomplete deployment response.");
  if (runId !== undefined) return deployment({ ctx, value: response.json, runId });
  if (!Array.isArray(response.json)) ctx.fail("Render did not return a deployment list.");
  if (!response.json.length) return undefined;
  return deployment({ ctx, value: response.json[0]?.deploy });
}
async function status(ctx, { target, runId, branch }) {
  if (branch !== undefined) ctx.fail("Render status uses a deployment ID, not a branch filter.");
  const run = await readDeployment({ ctx, target, runId });
  if (!run) return { platform: "render", target, state: "unknown", summary: "No Render deployments found.", items: [], checkedAt: ctx.nowIso() };
  return { platform: "render", target, state: overall({ state: run.status }), summary: `Render deployment: ${run.status.slice(0, 2000)}`, items: [{ id: run.id, state: run.status.slice(0, 2000) }], checkedAt: ctx.nowIso() };
}
function validateRef({ ctx, ref }, _options = {}) {
  if (ref !== undefined && (typeof ref !== "string" || !/^[0-9a-fA-F]{40}$/.test(ref))) ctx.fail("Render ref must be a full commit SHA; omit it to deploy the connected branch.");
}
/** A full SHA pins the commit; omission uses the service's connected branch. Never retry writes here. */
async function deploy(ctx, { target, ref }) {
  validateRef({ ctx, ref });
  await service({ ctx, target });
  const response = await ctx.send({ method: "POST", url: `${serviceUrl({ ctx, target })}/deploys`, body: ref === undefined ? {} : { commitId: ref } });
  // 202 means queued behind a running deploy and carries no body, so there is no run ID to follow yet.
  if (response.status === 202) return { platform: "render", target, started: true, ...(ref === undefined ? {} : { sha: ref }), summary: "Render queued the deployment behind one already running. Wait for the service's latest deployment status." };
  if (response.truncated || response.status !== 201) ctx.fail("Render did not confirm deployment acceptance. Check Render before retrying.");
  const runId = response.json?.id;
  if (typeof runId !== "string" || !/^dep-[A-Za-z0-9_-]{1,124}$/.test(runId)) ctx.fail("Render accepted the request without a usable deployment ID. Check Render before retrying.");
  return { platform: "render", target, started: true, runId, ...(ref === undefined ? {} : { sha: ref }), summary: "Render accepted the deployment. Check its status to see when it is live." };
}
/** Log labels are metadata; return no raw service or log response objects. */
function logLine({ ctx, entry }, _options = {}) {
  if (typeof entry?.message !== "string" || typeof entry.timestamp !== "string" || !Array.isArray(entry.labels)) ctx.fail("Render returned an invalid log entry.");
  const level = entry.labels.find(label => label?.name === "level")?.value;
  return { at: entry.timestamp.slice(0, 2000), ...(typeof level === "string" ? { level: level.slice(0, 2000) } : {}), message: entry.message.slice(0, 2000) };
}
/** One bounded service-log page. These are recent service logs, not a deploy-specific stream. */
async function logs(ctx, { target, limit, runId, branch }) {
  if (branch !== undefined) ctx.fail("Render logs do not support a branch filter.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) ctx.fail("Render log limit must be between 1 and 1000.");
  const found = await service({ ctx, target });
  if (typeof found.ownerId !== "string" || !found.ownerId) ctx.fail("Render did not return the service workspace ID needed for logs.");
  if (runId !== undefined) await readDeployment({ ctx, target, runId });
  const query = new URLSearchParams({ ownerId: found.ownerId, resource: target, limit: String(Math.min(limit, 100)), direction: "backward" });
  const response = await ctx.get(`${API}/logs?${query}`);
  const entries = response.json?.logs;
  if (!Array.isArray(entries)) ctx.fail("Render did not return a logs array.");
  const lines = entries.slice(0, limit).map(entry => logLine({ ctx, entry }));
  return { platform: "render", target, lines, truncated: logsTruncated({ response, entries, limit }) };
}
function logsTruncated({ response, entries, limit }, _options = {}) {
  return response.truncated === true || response.json.hasMore === true || entries.length > limit || entries.slice(0, limit).some(entry => entry.message.length > 2000);
}
function secretInfo({ ctx, value }, _options = {}) {
  if (typeof value?.key !== "string" || !value.key || value.key.length > 128) ctx.fail("Render returned an invalid environment variable key.");
  return { name: value.key };
}
/** Only names leave this adapter; no value reads, digests or invented revision timestamps. */
async function listSecrets(ctx, { target }) {
  const result = await pages({ ctx, url: `${serviceUrl({ ctx, target })}/env-vars`, field: "envVar", project: secretInfo });
  return { secrets: result.items, truncated: result.truncated };
}
function envUrl({ ctx, target, name }, _options = {}) {
  if (typeof name !== "string" || !name || name.length > 128) ctx.fail("Use a valid Render environment variable key.");
  if (name === "." || name === ".." || /[\x00-\x1f\x7f]/.test(name)) ctx.fail("Use a valid Render environment variable key.");
  return `${serviceUrl({ ctx, target })}/env-vars/${encodeURIComponent(name)}`;
}
/** Per-key PUT preserves unrelated variables. The new value applies on the next deploy. */
async function setSecret(ctx, { target, name, value }) {
  await ctx.send({ method: "PUT", url: envUrl({ ctx, target, name }), body: { value } });
  return {};
}
/** Host revision safeguards normally refuse this call: Render lists no revision metadata. */
async function unsetSecret(ctx, { target, name }) {
  await ctx.send({ method: "DELETE", url: envUrl({ ctx, target, name }) });
  return {};
}
const secretCapabilities = { appliesOn: "next-deploy", supportsStaging: true };
export default { listTargets, deploy, status, logs, secretCapabilities, listSecrets, setSecret, unsetSecret };
