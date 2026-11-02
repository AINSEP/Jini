// @ts-check
import { createHash } from "node:crypto";

/**
 * @file Commits a full site export to a GitHub repository in ONE commit through the Git Data API
 * (blobs, a tree, a commit, then a ref update). Moved out of core
 * (`apps/website/src/features/source-control/github-git-provider.ts`) unchanged in behavior.
 *
 * The rules this file keeps, each one a past defect:
 *
 * - The ref write is the only irreversible step. An existing branch is moved with a PATCH that is
 *   NOT forced, so a branch that moved since this commit began answers 422 and the commit is
 *   reported `diverged`, never overwritten.
 * - The parent TREE read fails the whole commit when it fails: building without `base_tree` would
 *   silently delete every file on the branch this export does not write.
 * - `.tovu/managed-files.json` records every path THIS adapter wrote plus its blob sha. A later
 *   export deletes a path it no longer writes only when the live blob still has that exact sha; a
 *   hand-edited, unverifiable or v1 (no sha) path is kept and reported in `divergedPaths`. A
 *   manifest that cannot be read fails the commit, rather than forgetting what it owned.
 * - A fetch that threw is `network-unreachable` (says nothing about the token); a response that came
 *   back non-2xx, or a redirect (the token is never replayed at another host), is `provider-error`.
 *
 * @typedef {import("./github.mjs").Kit} Kit
 * @typedef {{ path: string, data: string | Buffer }} CommitFile
 * @typedef {{ ok: false, code: "network-unreachable" | "provider-error", message: string }} StepFailure
 * @typedef {{ path: string, sha: string | undefined }} PreviouslyManagedFile
 */

const PROVIDER_ERROR = "provider-error";
const GITHUB_API = "https://api.github.com";
/** Pinned to the same REST API version the GitHub Pages deploy target uses. */
const GITHUB_API_VERSION = "2026-03-10";
/** Where this adapter records exactly which paths IT wrote. A dotfile directory, so it never collides
 *  with real export output. */
const MANAGED_MANIFEST_PATH = ".tovu/managed-files.json";
const GITHUB_FETCH_TIMEOUT_MS = 30_000;
const GIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/** @param {string} value */
function enc(value) {
  return encodeURIComponent(value);
}

/** Encodes a repo path one segment at a time, keeping `/` (branch names and file paths contain it).
 *  @param {string} path */
function encPath(path) {
  return path.split("/").map(enc).join("/");
}

/** @param {string} token @param {Record<string, string>} [extra] */
function githubHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    ...extra,
  };
}

/** @param {string | Buffer} data */
function sha256Hex(data) {
  return createHash("sha256").update(Buffer.from(data)).digest("hex");
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return typeof value === "object" && value !== null;
}

/** @param {{ err: unknown }} required */
function isGitHubTimeout({ err }, _options = {}) {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/**
 * The commit operation, bound to one kit.
 *
 * @param {Kit} kit
 */
export function createSiteCommitter(kit) {
  /**
   * One request, classified before any status interpretation.
   * @param {string} url @param {RequestInit} init
   * @returns {Promise<{ kind: "network-unreachable" | "provider-rejected", message: string } | { kind: "response", response: Response }>}
   */
  async function githubFetch(url, init) {
    try {
      const response = await kit.fetch(url, kit.redirectGuardInit({ ...init, signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS) }));
      kit.assertNotRedirected(response, "GitHub");
      return { kind: "response", response };
    } catch (err) {
      if (kit.isRedirectRefusal(err)) {
        return { kind: "provider-rejected", message: err instanceof Error ? err.message : String(err) };
      }
      if (isGitHubTimeout({ err })) {
        return { kind: "network-unreachable", message: `GitHub request to ${url} timed out after ${GITHUB_FETCH_TIMEOUT_MS}ms` };
      }
      return { kind: "network-unreachable", message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** @param {Response} response @returns {Promise<{ ok: true, json: Record<string, any> } | { ok: false, message: string }>} */
  async function readJsonBody(response) {
    try {
      return { ok: true, json: /** @type {Record<string, any>} */ (await response.json()) };
    } catch {
      return { ok: false, message: "GitHub returned a non-JSON response." };
    }
  }

  /** @param {Response} response @param {string} fallback */
  async function providerErrorMessage(response, fallback) {
    const body = await readJsonBody(response);
    if (body.ok && typeof body.json.message === "string" && body.json.message.trim() !== "") return body.json.message;
    return `${fallback} (${response.status}).`;
  }

  /** @param {{ kind: "network-unreachable" | "provider-rejected", message: string }} result @returns {StepFailure} */
  function nonResponseFailure(result) {
    return { ok: false, code: result.kind === "network-unreachable" ? "network-unreachable" : PROVIDER_ERROR, message: result.message };
  }

  /** POSTs JSON and reads back `sha`. @param {string} url @param {unknown} body @param {string} what
   *  @returns {Promise<{ ok: true, sha: string } | StepFailure>} */
  async function postForSha(url, body, what, token) {
    const result = await githubFetch(url, { method: "POST", headers: githubHeaders(token, { "Content-Type": "application/json" }), body: JSON.stringify(body) });
    if (result.kind !== "response") return nonResponseFailure(result);
    const { response } = result;
    if (!response.ok) return { ok: false, code: PROVIDER_ERROR, message: await providerErrorMessage(response, `GitHub ${what} failed`) };
    const parsed = await readJsonBody(response);
    if (!parsed.ok) return { ok: false, code: PROVIDER_ERROR, message: parsed.message };
    const sha = typeof parsed.json.sha === "string" ? parsed.json.sha : "";
    if (!sha) return { ok: false, code: PROVIDER_ERROR, message: `GitHub ${what} response did not include a sha` };
    return { ok: true, sha };
  }

  /** @param {string} token @param {string} owner @param {string} repo */
  async function fetchRepo(token, owner, repo) {
    const result = await githubFetch(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}`, { headers: githubHeaders(token) });
    if (result.kind !== "response") return nonResponseFailure(result);
    const { response } = result;
    if (response.status === 404) {
      return /** @type {const} */ ({ ok: false, code: "repository-not-found", message: `no repository '${owner}/${repo}' is reachable with this token — it may not exist, or the token cannot see it` });
    }
    if (!response.ok) return { ok: false, code: PROVIDER_ERROR, message: await providerErrorMessage(response, "GitHub repository lookup failed") };
    const body = await readJsonBody(response);
    if (!body.ok) return { ok: false, code: PROVIDER_ERROR, message: body.message };
    const defaultBranch = typeof body.json.default_branch === "string" ? body.json.default_branch : "main";
    return /** @type {const} */ ({ ok: true, defaultBranch });
  }

  /** A 404 is a branch that does not exist yet (the commit creates it). @param {string} token
   *  @param {string} owner @param {string} repo @param {string} branch
   *  @returns {Promise<{ ok: true, tipSha: string | undefined } | StepFailure>} */
  async function fetchBranchTip(token, owner, repo, branch) {
    const result = await githubFetch(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/ref/heads/${encPath(branch)}`, { headers: githubHeaders(token) });
    if (result.kind !== "response") return nonResponseFailure(result);
    const { response } = result;
    if (response.status === 404) return { ok: true, tipSha: undefined };
    if (!response.ok) return { ok: false, code: PROVIDER_ERROR, message: await providerErrorMessage(response, "GitHub branch lookup failed") };
    const body = await readJsonBody(response);
    if (!body.ok) return { ok: false, code: PROVIDER_ERROR, message: body.message };
    const object = body.json.object;
    const sha = isPlainObject(object) && typeof object.sha === "string" ? object.sha : "";
    if (!sha) return { ok: false, code: PROVIDER_ERROR, message: "GitHub branch lookup response did not include a sha" };
    return { ok: true, tipSha: sha };
  }

  /** Fails the whole commit on failure (see this file's header). @param {string} token @param {string} owner
   *  @param {string} repo @param {string} commitSha @returns {Promise<{ ok: true, treeSha: string } | StepFailure>} */
  async function fetchParentTree(token, owner, repo, commitSha) {
    const result = await githubFetch(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/commits/${enc(commitSha)}`, { headers: githubHeaders(token) });
    if (result.kind !== "response") return nonResponseFailure(result);
    const { response } = result;
    if (!response.ok) return { ok: false, code: PROVIDER_ERROR, message: await providerErrorMessage(response, "GitHub parent-commit lookup failed") };
    const body = await readJsonBody(response);
    if (!body.ok) return { ok: false, code: PROVIDER_ERROR, message: body.message };
    const tree = body.json.tree;
    const sha = isPlainObject(tree) && typeof tree.sha === "string" ? tree.sha : "";
    if (!sha) return { ok: false, code: PROVIDER_ERROR, message: "GitHub parent-commit response did not include a tree sha" };
    return { ok: true, treeSha: sha };
  }

  /** @param {string} token @param {string} owner @param {string} repo @param {string} branch
   *  @returns {Promise<{ ok: true, files: readonly PreviouslyManagedFile[] } | StepFailure>} */
  async function fetchManagedManifest(token, owner, repo, branch, scope) {
    const result = await githubFetch(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/contents/${encPath(scope.manifestPath)}?ref=${enc(branch)}`, { headers: githubHeaders(token) });
    if (result.kind !== "response") return nonResponseFailure(result);
    const { response } = result;
    if (response.status === 404) return { ok: true, files: [] }; // verified: no manifest yet — safe, not "unreadable"
    if (!response.ok) return { ok: false, code: PROVIDER_ERROR, message: await providerErrorMessage(response, "GitHub managed-manifest lookup failed") };

    const body = await readJsonBody(response);
    if (!body.ok) return { ok: false, code: PROVIDER_ERROR, message: "GitHub managed-manifest response did not parse as JSON — cannot confirm which paths this adapter previously owned." };
    const content = typeof body.json.content === "string" ? body.json.content : undefined;
    if (content === undefined) {
      return { ok: false, code: PROVIDER_ERROR, message: "GitHub managed-manifest response did not include file content — cannot confirm which paths this adapter previously owned." };
    }
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(content, "base64").toString("utf8"));
    } catch {
      return { ok: false, code: PROVIDER_ERROR, message: "GitHub managed-manifest content is not valid JSON — cannot confirm which paths this adapter previously owned." };
    }
    const files = parseManagedManifestShape(parsed);
    if (files === undefined) {
      return { ok: false, code: PROVIDER_ERROR, message: "GitHub managed-manifest content did not match a recognized shape — cannot confirm which paths this adapter previously owned." };
    }
    if (files.some(file => !kit.repositoryPaths.contains({ folder: scope.folder, path: file.path }))) {
      return { ok: false, code: PROVIDER_ERROR, message: "GitHub managed manifest contains an unsafe or out-of-folder path." };
    }
    return { ok: true, files };
  }

  /** Soft-degrades: any failure is `unverifiable`, which keeps the path. @param {string} token
   *  @param {string} owner @param {string} repo @param {string} branch @param {string} path
   *  @returns {Promise<{ kind: "found", sha: string } | { kind: "confirmed-absent" } | { kind: "unverifiable" }>} */
  async function fetchLiveBlobSha(token, owner, repo, branch, path) {
    const result = await githubFetch(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/contents/${encPath(path)}?ref=${enc(branch)}`, { headers: githubHeaders(token) });
    if (result.kind !== "response") return { kind: "unverifiable" };
    if (result.response.status === 404) return { kind: "confirmed-absent" };
    if (!result.response.ok) return { kind: "unverifiable" };
    const body = await readJsonBody(result.response);
    if (!body.ok) return { kind: "unverifiable" };
    return typeof body.json.sha === "string" ? { kind: "found", sha: body.json.sha } : { kind: "unverifiable" };
  }

  /** @param {string} token @param {string} owner @param {string} repo @param {string | Buffer} data */
  function createBlob(token, owner, repo, data) {
    return postForSha(`${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/blobs`, { content: Buffer.from(data).toString("base64"), encoding: "base64" }, "blob creation", token);
  }

  /** One blob per distinct content (identical files share a blob). @param {string} token
   *  @param {string} owner @param {string} repo @param {readonly CommitFile[]} files */
  async function buildFileTreeEntries(token, owner, repo, files) {
    /** @type {Map<string, string>} */
    const blobShaByHash = new Map();
    /** @type {Record<string, unknown>[]} */
    const tree = [];
    const currentPaths = new Set();
    /** @type {{ path: string, sha: string }[]} */
    const currentFileShas = [];
    for (const file of files) {
      currentPaths.add(file.path);
      const hash = sha256Hex(file.data);
      let blobSha = blobShaByHash.get(hash);
      if (!blobSha) {
        const blobResult = await createBlob(token, owner, repo, file.data);
        if (!blobResult.ok) return blobResult;
        blobSha = blobResult.sha;
        blobShaByHash.set(hash, blobSha);
      }
      tree.push({ path: file.path, mode: "100644", type: "blob", sha: blobSha });
      currentFileShas.push({ path: file.path, sha: blobSha });
    }
    return /** @type {const} */ ({ ok: true, tree, currentPaths, currentFileShas });
  }

  /** @param {string} token @param {string} owner @param {string} repo @param {string} branch
   *  @param {readonly PreviouslyManagedFile[]} candidates */
  async function resolveDeletionCandidates(token, owner, repo, branch, candidates) {
    /** @type {Record<string, unknown>[]} */
    const deletions = [];
    /** @type {string[]} */
    const deletedPaths = [];
    /** @type {string[]} */
    const divergedPaths = [];
    for (const candidate of candidates) {
      const verdict = candidate.sha === undefined ? "diverged"
        : classifyLiveResult(await fetchLiveBlobSha(token, owner, repo, branch, candidate.path), candidate.sha);
      if (verdict === "skip") continue;
      if (verdict === "diverged") {
        divergedPaths.push(candidate.path);
      } else {
        deletedPaths.push(candidate.path);
        deletions.push({ path: candidate.path, mode: "100644", type: "blob", sha: null });
      }
    }
    return { deletions, deletedPaths, divergedPaths };
  }

  /** @param {string} token @param {string} owner @param {string} repo @param {string} branch
   *  @param {readonly CommitFile[]} files @param {string | undefined} baseTreeSha
   *  @param {readonly PreviouslyManagedFile[] | undefined} previousManagedFiles */
  async function buildTree(token, owner, repo, branch, files, baseTreeSha, previousManagedFiles, scope) {
    const fileTree = await buildFileTreeEntries(token, owner, repo, files);
    if (!fileTree.ok) return fileTree;

    const candidates = (previousManagedFiles ?? []).filter((f) => !fileTree.currentPaths.has(f.path) && f.path !== scope.manifestPath);
    const { deletions, deletedPaths, divergedPaths } = await resolveDeletionCandidates(token, owner, repo, branch, candidates);

    const sortedFiles = fileTree.currentFileShas.slice().sort((a, b) => {
      if (a.path < b.path) return -1;
      return a.path > b.path ? 1 : 0;
    });
    const manifestBlob = await createBlob(
      token,
      owner,
      repo,
      JSON.stringify({ version: 2, files: sortedFiles })
    );
    if (!manifestBlob.ok) return manifestBlob;

    const tree = [...fileTree.tree, ...deletions, { path: scope.manifestPath, mode: "100644", type: "blob", sha: manifestBlob.sha }];
    const treeResult = await postForSha(
      `${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/trees`,
      { tree, ...(baseTreeSha !== undefined ? { base_tree: baseTreeSha } : {}) },
      "tree creation",
      token
    );
    if (!treeResult.ok) return treeResult;
    return /** @type {const} */ ({ ok: true, sha: treeResult.sha, deletedPaths, divergedPaths });
  }

  /** @param {string} token @param {string} owner @param {string} repo @param {string} branch
   *  @param {string} sha @param {"create" | "update"} mode */
  async function writeRef(token, owner, repo, branch, sha, mode) {
    const url = mode === "create" ? `${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/refs` : `${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/refs/heads/${encPath(branch)}`;
    /** @type {RequestInit} */
    const init =
      mode === "create"
        ? { method: "POST", headers: githubHeaders(token, { "Content-Type": "application/json" }), body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }) }
        : { method: "PATCH", headers: githubHeaders(token, { "Content-Type": "application/json" }), body: JSON.stringify({ sha }) };

    const result = await githubFetch(url, init);
    if (result.kind !== "response") return nonResponseFailure(result);
    const { response } = result;
    if (response.ok) return /** @type {const} */ ({ ok: true });
    if (mode === "update" && response.status === 422) {
      return /** @type {const} */ ({ ok: false, code: "diverged", message: "the branch has moved since this commit started — refusing to overwrite it" });
    }
    return { ok: false, code: PROVIDER_ERROR, message: await providerErrorMessage(response, `GitHub branch ${mode} failed`) };
  }

  /** A new branch has no parent, no base tree and no manifest. @param {string} token @param {string} owner
   *  @param {string} repo @param {string} branch @param {string | undefined} parentSha */
  async function resolveCommitPrerequisites(token, owner, repo, branch, parentSha, scope) {
    if (parentSha === undefined) return /** @type {const} */ ({ ok: true, baseTreeSha: undefined, previousManagedFiles: undefined, parents: [] });

    const parentTreeResult = await fetchParentTree(token, owner, repo, parentSha);
    if (!parentTreeResult.ok) return parentTreeResult;
    const manifestResult = await fetchManagedManifest(token, owner, repo, branch, scope);
    if (!manifestResult.ok) return manifestResult;
    return /** @type {const} */ ({ ok: true, baseTreeSha: parentTreeResult.treeSha, previousManagedFiles: manifestResult.files, parents: [parentSha] });
  }

  /** Prefix payloads once and reserve the local ownership manifest before any provider I/O.
   * @param {{ input: { folder?: string, files: readonly CommitFile[] } }} required
   * @complexity O(file count + path bytes), no effects.
   */
  function prepareCommitScope({ input }, _options = {}) {
    try {
      const folder = kit.repositoryPaths.normalizeFolder({ folder: input.folder });
      const manifestPath = kit.repositoryPaths.prefixPath({ folder, path: MANAGED_MANIFEST_PATH });
      const files = input.files.map(file => ({ ...file, path: kit.repositoryPaths.prefixPath({ folder, path: file.path }) }));
      if (files.some(file => file.path === manifestPath)) return { ok: false, code: PROVIDER_ERROR, message: "Export cannot overwrite the managed manifest." };
      return { ok: true, folder, manifestPath, files };
    } catch {
      return { ok: false, code: PROVIDER_ERROR, message: "Invalid target folder or repository file path." };
    }
  }

  /** @param {{ input: { branch?: string }, defaultBranch: string }} required */
  function siteCommitBranch({ input, defaultBranch }, _options = {}) {
    return input.branch ?? defaultBranch;
  }

  /** @param {{ baseTreeSha: string | undefined, treeSha: string }} required */
  function unchangedSiteTree({ baseTreeSha, treeSha }, _options = {}) {
    return baseTreeSha !== undefined && baseTreeSha === treeSha;
  }

  /**
   * @param {{ token: string, owner: string, repo: string, branch?: string, commitMessage: string, folder?: string, files: readonly CommitFile[] }} input
   * @complexity O(f) requests in the file count, plus one per path a previous export owned and dropped.
   */
  return async function commitSite(input) {
    const { token, owner, repo, commitMessage } = input;
    const scope = prepareCommitScope({ input });
    if (!scope.ok) return scope;
    const files = scope.files;

    const repoResult = await fetchRepo(token, owner, repo);
    if (!repoResult.ok) return repoResult;
    const branch = siteCommitBranch({ input, defaultBranch: repoResult.defaultBranch });

    const tipResult = await fetchBranchTip(token, owner, repo, branch);
    if (!tipResult.ok) return tipResult;
    const parentSha = tipResult.tipSha;
    const branchCreated = parentSha === undefined;

    const prereqs = await resolveCommitPrerequisites(token, owner, repo, branch, parentSha, scope);
    if (!prereqs.ok) return prereqs;

    const treeResult = await buildTree(token, owner, repo, branch, files, prereqs.baseTreeSha, prereqs.previousManagedFiles, scope);
    if (!treeResult.ok) return treeResult;

    if (unchangedSiteTree({ baseTreeSha: prereqs.baseTreeSha, treeSha: treeResult.sha })) {
      return { ok: false, code: "no-changes", message: "nothing changed since the branch's last commit" };
    }

    const commitResult = await postForSha(
      `${GITHUB_API}/repos/${enc(owner)}/${enc(repo)}/git/commits`,
      { message: commitMessage, tree: treeResult.sha, parents: prereqs.parents },
      "commit creation",
      token
    );
    if (!commitResult.ok) return commitResult;

    const refResult = await writeRef(token, owner, repo, branch, commitResult.sha, branchCreated ? "create" : "update");
    if (!refResult.ok) return refResult;

    return {
      ok: true,
      branch,
      branchCreated,
      commitSha: commitResult.sha,
      commitUrl: `https://github.com/${owner}/${repo}/commit/${commitResult.sha}`,
      filesChanged: files.length,
      filesDeleted: treeResult.deletedPaths.length,
      divergedPaths: treeResult.divergedPaths,
    };
  };
}

/** @param {{ kind: string, sha?: string }} liveResult @param {string} recordedSha @returns {"skip" | "diverged" | "delete"} */
function classifyLiveResult(liveResult, recordedSha) {
  if (liveResult.kind === "confirmed-absent") return "skip";
  if (liveResult.kind === "unverifiable") return "diverged";
  return liveResult.sha === recordedSha ? "delete" : "diverged";
}

/** @param {unknown} entry @returns {PreviouslyManagedFile | undefined} */
function parseManifestV2Entry(entry) {
  if (!isPlainObject(entry) || typeof entry.path !== "string") return undefined;
  const sha = typeof entry.sha === "string" && GIT_SHA_PATTERN.test(entry.sha) ? entry.sha : undefined;
  return { path: entry.path, sha };
}

/** v2 carries each path's blob sha; v1 only paths (every v1 path is treated as unverifiable).
 *  @param {unknown} parsed @returns {PreviouslyManagedFile[] | undefined} */
function parseManagedManifestShape(parsed) {
  if (!isPlainObject(parsed)) return undefined;
  if (parsed.version === 2 && Array.isArray(parsed.files)) {
    /** @type {PreviouslyManagedFile[]} */
    const files = [];
    for (const entry of parsed.files) {
      const one = parseManifestV2Entry(entry);
      if (!one) return undefined;
      files.push(one);
    }
    return files;
  }
  if (parsed.version === 1 && Array.isArray(parsed.paths) && parsed.paths.every((path) => typeof path === "string")) {
    return parsed.paths.map((path) => ({ path, sha: undefined }));
  }
  return undefined;
}
