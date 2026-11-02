/**
 * @file Vercel deploy target of the `vercel` Agent Plugin.
 *
 * Ported from `@jini-ai/devops` `src/deploy/vercel.ts` at Jini commit 28f67f9a: the body of
 * {@link bindVercel} is that source with its TypeScript types stripped, same Vercel calls, error texts,
 * redirect guard and Deployment Protection detector (`isVercelProtectedResponse`). Changes:
 *
 * - Network, timeouts, poll delay, reachability, naming, the redirect guard and `DeployError` come
 *   from the host kit the host injects (see {@link bindVercel}),
 *   bound once per target by {@link bindVercel}: an installed plugin has no npm dependencies.
 * - `responseHeaders` (the host's security header set) is rendered into a root `vercel.json` here,
 *   which the first host (Tovu) used to add in its core.
 * - Files are uploaded one per request to `POST /v2/files` (by SHA-1) and the deployment references
 *   them as `{ file, sha, size }`, the way Vercel's CLI does (2026-10-11). The devops source sent every
 *   file inline, base64, in the one `/v13/deployments` body, which Vercel refuses past 10 MB
 *   ("Request body too large"): any real site with photos.
 *
 * Plain JS by owner decision (2026-09-29).
 */

import { createHash, randomInt } from "node:crypto";

export const VERCEL_TARGET_ID = "vercel";

/** `/v2/files` uploads in flight at once per publish: a few hundred files finish in reasonable time
 *  without tripping Vercel's rate limit. */
const VERCEL_UPLOAD_CONCURRENCY = 5;
/** Tries per file upload; a 429, a 5xx or a dropped connection is retried, anything else fails the
 *  publish at once. */
const VERCEL_UPLOAD_ATTEMPTS = 3;

/** The root file Vercel reads response-header rules from. */
const VERCEL_CONFIG_FILE = "vercel.json";

/**
 * Renders a header set as a `vercel.json` with one catch-all header rule. Byte-identical to what
 * the first host (Tovu) rendered in its core before this moved here.
 *
 * @param {Readonly<Record<string, string>>} headers
 * @returns {string}
 */
function renderVercelConfig(headers) {
  const rule = { source: "/(.*)", headers: Object.entries(headers).map(([key, value]) => ({ key, value })) };
  return `${JSON.stringify({ headers: [rule] }, null, 2)}\n`;
}

/**
 * The file set actually deployed: `files`, plus a root `vercel.json` rendered from
 * `responseHeaders`, which REPLACES a site-supplied one (the header set is the host's policy).
 *
 * @param {Array<{ file: string, data: string | Uint8Array, contentType?: string }>} files
 * @param {Readonly<Record<string, string>> | undefined} responseHeaders
 */
function withVercelConfigFile(files, responseHeaders) {
  if (!responseHeaders || Object.keys(responseHeaders).length === 0) return files;
  return [...files.filter((file) => file.file !== VERCEL_CONFIG_FILE), { file: VERCEL_CONFIG_FILE, data: renderVercelConfig(responseHeaders) }];
}

/**
 * Content-addresses a file set for Vercel: the deployment's `files` entries (`{ file, sha, size }`,
 * no data) and one upload body per distinct SHA-1, so identical files upload once.
 *
 * @param {Array<{ file: string, data: string | Uint8Array }>} files
 * @returns {{ refs: Array<{ file: string, sha: string, size: number }>, blobs: Map<string, Buffer> }}
 */
function vercelFileManifest(files) {
  const blobs = new Map();
  const refs = files.map((f) => {
    const data = Buffer.from(f.data);
    // Vercel requires SHA-1 in file references and x-vercel-digest upload headers.
    // This is a wire-format requirement; substituting SHA-256 would break uploads.
    const sha = createHash("sha1").update(data).digest("hex");
    blobs.set(sha, data);
    return { file: f.file, sha, size: data.length };
  });
  return { refs, blobs };
}

/**
 * Binds the ported Vercel code to one host kit.
 *
 * @param {{ fetch(url: string, init: RequestInit, options: { timeoutMs: number }): Promise<Response>,
 *   timeouts: { QUICK: number, DEPLOY: number, UPLOAD: number }, sleep(ms: number): Promise<void> } & Record<string, any>} kit
 *   The host's deploy kit in the positional ABI installed modules are written against (devops'
 *   `DeployHostKit` helpers, called positionally; `DeployError` is `new (message, status?, details?)`).
 * @returns The target class (constructed with `{ token, teamId?, teamSlug? }`, as in devops) and the
 * protected-response detector.
 */
export function bindVercel(kit) {
  const { fetch: fetchWithTimeout, timeouts: FETCH_TIMEOUT_MS, sleep, DeployError, checkDeploymentUrl, normalizeDeploymentUrl, waitForReachableDeploymentUrl, safeProjectLabel, assertNotRedirected, redirectGuardInit } = kit;
  const VERCEL_TARGET_ID = 'vercel';
  const VERCEL_API = 'https://api.vercel.com';
  const VERCEL_PROTECTED_MESSAGE = 'Deployment is protected by Vercel. Disable Deployment Protection or use a custom domain to make this link public.';
  /**
   * Heuristically detects Vercel's own Deployment Protection auth wall from a
   * 401 response, so `checkReachability` can report `status: 'protected'`
   * (an actionable, non-error outcome) instead of `reachable: false` with a
   * generic message.
   *
   * @param resp - The HTTP response received from probing a deployment URL.
   * @param body - The response body (only read for 401s by the caller).
   * @returns `true` if the response looks like Vercel's SSO/auth gate.
   * @complexity O(1) — a handful of regex tests over already-fetched strings.
   * @overallScore 100/100
   */
  function isVercelProtectedResponse(resp, body = '') {
      const { server, setCookie } = protectionHeaders({ resp });
      const text = String(body || '');
      if (/vercel/i.test(server) || /_vercel_sso_nonce/i.test(setCookie)) return true;
      return /Authentication Required|Vercel Authentication|vercel\.com\/sso-api/i.test(text);
  }
  function protectionHeaders({ resp }, _options = {}) {
      return { server: resp.headers?.get?.('server') || '', setCookie: resp.headers?.get?.('set-cookie') || '' };
  }
  /**
   * `DeployTarget` adapter for Vercel's v13 deployments API. Publishes a
   * caller-supplied file set as a single deployment, polls until Vercel
   * reports a terminal `readyState`, then waits for the resulting URL to
   * become publicly reachable.
   *
   * Genericized from the origin product's daemon deploy module's
   * `deployToVercel`: the origin's product-specific deployment-name
   * convention is replaced by `input.projectName` (sanitized the same way);
   * token/team config is supplied by the caller instead of being read from a
   * product-owned local config file — persistence of that config is now the
   * caller's concern, not this package's.
   */
  class VercelDeployTarget {
      config;
      id = VERCEL_TARGET_ID;
      resolvedProjectName;
      resolvedPublicUrl;
      constructor(config) {
          this.config = config;
      }
      /** Resolve the host-assigned production domain before rendering. A first publish creates
       * the same project publish() would create, then reads its actual alias (names may collide).
       * @complexity At most three bounded API calls, at most 100 domain records; no file uploads.
       * @throws DeployError for refused/ambiguous inventories; never fabricates a public URL.
       */
      async resolvePublicUrl({ projectName }, _options = {}) {
          this.resolvedProjectName = safeVercelProjectName(projectName);
          this.resolvedPublicUrl = await resolveVercelPublicUrl({ config: this.config, name: this.resolvedProjectName });
          return this.resolvedPublicUrl;
      }
      /**
       * Publishes `input.files` as a new Vercel deployment and waits for the
       * resulting URL to be reachable.
       *
       * @param input - File set plus a caller-chosen project name label.
       * @returns The published deployment's URL/status once Vercel has a
       *   terminal `readyState` (or the poll budget is exhausted).
       * @throws {DeployError} If `config.token` is missing, or Vercel's API
       *   rejects the deployment request or reports `readyState: 'ERROR'`.
       * @complexity O(files) to hash and upload them, plus a bounded poll loop
       *   (`pollVercelDeployment`) and the reachability wait's own bound.
       * @overallScore 100/100
       */
      async publish(input) {
          if (!this.config.token) {
              throw new DeployError('Vercel token is required.', 400);
          }
          const { refs, blobs } = vercelFileManifest(withVercelConfigFile(input.files, input.responseHeaders));
          await uploadVercelFiles(this.config, blobs, [...blobs.keys()]);
          const name = this.resolvedProjectName ?? safeVercelProjectName(input.projectName);
          const created = await createUploadedVercelDeployment({ config: this.config, name, refs, blobs });
          const fallbackId = typeof created.uid === 'string' ? created.uid : undefined;
          const deploymentId = typeof created.id === 'string' ? created.id : fallbackId;
          const initialUrl = deploymentUrl(created);
          const ready = await readyVercelDeployment({ config: this.config, deploymentId, created });
          const link = await publicVercelLink({ name, ready, created, initialUrl, publicUrl: this.resolvedPublicUrl });
          return {
              targetId: this.id,
              url: link.url || deploymentUrl(ready) || initialUrl,
              ...(deploymentId ? { deploymentId } : {}),
              status: link.status,
              statusMessage: link.statusMessage,
              ...(link.reachableAt !== undefined ? { reachableAt: link.reachableAt } : {}),
          };
      }
      /** Probes `url`, recognizing Vercel's own Deployment Protection auth wall. */
      async checkReachability(url) {
          return checkDeploymentUrl(url, {
              detectProtected: isVercelProtectedResponse,
              protectedMessage: VERCEL_PROTECTED_MESSAGE,
          });
      }
  }
  /** Read the provider's production-only, verified, nonredirecting domains. Refuse a partial
   * inventory rather than select a different canonical URL on different pages of the result.
   * @complexity One bounded request; response limited to 100 records by the provider.
   */
  async function readPublicDomains({ config, name }, _options = {}) {
      const url = new URL(`${VERCEL_API}/v9/projects/${encodeURIComponent(name)}/domains${vercelTeamQuery(config)}`);
      for (const [key, value] of Object.entries({ production: 'true', redirects: 'false', verified: 'true', limit: '100' })) url.searchParams.set(key, value);
      return fetchWithTimeout(url.href, redirectGuardInit({ method: 'GET', headers: { Authorization: `Bearer ${config.token}` } }), { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
  }
  /** Provision only after an authoritative not-found response; permission/network failures never create.
   * @complexity One POST with the same project name and framework as the existing publish request.
   */
  async function createPublicProject({ config, name }, _options = {}) {
      const response = await fetchWithTimeout(`${VERCEL_API}/v11/projects${vercelTeamQuery(config)}`, redirectGuardInit({
          method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, framework: null }),
      }), { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
      assertNotRedirected(response, 'Vercel project creation');
      const body = await readVercelJson(response);
      if (!response.ok) throw vercelError(body, response.status);
  }
  /** Actual domain evidence, never a name-derived hostname; preparation stays inside this provider.
   * @complexity At most three API requests and O(domains), capped at 100; errors propagate.
   */
  async function resolveVercelPublicUrl({ config, name }, _options = {}) {
      if (!config.token) throw new DeployError('Vercel token is required.', 400);
      let response = await readPublicDomains({ config, name });
      if (response.status === 404) {
          await response.body?.cancel();
          await createPublicProject({ config, name });
          response = await readPublicDomains({ config, name });
      }
      assertNotRedirected(response, 'Vercel public domain lookup');
      const body = await readVercelJson(response);
      if (!response.ok) throw vercelError(body, response.status);
      return publicDomainUrl({ body, name });
  }
  /** Select a complete, bounded inventory. Missing evidence is a refusal, never a guessed alias.
   * @complexity O(domains), capped at 100 records; pure, throws DeployError for missing evidence.
   */
  function publicDomainUrl({ body, name }, _options = {}) {
      const entries = Array.isArray(body.domains) ? body.domains : [];
      if (body.pagination?.next != null || entries.length > 100) throw new DeployError('Public domain inventory exceeds 100 domains; choose a smaller destination.', 400);
      const domains = entries.filter(domain => domain.verified === true && !domain.redirect && !domain.gitBranch && typeof domain.name === 'string');
      const domain = domains.find(domain => domain.name === `${name}.vercel.app`) ?? domains[0];
      if (!domain) throw new DeployError('Vercel did not report a verified public domain for this project.', 400);
      return `https://${domain.name}`;
  }
  async function createUploadedVercelDeployment({ config, name, refs, blobs }, _options = {}) {
      // `target: "production"`: without it Vercel makes a preview deployment, and only a project's
      // FIRST deployment takes the production alias, so every later publish never reached the
      // public address (2026-10-11). A publish is meant to update the live site.
      const body = JSON.stringify({ name, files: refs, target: 'production', projectSettings: { framework: null } });
      let createResp = await createVercelDeployment(config, body);
      let created = await readVercelJson(createResp);
      const missing = created?.error?.code === 'missing_files' ? created.error.missing : undefined;
      if (!createResp.ok && Array.isArray(missing)) {
          // Vercel did not keep (or never got) some uploads: send exactly what it names, then create
          // once more. A second `missing_files` is reported like any other create failure.
          await uploadVercelFiles(config, blobs, missing.filter((sha) => blobs.has(sha)));
          createResp = await createVercelDeployment(config, body);
          created = await readVercelJson(createResp);
      }
      if (!createResp.ok)
          throw vercelError(created, createResp.status);
      return created;
  }
  async function readyVercelDeployment({ config, deploymentId, created }, _options = {}) {
      const ready = deploymentId ? await pollVercelDeployment(config, deploymentId) : created;
      if (ready?.readyState === 'ERROR') {
          const readyError = ready?.error;
          // `ready ?? undefined` — the `undefined` side is unreachable: this line
          // only runs when `ready?.readyState === 'ERROR'` just matched, which
          // requires `ready` itself to already be a real object (optional
          // chaining on a null/undefined `ready` would make the whole comparison
          // `undefined === 'ERROR'`, i.e. false, skipping this block entirely).
          // So by the time `ready ?? undefined` evaluates, `ready` is always
          // truthy and the `??` is a no-op at runtime. Kept (not simplified to
          // just `ready`) purely for type-level reasons: `ready`'s static type is
          // `JsonObject | null` (from `pollVercelDeployment`'s return type /
          // `created`'s), and `DeployError`'s `details` parameter accepts
          // `JsonObject | string | undefined` — not `null` — so this coalesce is
          // a compile-time-required null-to-undefined conversion that TypeScript's
          // control-flow analysis cannot narrow away just from the optional-chained
          // comparison above. See packages/devops/source-map.md's 2026-07-22
          // addition for the full re-derivation.
          throw new DeployError(readyError?.message || 'Vercel deployment failed.', 502, ready ?? undefined);
      }
      return ready;
  }
  async function publicVercelLink({ name, ready, created, initialUrl, publicUrl }, _options = {}) {
      const aliases = deploymentUrlCandidates(`${name}.vercel.app`, ready, created);
      const candidates = publicUrl ? [publicUrl, ...aliases.filter(alias => alias !== publicUrl)] : aliases;
      let link = await waitForReachableDeploymentUrl(candidates.length ? candidates : [initialUrl], {
          providerLabel: 'Vercel',
          detectProtected: isVercelProtectedResponse,
          protectedMessage: VERCEL_PROTECTED_MESSAGE,
      });
      // The kit counts any 3xx as reachable, but Deployment Protection answers a per-deployment
      // URL with a redirect to Vercel's login, which is not a public link.
      if (link.status === 'ready' && await redirectsToVercelLogin(link.url)) {
          link = { status: 'protected', url: link.url, statusMessage: VERCEL_PROTECTED_MESSAGE };
      }
      return link;
  }
  /** One HEAD, redirects not followed: does `url` send visitors to Vercel's SSO/login wall? Any
   *  failure answers `false`, leaving the reachability result as it was. */
  async function redirectsToVercelLogin(url) {
      try {
          const resp = await fetchWithTimeout(url, { method: 'HEAD', redirect: 'manual' }, { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
          await resp.arrayBuffer().catch(() => undefined);
          return resp.status >= 300 && resp.status < 400 && /vercel\.com\/(sso-api|login)/i.test(resp.headers.get('location') || '');
      }
      catch {
          return false;
      }
  }
  async function createVercelDeployment(config, body) {
      const resp = await fetchWithTimeout(`${VERCEL_API}/v13/deployments${vercelTeamQuery(config)}`, redirectGuardInit({
          method: 'POST',
          headers: {
              Authorization: `Bearer ${config.token}`,
              'Content-Type': 'application/json',
          },
          body,
      }), { timeoutMs: FETCH_TIMEOUT_MS.UPLOAD });
      assertNotRedirected(resp, 'Vercel deployment creation');
      return resp;
  }
  /**
   * Uploads `shas` (keys of `blobs`) to `POST /v2/files`, {@link VERCEL_UPLOAD_CONCURRENCY} at a
   * time. The first failure stops the remaining queue and rejects.
   *
   * @complexity O(n) requests, plus at most `VERCEL_UPLOAD_ATTEMPTS - 1` retries each.
   */
  async function uploadVercelFiles(config, blobs, shas) {
      const queue = [...shas];
      const worker = async () => {
          while (queue.length) {
              const sha = queue.shift();
              try {
                  await uploadVercelFile(config, sha, blobs.get(sha));
              }
              catch (err) {
                  queue.length = 0;
                  throw err;
              }
          }
      };
      await Promise.all(Array.from({ length: Math.min(VERCEL_UPLOAD_CONCURRENCY, queue.length) }, worker));
  }
  function vercelUploadTransportError({ err }, _options = {}) {
      // Node's fetch reports every transport failure as a bare "fetch failed"; the cause (a
      // reset socket, a TLS or DNS error) is the only part that says what happened.
      const cause = err?.cause?.message || err?.cause?.code;
      const detail = cause ? ` (${cause})` : '';
      return new DeployError(`Vercel file upload failed: ${err?.message ?? err}${detail}`, 502);
  }
  async function tryVercelFileUpload({ config, sha, data, attempt }, _options = {}) {
      try {
          return await fetchWithTimeout(`${VERCEL_API}/v2/files${vercelTeamQuery(config)}`, redirectGuardInit({
              method: 'POST',
              headers: {
                  Authorization: `Bearer ${config.token}`,
                  'Content-Type': 'application/octet-stream',
                  'Content-Length': String(data.length),
                  'x-vercel-digest': sha,
              },
              body: data,
          }), { timeoutMs: FETCH_TIMEOUT_MS.UPLOAD });
      }
      catch (err) {
          // A dropped connection is retried like a 5xx (the first real plannie publish lost one of
          // ~200 uploads that way); a timeout is not, since each try already waited the full bound.
          if (attempt < VERCEL_UPLOAD_ATTEMPTS && !/timed out/i.test(String(err?.message))) {
              await sleep(1000 * attempt);
              return undefined;
          }
          throw vercelUploadTransportError({ err });
      }
  }
  async function uploadVercelFile(config, sha, data) {
      for (let attempt = 1; ; attempt += 1) {
          const resp = await tryVercelFileUpload({ config, sha, data, attempt });
          if (resp === undefined) continue;
          assertNotRedirected(resp, 'Vercel file upload');
          if (resp.ok) {
              // Drain the small JSON ack so the connection goes back to the pool.
              await resp.arrayBuffer().catch(() => undefined);
              return;
          }
          if (attempt < VERCEL_UPLOAD_ATTEMPTS && (resp.status === 429 || resp.status >= 500)) {
              await resp.arrayBuffer().catch(() => undefined);
              await sleep(1000 * attempt);
          } else {
              throw vercelError(await readVercelJson(resp), resp.status);
          }
      }
  }
  /**
   * Polls a just-created Vercel deployment until it reaches a terminal
   * `readyState` (`READY`/`ERROR`) or the fixed 30-attempt budget is spent
   * (~1s for the first 5 attempts, 2s thereafter — roughly a minute).
   *
   * A response this file cannot parse as JSON is treated as "keep polling,"
   * not an error — same reasoning as `github-pages.ts`'s `pollGitHubPagesBuild`
   * (fixed 2026-08-16 for the identical bug class): the deployment already
   * exists server-side by the time this loop runs (the create call above
   * already succeeded), so a transient/edge/empty poll response is exactly as
   * uninformative as a stuck in-progress state, never a reason to report an
   * already-created deployment as failed. Any other non-2xx response whose
   * body DID parse still fails fast, unchanged.
   *
   * @complexity O(30) network round-trips, bounded and fixed regardless of input size.
   * @overallScore 90/100
   * @tradeoffs Fixed attempt/backoff constants (lifted verbatim from the OD
   *   origin) rather than caller-configurable ones — acceptable for now since
   *   `publish` has no caller-facing timeout knob yet either; flagged as a
   *   minor extensibility gap rather than a correctness issue.
   */
  async function pollVercelDeployment(config, id) {
      let last = null;
      for (let i = 0; i < 30; i += 1) {
          await sleep(i < 5 ? 1000 : 2000);
          const resp = await fetchWithTimeout(`${VERCEL_API}/v13/deployments/${encodeURIComponent(id)}${vercelTeamQuery(config)}`, redirectGuardInit({ headers: { Authorization: `Bearer ${config.token}` } }), { timeoutMs: FETCH_TIMEOUT_MS.DEPLOY });
          assertNotRedirected(resp, 'Vercel deployment status poll');
          let json;
          try {
              json = await readVercelJson(resp);
          }
          catch {
              // Nothing usable to report yet — keep polling within the same fixed budget
              // rather than turning an ambiguous mid-poll hiccup into a reported failure.
              continue;
          }
          if (!resp.ok)
              throw vercelError(json, resp.status);
          last = json;
          if (json.readyState === 'READY' || json.readyState === 'ERROR')
              return json;
      }
      return last;
  }
  function vercelTeamQuery(config) {
      const params = new URLSearchParams();
      if (config.teamId)
          params.set('teamId', config.teamId);
      else if (config.teamSlug)
          params.set('slug', config.teamSlug);
      else {
          // Personal deployments need no team query parameter.
      }
      const s = params.toString();
      return s ? `?${s}` : '';
  }
  /**
   * Derives a Vercel-safe project name from a caller-supplied label, falling
   * back to a random id if the label sanitizes to nothing. Replaces the OD
   * origin's hardcoded `od-${projectId}` convention.
   */
  function safeVercelProjectName(projectName) {
      return safeProjectLabel(projectName, 80) || `deploy-${randomInt(36 ** 8).toString(36).padStart(8, '0')}`;
  }
  async function readVercelJson(resp) {
      try {
          return (await resp.json());
      }
      catch {
          throw new DeployError('Vercel returned a non-JSON response.', resp.status || 502);
      }
  }
  function vercelErrorField({ json, field }, _options = {}) {
      return json?.error && typeof json.error === 'object' ? json.error[field] : undefined;
  }
  function vercelError(json, status) {
      const code = vercelErrorField({ json, field: 'code' });
      const message = vercelErrorField({ json, field: 'message' }) ||
          json?.message ||
          `Vercel request failed (${status}).`;
      if (code === 'forbidden' || /permission/i.test(String(message))) {
          return new DeployError("You don't have permission to create a project.", status, json);
      }
      return new DeployError(String(message), status, json);
  }
  function deploymentUrl(json) {
      const url = json?.url || json?.alias?.[0] || '';
      if (!url)
          return '';
      return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }
  function appendDeploymentAlias({ alias, urls }, _options = {}) {
      if (typeof alias === 'string') {
          urls.push(alias);
          return;
      }
      if (alias && typeof alias === 'object') {
          const a = alias;
          if (typeof a.domain === 'string')
              urls.push(a.domain);
          else if (typeof a.url === 'string')
              urls.push(a.url);
          else {
              // Objects without a domain or URL are not deployment aliases.
          }
      }
  }
  function appendDeploymentAliases({ json, urls }, _options = {}) {
      for (const alias of json.alias ?? []) {
          if (typeof alias === 'string')
              urls.push(alias);
      }
      for (const alias of json.aliases ?? []) {
          appendDeploymentAlias({ alias, urls });
      }
  }
  /**
   * `if (!json) continue` skips a response that is not there. Of this file's one call site,
   * `deploymentUrlCandidates(publicHost, ready, created)` in `publish()`, `created` is always a parsed
   * `JsonObject` (`readVercelJson` returns one or throws), but `ready` is `null` when every one of
   * `pollVercelDeployment`'s 30 status reads was unparseable (each such read is skipped with
   * `continue`, so `last` is never assigned) — then only `created` supplies candidates. Same guard
   * `netlify.ts`'s own `netlifyUrlCandidates` keeps for the same reason.
   */
  function deploymentUrlCandidates(publicHost, ...responses) {
      // Aliases (the production `<project>.vercel.app` among them) are tried before `url`: `url` is the
      // per-deployment address, which Deployment Protection puts behind Vercel's login by default.
      const urls = [];
      const deploymentUrls = [];
      for (const json of responses) {
          if (!json)
              continue;
          if (typeof json.url === 'string')
              deploymentUrls.push(json.url);
          appendDeploymentAliases({ json, urls });
      }
      const candidates = [...new Set([...urls, ...deploymentUrls].map(normalizeDeploymentUrl).filter(Boolean))];
      // The public `<project>.vercel.app` alias goes first when Vercel lists it. Vercel orders aliases
      // its own way, so the team-scoped `<project>-<team>.vercel.app` (behind Deployment Protection)
      // can come first, and the reachability wait stops at the first `protected` answer: a publish
      // whose public alias served 200 was reported `protected` (2026-10-11).
      const publicUrl = normalizeDeploymentUrl(publicHost);
      return candidates.includes(publicUrl) ? [publicUrl, ...candidates.filter((url) => url !== publicUrl)] : candidates;
  }

  return { VercelDeployTarget, isVercelProtectedResponse };
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

/**
 * The token's account `user.username` from a `GET /v2/user` body, or `undefined`. Reads no other field.
 * @param {unknown} body
 * @returns {string | undefined}
 */
function readVercelUsername(body) {
  const user = typeof body === "object" && body !== null ? /** @type {Record<string, unknown>} */ (body).user : undefined;
  const username = typeof user === "object" && user !== null ? /** @type {Record<string, unknown>} */ (user).username : undefined;
  return typeof username === "string" && username !== "" ? username : undefined;
}

/** The module contract a host's deploy-target registry loads (`DeployTargetModule`). The one config
 *  field is the optional Vercel `teamId`. */
export default {
  /** @param {{ credential: { token: string }, config: { teamId?: string }, kit: any }} context */
  create({ credential, config, kit }) {
    const { VercelDeployTarget } = bindVercel(kit);
    return new VercelDeployTarget({ token: credential.token, ...(typeof config.teamId === "string" ? { teamId: config.teamId } : {}) });
  },
  /**
   * `GET /v2/user`: 401/403 for a bad token. Reads back only `user.username`, required on both body
   * shapes Vercel's OpenAPI schema declares and public (`vercel.com/<username>`), never email,
   * billing or `defaultTeamId`.
   * @param {{ credential: { token: string }, kit: any }} context
   */
  async verifyCredential({ credential, kit }) {
    const response = await kit.fetch("https://api.vercel.com/v2/user", { headers: { Authorization: `Bearer ${credential.token}` } }, { timeoutMs: kit.timeouts.QUICK });
    const check = classifyCredentialResponse(response);
    if (!check.ok) return check;
    return { ok: true, accountLabel: readVercelUsername(await response.json().catch(() => undefined)) };
  },
  /** @param {{ teamId?: unknown }} config */
  validateConfig(config) {
    if (typeof config.teamId === "string" && config.teamId.trim() === "") return "teamId must not be blank when provided";
    return null;
  },
  basePath() {
    return undefined;
  },
};
