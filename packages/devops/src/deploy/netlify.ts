import { createHash } from 'node:crypto';
import { checkDeploymentUrl, normalizeDeploymentUrl, waitForReachableDeploymentUrl } from './reachability.js';
import { safeDnsLabel } from './naming.js';
import {
  DeployError,
  type DeployFile,
  type DeployPublishInput,
  type DeployPublishResult,
  type DeployTarget,
  type DeploymentUrlCheck,
  type JsonObject,
} from './types.js';

export const NETLIFY_TARGET_ID = 'netlify';

const NETLIFY_API = 'https://api.netlify.com/api/v1';

/**
 * Deploy states enumerated by the Netlify API's own `GET /sites/{site_id}/deploys`
 * `state` query-filter (the canonical source for this field's real values —
 * the deploy object's own schema types `state` as a bare `string` with no
 * inline enum). `'ready'` is the only success terminal state; `'error'` and
 * `'rejected'` are the only failure terminal states. Every other value
 * (`'new'`, `'pending_review'`, `'accepted'`, `'enqueued'`, `'building'`,
 * `'uploading'`, `'uploaded'`, `'preparing'`, `'prepared'`, `'processing'`,
 * `'processed'`, `'retrying'`) is an in-progress state this module keeps
 * polling through.
 */
const NETLIFY_FAILURE_STATES = new Set(['error', 'rejected']);

/** Auth config a caller supplies when constructing a `NetlifyDeployTarget`. */
export interface NetlifyDeployConfig {
  token: string;
}

/**
 * `DeployTarget` adapter for Netlify's digest-based deploy API: find-or-create
 * a site for the caller's `projectName`, create a deploy from a SHA1 file
 * manifest, upload whichever files Netlify reports as `required`, poll until
 * the deploy reaches a terminal `state`, then wait for the resulting URL to
 * become publicly reachable.
 *
 * No OD origin — `apps/daemon/src/deploy.ts` never implemented a Netlify
 * target (only `vercel-self` and `cloudflare-pages` exist there); this is new
 * work built directly against Netlify's own published OpenAPI contract
 * (`https://open-api.netlify.com`), following the same `DeployTarget` shape
 * `vercel.ts`/`cloudflare-pages.ts` already establish. See `source-map.md`'s
 * 2026-07-21 addition for the exact endpoints/fields this was built from.
 */
export class NetlifyDeployTarget implements DeployTarget {
  readonly id = NETLIFY_TARGET_ID;

  constructor(private readonly config: NetlifyDeployConfig) {}

  /**
   * Publishes `input.files` as a new Netlify deploy (creating the target site
   * on first use) and waits for the resulting URL to be reachable.
   *
   * @param input - File set plus a caller-chosen project name label.
   * @returns The published deploy's URL/status once Netlify has a terminal
   *   `state` (or the poll budget is exhausted).
   * @throws {DeployError} If `config.token` is missing, the site cannot be
   *   found/created, or Netlify reports a terminal failure state
   *   (`'error'`/`'rejected'`).
   */
  async publish(input: DeployPublishInput): Promise<DeployPublishResult> {
    if (!this.config.token) {
      throw new DeployError('Netlify token is required.', 400);
    }
    const siteName = deriveNetlifySiteName(input.projectName);
    if (!siteName) {
      throw new DeployError('Netlify site name could not be generated.', 400);
    }

    const site = await ensureNetlifySite(this.config, siteName);
    const siteId = typeof site.id === 'string' ? site.id : '';
    if (!siteId) {
      throw new DeployError('Netlify site response did not include an id.', 502, site);
    }

    const { created, byHash } = await createNetlifyDeploy(this.config, siteId, input.files);
    const deployId = typeof created.id === 'string' ? created.id : '';
    if (!deployId) {
      throw new DeployError('Netlify deploy response did not include an id.', 502, created);
    }

    const required = Array.isArray(created.required) ? (created.required as unknown[]).filter((h): h is string => typeof h === 'string') : [];
    for (const hash of required) {
      const file = byHash.get(hash);
      // A hash Netlify asked for but that isn't in our own manifest should
      // never happen (`required` is derived from the manifest we just sent),
      // but skip defensively rather than crash the whole publish over it.
      if (!file) continue;
      await uploadNetlifyFile(this.config, deployId, file);
    }

    const finalState = await pollNetlifyDeploy(this.config, deployId);
    if (finalState && NETLIFY_FAILURE_STATES.has(String(finalState.state))) {
      throw new DeployError(
        (typeof finalState.error_message === 'string' && finalState.error_message) || `Netlify deployment ${finalState.state}.`,
        502,
        finalState,
      );
    }

    const candidates = netlifyUrlCandidates(finalState, site);
    const link = await waitForReachableDeploymentUrl(candidates, { providerLabel: 'Netlify' });

    return {
      targetId: this.id,
      url: link.url || candidates[0] || '',
      deploymentId: deployId,
      status: link.status,
      statusMessage: link.statusMessage,
      ...(link.reachableAt !== undefined ? { reachableAt: link.reachableAt } : {}),
      providerMetadata: { siteId, siteName },
    };
  }

  /** Probes `url` with the shared reachability checker (no Netlify-specific auth-wall detection is needed/documented). */
  async checkReachability(url: string): Promise<DeploymentUrlCheck> {
    return checkDeploymentUrl(url);
  }
}

/**
 * Derives a stable, Netlify-site-name-safe label from the caller's
 * `projectName`. Deterministic (no random suffix) so repeated publishes of
 * the same logical project land on the same Netlify site — same shape as
 * `cloudflare-pages.ts`'s `deriveCloudflarePagesProjectName`.
 */
function deriveNetlifySiteName(projectName: string): string {
  const label = safeDnsLabel(projectName) || 'site';
  return safeDnsLabel(`jini-${label}`).slice(0, 63);
}

function netlifyHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

async function readNetlifyJson<T>(resp: Response): Promise<T> {
  try {
    return (await resp.json()) as T;
  } catch {
    throw new DeployError('Netlify returned a non-JSON response.', resp.status || 502);
  }
}

/**
 * `fallback || \`Netlify request failed (${status}).\`` (the template
 * literal half) is unreachable today: every one of this file's 5 call
 * sites passes a non-empty string literal for `fallback` ('Netlify site
 * lookup failed.', 'Netlify site creation failed.', 'Netlify deploy
 * creation failed.', the per-file upload message, 'Netlify deploy status
 * check failed.') — `fallback` is never derived from network/config input,
 * so it cannot vary at runtime, and this right-hand operand can never be
 * selected. Verified by reading every call site, not just "not covered".
 * Left as-is (not deleted) because `netlifyError` is a general-purpose
 * formatter, not written solely for today's 5 callers, and this is the
 * sane-default guard a future caller forgetting to pass `fallback` would
 * fall through to.
 */
function netlifyError(json: JsonObject, status: number, fallback: string): DeployError {
  const message = typeof json?.message === 'string' && json.message ? json.message : fallback || `Netlify request failed (${status}).`;
  return new DeployError(message, status, json);
}

/** Looks up an existing site by its exact (case-insensitive) name within the caller's own account. */
async function findNetlifySiteByName(config: NetlifyDeployConfig, name: string): Promise<JsonObject | undefined> {
  const url = `${NETLIFY_API}/sites?${new URLSearchParams({ name, filter: 'all' }).toString()}`;
  const resp = await fetch(url, { headers: netlifyHeaders(config.token) });
  const body = await readNetlifyJson<unknown>(resp);
  if (!resp.ok) {
    throw netlifyError(Array.isArray(body) ? {} : (body as JsonObject), resp.status, 'Netlify site lookup failed.');
  }
  const list = Array.isArray(body) ? (body as JsonObject[]) : [];
  return list.find((site) => typeof site?.name === 'string' && (site.name as string).toLowerCase() === name.toLowerCase());
}

async function createNetlifySite(config: NetlifyDeployConfig, name: string): Promise<JsonObject> {
  const resp = await fetch(`${NETLIFY_API}/sites`, {
    method: 'POST',
    headers: netlifyHeaders(config.token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name }),
  });
  const body = await readNetlifyJson<JsonObject>(resp);
  if (!resp.ok) throw netlifyError(body, resp.status, 'Netlify site creation failed.');
  return body;
}

/**
 * Finds the site for `name`, creating it on first use. Netlify site names
 * are globally unique (not scoped to one account), so a creation conflict is
 * ambiguous: it may mean *this* account already owns the name (a benign
 * create/create race — recoverable by re-listing), or that a different
 * account owns it outright (not recoverable). Re-checking the caller's own
 * account's sites after a failed create distinguishes the two: found → use
 * it; still not found → rethrow the original creation error.
 */
async function ensureNetlifySite(config: NetlifyDeployConfig, name: string): Promise<JsonObject> {
  const existing = await findNetlifySiteByName(config, name);
  if (existing) return existing;
  try {
    return await createNetlifySite(config, name);
  } catch (err) {
    const retry = await findNetlifySiteByName(config, name);
    if (retry) return retry;
    throw err;
  }
}

function sha1Hex(data: Buffer | Uint8Array | string): string {
  return createHash('sha1').update(Buffer.from(data)).digest('hex');
}

/** URL-encodes each path segment individually so directory separators survive but special characters in a single segment don't. */
function encodeNetlifyFilePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

/**
 * Creates a Netlify deploy from an async SHA1 file-digest manifest. Returns
 * both the raw created-deploy response and a hash→file lookup so the caller
 * can resolve whichever hashes Netlify reports back as `required` to upload.
 */
async function createNetlifyDeploy(
  config: NetlifyDeployConfig,
  siteId: string,
  files: DeployFile[],
): Promise<{ created: JsonObject; byHash: Map<string, DeployFile> }> {
  const manifest: Record<string, string> = {};
  const byHash = new Map<string, DeployFile>();
  for (const file of files) {
    const hash = sha1Hex(file.data);
    manifest[`/${file.file}`] = hash;
    if (!byHash.has(hash)) byHash.set(hash, file);
  }

  const resp = await fetch(`${NETLIFY_API}/sites/${encodeURIComponent(siteId)}/deploys`, {
    method: 'POST',
    headers: netlifyHeaders(config.token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ async: true, files: manifest }),
  });
  const created = await readNetlifyJson<JsonObject>(resp);
  if (!resp.ok) throw netlifyError(created, resp.status, 'Netlify deploy creation failed.');
  return { created, byHash };
}

async function uploadNetlifyFile(config: NetlifyDeployConfig, deployId: string, file: DeployFile): Promise<void> {
  const resp = await fetch(`${NETLIFY_API}/deploys/${encodeURIComponent(deployId)}/files/${encodeNetlifyFilePath(file.file)}`, {
    method: 'PUT',
    headers: netlifyHeaders(config.token, { 'Content-Type': file.contentType || 'application/octet-stream' }),
    body: Buffer.from(file.data),
  });
  if (!resp.ok) {
    const body = await readNetlifyJson<JsonObject>(resp).catch(() => ({}) as JsonObject);
    throw netlifyError(body, resp.status, `Netlify file upload failed for "${file.file}".`);
  }
}

/**
 * Polls a just-created Netlify deploy until it reaches a terminal `state`
 * (`'ready'` or one of {@link NETLIFY_FAILURE_STATES}) or the fixed
 * 30-attempt budget is spent (~1s for the first 5 attempts, 2s thereafter —
 * roughly a minute) — same attempt/backoff shape as `vercel.ts`'s
 * `pollVercelDeployment`, for consistency across this package's targets.
 */
async function pollNetlifyDeploy(config: NetlifyDeployConfig, deployId: string): Promise<JsonObject | null> {
  let last: JsonObject | null = null;
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, i < 5 ? 1000 : 2000));
    const resp = await fetch(`${NETLIFY_API}/deploys/${encodeURIComponent(deployId)}`, {
      headers: netlifyHeaders(config.token),
    });
    const json = await readNetlifyJson<JsonObject>(resp);
    if (!resp.ok) throw netlifyError(json, resp.status, 'Netlify deploy status check failed.');
    last = json;
    if (json.state === 'ready' || NETLIFY_FAILURE_STATES.has(String(json.state))) return json;
  }
  return last;
}

/**
 * Collects candidate public URLs from a deploy/site response, preferring the HTTPS site URL over the deploy-specific one.
 *
 * `if (!json) continue` is unreachable via this file's one call site,
 * `netlifyUrlCandidates(finalState, site)` in `publish()`: `finalState`
 * comes from `pollNetlifyDeploy`, whose 30-iteration loop (`i < 30` with
 * `i` starting at 0) always runs at least once and unconditionally assigns
 * `last` before any return, so it can only resolve to a real `JsonObject`
 * or throw — never resolve to `null`; `site` comes from `ensureNetlifySite`,
 * which always returns a `JsonObject` (never null/undefined), and `publish()`
 * additionally guards it with a `!siteId` check right after. The `| null |
 * undefined` in this function's own parameter type is deliberately wider
 * than what its only caller can ever supply, so this stays real
 * defense-in-depth for a general-purpose variadic helper rather than dead
 * weight worth deleting.
 */
function netlifyUrlCandidates(...responses: (JsonObject | null | undefined)[]): string[] {
  const urls: string[] = [];
  for (const json of responses) {
    if (!json) continue;
    if (typeof json.ssl_url === 'string') urls.push(json.ssl_url);
    if (typeof json.url === 'string') urls.push(json.url);
    if (typeof json.deploy_ssl_url === 'string') urls.push(json.deploy_ssl_url);
    if (typeof json.deploy_url === 'string') urls.push(json.deploy_url);
  }
  return [...new Set(urls.map(normalizeDeploymentUrl).filter(Boolean))];
}
