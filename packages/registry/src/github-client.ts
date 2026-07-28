/**
 * @module github-client
 *
 * A concrete `GithubRegistryClient` (the interface `github-backend.ts`
 * defines and takes as an injected dependency) implemented against GitHub's
 * real REST API. Per `source-map.md`'s "2026-07-21 hardening pass": "No
 * concrete `GithubRegistryClient` HTTP implementation exists in this
 * package — `readManifest`/`createPublishPullRequest` are an injected
 * interface with no concrete implementation anywhere in this repo." This
 * file closes that gap.
 *
 * Built directly against GitHub's published REST API docs (Contents API,
 * Git Data API, Pulls API — see each function's doc comment for the exact
 * endpoint/behavior it was verified against), following the same "raw
 * `fetch`, no SDK dependency" convention `@jini-ai/deploy`'s `netlify.ts`/
 * `github-pages.ts` already establish (this package has no `@jini-ai/deploy`
 * dependency and does not gain one — the blob/tree/commit/ref mechanics
 * below are written fresh for this package, not shared cross-package, since
 * there is no existing shared low-level GitHub REST helper package).
 */
import type { RegistryManifest } from '@jini-ai/protocol';
import type { GithubPublishMutation, GithubRegistryClient } from './github-backend.js';

const GITHUB_API = 'https://api.github.com';
/** Pinned per GitHub's own recommendation (`X-GitHub-Api-Version` header), matching `@jini-ai/deploy`'s `github-pages.ts` — see that file's doc comment for the sourcing rationale. */
const GITHUB_API_VERSION = '2026-03-10';

type JsonObject = Record<string, unknown>;

/** Auth/endpoint config for {@link GithubApiRegistryClient}. */
export interface GithubApiRegistryClientOptions {
  /**
   * A token with `repo` scope (classic PAT) or fine-grained "Contents" read
   * access — required for `createPublishPullRequest` (which additionally
   * needs "Contents" write + "Pull requests" write), optional for
   * `readManifest` against a public repository (anonymous reads are
   * supported by GitHub's Contents API, subject to its lower unauthenticated
   * rate limit).
   */
  token?: string;
  /** Override the REST API base URL (e.g. a GitHub Enterprise Server instance's `https://HOST/api/v3`). Defaults to `https://api.github.com`. */
  apiUrl?: string;
}

/**
 * `GithubRegistryClient` implementation against GitHub's real REST API:
 * `readManifest` reads a file via the Contents API; `createPublishPullRequest`
 * pushes a new commit via the Git Data API (blobs → tree → commit → branch
 * ref) and opens a pull request via the Pulls API.
 */
export class GithubApiRegistryClient implements GithubRegistryClient {
  private readonly token: string | undefined;
  private readonly apiUrl: string;

  constructor(options: GithubApiRegistryClientOptions = {}) {
    this.token = options.token;
    this.apiUrl = options.apiUrl ?? GITHUB_API;
  }

  /**
   * Reads `path` at `ref` via `GET /repos/{owner}/{repo}/contents/{path}`
   * (GitHub REST "Get repository content") and JSON-parses its base64
   * `content`. Verified against GitHub's own docs: this endpoint returns
   * `content`/`encoding: "base64"` only for files up to 1 MB; a 1-100 MB
   * file instead returns `content: ""`/`encoding: "none"` (requiring the raw
   * media type or Git Trees API instead) and files over 100 MB aren't
   * supported by this endpoint at all. A registry manifest is expected to be
   * well under 1 MB (it is a JSON index of entries, not package content
   * itself), so this implementation reads the standard base64 response and
   * reports a clear, attributable error for the oversized case rather than
   * silently misreading it.
   *
   * @param owner - Repository owner.
   * @param repo - Repository name.
   * @param ref - Branch, tag, or commit sha to read from.
   * @param path - Path to the manifest file within the repository.
   * @returns The parsed manifest JSON (not schema-validated here — downstream
   *   readers in `static-backend.ts` already treat an untrusted/malformed
   *   manifest defensively; see its `validEntries()`/`doctor()`).
   * @throws If the file does not exist, is a directory, is too large for
   *   this endpoint's inline-content response, or is not valid JSON.
   */
  async readManifest(owner: string, repo: string, ref: string, path: string): Promise<RegistryManifest> {
    const url = `${this.apiUrl}/repos/${enc(owner)}/${enc(repo)}/contents/${encPath(path)}?${new URLSearchParams({ ref }).toString()}`;
    const resp = await fetch(url, { headers: githubHeaders(this.token) });
    if (resp.status === 404) {
      throw new Error(`Registry manifest not found: ${owner}/${repo}@${ref}:${path}`);
    }
    const json = await readGithubJson<JsonObject | JsonObject[]>(resp);
    if (!resp.ok) {
      throw githubError(Array.isArray(json) ? {} : json, resp.status, `Failed to read registry manifest ${owner}/${repo}@${ref}:${path}.`);
    }
    if (Array.isArray(json)) {
      throw new Error(`Registry manifest path is a directory, not a file: ${owner}/${repo}@${ref}:${path}`);
    }
    if (json.type !== 'file') {
      throw new Error(`Registry manifest path is not a file (type: ${String(json.type)}): ${owner}/${repo}@${ref}:${path}`);
    }
    if (json.encoding !== 'base64' || typeof json.content !== 'string') {
      throw new Error(
        `Registry manifest at ${owner}/${repo}@${ref}:${path} is too large for the Contents API's inline response ` +
          `(size: ${typeof json.size === 'number' ? json.size : 'unknown'} bytes, encoding: ${String(json.encoding)}); ` +
          'split the manifest into a smaller file or fetch it via the Git Trees/raw-media-type API instead.',
      );
    }
    const decoded = Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded);
    } catch (cause) {
      throw new Error(`Registry manifest at ${owner}/${repo}@${ref}:${path} is not valid JSON.`, { cause });
    }
    return parsed as RegistryManifest;
  }

  /**
   * Pushes `request.files` as a new commit on a fresh branch (created off
   * `request.baseRef`) via the Git Data API — create a blob per file, a tree
   * layered on the base commit's tree, a commit, and a branch ref — then
   * opens a pull request via `POST /repos/{owner}/{repo}/pulls`. Mirrors the
   * blob→tree→commit→ref mechanics `@jini-ai/deploy`'s `github-pages.ts` already
   * verified against GitHub's Git Data API docs, extended with an actual
   * Pulls API call (that file force-pushes a branch directly; this one opens
   * a PR against `baseRef` instead, matching `GithubPublishMutation`'s shape).
   *
   * @param request - Owner/repo/baseRef/branchName/title/body/files.
   * @returns The opened (or, if one already existed for the same head/base, the existing) pull request's URL.
   * @throws If no token is configured, `baseRef` does not exist, or any Git Data/Pulls API call fails.
   */
  async createPublishPullRequest(request: GithubPublishMutation): Promise<{ url: string }> {
    if (!this.token) {
      throw new Error('A GitHub token is required to open a registry publish/yank pull request.');
    }
    const { owner, repo } = request;
    const baseSha = await this.getRefSha(owner, repo, request.baseRef);
    if (!baseSha) {
      throw new Error(`GitHub base ref "${request.baseRef}" does not exist in ${owner}/${repo}.`);
    }
    const baseTreeSha = await this.getCommitTreeSha(owner, repo, baseSha);
    const treeSha = await this.createTree(owner, repo, baseTreeSha, request.files);
    const commitSha = await this.createCommit(owner, repo, `${request.title}\n\n${request.body}`.trim(), treeSha, [baseSha]);
    await this.ensureBranch(owner, repo, request.branchName, commitSha);
    return this.ensurePullRequest(owner, repo, request);
  }

  private async getRefSha(owner: string, repo: string, branch: string): Promise<string | undefined> {
    const resp = await fetch(`${this.apiUrl}/repos/${enc(owner)}/${enc(repo)}/git/ref/heads/${enc(branch)}`, {
      headers: githubHeaders(this.token),
    });
    if (resp.status === 404) return undefined;
    const json = await readGithubJson<JsonObject>(resp);
    if (!resp.ok) throw githubError(json, resp.status, 'GitHub ref lookup failed.');
    const object = json.object as JsonObject | undefined;
    return typeof object?.sha === 'string' ? object.sha : undefined;
  }

  /** `GET /repos/{owner}/{repo}/git/commits/{sha}` (Git Data API) — the tree API's `base_tree` param needs a *tree* sha, not the commit sha `getRefSha` returns. */
  private async getCommitTreeSha(owner: string, repo: string, commitSha: string): Promise<string> {
    const resp = await fetch(`${this.apiUrl}/repos/${enc(owner)}/${enc(repo)}/git/commits/${enc(commitSha)}`, {
      headers: githubHeaders(this.token),
    });
    const json = await readGithubJson<JsonObject>(resp);
    if (!resp.ok) throw githubError(json, resp.status, 'GitHub base commit lookup failed.');
    const tree = json.tree as JsonObject | undefined;
    const sha = typeof tree?.sha === 'string' ? tree.sha : '';
    if (!sha) throw new Error('GitHub base commit response did not include a tree sha.');
    return sha;
  }

  private async createBlob(owner: string, repo: string, content: string): Promise<string> {
    const resp = await fetch(`${this.apiUrl}/repos/${enc(owner)}/${enc(repo)}/git/blobs`, {
      method: 'POST',
      headers: githubHeaders(this.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ content: Buffer.from(content, 'utf8').toString('base64'), encoding: 'base64' }),
    });
    const json = await readGithubJson<JsonObject>(resp);
    if (!resp.ok) throw githubError(json, resp.status, 'GitHub blob creation failed.');
    const sha = typeof json.sha === 'string' ? json.sha : '';
    if (!sha) throw new Error('GitHub blob response did not include a sha.');
    return sha;
  }

  private async createTree(owner: string, repo: string, baseTreeSha: string, files: GithubPublishMutation['files']): Promise<string> {
    const tree: JsonObject[] = [];
    for (const file of files) {
      const blobSha = await this.createBlob(owner, repo, file.content);
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blobSha });
    }
    const resp = await fetch(`${this.apiUrl}/repos/${enc(owner)}/${enc(repo)}/git/trees`, {
      method: 'POST',
      headers: githubHeaders(this.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ base_tree: baseTreeSha, tree }),
    });
    const json = await readGithubJson<JsonObject>(resp);
    if (!resp.ok) throw githubError(json, resp.status, 'GitHub tree creation failed.');
    const sha = typeof json.sha === 'string' ? json.sha : '';
    if (!sha) throw new Error('GitHub tree response did not include a sha.');
    return sha;
  }

  private async createCommit(owner: string, repo: string, message: string, treeSha: string, parents: string[]): Promise<string> {
    const resp = await fetch(`${this.apiUrl}/repos/${enc(owner)}/${enc(repo)}/git/commits`, {
      method: 'POST',
      headers: githubHeaders(this.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message, tree: treeSha, parents }),
    });
    const json = await readGithubJson<JsonObject>(resp);
    if (!resp.ok) throw githubError(json, resp.status, 'GitHub commit creation failed.');
    const sha = typeof json.sha === 'string' ? json.sha : '';
    if (!sha) throw new Error('GitHub commit response did not include a sha.');
    return sha;
  }

  /**
   * Creates `refs/heads/{branch}` pointing at `sha`, or (if it already
   * exists — e.g. a retried publish reusing the same deterministic
   * `vendor-name-version` branch name) force-updates it instead. Verified
   * against GitHub's Git Data Refs API docs: create returns `409 Conflict`
   * when the ref already exists; update accepts `force: true` to bypass the
   * fast-forward-only default — same "last publish wins" reasoning
   * `@jini-ai/deploy`'s `github-pages.ts` already documents for its own ref update.
   */
  private async ensureBranch(owner: string, repo: string, branch: string, sha: string): Promise<void> {
    const createResp = await fetch(`${this.apiUrl}/repos/${enc(owner)}/${enc(repo)}/git/refs`, {
      method: 'POST',
      headers: githubHeaders(this.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    });
    if (createResp.ok) return;
    if (createResp.status !== 409 && createResp.status !== 422) {
      const json = await readGithubJson<JsonObject>(createResp);
      throw githubError(json, createResp.status, 'GitHub branch creation failed.');
    }
    const updateResp = await fetch(`${this.apiUrl}/repos/${enc(owner)}/${enc(repo)}/git/refs/heads/${enc(branch)}`, {
      method: 'PATCH',
      headers: githubHeaders(this.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sha, force: true }),
    });
    const json = await readGithubJson<JsonObject>(updateResp);
    if (!updateResp.ok) throw githubError(json, updateResp.status, 'GitHub branch update failed.');
  }

  /**
   * Opens `POST /repos/{owner}/{repo}/pulls`, or — if GitHub rejects it
   * because a pull request for this exact head/base already exists (the
   * documented shape of that failure is a `422` whose `message` says so) —
   * looks up and returns the existing PR's URL instead. Same
   * try-then-recover-on-conflict shape `@jini-ai/deploy`'s `netlify.ts`
   * (`ensureNetlifySite`) already establishes for a different provider's
   * analogous "create-or-find" race.
   */
  private async ensurePullRequest(owner: string, repo: string, request: GithubPublishMutation): Promise<{ url: string }> {
    const resp = await fetch(`${this.apiUrl}/repos/${enc(owner)}/${enc(repo)}/pulls`, {
      method: 'POST',
      headers: githubHeaders(this.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title: request.title, body: request.body, head: request.branchName, base: request.baseRef }),
    });
    const json = await readGithubJson<JsonObject>(resp);
    if (resp.ok) {
      const url = typeof json.html_url === 'string' ? json.html_url : '';
      if (!url) throw new Error('GitHub pull request response did not include an html_url.');
      return { url };
    }
    const message = typeof json.message === 'string' ? json.message : '';
    if (resp.status === 422 && /already exists/i.test(message)) {
      const existing = await this.findOpenPullRequest(owner, repo, request.baseRef, request.branchName);
      if (existing) return { url: existing };
    }
    throw githubError(json, resp.status, 'GitHub pull request creation failed.');
  }

  private async findOpenPullRequest(owner: string, repo: string, base: string, branch: string): Promise<string | undefined> {
    const query = new URLSearchParams({ head: `${owner}:${branch}`, base, state: 'open' });
    const resp = await fetch(`${this.apiUrl}/repos/${enc(owner)}/${enc(repo)}/pulls?${query.toString()}`, {
      headers: githubHeaders(this.token),
    });
    const json = await readGithubJson<JsonObject[]>(resp);
    if (!resp.ok || !Array.isArray(json)) return undefined;
    const first = json[0];
    return first && typeof first.html_url === 'string' ? first.html_url : undefined;
  }
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

/** URL-encodes each path segment individually so directory separators survive but special characters within a segment don't. */
function encPath(path: string): string {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function githubHeaders(token: string | undefined, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function readGithubJson<T>(resp: Response): Promise<T> {
  try {
    return (await resp.json()) as T;
  } catch (cause) {
    throw new Error('GitHub returned a non-JSON response.', { cause });
  }
}

function githubError(json: JsonObject, status: number, fallback: string): Error {
  const message = typeof json?.message === 'string' && json.message ? json.message : fallback;
  return new Error(`${message} (HTTP ${status})`);
}
