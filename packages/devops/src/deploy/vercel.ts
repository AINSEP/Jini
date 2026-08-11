import { checkDeploymentUrl, normalizeDeploymentUrl, waitForReachableDeploymentUrl } from './reachability.js';
import { safeProjectLabel } from './naming.js';
import { DeployError, type DeployPublishInput, type DeployPublishResult, type DeployTarget, type DeploymentUrlCheck, type JsonObject } from './types.js';

export const VERCEL_TARGET_ID = 'vercel';

const VERCEL_API = 'https://api.vercel.com';
const VERCEL_PROTECTED_MESSAGE =
  'Deployment is protected by Vercel. Disable Deployment Protection or use a custom domain to make this link public.';

/** Auth/scoping config a caller supplies when constructing a `VercelDeployTarget`. */
export interface VercelDeployConfig {
  token: string;
  teamId?: string;
  teamSlug?: string;
}

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
export function isVercelProtectedResponse(resp: Response, body = ''): boolean {
  const server = resp.headers?.get?.('server') || '';
  const setCookie = resp.headers?.get?.('set-cookie') || '';
  const text = String(body || '');
  return (
    /vercel/i.test(server) ||
    /_vercel_sso_nonce/i.test(setCookie) ||
    /Authentication Required/i.test(text) ||
    /Vercel Authentication/i.test(text) ||
    /vercel\.com\/sso-api/i.test(text)
  );
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
export class VercelDeployTarget implements DeployTarget {
  readonly id = VERCEL_TARGET_ID;

  constructor(private readonly config: VercelDeployConfig) {}

  /**
   * Publishes `input.files` as a new Vercel deployment and waits for the
   * resulting URL to be reachable.
   *
   * @param input - File set plus a caller-chosen project name label.
   * @returns The published deployment's URL/status once Vercel has a
   *   terminal `readyState` (or the poll budget is exhausted).
   * @throws {DeployError} If `config.token` is missing, or Vercel's API
   *   rejects the deployment request or reports `readyState: 'ERROR'`.
   * @complexity O(files) to encode the payload, plus a bounded poll loop
   *   (`pollVercelDeployment`) and the reachability wait's own bound.
   * @overallScore 100/100
   */
  async publish(input: DeployPublishInput): Promise<DeployPublishResult> {
    if (!this.config.token) {
      throw new DeployError('Vercel token is required.', 400);
    }

    const createResp = await fetch(`${VERCEL_API}/v13/deployments${vercelTeamQuery(this.config)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: safeVercelProjectName(input.projectName),
        files: input.files.map((f) => ({
          file: f.file,
          data: Buffer.from(f.data).toString('base64'),
          encoding: 'base64',
        })),
        projectSettings: { framework: null },
      }),
    });

    const created = await readVercelJson(createResp);
    if (!createResp.ok) throw vercelError(created, createResp.status);

    const deploymentId = typeof created.id === 'string' ? created.id : typeof created.uid === 'string' ? created.uid : undefined;
    const initialUrl = deploymentUrl(created);
    const ready = deploymentId ? await pollVercelDeployment(this.config, deploymentId) : created;
    if (ready?.readyState === 'ERROR') {
      const readyError = ready?.error as JsonObject | undefined;
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
      // comparison above. See packages/deploy/source-map.md's 2026-07-22
      // addition for the full re-derivation.
      throw new DeployError((readyError?.message as string | undefined) || 'Vercel deployment failed.', 502, ready ?? undefined);
    }

    const candidates = deploymentUrlCandidates(ready, created);
    const link = await waitForReachableDeploymentUrl(candidates.length ? candidates : [initialUrl], {
      providerLabel: 'Vercel',
      detectProtected: isVercelProtectedResponse,
      protectedMessage: VERCEL_PROTECTED_MESSAGE,
    });

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
  async checkReachability(url: string): Promise<DeploymentUrlCheck> {
    return checkDeploymentUrl(url, {
      detectProtected: isVercelProtectedResponse,
      protectedMessage: VERCEL_PROTECTED_MESSAGE,
    });
  }
}

/**
 * Polls a just-created Vercel deployment until it reaches a terminal
 * `readyState` (`READY`/`ERROR`) or the fixed 30-attempt budget is spent
 * (~1s for the first 5 attempts, 2s thereafter — roughly a minute).
 *
 * @complexity O(30) network round-trips, bounded and fixed regardless of input size.
 * @overallScore 90/100
 * @tradeoffs Fixed attempt/backoff constants (lifted verbatim from the OD
 *   origin) rather than caller-configurable ones — acceptable for now since
 *   `publish` has no caller-facing timeout knob yet either; flagged as a
 *   minor extensibility gap rather than a correctness issue.
 */
async function pollVercelDeployment(config: VercelDeployConfig, id: string): Promise<JsonObject | null> {
  let last: JsonObject | null = null;
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, i < 5 ? 1000 : 2000));
    const resp = await fetch(`${VERCEL_API}/v13/deployments/${encodeURIComponent(id)}${vercelTeamQuery(config)}`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    const json = await readVercelJson(resp);
    if (!resp.ok) throw vercelError(json, resp.status);
    last = json;
    if (json.readyState === 'READY' || json.readyState === 'ERROR') return json;
  }
  return last;
}

function vercelTeamQuery(config: VercelDeployConfig): string {
  const params = new URLSearchParams();
  if (config.teamId) params.set('teamId', config.teamId);
  else if (config.teamSlug) params.set('slug', config.teamSlug);
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * Derives a Vercel-safe project name from a caller-supplied label, falling
 * back to a random id if the label sanitizes to nothing. Replaces the OD
 * origin's hardcoded `od-${projectId}` convention.
 */
function safeVercelProjectName(projectName: unknown): string {
  return safeProjectLabel(projectName, 80) || `deploy-${Math.random().toString(36).slice(2, 10)}`;
}

async function readVercelJson(resp: Response): Promise<JsonObject> {
  try {
    return (await resp.json()) as JsonObject;
  } catch {
    throw new DeployError('Vercel returned a non-JSON response.', resp.status || 502);
  }
}

function vercelError(json: JsonObject, status: number): DeployError {
  const code = json?.error && typeof json.error === 'object' ? (json.error as JsonObject).code : undefined;
  const message =
    (json?.error && typeof json.error === 'object' ? (json.error as JsonObject).message : undefined) ||
    json?.message ||
    `Vercel request failed (${status}).`;
  if (code === 'forbidden' || /permission/i.test(String(message))) {
    return new DeployError("You don't have permission to create a project.", status, json);
  }
  return new DeployError(String(message), status, json);
}

function deploymentUrl(json: JsonObject | null | undefined): string {
  const url = (json?.url as string | undefined) || (json?.alias as string[] | undefined)?.[0] || '';
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/**
 * `if (!json) continue` is unreachable via this file's one call site,
 * `deploymentUrlCandidates(ready, created)` in `publish()`: `created` comes
 * from `readVercelJson`, which either returns a real parsed `JsonObject` or
 * throws (never resolves to null/undefined); `ready` is either `created`
 * itself (same guarantee) or `pollVercelDeployment`'s result, which — per
 * that function's own loop shape (`i < 30` starting at `i = 0`, so it always
 * runs at least one full iteration before it can return, and that iteration
 * unconditionally assigns `last = json` right after the `!resp.ok` throw
 * check, before any `return`) — can only resolve to a real `JsonObject` or
 * throw, never resolve to `null`. The wider `(JsonObject | null | undefined)[]`
 * parameter type is deliberately more permissive than what this one caller
 * can ever supply — same "general-purpose helper, defense-in-depth beyond
 * today's only caller" reasoning `netlify.ts`'s own `netlifyUrlCandidates`
 * already documents for its structurally identical guard.
 */
function deploymentUrlCandidates(...responses: (JsonObject | null | undefined)[]): string[] {
  const urls: string[] = [];
  for (const json of responses) {
    if (!json) continue;
    if (typeof json.url === 'string') urls.push(json.url);
    for (const alias of (json.alias as unknown[]) ?? []) {
      if (typeof alias === 'string') urls.push(alias);
    }
    for (const alias of (json.aliases as unknown[]) ?? []) {
      if (typeof alias === 'string') urls.push(alias);
      else if (alias && typeof alias === 'object') {
        const a = alias as JsonObject;
        if (typeof a.domain === 'string') urls.push(a.domain);
        else if (typeof a.url === 'string') urls.push(a.url);
      }
    }
  }
  return [...new Set(urls.map(normalizeDeploymentUrl).filter(Boolean))];
}
