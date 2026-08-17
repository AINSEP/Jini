import { createHash } from 'node:crypto';
import { FETCH_TIMEOUT_MS, fetchWithTimeout } from '@jini-ai/platform';
import { checkDeploymentUrl, normalizeDeploymentUrl, waitForReachableDeploymentUrl } from './reachability.js';
import { assertNotRedirected, redirectGuardInit } from './redirect-guard.js';
import {
  DeployError,
  type DeployFile,
  type DeployPublishInput,
  type DeployPublishResult,
  type DeployTarget,
  type DeploymentUrlCheck,
  type JsonObject,
} from './types.js';

export const GITHUB_PAGES_TARGET_ID = 'github-pages';

const GITHUB_API = 'https://api.github.com';
/** Pinned per GitHub's own recommendation (`X-GitHub-Api-Version` header) so a future server-side default bump can't silently change this file's response shapes underneath it. */
const GITHUB_API_VERSION = '2026-03-10';
/** The long-standing GitHub Pages convention branch name (used by `gh-pages`-the-npm-package, `JamesIves/github-pages-deploy-action`, etc.) — deliberately distinct from a repo's default/production branch so a publish never touches source code. */
const DEFAULT_GITHUB_PAGES_BRANCH = 'gh-pages';
/**
 * The only two terminal values this file commits to, independently
 * cross-validated against `GET /repos/{owner}/{repo}/pages`'s own confirmed
 * clean enum (`built | building | errored | null` — documented as "the
 * status of the most recent build", the same underlying concept
 * `builds/latest`'s `status` field represents). Any other value —
 * `'building'`, `null`, or an unlisted future value — is treated as
 * in-progress; see `pollGitHubPagesBuild`'s doc comment for why this file
 * does not commit to `builds/latest`'s full enum (GitHub's own docs render
 * that field's enum widget client-side and it did not come through cleanly
 * via a direct fetch of the docs page during this file's research pass).
 */
const GITHUB_PAGES_BUILD_SUCCESS = 'built';
const GITHUB_PAGES_BUILD_FAILURE = 'errored';

/** Auth/repo-scoping config a caller supplies when constructing a `GitHubPagesDeployTarget`. */
export interface GitHubPagesDeployConfig {
  /** A token with `repo` scope (classic PAT) or equivalent fine-grained "Contents" + "Pages" write permissions. */
  token: string;
  owner: string;
  repo: string;
  /** Branch to publish to and to configure as the Pages source. Defaults to `'gh-pages'`. */
  branch?: string;
}

/**
 * `DeployTarget` adapter for GitHub Pages, built on the Git Data API (create
 * blobs → a tree → a commit → create/update a branch ref) rather than the
 * newer artifact-based "Pages deployments" API
 * (`POST /repos/{owner}/{repo}/pages/deployments`). See
 * `packages/deploy/source-map.md`'s 2026-07-21 addition for the full
 * research trail; in short: that endpoint requires an `oidc_token` "issued
 * by GitHub Actions certifying the origin of the deployment" — a token this
 * package (running outside an Actions runner, authenticating with a plain
 * PAT) has no way to mint. The Git Data API has no such requirement: any
 * token with repo write access can push a commit and (once the branch
 * exists) enable/observe Pages against it, which is exactly what
 * `actions/deploy-pages`'s *predecessor* tooling (and every non-Actions
 * GitHub Pages deploy tool in the wild, e.g. `gh-pages`/
 * `JamesIves/github-pages-deploy-action` in non-artifact mode) has always
 * done.
 *
 * Unlike `VercelDeployTarget`/`NetlifyDeployTarget`/`CloudflarePagesDeployTarget`,
 * this target does not derive a project/site identity from
 * `input.projectName` — a GitHub Pages "site" is intrinsically the
 * `{owner, repo}` the caller configures, not a freely-named resource this
 * package could create on the fly. `input.projectName` is used only as a
 * human label in the generated commit message.
 */
export class GitHubPagesDeployTarget implements DeployTarget {
  readonly id = GITHUB_PAGES_TARGET_ID;

  constructor(private readonly config: GitHubPagesDeployConfig) {}

  /**
   * Publishes `input.files` as a new commit on the configured Pages branch
   * (creating the branch if it doesn't exist yet), ensures the repository's
   * Pages site is enabled against that branch, waits for GitHub's own build
   * of that exact commit to finish, then waits for the resulting URL to
   * become publicly reachable.
   *
   * Sequencing note: the branch is pushed to *before* Pages is
   * enabled/verified, not after. `POST /repos/{owner}/{repo}/pages` requires
   * `source.branch` to already exist in the repository — enabling Pages
   * against a branch that doesn't exist yet fails, so the branch must be
   * created first via the Git Data API flow below.
   *
   * @param input - File set plus a caller-chosen label used only for the commit message.
   * @throws {DeployError} If `config.token`/`config.owner`/`config.repo` is
   *   missing, or GitHub's API rejects any step of the blob/tree/commit/ref/
   *   pages flow, or the resulting Pages build reaches `status: 'errored'`.
   */
  async publish(input: DeployPublishInput): Promise<DeployPublishResult> {
    if (!this.config.token) {
      throw new DeployError('GitHub token is required.', 400);
    }
    const { owner, repo } = this.config;
    if (!owner || !repo) {
      throw new DeployError('GitHub Pages owner and repo are required.', 400);
    }
    const branch = this.config.branch || DEFAULT_GITHUB_PAGES_BRANCH;

    const parentSha = await getGitHubRefSha(this.config, owner, repo, branch);

    const treeSha = await createGitHubTreeFromFiles(this.config, owner, repo, input.files);
    const label = typeof input.projectName === 'string' && input.projectName.trim() ? input.projectName.trim() : 'site';
    const commitSha = await createGitHubCommit(
      this.config,
      owner,
      repo,
      `Deploy ${label} via @jini-ai/deploy`,
      treeSha,
      parentSha ? [parentSha] : [],
    );

    if (parentSha) {
      await updateGitHubRef(this.config, owner, repo, branch, commitSha);
    } else {
      await createGitHubRef(this.config, owner, repo, branch, commitSha);
    }

    const site = await ensureGitHubPagesSite(this.config, owner, repo, branch);
    const configuredBranch = typeof (site.source as JsonObject | undefined)?.branch === 'string' ? ((site.source as JsonObject).branch as string) : undefined;
    const sourceBranchMismatch = configuredBranch !== undefined && configuredBranch !== branch;

    const build = await pollGitHubPagesBuild(this.config, owner, repo, commitSha);
    if (build?.status === GITHUB_PAGES_BUILD_FAILURE) {
      throw new DeployError(build.errorMessage || 'GitHub Pages build errored.', 502, build.raw);
    }

    const candidates = githubPagesUrlCandidates(site);
    const link = await waitForReachableDeploymentUrl(candidates, { providerLabel: 'GitHub Pages' });

    return {
      targetId: this.id,
      url: link.url || candidates[0] || '',
      deploymentId: commitSha,
      status: link.status,
      statusMessage: link.statusMessage,
      ...(link.reachableAt !== undefined ? { reachableAt: link.reachableAt } : {}),
      providerMetadata: {
        owner,
        repo,
        branch,
        branchCreated: !parentSha,
        ...(sourceBranchMismatch ? { sourceBranchMismatch: true } : {}),
      },
    };
  }

  /** Probes `url` with the shared reachability checker — no documented GitHub Pages equivalent to Vercel's Deployment Protection auth wall was found, same reasoning `netlify.ts`/`cloudflare-pages.ts` already applied to their own `checkReachability`. */
  async checkReachability(url: string): Promise<DeploymentUrlCheck> {
    return checkDeploymentUrl(url);
  }
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

function githubHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    ...extra,
  };
}

async function readGitHubJson<T>(resp: Response): Promise<T> {
  try {
    return (await resp.json()) as T;
  } catch {
    throw new DeployError('GitHub returned a non-JSON response.', resp.status || 502);
  }
}

/**
 * `fallback` (the second operand of the `||`) is unreachable today: every
 * one of this file's 8 call sites passes a non-empty string literal — same
 * situation `netlify.ts`'s `netlifyError` documents for its own callers.
 * Kept as the sane default a future caller forgetting to pass `fallback`
 * would fall through to, not deleted for coverage's sake.
 */
function githubError(json: JsonObject, status: number, fallback: string): DeployError {
  const message = typeof json?.message === 'string' && json.message ? json.message : fallback || `GitHub request failed (${status}).`;
  return new DeployError(message, status, json);
}

function sha256Hex(data: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(Buffer.from(data)).digest('hex');
}

/** Looks up the tip commit sha of `heads/{branch}`, or `undefined` if the branch does not exist yet (a brand-new Pages publish). */
async function getGitHubRefSha(
  config: GitHubPagesDeployConfig,
  owner: string,
  repo: string,
  branch: string,
): Promise<string | undefined> {
  const resp = await fetchWithTimeout(
    `${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/ref/heads/${enc(branch)}`,
    redirectGuardInit({ headers: githubHeaders(config.token) }),
    { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
  );
  assertNotRedirected(resp, 'GitHub Pages branch lookup');
  if (resp.status === 404) return undefined;
  const json = await readGitHubJson<JsonObject>(resp);
  if (!resp.ok) throw githubError(json, resp.status, 'GitHub Pages branch lookup failed.');
  const object = json.object as JsonObject | undefined;
  return typeof object?.sha === 'string' ? object.sha : undefined;
}

async function createGitHubBlob(config: GitHubPagesDeployConfig, owner: string, repo: string, data: DeployFile['data']): Promise<string> {
  const resp = await fetchWithTimeout(
    `${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/blobs`,
    redirectGuardInit({
      method: 'POST',
      headers: githubHeaders(config.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ content: Buffer.from(data).toString('base64'), encoding: 'base64' }),
    }),
    { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
  );
  assertNotRedirected(resp, 'GitHub blob creation');
  const json = await readGitHubJson<JsonObject>(resp);
  if (!resp.ok) throw githubError(json, resp.status, 'GitHub blob creation failed.');
  const sha = typeof json.sha === 'string' ? json.sha : '';
  if (!sha) throw new DeployError('GitHub blob response did not include a sha.', 502, json);
  return sha;
}

/**
 * Creates one blob per distinct file content (deduped by a local sha256 key
 * — a plain dedup key, not a wire-protocol requirement the way Netlify's
 * SHA1 manifest is, so any stable collision-resistant digest works; sha256
 * via `node:crypto` matches `cloudflare-pages.ts`'s own no-new-dependency
 * choice for the same class of problem) and assembles the resulting tree in
 * one call. Deliberately always creates real blobs rather than using the
 * tree endpoint's inline `content` shortcut — that shortcut only accepts
 * text content, and a static site's asset set (images, fonts, ...) is not
 * reliably valid UTF-8.
 */
async function createGitHubTreeFromFiles(config: GitHubPagesDeployConfig, owner: string, repo: string, files: DeployFile[]): Promise<string> {
  const blobShaByHash = new Map<string, string>();
  const tree: JsonObject[] = [];
  for (const file of files) {
    const hash = sha256Hex(file.data);
    let blobSha = blobShaByHash.get(hash);
    if (!blobSha) {
      blobSha = await createGitHubBlob(config, owner, repo, file.data);
      blobShaByHash.set(hash, blobSha);
    }
    tree.push({ path: file.file, mode: '100644', type: 'blob', sha: blobSha });
  }

  const resp = await fetchWithTimeout(
    `${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/trees`,
    redirectGuardInit({
      method: 'POST',
      headers: githubHeaders(config.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ tree }),
    }),
    { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
  );
  assertNotRedirected(resp, 'GitHub tree creation');
  const json = await readGitHubJson<JsonObject>(resp);
  if (!resp.ok) throw githubError(json, resp.status, 'GitHub tree creation failed.');
  const sha = typeof json.sha === 'string' ? json.sha : '';
  if (!sha) throw new DeployError('GitHub tree response did not include a sha.', 502, json);
  return sha;
}

async function createGitHubCommit(
  config: GitHubPagesDeployConfig,
  owner: string,
  repo: string,
  message: string,
  treeSha: string,
  parents: string[],
): Promise<string> {
  const resp = await fetchWithTimeout(
    `${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/commits`,
    redirectGuardInit({
      method: 'POST',
      headers: githubHeaders(config.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message, tree: treeSha, parents }),
    }),
    { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
  );
  assertNotRedirected(resp, 'GitHub commit creation');
  const json = await readGitHubJson<JsonObject>(resp);
  if (!resp.ok) throw githubError(json, resp.status, 'GitHub commit creation failed.');
  const sha = typeof json.sha === 'string' ? json.sha : '';
  if (!sha) throw new DeployError('GitHub commit response did not include a sha.', 502, json);
  return sha;
}

async function createGitHubRef(config: GitHubPagesDeployConfig, owner: string, repo: string, branch: string, sha: string): Promise<void> {
  const resp = await fetchWithTimeout(
    `${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/refs`,
    redirectGuardInit({
      method: 'POST',
      headers: githubHeaders(config.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    }),
    { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
  );
  assertNotRedirected(resp, 'GitHub Pages branch creation');
  const json = await readGitHubJson<JsonObject>(resp);
  if (!resp.ok) throw githubError(json, resp.status, 'GitHub Pages branch creation failed.');
}

/**
 * `force: true` even though `sha` is always a direct child of the branch's
 * current tip (`createGitHubCommit`'s `parents` was seeded from this exact
 * ref lookup, so this update is a genuine fast-forward): a concurrent
 * publish racing between this file's own ref-lookup and this update could
 * otherwise turn a legitimate fast-forward into a rejected non-fast-forward
 * update (422). `force: true` trades that narrow race for the same
 * "last publish wins" semantics every other target in this package already
 * has (a second concurrent `publish()` call also just overwrites whatever
 * the first one produced).
 */
async function updateGitHubRef(config: GitHubPagesDeployConfig, owner: string, repo: string, branch: string, sha: string): Promise<void> {
  const resp = await fetchWithTimeout(
    `${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/refs/heads/${enc(branch)}`,
    redirectGuardInit({
      method: 'PATCH',
      headers: githubHeaders(config.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sha, force: true }),
    }),
    { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
  );
  assertNotRedirected(resp, 'GitHub Pages branch update');
  const json = await readGitHubJson<JsonObject>(resp);
  if (!resp.ok) throw githubError(json, resp.status, 'GitHub Pages branch update failed.');
}

/**
 * Finds the repository's Pages site config, creating it (pointed at
 * `branch`, `build_type: 'legacy'` — the branch-based build model, matching
 * this file's Git Data API publish mechanism rather than the Actions
 * `'workflow'` build type) if none exists yet. Never mutates an
 * already-enabled site's configuration — see `publish()`'s
 * `sourceBranchMismatch` handling for what happens when the existing site
 * is configured against a different branch than this call targets.
 */
async function ensureGitHubPagesSite(config: GitHubPagesDeployConfig, owner: string, repo: string, branch: string): Promise<JsonObject> {
  const getResp = await fetchWithTimeout(
    `${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/pages`,
    redirectGuardInit({ headers: githubHeaders(config.token) }),
    { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
  );
  assertNotRedirected(getResp, 'GitHub Pages site lookup');
  if (getResp.status === 404) {
    const createResp = await fetchWithTimeout(
      `${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/pages`,
      redirectGuardInit({
        method: 'POST',
        headers: githubHeaders(config.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ source: { branch, path: '/' }, build_type: 'legacy' }),
      }),
      { timeoutMs: FETCH_TIMEOUT_MS.DEPLOY },
    );
    assertNotRedirected(createResp, 'GitHub Pages site creation');
    const created = await readGitHubJson<JsonObject>(createResp);
    if (!createResp.ok) throw githubError(created, createResp.status, 'GitHub Pages site creation failed.');
    return created;
  }
  const json = await readGitHubJson<JsonObject>(getResp);
  if (!getResp.ok) throw githubError(json, getResp.status, 'GitHub Pages site lookup failed.');
  return json;
}

interface GitHubPagesBuildOutcome {
  status: string;
  errorMessage?: string;
  raw: JsonObject;
}

/**
 * Polls `GET /repos/{owner}/{repo}/pages/builds/latest` — deliberately not
 * the Pages site resource's own `status` field (`GET
 * /repos/{owner}/{repo}/pages`), even though that field is documented with
 * a cleaner confirmed enum. Reason: the site-level `status` is shared
 * across every publish to the same site, so immediately after pushing a new
 * commit it can still reflect the *previous* build's terminal state for a
 * moment — a false-positive "already built" race with no way to tell it
 * apart from a genuinely finished new build. `builds/latest`'s `commit`
 * field lets this function confirm it is actually looking at *this*
 * publish's build (`commit === commitSha`) before trusting its `status` at
 * all, closing that race at the cost of committing to a smaller slice of
 * that field's enum (see `GITHUB_PAGES_BUILD_SUCCESS`/`_FAILURE`'s doc
 * comment for why only two values are treated as terminal).
 *
 * A 404 (no build has run yet — expected immediately after a brand-new
 * site's first-ever push/enable, undocumented but consistent with GitHub
 * REST's general "resource doesn't exist yet" convention), a stale,
 * non-matching `commit`, and a response this file cannot parse as JSON are
 * ALL treated as "keep polling," not an error — see the `catch` below for
 * why the non-JSON case joins that list. Any other non-2xx response whose
 * body DID parse still fails fast, matching
 * `pollVercelDeployment`/`pollNetlifyDeploy`'s existing convention. Same
 * fixed 30-attempt/1s-then-2s budget as this package's other targets.
 */
async function pollGitHubPagesBuild(
  config: GitHubPagesDeployConfig,
  owner: string,
  repo: string,
  commitSha: string,
): Promise<GitHubPagesBuildOutcome | null> {
  let last: GitHubPagesBuildOutcome | null = null;
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, i < 5 ? 1000 : 2000));
    const resp = await fetchWithTimeout(
      `${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/pages/builds/latest`,
      redirectGuardInit({ headers: githubHeaders(config.token) }),
      { timeoutMs: FETCH_TIMEOUT_MS.DEPLOY },
    );
    assertNotRedirected(resp, 'GitHub Pages build status check');
    if (resp.status === 404) continue;
    let json: JsonObject;
    try {
      json = await readGitHubJson<JsonObject>(resp);
    } catch {
      // Same "nothing usable to report yet" bucket as the 404 branch above, not a
      // publish failure: every step up to and including enabling the Pages site has
      // already irreversibly succeeded by the time this loop runs (see `publish()`'s
      // call order), so a response this file cannot parse as JSON — an empty/no-content
      // body while GitHub's build-tracking record has not been written yet, or a
      // transient gateway/edge response — is exactly as uninformative as a 404, never a
      // reason to report the whole publish as failed. A genuinely persistent problem
      // still surfaces: this loop is bounded by the same fixed 30-attempt budget as every
      // other outcome (see `proceeds to the reachability wait ... exhausts its 30-attempt
      // budget`), after which `publish()` falls through to the reachability probe with
      // whatever URL it already has — never a false "published: false" for a site that is
      // actually live (`github-pages.test.ts`'s `keeps polling past a builds/latest
      // response that fails to parse as JSON` regression test).
      continue;
    }
    if (!resp.ok) throw githubError(json, resp.status, 'GitHub Pages build status check failed.');
    const commit = typeof json.commit === 'string' ? json.commit : '';
    if (commit !== commitSha) continue;
    const status = typeof json.status === 'string' ? json.status : '';
    const errorObj = json.error as JsonObject | undefined;
    const errorMessage = typeof errorObj?.message === 'string' ? errorObj.message : undefined;
    last = { status, ...(errorMessage ? { errorMessage } : {}), raw: json };
    if (status === GITHUB_PAGES_BUILD_SUCCESS || status === GITHUB_PAGES_BUILD_FAILURE) return last;
  }
  return last;
}

/** Collects candidate public URLs from a Pages site response, preferring `html_url` (the browser-facing field, standard GitHub REST convention) over the bare `url` field (the API resource URL, which happens to also be public-reachable for Pages but is documented separately). */
function githubPagesUrlCandidates(site: JsonObject | null | undefined): string[] {
  const urls: string[] = [];
  if (site && typeof site.html_url === 'string') urls.push(site.html_url);
  if (site && typeof site.url === 'string') urls.push(site.url);
  return [...new Set(urls.map(normalizeDeploymentUrl).filter(Boolean))];
}
