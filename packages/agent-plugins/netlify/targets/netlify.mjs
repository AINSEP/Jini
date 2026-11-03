// @ts-check
import { createHash } from "node:crypto";

/**
 * @file Netlify deploy target of the `netlify` Agent Plugin.
 *
 * Ported from `@jini-ai/devops` `src/deploy/netlify.ts` (0.3.1). Same Netlify calls and error texts;
 * the only change is the import surface: network, timeouts, reachability and naming come from the
 * host kit the host injects (`DeployHostKit`, below), because an installed plugin has no npm
 * dependencies to import. Plain JS by owner decision (2026-09-29).
 *
 * Flow: find-or-create a site for the project name, create a deploy from a SHA1 file manifest, upload
 * only the files Netlify reports as `required`, poll to a terminal `state`, then wait for the public
 * URL. Built against Netlify's OpenAPI contract (https://open-api.netlify.com).
 *
 * @typedef {import("@jini-ai/devops/deploy").DeployFile} DeployFile
 * @typedef {import("@jini-ai/devops/deploy").DeployTarget} DeployTarget
 * @typedef {Record<string, unknown>} JsonObject
 * @typedef {{ fetch(url: string, init: RequestInit, options: { timeoutMs: number }): Promise<Response>,
 *   timeouts: { QUICK: number, DEPLOY: number, UPLOAD: number }, sleep(ms: number): Promise<void>,
 *   checkDeploymentUrl: Function, waitForReachableDeploymentUrl: Function, normalizeDeploymentUrl(url: unknown): string,
 *   safeDnsLabel(raw: unknown): string, DeployError: typeof import("@jini-ai/devops/deploy").DeployError }} DeployHostKit
 * @typedef {{ files: DeployFile[], projectName: string, responseHeaders?: Readonly<Record<string, string>> }} PublishInput
 */

export const NETLIFY_TARGET_ID = "netlify";

const NETLIFY_API = "https://api.netlify.com/api/v1";

/** The file Netlify reads per-path response headers from. */
const HEADERS_FILE = "_headers";

/**
 * Terminal failure states from Netlify's `GET /sites/{site_id}/deploys` `state` filter. `ready` is the
 * only success state; every other value is in progress and keeps the poll going.
 */
const NETLIFY_FAILURE_STATES = new Set(["error", "rejected"]);

/**
 * Renders a header set in Netlify's `_headers` format: a path pattern, then two-space-indented
 * `Name: value` lines. Byte-identical to what the first host (Tovu) rendered in its core before this moved here.
 *
 * @param {Readonly<Record<string, string>>} headers
 * @returns {string}
 */
function renderHeadersFile(headers) {
  const lines = Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`);
  return `/*\n${lines.join("\n")}\n`;
}

/**
 * The file set actually deployed: `files`, plus a root `_headers` rendered from `responseHeaders`.
 * The rendered file REPLACES a site-supplied `_headers`: the header set is the host's policy, and the
 * legacy path had the same effect (its later manifest entry for the same path won).
 *
 * @param {DeployFile[]} files
 * @param {Readonly<Record<string, string>> | undefined} responseHeaders
 * @returns {DeployFile[]}
 */
function withHeadersFile(files, responseHeaders) {
  if (!responseHeaders || Object.keys(responseHeaders).length === 0) return files;
  return [...files.filter((file) => file.file !== HEADERS_FILE), { file: HEADERS_FILE, data: renderHeadersFile(responseHeaders) }];
}

/** @implements {DeployTarget} */
class NetlifyDeployTarget {
  /**
   * @param {{ token: string }} config
   * @param {DeployHostKit} kit
   */
  constructor(config, kit) {
    this.id = NETLIFY_TARGET_ID;
    this.config = config;
    this.kit = kit;
  }

  /** Resolve through the existing site lifecycle so a first publish and its upload share one
   * provider-assigned identity. @complexity One bounded ensure-site pass; no file uploads.
   */
  async resolvePublicUrl({ projectName }, _options = {}) {
    if (!this.config.token) throw new this.kit.DeployError("Netlify token is required.", 400);
    this.resolvedSite = await ensureNetlifySite(this, deriveNetlifySiteName(this.kit, projectName));
    const url = netlifyUrlCandidates(this.kit, this.resolvedSite)[0];
    if (!url) throw new this.kit.DeployError("Netlify did not report the site's public URL.", 502);
    return url;
  }

  /**
   * Publishes `input.files` as a new Netlify deploy (creating the site on first use) and waits for
   * the URL to be reachable.
   *
   * @param {PublishInput} input
   * @throws {DeployError} Missing token, site not found/created, or a terminal failure state.
   */
  async publish(input) {
    const { kit } = this;
    const { site, siteId, siteName } = await resolvePublishSite({ target: this, projectName: input.projectName });

    const { created, byHash } = await createNetlifyDeploy(this, siteId, withHeadersFile(input.files, input.responseHeaders));
    const deployId = typeof created.id === "string" ? created.id : "";
    if (!deployId) throw new kit.DeployError("Netlify deploy response did not include an id.", 502, created);

    await uploadRequiredNetlifyFiles({ target: this, deployId, created, byHash });

    const finalState = await readyNetlifyDeploy({ target: this, deployId });

    const candidates = netlifyUrlCandidates(kit, finalState, site);
    const link = await kit.waitForReachableDeploymentUrl(candidates, { providerLabel: "Netlify" });

    return publishResult({ target: this, link, candidates, deployId, siteId, siteName });
  }

  /** Probes `url` with the shared checker; Netlify has no documented auth wall to detect.
   *  @param {string} url */
  async checkReachability(url) {
    return this.kit.checkDeploymentUrl(url);
  }
}

/** The site this publish deploys to: the already-resolved one, or the named site (created on first use).
 *  @param {{ target: NetlifyDeployTarget, projectName: string | undefined }} required
 *  @throws {DeployError} Missing token, an ungeneratable name, or a site response without an id. */
async function resolvePublishSite({ target, projectName }, _options = {}) {
  const { kit } = target;
  if (!target.config.token) throw new kit.DeployError("Netlify token is required.", 400);
  const siteName = deriveNetlifySiteName(kit, projectName);
  if (!siteName) throw new kit.DeployError("Netlify site name could not be generated.", 400);
  const site = target.resolvedSite ?? await ensureNetlifySite(target, siteName);
  const siteId = typeof site.id === "string" ? site.id : "";
  if (!siteId) throw new kit.DeployError("Netlify site response did not include an id.", 502, site);
  return { site, siteId, siteName };
}

/** @param {{ target: NetlifyDeployTarget, link: { url?: string, status: unknown, statusMessage?: unknown, reachableAt?: unknown }, candidates: string[], deployId: string, siteId: string, siteName: string }} required */
function publishResult({ target, link, candidates, deployId, siteId, siteName }, _options = {}) {
  return {
    targetId: target.id,
    url: link.url || candidates[0] || "",
    deploymentId: deployId,
    status: link.status,
    statusMessage: link.statusMessage,
    ...(link.reachableAt !== undefined ? { reachableAt: link.reachableAt } : {}),
    providerMetadata: { siteId, siteName },
  };
}

/** @param {{ target: NetlifyDeployTarget, deployId: string, created: JsonObject, byHash: Map<string, DeployFile> }} required */
async function uploadRequiredNetlifyFiles({ target, deployId, created, byHash }, _options = {}) {
  const required = Array.isArray(created.required) ? created.required.filter((hash) => typeof hash === "string") : [];
  for (const hash of required) {
    const file = byHash.get(hash);
    // `required` is derived from the manifest just sent, so an unknown hash should never happen;
    // skip it rather than fail the whole publish.
    if (!file) continue;
    await uploadNetlifyFile(target, deployId, file);
  }
}

/** @param {{ target: NetlifyDeployTarget, deployId: string }} required */
async function readyNetlifyDeploy({ target, deployId }, _options = {}) {
  const finalState = await pollNetlifyDeploy(target, deployId);
  if (finalState && NETLIFY_FAILURE_STATES.has(String(finalState.state))) {
    throw new target.kit.DeployError(
      (typeof finalState.error_message === "string" && finalState.error_message) || `Netlify deployment ${finalState.state}.`,
      502,
      finalState,
    );
  }
  return finalState;
}

/**
 * A stable, Netlify-safe site name from the project name. Deterministic so repeated publishes land on
 * the same site. The `jini-` prefix is kept byte-identical to the devops original: existing Netlify
 * sites carry it, and a new prefix would silently create a second site on the next publish.
 *
 * @param {DeployHostKit} kit
 * @param {string} projectName
 */
function deriveNetlifySiteName(kit, projectName) {
  const label = kit.safeDnsLabel(projectName) || "site";
  return kit.safeDnsLabel(`jini-${label}`).slice(0, 63);
}

/** @param {string} token @param {Record<string, string>} [extra] */
function netlifyHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

/** @param {NetlifyDeployTarget} target @param {Response} resp @returns {Promise<any>} */
async function readNetlifyJson(target, resp) {
  try {
    return await resp.json();
  } catch {
    throw new target.kit.DeployError("Netlify returned a non-JSON response.", resp.status || 502);
  }
}

/** @param {NetlifyDeployTarget} target @param {JsonObject} json @param {number} status @param {string} fallback */
function netlifyError(target, json, status, fallback) {
  const message = typeof json?.message === "string" && json.message ? json.message : fallback || `Netlify request failed (${status}).`;
  return new target.kit.DeployError(message, status, json);
}

/** Looks up a site by exact (case-insensitive) name within the caller's own account.
 *  @param {NetlifyDeployTarget} target @param {string} name @returns {Promise<JsonObject | undefined>} */
async function findNetlifySiteByName(target, name) {
  const { kit, config } = target;
  const url = `${NETLIFY_API}/sites?${new URLSearchParams({ name, filter: "all" }).toString()}`;
  const resp = await kit.fetch(url, { headers: netlifyHeaders(config.token) }, { timeoutMs: kit.timeouts.QUICK });
  const body = await readNetlifyJson(target, resp);
  if (!resp.ok) throw netlifyError(target, Array.isArray(body) ? {} : body, resp.status, "Netlify site lookup failed.");
  /** @type {JsonObject[]} */
  const list = Array.isArray(body) ? body : [];
  return list.find((site) => typeof site?.name === "string" && site.name.toLowerCase() === name.toLowerCase());
}

/** @param {NetlifyDeployTarget} target @param {string} name @returns {Promise<JsonObject>} */
async function createNetlifySite(target, name) {
  const { kit, config } = target;
  const resp = await kit.fetch(
    `${NETLIFY_API}/sites`,
    { method: "POST", headers: netlifyHeaders(config.token, { "Content-Type": "application/json" }), body: JSON.stringify({ name }) },
    { timeoutMs: kit.timeouts.DEPLOY },
  );
  const body = await readNetlifyJson(target, resp);
  if (!resp.ok) throw netlifyError(target, body, resp.status, "Netlify site creation failed.");
  return body;
}

/**
 * Finds the site for `name`, creating it on first use. Site names are globally unique, so a failed
 * create is ambiguous (a benign race inside this account, or another account owns it): re-listing
 * this account's sites tells them apart. Found: use it. Still missing: rethrow the creation error.
 *
 * @param {NetlifyDeployTarget} target @param {string} name @returns {Promise<JsonObject>}
 */
async function ensureNetlifySite(target, name) {
  const existing = await findNetlifySiteByName(target, name);
  if (existing) return existing;
  try {
    return await createNetlifySite(target, name);
  } catch (error) {
    const retry = await findNetlifySiteByName(target, name);
    if (retry) return retry;
    throw error;
  }
}

/** @param {DeployFile["data"]} data */
function sha1Hex(data) {
  // Netlify requires SHA-1 file identifiers in its deploy manifest and upload URLs.
  // This is a wire-format requirement; substituting SHA-256 would break uploads.
  return createHash("sha1").update(Buffer.from(data)).digest("hex");
}

/** URL-encodes each path segment so separators survive but special characters do not.
 *  @param {string} filePath */
function encodeNetlifyFilePath(filePath) {
  return filePath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

/**
 * Creates a deploy from a SHA1 manifest. Returns the response plus a hash-to-file lookup for the
 * hashes Netlify reports back as `required`.
 *
 * @param {NetlifyDeployTarget} target @param {string} siteId @param {DeployFile[]} files
 * @returns {Promise<{ created: JsonObject, byHash: Map<string, DeployFile> }>}
 */
async function createNetlifyDeploy(target, siteId, files) {
  const { kit, config } = target;
  /** @type {Record<string, string>} */
  const manifest = {};
  /** @type {Map<string, DeployFile>} */
  const byHash = new Map();
  for (const file of files) {
    const hash = sha1Hex(file.data);
    manifest[`/${file.file}`] = hash;
    if (!byHash.has(hash)) byHash.set(hash, file);
  }

  const resp = await kit.fetch(
    `${NETLIFY_API}/sites/${encodeURIComponent(siteId)}/deploys`,
    { method: "POST", headers: netlifyHeaders(config.token, { "Content-Type": "application/json" }), body: JSON.stringify({ async: true, files: manifest }) },
    { timeoutMs: kit.timeouts.DEPLOY },
  );
  const created = await readNetlifyJson(target, resp);
  if (!resp.ok) throw netlifyError(target, created, resp.status, "Netlify deploy creation failed.");
  return { created, byHash };
}

/** @param {NetlifyDeployTarget} target @param {string} deployId @param {DeployFile} file */
async function uploadNetlifyFile(target, deployId, file) {
  const { kit, config } = target;
  const resp = await kit.fetch(
    `${NETLIFY_API}/deploys/${encodeURIComponent(deployId)}/files/${encodeNetlifyFilePath(file.file)}`,
    { method: "PUT", headers: netlifyHeaders(config.token, { "Content-Type": file.contentType || "application/octet-stream" }), body: Buffer.from(file.data) },
    { timeoutMs: kit.timeouts.UPLOAD },
  );
  if (!resp.ok) {
    const body = await readNetlifyJson(target, resp).catch(() => ({}));
    throw netlifyError(target, body, resp.status, `Netlify file upload failed for "${file.file}".`);
  }
}

/**
 * Polls a new deploy to a terminal state or a fixed 30-attempt budget (~1s for the first 5 attempts,
 * 2s after: about a minute). A poll body that does not parse is "keep polling", not a failure: the
 * deploy and its files already exist server-side by now. A parsed non-2xx still fails fast.
 *
 * @param {NetlifyDeployTarget} target @param {string} deployId @returns {Promise<JsonObject | null>}
 */
async function pollNetlifyDeploy(target, deployId) {
  const { kit, config } = target;
  /** @type {JsonObject | null} */
  let last = null;
  for (let i = 0; i < 30; i += 1) {
    await kit.sleep(i < 5 ? 1000 : 2000);
    const resp = await kit.fetch(`${NETLIFY_API}/deploys/${encodeURIComponent(deployId)}`, { headers: netlifyHeaders(config.token) }, { timeoutMs: kit.timeouts.DEPLOY });
    let json;
    try {
      json = await readNetlifyJson(target, resp);
    } catch {
      continue;
    }
    if (!resp.ok) throw netlifyError(target, json, resp.status, "Netlify deploy status check failed.");
    last = json;
    if (json.state === "ready" || NETLIFY_FAILURE_STATES.has(String(json.state))) return json;
  }
  return last;
}

/**
 * Candidate public URLs from the deploy and site responses, HTTPS site URL first.
 *
 * @param {DeployHostKit} kit @param {...(JsonObject | null | undefined)} responses @returns {string[]}
 */
function netlifyUrlCandidates(kit, ...responses) {
  /** @type {string[]} */
  const urls = [];
  for (const json of responses) {
    if (!json) continue;
    for (const key of ["ssl_url", "url", "deploy_ssl_url", "deploy_url"]) {
      if (typeof json[key] === "string") urls.push(json[key]);
    }
  }
  return [...new Set(urls.map((url) => kit.normalizeDeploymentUrl(url)).filter(Boolean))];
}

/**
 * Reads one credential-check response WITHOUT touching its body: 401/403 means the host refused the
 * credential, any other failure says nothing about it (a 5xx, a rate limit).
 *
 * @param {Response} response
 * @returns {{ ok: true } | { ok: false, reason: "rejected" | "unreachable", statusCode: number }}
 */
function classifyCredentialResponse(response) {
  if (response.ok) return { ok: true };
  return { ok: false, reason: response.status === 401 || response.status === 403 ? "rejected" : "unreachable", statusCode: response.status };
}

/** The module contract a host's deploy-target registry loads (`DeployTargetModule`). Netlify needs no
 *  config fields: the site is found or created from the publish's project name. */
export default {
  /** @param {{ credential: { token: string }, kit: DeployHostKit }} context */
  create({ credential, kit }) {
    return new NetlifyDeployTarget({ token: credential.token }, kit);
  },
  /**
   * `GET /api/v1/user`: 401 for a bad token. Reads nothing back: the body's only identity fields are
   * `email` and `full_name`, neither of them a public handle.
   * @param {{ credential: { token: string }, kit: any }} context
   */
  async verifyCredential({ credential, kit }) {
    const response = await kit.fetch("https://api.netlify.com/api/v1/user", { headers: { Authorization: `Bearer ${credential.token}` } }, { timeoutMs: kit.timeouts.QUICK });
    return classifyCredentialResponse(response);
  },
  validateConfig() {
    return null;
  },
  basePath() {
    return undefined;
  },
};
