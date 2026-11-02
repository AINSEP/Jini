import { createSign } from "node:crypto";

/**
 * @file The first-party `github` deployment provider — GitHub App installation auth over the
 * guarded ADR-038 `HttpClientPort`.
 *
 * Why a GitHub App and not `gh` or a stored PAT (ADS deployments debate, all three rounds, 5/5):
 * a PAT is a long-lived, human-scoped credential with no per-workspace or per-repository boundary
 * in a multi-tenant process; `gh` inherits whatever credential is on the host's global config and
 * bypasses the guarded HTTP client entirely. A GitHub App installation token is narrowable to one
 * repository and one permission (`deployments: write`) at mint time, and expires in exactly one
 * hour regardless of caller-supplied TTL — verified against
 * docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app. The App JWT
 * used to mint it must be RS256 with `exp` no more than ten minutes past `iat` — verified against
 * docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app.
 *
 * `EgressPolicy` cannot pin a host — see the host deployment port's file header. `sendPinned` below is this
 * file's answer: the ONLY function allowed to call `http.send`, and it refuses anything whose
 * resolved origin is not exactly `https://api.github.com`, so a malformed URL template (or a
 * future workspace-supplied GitHub Enterprise base URL, if that is ever added) fails closed instead
 * of silently reaching an arbitrary host.
 */

export const GITHUB_DEPLOYMENT_PROVIDER_ID = "github";

const GITHUB_API_ORIGIN = "https://api.github.com";
const API_VERSION = "2022-11-28";
const DEFAULT_TIMEOUT_MS = 10_000;

/** GitHub App JWTs: `exp` MUST be no more than 10 minutes past `iat` (verified — see file header).
 * 9 minutes leaves margin against clock drift between signing and GitHub's verification. */
const APP_JWT_TTL_SECONDS = 9 * 60;
/** GitHub's own guidance is to back-date `iat` by up to 60s to tolerate clock skew between this
 * process and GitHub's clock (verified — see file header). */
const APP_JWT_CLOCK_SKEW_SECONDS = 60;

function fail(
  code,
  message,
  optional = {}
) {
  return {
    code,
    message,
    retryable: optional.retryable ?? false,
    ...(optional.providerStatus === undefined ? {} : { providerStatus: optional.providerStatus }),
  };
}

/**
 * Reads and validates `target.config`'s three required GitHub-specific fields.
 *
 * @complexity O(1).
 */
function readGitHubTargetConfig(target) {
  const { owner, repo, environmentName } = target.config;
  if (typeof owner !== "string" || owner.length === 0) return null;
  if (typeof repo !== "string" || repo.length === 0) return null;
  if (typeof environmentName !== "string" || environmentName.length === 0) return null;
  return { owner, repo, environmentName };
}

/**
 * The origin pin. This is the ONLY call site for `http.send` in this file — every outbound request
 * (minting a token, creating a deployment, polling statuses) is routed through it. See the file
 * header for why this check cannot be delegated to `EgressPolicy`.
 *
 * Exported so this guard can be tested directly (see `../__tests__/deployments-provider.test.mjs`'s "sendPinned
 * refuses..." case) — every current call site builds its URL through `githubApiUrl()`, which
 * already can only resolve under `GITHUB_API_ORIGIN`, so an adapter-level test alone cannot prove
 * this check is load-bearing (confirmed by a mutation check: disabling it did not fail any
 * adapter-level test). This function is the actual safety boundary for a future call site that
 * builds a URL a different way — e.g. a workspace-supplied GitHub Enterprise base URL, if that is
 * ever added — so it must be proven correct on its own.
 *
 * @complexity O(1) beyond the underlying `http.send` call.
 */
export async function sendPinned(http, request) {
  const url = new URL(request.url);
  if (url.origin !== GITHUB_API_ORIGIN) {
    throw new Error(
      `github deployment adapter refused to send to '${url.origin}' — pinned to ${GITHUB_API_ORIGIN} only`
    );
  }
  return http.send(request);
}

/** Builds a same-origin URL from a path. Every caller-influenced path segment (owner, repo,
 * installation id, provider run ref) MUST already be `encodeURIComponent`-encoded before reaching
 * this function — encoding is what stops a value like `../../app/installations/1` from being
 * interpreted as a literal dot-segment and resolving outside the intended endpoint: RFC 3986
 * dot-segment removal only recognizes literal, unencoded `..` between `/` characters, never a
 * percent-encoded `%2E%2E`. */
function githubApiUrl(path) {
  return new URL(path, GITHUB_API_ORIGIN).toString();
}

function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "Tovu-CMS",
    "x-github-api-version": API_VERSION,
  };
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

/**
 * Signs a GitHub App JWT locally. The private key never leaves this process.
 *
 * @complexity O(1) (one RSA signature over a short, fixed-shape payload).
 */
function signGitHubAppJwt(input) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: input.issuedAt, exp: input.expiresAt, iss: input.appId }));
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(input.privateKeyPem)
    .toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function sanitizeMessage(value) {
  if (typeof value !== "string") return null;
  return value.replace(/[\r\n\0]/g, " ").slice(0, 500);
}

/**
 * Mints a short-lived App JWT, exchanges it for an installation access token narrowed to exactly
 * this installation's `deployments: write` permission. Minted fresh on every call rather than
 * cached: simpler and correct, at the cost of one extra round trip per deploy action — acceptable
 * given deploy actions are infrequent, not a hot path.
 *
 * @complexity One outbound HTTP request, hard-bounded by `DEFAULT_TIMEOUT_MS`.
 */
async function mintInstallationToken(
  http,
  credentials,
  nowMs
) {
  const now = Math.floor(nowMs() / 1000);
  const jwt = signGitHubAppJwt({
    appId: credentials.appId,
    privateKeyPem: credentials.privateKeyPem,
    issuedAt: now - APP_JWT_CLOCK_SKEW_SECONDS,
    expiresAt: now + APP_JWT_TTL_SECONDS,
  });

  let response;
  try {
    response = await sendPinned(http, {
      method: "POST",
      url: githubApiUrl(`/app/installations/${encodeURIComponent(credentials.installationId)}/access_tokens`),
      headers: { ...githubHeaders(jwt), "content-type": "application/json" },
      body: JSON.stringify({ permissions: { deployments: "write" } }),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch (err) {
    return { ok: false, error: fail("TRANSPORT_ERROR", err instanceof Error ? err.message : String(err), { retryable: true }) };
  }

  if (response.status >= 400) {
    return {
      ok: false,
      error: fail("PROVIDER_ERROR", `GitHub installation token exchange failed: ${response.status}`, {
        providerStatus: response.status,
        retryable: response.status >= 500,
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(response.bodyText);
  } catch {
    return { ok: false, error: fail("PROVIDER_RESPONSE_INVALID", "GitHub returned invalid JSON minting an installation token") };
  }
  // Token formats are opaque; do not assume a fixed prefix or length.
  if (typeof body.token !== "string" || body.token.length === 0) {
    return { ok: false, error: fail("PROVIDER_RESPONSE_INVALID", "GitHub returned an empty installation token") };
  }
  return { ok: true, token: body.token };
}

function requireCredentials(
  credentials
) {
  const { appId, installationId, privateKeyPem } = credentials;
  if (!appId || !installationId || !privateKeyPem) return null;
  return { appId, installationId, privateKeyPem };
}

/**
 * Sends the `POST .../deployments` call and validates its response — split out of `startRun` so
 * the pre-checks (target config, release shape, credentials) and the HTTP round-trip each carry
 * only their own branches. `release` is the two fields already narrowed out of
 * `input.release` by `startRun`'s own `kind !== "git-revision"` guard.
 */
async function createGitHubDeployment(
  ctx,
  token,
  config,
  release
) {
  let response;
  try {
    response = await sendPinned(ctx.httpClient, {
      method: "POST",
      url: githubApiUrl(`/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/deployments`),
      headers: { ...githubHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({
        ref: release.commitSha,
        environment: config.environmentName,
        description: `Tovu deployment of release ${release.releaseId}`,
        auto_merge: false,
        required_contexts: [],
        transient_environment: false,
        production_environment: config.environmentName === "production",
      }),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch (err) {
    return { ok: false, error: fail("TRANSPORT_ERROR", err instanceof Error ? err.message : String(err), { retryable: true }) };
  }

  if (response.status >= 400) {
    return {
      ok: false,
      error: fail("PROVIDER_ERROR", `GitHub deployment create failed: ${response.status}`, {
        providerStatus: response.status,
        retryable: response.status >= 500,
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(response.bodyText);
  } catch {
    return { ok: false, error: fail("PROVIDER_RESPONSE_INVALID", "GitHub returned invalid JSON creating a deployment") };
  }
  if (!Number.isSafeInteger(body.id) || (body.id) <= 0) {
    return { ok: false, error: fail("PROVIDER_RESPONSE_INVALID", "GitHub returned an invalid deployment id") };
  }

  return { ok: true, providerRunRef: String(body.id), reconciliation: "callback" };
}

/**
 * Creates a GitHub Deployment for an existing commit. Does NOT wait for (or fabricate) evidence
 * that a build or deploy has started — GitHub's own docs state it does not access or deploy to the
 * target servers itself; creating a deployment only dispatches a `deployment` event to whatever is
 * listening.
 *
 * @complexity Two outbound HTTP requests (mint token, create deployment), each hard-bounded by
 * `DEFAULT_TIMEOUT_MS`.
 */
async function startRun(input, ctx) {
  const config = readGitHubTargetConfig(input.target);
  if (!config) {
    return { ok: false, error: fail("INVALID_TARGET_CONFIG", "github target is missing owner/repo/environmentName") };
  }
  if (input.release.source.kind !== "git-revision") {
    // The honesty constraint, enforced at the one place it can be: this adapter promotes an
    // EXISTING commit. It cannot manufacture one from an "external-artifact" release — the host's CLI
    // has no build or export command.
    return {
      ok: false,
      error: fail("INVALID_RELEASE", "github deployment target requires a git-revision release (commit sha), not an external artifact"),
    };
  }
  const credentials = requireCredentials(ctx.credentials);
  if (!credentials) {
    return { ok: false, error: fail("NO_CREDENTIALS_CONFIGURED", "github deployment target is missing appId/installationId/privateKeyPem") };
  }

  const token = await mintInstallationToken(ctx.httpClient, credentials, ctx.now);
  if (!token.ok) return { ok: false, error: token.error };

  return createGitHubDeployment(ctx, token.token, config, {
    commitSha: input.release.source.commitSha,
    releaseId: input.release.id,
  });
}

/**
 * GitHub's real deployment-status `state` enum has SEVEN values — `error`, `failure`, `inactive`,
 * `in_progress`, `queued`, `pending`, `success` — verified against
 * docs.github.com/en/rest/deployments/statuses. Every value is handled explicitly here; an
 * unrecognized future value falls to `"running"` (never a terminal state), so it can never be
 * mistaken for success or a permanent failure.
 *
 * GitHub never fires a `deployment_status` WEBHOOK for `inactive` (verified against
 * docs.github.com/en/webhooks/webhook-events-and-payloads#deployment_status) — so this mapping is
 * the only place `inactive` is ever observed, and only via `pollRun`, never a callback.
 *
 * @complexity O(1).
 */
export function mapGitHubDeploymentStatus(status) {
  const providerStatusId = String(status.id);
  const message = sanitizeMessage(status.description);
  switch (status.state) {
    case "success":
      return { status: "succeeded", providerStatusId, message };
    case "failure":
    case "error":
      return { status: "failed", providerStatusId, message };
    case "inactive":
      return { status: "cancelled", providerStatusId, message };
    case "in_progress":
      return { status: "running", providerStatusId, message };
    case "queued":
    case "pending":
      return { status: "queued", providerStatusId, message };
    default:
      return { status: "running", providerStatusId, message };
  }
}

/**
 * Sends the `GET .../statuses` call and resolves the latest status from it — split out of
 * `pollRun` for the same "pre-checks vs. HTTP round-trip" reason as `createGitHubDeployment`. Does
 * NOT assume the response is newest-first — GitHub's docs describe pagination for this endpoint but
 * state no response order (verified against docs.github.com/en/rest/deployments/statuses). Status
 * ids are assigned monotonically, so the correct status is the one with the greatest `id`,
 * independent of array position.
 */
async function pollGitHubDeploymentStatuses(
  ctx,
  token,
  config,
  providerRunRef
) {
  let response;
  try {
    response = await sendPinned(ctx.httpClient, {
      method: "GET",
      url: githubApiUrl(
        `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/deployments/` +
          `${encodeURIComponent(providerRunRef)}/statuses?per_page=100`
      ),
      headers: githubHeaders(token),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch (err) {
    return { ok: false, error: fail("TRANSPORT_ERROR", err instanceof Error ? err.message : String(err), { retryable: true }) };
  }

  if (response.status >= 400) {
    return {
      ok: false,
      error: fail("PROVIDER_ERROR", `GitHub deployment status poll failed: ${response.status}`, {
        providerStatus: response.status,
        retryable: response.status >= 500,
      }),
    };
  }

  let statuses;
  try {
    const parsed = JSON.parse(response.bodyText);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    statuses = parsed;
  } catch {
    return { ok: false, error: fail("PROVIDER_RESPONSE_INVALID", "GitHub returned a malformed statuses response") };
  }

  if (statuses.length === 0) {
    return { ok: true, update: { status: "queued", providerStatusId: null, message: null } };
  }

  const latest = statuses.reduce((best, candidate) => (candidate.id > best.id ? candidate : best));
  return { ok: true, update: mapGitHubDeploymentStatus(latest) };
}

/**
 * Polls the latest deployment status.
 *
 * @complexity One outbound HTTP request (plus the token mint) and a single linear scan over the
 * returned statuses (bounded by `per_page=100`), each hard-bounded by `DEFAULT_TIMEOUT_MS`.
 */
async function pollRun(input, ctx) {
  const config = readGitHubTargetConfig(input.target);
  if (!config) {
    return { ok: false, error: fail("INVALID_TARGET_CONFIG", "github target is missing owner/repo/environmentName") };
  }
  if (!/^[1-9]\d*$/.test(input.providerRunRef)) {
    return { ok: false, error: fail("INVALID_TARGET_CONFIG", "providerRunRef is not a github deployment id") };
  }
  const credentials = requireCredentials(ctx.credentials);
  if (!credentials) {
    return { ok: false, error: fail("NO_CREDENTIALS_CONFIGURED", "github deployment target is missing appId/installationId/privateKeyPem") };
  }

  const token = await mintInstallationToken(ctx.httpClient, credentials, ctx.now);
  if (!token.ok) return { ok: false, error: token.error };

  return pollGitHubDeploymentStatuses(ctx, token.token, config, input.providerRunRef);
}

/**
 * Builds the `github` deployment provider adapter. Stateless — safe to construct once and reuse
 * across requests; all per-call state lives in the `ctx` passed to each method.
 */
export function createGitHubDeploymentProvider() {
  return {
    id: GITHUB_DEPLOYMENT_PROVIDER_ID,
    credentialKeys: ["appId", "installationId", "privateKeyPem"],
    startRun,
    pollRun,
  };
}
