import { createHash } from "node:crypto";

/**
 * @file GitHub Pages deploy target of the `github-pages` Agent Plugin.
 *
 * Ported from `@jini-ai/devops` `src/deploy/github-pages.ts` at Jini commit 28f67f9a: the body of
 * {@link bindGitHubPages} is that source with its TypeScript types stripped, same GitHub calls, error
 * texts and redirect guard. Network, timeouts, poll delay, reachability, the redirect guard and
 * `DeployError` come from the host kit the host injects (see {@link bindGitHubPages}), bound once
 * per target: an installed plugin has no npm dependencies.
 *
 * What the first host (Tovu) used to add in its core around this target now lives in the module
 * contract at the bottom: the `.nojekyll` marker, the `/<repo>` base path, and the owner/repo/branch
 * validation. GitHub Pages has no response-header config, so `responseHeaders` is ignored.
 *
 * Plain JS by owner decision (2026-09-29).
 */

export const GITHUB_PAGES_TARGET_ID = "github-pages";

/** GitHub Pages runs Jekyll over published content unless this empty root file exists, and Jekyll
 *  silently drops every path segment starting with `_`. */
const NOJEKYLL_FILE = ".nojekyll";

/** GitHub owner/org: alphanumeric plus single hyphens, not starting with one, at most 39 characters. */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** GitHub repo name: letters, digits, `.`/`-`/`_`, at most 100 characters. */
const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
/** Git branch name: deliberately permissive, but no whitespace or control characters. */
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,250}$/;

/**
 * The file set actually committed: `files` plus the `.nojekyll` marker, unless the site ships one.
 *
 * @param {Array<{ file: string, data: string | Uint8Array, contentType?: string }>} files
 */
function withNoJekyll(files) {
  return files.some((file) => file.file === NOJEKYLL_FILE) ? files : [...files, { file: NOJEKYLL_FILE, data: "" }];
}

/**
 * Binds the ported GitHub Pages code to one host kit.
 *
 * @param {{ fetch(url: string, init: RequestInit, options: { timeoutMs: number }): Promise<Response>,
 *   timeouts: { QUICK: number, DEPLOY: number, UPLOAD: number }, sleep(ms: number): Promise<void> } & Record<string, any>} kit
 *   The host's deploy kit in the positional ABI installed modules are written against (devops'
 *   `DeployHostKit` helpers, called positionally; `DeployError` is `new (message, status?, details?)`).
 * @returns The target class, constructed with `{ token, owner, repo, branch? }` as in devops.
 */
export function bindGitHubPages(kit) {
  const { fetch: fetchWithTimeout, timeouts: FETCH_TIMEOUT_MS, sleep, DeployError, checkDeploymentUrl, normalizeDeploymentUrl, waitForReachableDeploymentUrl, assertNotRedirected, redirectGuardInit } = kit;
  const GITHUB_PAGES_TARGET_ID = 'github-pages';
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
  /**
   * `DeployTarget` adapter for GitHub Pages, built on the Git Data API (create
   * blobs → a tree → a commit → create/update a branch ref) rather than the
   * newer artifact-based "Pages deployments" API
   * (`POST /repos/{owner}/{repo}/pages/deployments`). See
   * `packages/devops/source-map.md`'s 2026-07-21 addition for the full
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
  class GitHubPagesDeployTarget {
      config;
      id = GITHUB_PAGES_TARGET_ID;
      constructor(config) {
          this.config = config;
      }
      /** Existing Pages sites can use a custom domain; read it before rendering. A new site has
       * GitHub's fixed owner/repository address until its first Pages branch exists.
       * @complexity One bounded read, no branch writes or Pages provisioning.
       */
      async resolvePublicUrl(_required, _options = {}) {
          const { owner, repo } = this.config;
          const response = await fetchWithTimeout(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/pages`, redirectGuardInit({ headers: githubHeaders(this.config.token) }), { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
          assertNotRedirected(response, 'GitHub Pages public URL lookup');
          const body = await readGitHubJson(response);
          if (response.status === 404) return `https://${owner.toLowerCase()}.github.io${repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '' : `/${repo}`}`;
          if (!response.ok) throw githubError(body, response.status, 'GitHub Pages site lookup failed.');
          const url = githubPagesUrlCandidates(body)[0];
          if (!url) throw new DeployError('GitHub Pages did not report a public URL.', 502);
          return url;
      }
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
      async publish(input) {
          if (!this.config.token) {
              throw new DeployError('GitHub token is required.', 400);
          }
          const { owner, repo } = this.config;
          if (!owner || !repo) {
              throw new DeployError('GitHub Pages owner and repo are required.', 400);
          }
          const branch = this.config.branch || DEFAULT_GITHUB_PAGES_BRANCH;
          const { parentSha, commitSha } = await pushGitHubPagesFiles({ config: this.config, owner, repo, branch, input });
          const { site, sourceBranchMismatch } = await prepareGitHubPagesSite({ config: this.config, owner, repo, branch, commitSha });
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
                  commitSha,
                  branchCreated: !parentSha,
                  ...(sourceBranchMismatch ? { sourceBranchMismatch: true } : {}),
              },
          };
      }
      /** Probes `url` with the shared reachability checker — no documented GitHub Pages equivalent to Vercel's Deployment Protection auth wall was found, same reasoning `netlify.ts`/`cloudflare-pages.ts` already applied to their own `checkReachability`. */
      async checkReachability(url) {
          return checkDeploymentUrl(url);
      }
  }
  async function pushGitHubPagesFiles({ config, owner, repo, branch, input }, _options = {}) {
      const parentSha = await getGitHubRefSha(config, owner, repo, branch);
      const treeSha = await createGitHubTreeFromFiles(config, owner, repo, input.files);
      const label = typeof input.projectName === 'string' && input.projectName.trim() ? input.projectName.trim() : 'site';
      const commitSha = await createGitHubCommit(config, owner, repo, `Deploy ${label} via @jini-ai/deploy`, treeSha, parentSha ? [parentSha] : []);
      if (parentSha) {
          await updateGitHubRef(config, owner, repo, branch, commitSha);
      }
      else {
          await createGitHubRef(config, owner, repo, branch, commitSha);
      }
      return { parentSha, commitSha };
  }
  async function prepareGitHubPagesSite({ config, owner, repo, branch, commitSha }, _options = {}) {
      const site = await ensureGitHubPagesSite(config, owner, repo, branch);
      const configuredBranch = typeof site.source?.branch === 'string' ? site.source.branch : undefined;
      const sourceBranchMismatch = configuredBranch !== undefined && configuredBranch !== branch;
      const build = await pollGitHubPagesBuild(config, owner, repo, commitSha);
      if (build?.status === GITHUB_PAGES_BUILD_FAILURE) {
          throw new DeployError(build.errorMessage || 'GitHub Pages build errored.', 502, build.raw);
      }
      return { site, sourceBranchMismatch };
  }
  function enc(value) {
      return encodeURIComponent(value);
  }
  function githubHeaders(token, extra = {}) {
      return {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
          ...extra,
      };
  }
  async function readGitHubJson(resp) {
      try {
          return (await resp.json());
      }
      catch {
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
  function githubError(json, status, fallback) {
      const message = typeof json?.message === 'string' && json.message ? json.message : fallback || `GitHub request failed (${status}).`;
      return new DeployError(message, status, json);
  }
  function sha256Hex(data) {
      return createHash('sha256').update(Buffer.from(data)).digest('hex');
  }
  /** Looks up the tip commit sha of `heads/{branch}`, or `undefined` if the branch does not exist yet (a brand-new Pages publish). */
  async function getGitHubRefSha(config, owner, repo, branch) {
      const resp = await fetchWithTimeout(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/ref/heads/${enc(branch)}`, redirectGuardInit({ headers: githubHeaders(config.token) }), { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
      assertNotRedirected(resp, 'GitHub Pages branch lookup');
      if (resp.status === 404)
          return undefined;
      const json = await readGitHubJson(resp);
      if (!resp.ok)
          throw githubError(json, resp.status, 'GitHub Pages branch lookup failed.');
      const object = json.object;
      return typeof object?.sha === 'string' ? object.sha : undefined;
  }
  async function createGitHubBlob(config, owner, repo, data) {
      const resp = await fetchWithTimeout(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/blobs`, redirectGuardInit({
          method: 'POST',
          headers: githubHeaders(config.token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ content: Buffer.from(data).toString('base64'), encoding: 'base64' }),
      }), { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
      assertNotRedirected(resp, 'GitHub blob creation');
      const json = await readGitHubJson(resp);
      if (!resp.ok)
          throw githubError(json, resp.status, 'GitHub blob creation failed.');
      const sha = typeof json.sha === 'string' ? json.sha : '';
      if (!sha)
          throw new DeployError('GitHub blob response did not include a sha.', 502, json);
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
  async function createGitHubTreeFromFiles(config, owner, repo, files) {
      const blobShaByHash = new Map();
      const tree = [];
      for (const file of files) {
          const hash = sha256Hex(file.data);
          let blobSha = blobShaByHash.get(hash);
          if (!blobSha) {
              blobSha = await createGitHubBlob(config, owner, repo, file.data);
              blobShaByHash.set(hash, blobSha);
          }
          tree.push({ path: file.file, mode: '100644', type: 'blob', sha: blobSha });
      }
      const resp = await fetchWithTimeout(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/trees`, redirectGuardInit({
          method: 'POST',
          headers: githubHeaders(config.token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ tree }),
      }), { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
      assertNotRedirected(resp, 'GitHub tree creation');
      const json = await readGitHubJson(resp);
      if (!resp.ok)
          throw githubError(json, resp.status, 'GitHub tree creation failed.');
      const sha = typeof json.sha === 'string' ? json.sha : '';
      if (!sha)
          throw new DeployError('GitHub tree response did not include a sha.', 502, json);
      return sha;
  }
  async function createGitHubCommit(config, owner, repo, message, treeSha, parents) {
      const resp = await fetchWithTimeout(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/commits`, redirectGuardInit({
          method: 'POST',
          headers: githubHeaders(config.token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ message, tree: treeSha, parents }),
      }), { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
      assertNotRedirected(resp, 'GitHub commit creation');
      const json = await readGitHubJson(resp);
      if (!resp.ok)
          throw githubError(json, resp.status, 'GitHub commit creation failed.');
      const sha = typeof json.sha === 'string' ? json.sha : '';
      if (!sha)
          throw new DeployError('GitHub commit response did not include a sha.', 502, json);
      return sha;
  }
  async function createGitHubRef(config, owner, repo, branch, sha) {
      const resp = await fetchWithTimeout(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/refs`, redirectGuardInit({
          method: 'POST',
          headers: githubHeaders(config.token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
      }), { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
      assertNotRedirected(resp, 'GitHub Pages branch creation');
      const json = await readGitHubJson(resp);
      if (!resp.ok)
          throw githubError(json, resp.status, 'GitHub Pages branch creation failed.');
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
  async function updateGitHubRef(config, owner, repo, branch, sha) {
      const resp = await fetchWithTimeout(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/refs/heads/${enc(branch)}`, redirectGuardInit({
          method: 'PATCH',
          headers: githubHeaders(config.token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ sha, force: true }),
      }), { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
      assertNotRedirected(resp, 'GitHub Pages branch update');
      const json = await readGitHubJson(resp);
      if (!resp.ok)
          throw githubError(json, resp.status, 'GitHub Pages branch update failed.');
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
  async function ensureGitHubPagesSite(config, owner, repo, branch) {
      const getResp = await fetchWithTimeout(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/pages`, redirectGuardInit({ headers: githubHeaders(config.token) }), { timeoutMs: FETCH_TIMEOUT_MS.QUICK });
      assertNotRedirected(getResp, 'GitHub Pages site lookup');
      if (getResp.status === 404) {
          const createResp = await fetchWithTimeout(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/pages`, redirectGuardInit({
              method: 'POST',
              headers: githubHeaders(config.token, { 'Content-Type': 'application/json' }),
              body: JSON.stringify({ source: { branch, path: '/' }, build_type: 'legacy' }),
          }), { timeoutMs: FETCH_TIMEOUT_MS.DEPLOY });
          assertNotRedirected(createResp, 'GitHub Pages site creation');
          const created = await readGitHubJson(createResp);
          if (!createResp.ok)
              throw githubError(created, createResp.status, 'GitHub Pages site creation failed.');
          return created;
      }
      const json = await readGitHubJson(getResp);
      if (!getResp.ok)
          throw githubError(json, getResp.status, 'GitHub Pages site lookup failed.');
      return json;
  }
  async function readPagesBuildResponse({ resp }, _options = {}) {
      if (resp.status === 404)
          return undefined;
      let json;
      try {
          json = await readGitHubJson(resp);
      }
      catch {
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
          return undefined;
      }
      if (!resp.ok)
          throw githubError(json, resp.status, 'GitHub Pages build status check failed.');
      return { json };
  }
  function pagesBuildState({ json }, _options = {}) {
      const status = typeof json.status === 'string' ? json.status : '';
      const errorObj = json.error;
      const errorMessage = typeof errorObj?.message === 'string' ? errorObj.message : undefined;
      return { status, ...(errorMessage ? { errorMessage } : {}), raw: json };
  }
  function isPagesBuildForCommit({ json, commitSha }, _options = {}) {
      const commit = typeof json.commit === 'string' ? json.commit : '';
      return commit === commitSha;
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
  async function pollGitHubPagesBuild(config, owner, repo, commitSha) {
      let last = null;
      for (let i = 0; i < 30; i += 1) {
          await sleep(i < 5 ? 1000 : 2000);
          const resp = await fetchWithTimeout(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/pages/builds/latest`, redirectGuardInit({ headers: githubHeaders(config.token) }), { timeoutMs: FETCH_TIMEOUT_MS.DEPLOY });
          assertNotRedirected(resp, 'GitHub Pages build status check');
          const read = await readPagesBuildResponse({ resp });
          const json = read?.json;
          if (read === undefined || !isPagesBuildForCommit({ json, commitSha }))
              continue;
          last = pagesBuildState({ json });
          const { status } = last;
          if (status === GITHUB_PAGES_BUILD_SUCCESS || status === GITHUB_PAGES_BUILD_FAILURE)
              return last;
      }
      return last;
  }
  /** Collects candidate public URLs from a Pages site response, preferring `html_url` (the browser-facing field, standard GitHub REST convention) over the bare `url` field (the API resource URL, which happens to also be public-reachable for Pages but is documented separately). */
  function githubPagesUrlCandidates(site) {
      const urls = [];
      if (site && typeof site.html_url === 'string')
          urls.push(site.html_url);
      if (site && typeof site.url === 'string')
          urls.push(site.url);
      return [...new Set(urls.map(normalizeDeploymentUrl).filter(Boolean))];
  }

  return { GitHubPagesDeployTarget };
}

/** @param {unknown} value */
function asText(value) {
  return typeof value === "string" ? value : "";
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
 * The token's account `login` from a `GET /user` body, or `undefined`. Reads no other field.
 * @param {unknown} body
 * @returns {string | undefined}
 */
function readGitHubLogin(body) {
  const login = typeof body === "object" && body !== null ? /** @type {Record<string, unknown>} */ (body).login : undefined;
  return typeof login === "string" && login !== "" ? login : undefined;
}

/** The module contract a host's deploy-target registry loads (`DeployTargetModule`). Config fields:
 *  `owner`, `repo`, optional `branch` (the class defaults it to `gh-pages`). */
export default {
  /** @param {{ credential: { token: string }, config: { owner?: string, repo?: string, branch?: string }, kit: any }} context */
  create({ credential, config, kit }) {
    const { GitHubPagesDeployTarget } = bindGitHubPages(kit);
    class NoJekyllGitHubPagesDeployTarget extends GitHubPagesDeployTarget {
      /** @param {{ files: Array<{ file: string, data: string | Uint8Array }>, projectName: string }} input */
      publish(input) {
        return super.publish({ ...input, files: withNoJekyll(input.files) });
      }
    }
    return new NoJekyllGitHubPagesDeployTarget({
      token: credential.token,
      owner: asText(config.owner),
      repo: asText(config.repo),
      ...(typeof config.branch === "string" ? { branch: config.branch } : {}),
    });
  },
  /**
   * `GET /user`, GitHub's own "who am I" endpoint: 401 for a bad or revoked token. Reads back only
   * `login`, the public handle GitHub prints in every profile and repo URL (a publish is about to
   * print it in `https://<login>.github.io/<repo>/`), never email, plan or orgs.
   * @param {{ credential: { token: string }, kit: any }} context
   */
  async verifyCredential({ credential, kit }) {
    const response = await kit.fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${credential.token}`, Accept: "application/vnd.github+json" } }, { timeoutMs: kit.timeouts.QUICK });
    const check = classifyCredentialResponse(response);
    if (!check.ok) return check;
    return { ok: true, accountLabel: readGitHubLogin(await response.json().catch(() => undefined)) };
  },
  /**
   * Shape check at the boundary before any value reaches a URL (the class still escapes each
   * segment). Texts are byte-identical to the checks the first host (Tovu) ran in its core before this moved here.
   * @param {{ owner?: unknown, repo?: unknown, branch?: unknown }} config
   * @returns {string | null}
   */
  validateConfig(config) {
    const owner = asText(config.owner);
    const repo = asText(config.repo);
    if (!OWNER_PATTERN.test(owner)) return `invalid GitHub owner '${owner.slice(0, 60)}'`;
    if (!REPO_PATTERN.test(repo) || repo === "." || repo === "..") return `invalid GitHub repo '${repo.slice(0, 100)}'`;
    if (config.branch !== undefined && !BRANCH_PATTERN.test(asText(config.branch))) return `invalid branch name '${asText(config.branch).slice(0, 60)}'`;
    return null;
  },
  /** A project site is served from `/<repo>`, so every asset URL must carry that prefix.
   *  @param {{ repo?: unknown }} config */
  basePath(config) {
    return `/${asText(config.repo)}`;
  },
  /** The confirmation card reads `owner/repo` as one row, the way GitHub prints a repository.
   *  @param {{ owner?: unknown, repo?: unknown, branch?: unknown }} config */
  summarize(config) {
    const rows = [{ label: "Repository", value: `${asText(config.owner)}/${asText(config.repo)}` }];
    if (typeof config.branch === "string") rows.push({ label: "Branch", value: config.branch });
    return rows;
  },
};
