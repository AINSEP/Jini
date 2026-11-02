// @ts-check
import { createHash } from "node:crypto";

/**
 * @file Writes files into a GitHub repository through a saved custom credential, in ONE commit on top
 * of exactly the tree the human confirmed. Moved out of core
 * (`apps/website/src/features/custom-credentials/github-write-files.ts`) unchanged in behavior; the
 * low-level helpers here are shared with `backup-push.mjs`.
 *
 * Two phases. `planFileWrite` is read-only reconnaissance run BEFORE the confirmation dialog: the
 * branch tip, its tree, and whether each path already exists (so the dialog can say "update" or
 * "create"). `commitFiles` runs only after the human confirms, and builds on the plan's parent commit
 * and tree, so a branch that moved in between answers 422 on the (unforced) ref update and is
 * reported `diverged`, never overwritten.
 *
 * Every request goes through core's guarded HTTP client (`kit.httpClient`, egress policy applied)
 * with the `Authorization` header core built from the saved connection. A thrown send is
 * `network-unreachable` with fixed caller-safe text (an egress refusal says so); its detail is
 * `logDetail`, for the server log only.
 *
 * @typedef {import("./github.mjs").Kit} Kit
 * @typedef {{ baseUrl: string, authorization: string, owner: string, repo: string }} Target
 * @typedef {{ path: string, content: string }} WriteFile
 * @typedef {{ status: number, bodyText: string, headers?: Record<string, string> }} HttpResponse
 * @typedef {{ ok: false, code: "provider-error", message: string }
 *   | { ok: false, code: "network-unreachable", message: string, logDetail: string }} Failure
 */

const PROVIDER_ERROR = "provider-error";
const GITHUB_API_VERSION = "2026-03-10";
const GITHUB_WRITE_FILES_TIMEOUT_MS = 30_000;
/** The Contents API lists at most this many entries per directory; a full listing may be truncated. */
const CONTENTS_API_DIRECTORY_LISTING_CAP = 1000;
const GITHUB_UNREACHABLE_MESSAGE = "GitHub could not be reached: the request failed before any response arrived (a network error or timeout).";

/** @param {string} value */
export function enc(value) {
  return encodeURIComponent(value);
}

/** @param {string} path */
export function encPath(path) {
  return path.split("/").map(enc).join("/");
}

/** `<baseUrl>/repos/<owner>/<repo>`. @param {Target} target */
export function repoPathOf(target) {
  const base = target.baseUrl.endsWith("/") ? target.baseUrl.slice(0, -1) : target.baseUrl;
  return `${base}/repos/${enc(target.owner)}/${enc(target.repo)}`;
}

/** @param {HttpResponse} response */
export function isOk(response) {
  return response.status >= 200 && response.status < 300;
}

/** @param {unknown} value @param {string} field */
export function extractStringField(value, field) {
  if (typeof value !== "object" || value === null) return "";
  const candidate = /** @type {Record<string, unknown>} */ (value)[field];
  return typeof candidate === "string" ? candidate : "";
}

/** @param {HttpResponse} response @returns {{ ok: true, json: any } | { ok: false, message: string }} */
export function parseJsonBody(response) {
  try {
    return { ok: true, json: JSON.parse(response.bodyText) };
  } catch {
    return { ok: false, message: "GitHub returned a non-JSON response." };
  }
}

/** @param {HttpResponse} response @param {string} fallback */
export function providerErrorMessage(response, fallback) {
  const body = parseJsonBody(response);
  const providerMessage = body.ok && typeof body.json?.message === "string" ? body.json.message : undefined;
  return providerMessage ? `${fallback}: ${providerMessage}` : `${fallback} (status ${response.status})`;
}

/** @param {string} path @returns {Failure} */
function notRegularFileFailure(path) {
  return { ok: false, code: PROVIDER_ERROR, message: `'${path}' already exists on the branch but is not a regular file — refusing to overwrite it with a blob` };
}

/** @param {string} path */
function splitRepoPath(path) {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? { dir: "", name: path } : { dir: path.slice(0, idx), name: path.slice(idx + 1) };
}

/** A regular file, not a symlink or submodule (both report `download_url: null`). @param {unknown} entry */
function isRegularFileEntry(entry) {
  if (extractStringField(entry, "type") !== "file") return false;
  return !(entry !== null && typeof entry === "object" && /** @type {Record<string, unknown>} */ (entry).download_url === null);
}

/** GitHub's own words for its secondary (abuse) rate limit, in a 403 body that carries no header. */
const SECONDARY_RATE_LIMIT_PATTERN = /secondary rate limit|abuse detection/i;

/** @param {HttpResponse} response @param {string} name */
function headerOf(response, name) {
  const headers = response.headers ?? {};
  const found = Object.keys(headers).find((key) => key.toLowerCase() === name);
  return found === undefined ? undefined : headers[found];
}

/** @param {{ response: HttpResponse, status: number }} required */
function isGitHubRateLimited({ response, status }, _options = {}) {
  if (status === 429) return true;
  if (status !== 403) return false;
  return headerOf(response, "retry-after") !== undefined || headerOf(response, "x-ratelimit-remaining") === "0" || SECONDARY_RATE_LIMIT_PATTERN.test(response.bodyText);
}

/** @param {{ response: HttpResponse, retryAfter: number, policy: RetryPolicy }} required */
function gitHubRateLimitDelay({ response, retryAfter, policy }, _options = {}) {
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1000;
  const reset = Number(headerOf(response, "x-ratelimit-reset"));
  if (headerOf(response, "x-ratelimit-remaining") === "0" && Number.isFinite(reset)) return Math.max(0, reset * 1000 - Date.now()) + 1000;
  return policy.rateLimitWaitMs;
}

/**
 * How long to wait before retrying a request GitHub may answer differently next time, or
 * `undefined` when it will not: an egress refusal, or a 4xx that is not a rate limit, is final.
 * GitHub's documented order: `retry-after` (seconds) first, then `x-ratelimit-reset` when
 * `x-ratelimit-remaining` is 0, then at least a minute for a secondary limit without either.
 *
 * @param {{ kind: "response", response: HttpResponse } | { kind: "network-unreachable", refused: boolean }} result
 * @param {number} attempt - 1 for the first retry.
 * @param {RetryPolicy} policy
 * @returns {number | undefined}
 * @complexity O(headers).
 */
export function retryDelayMs(result, attempt, policy) {
  const backoff = Math.min(policy.maxBackoffMs, policy.baseBackoffMs * 2 ** (attempt - 1));
  if (result.kind !== "response") return result.refused ? undefined : backoff;
  const { status } = result.response;
  const retryAfter = Number(headerOf(result.response, "retry-after"));
  const rateLimited = isGitHubRateLimited({ response: result.response, status });
  if (!rateLimited) return status >= 500 && status <= 599 ? backoff : undefined;
  return gitHubRateLimitDelay({ response: result.response, retryAfter, policy });
}

/**
 * @typedef {{ maxAttempts: number, baseBackoffMs: number, maxBackoffMs: number, rateLimitWaitMs: number, maxWaitMs: number }} RetryPolicy
 * `maxWaitMs` caps one wait: GitHub asking for longer (an hourly limit) is reported, not slept on.
 */

/**
 * The credentialed GitHub calls, bound to one kit.
 *
 * @param {Kit} kit
 * @param {{ timeoutMs?: number, retry?: RetryPolicy }} [options] - `timeoutMs` is each request's
 *   socket-idle budget (the egress policy may cap it lower). `retry` re-sends a request that failed
 *   transiently ({@link retryDelayMs}); every GitHub Git Data write is safe to repeat (a blob or tree
 *   is addressed by its content, and a non-force ref update to the same commit is a no-op). Without
 *   it a request is sent once, as `custom_credential_write_files` always has.
 */
export function createGitDataClient(kit, options = {}) {
  const timeoutMs = options.timeoutMs ?? GITHUB_WRITE_FILES_TIMEOUT_MS;
  const sleep = kit.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  /**
   * @param {Target} target @param {{ method: "GET" | "POST" | "PATCH", url: string, body?: string }} request
   * @returns {Promise<{ kind: "response", response: HttpResponse } | { kind: "network-unreachable", message: string, logDetail: string }>}
   */
  async function send(target, request) {
    let result = await sendOnce(target, request);
    const policy = options.retry;
    for (let attempt = 1; policy !== undefined && attempt < policy.maxAttempts; attempt++) {
      const waitMs = retryDelayMs(result, attempt, policy);
      if (waitMs === undefined || waitMs > policy.maxWaitMs) break;
      await sleep(waitMs);
      result = await sendOnce(target, request);
    }
    if (result.kind === "response") return result;
    return { kind: "network-unreachable", message: result.message, logDetail: result.logDetail };
  }

  /**
   * @param {Target} target @param {{ method: "GET" | "POST" | "PATCH", url: string, body?: string }} request
   * @returns {Promise<{ kind: "response", response: HttpResponse } | { kind: "network-unreachable", refused: boolean, message: string, logDetail: string }>}
   */
  async function sendOnce(target, request) {
    try {
      const response = await kit.httpClient.send({
        method: request.method,
        url: request.url,
        headers: {
          Authorization: target.authorization,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        timeoutMs,
        ...(request.body !== undefined ? { body: request.body } : {}),
      });
      return { kind: "response", response };
    } catch (err) {
      const described = kit.describeTransportError(err);
      const refused = described.refusal !== undefined;
      const message = refused ? `the request to GitHub was refused: ${described.refusal}` : GITHUB_UNREACHABLE_MESSAGE;
      return { kind: "network-unreachable", refused, message, logDetail: described.logDetail };
    }
  }

  /** @param {{ message: string, logDetail: string }} result @returns {Failure} */
  function nonResponseFailure(result) {
    return { ok: false, code: "network-unreachable", message: result.message, logDetail: result.logDetail };
  }

  /** A 404 is `found: false`, not a failure. @param {Target} target @param {string} url @param {string} failureFallback
   *  @returns {Promise<{ ok: true, found: false } | { ok: true, found: true, json: any } | Failure>} */
  async function getJson(target, url, failureFallback) {
    const result = await send(target, { method: "GET", url });
    if (result.kind !== "response") return nonResponseFailure(result);
    if (result.response.status === 404) return { ok: true, found: false };
    if (!isOk(result.response)) return { ok: false, code: PROVIDER_ERROR, message: providerErrorMessage(result.response, failureFallback) };
    const body = parseJsonBody(result.response);
    if (!body.ok) return { ok: false, code: PROVIDER_ERROR, message: body.message };
    return { ok: true, found: true, json: body.json };
  }

  /** @param {Target} target @param {string} url @param {Record<string, unknown>} body @param {string} failureFallback
   *  @returns {Promise<{ ok: true, json: any } | Failure>} */
  async function postJson(target, url, body, failureFallback) {
    const result = await send(target, { method: "POST", url, body: JSON.stringify(body) });
    if (result.kind !== "response") return nonResponseFailure(result);
    if (!isOk(result.response)) return { ok: false, code: PROVIDER_ERROR, message: providerErrorMessage(result.response, failureFallback) };
    const parsed = parseJsonBody(result.response);
    if (!parsed.ok) return { ok: false, code: PROVIDER_ERROR, message: parsed.message };
    return { ok: true, json: parsed.json };
  }

  /** @param {Target} target @param {string | Uint8Array} content @returns {Promise<{ ok: true, sha: string } | Failure>} */
  async function createBlob(target, content) {
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content.buffer, content.byteOffset, content.byteLength);
    const result = await postJson(target, `${repoPathOf(target)}/git/blobs`, { content: bytes.toString("base64"), encoding: "base64" }, "GitHub blob creation failed");
    if (!result.ok) return result;
    const sha = extractStringField(result.json, "sha");
    if (!sha) return { ok: false, code: PROVIDER_ERROR, message: "GitHub blob creation response did not include a sha" };
    return { ok: true, sha };
  }

  /** Unforced: a 422 means the branch moved. @param {Target} target @param {string} branch @param {string} sha
   *  @returns {Promise<{ ok: true } | { ok: false, code: "diverged", message: string } | Failure>} */
  async function updateRef(target, branch, sha) {
    const result = await send(target, { method: "PATCH", url: `${repoPathOf(target)}/git/refs/heads/${encPath(branch)}`, body: JSON.stringify({ sha }) });
    if (result.kind !== "response") return nonResponseFailure(result);
    if (result.response.status === 422) {
      return { ok: false, code: "diverged", message: "the branch has moved since this write was confirmed — refusing to overwrite it" };
    }
    if (!isOk(result.response)) return { ok: false, code: PROVIDER_ERROR, message: providerErrorMessage(result.response, "GitHub branch update failed") };
    return { ok: true };
  }

  return { send, nonResponseFailure, getJson, postJson, createBlob, updateRef };
}

/** @typedef {ReturnType<typeof createGitDataClient>} GitDataClient */

/** The two write-files operations. @param {GitDataClient} git */
export function createFileWriter(git) {
  /** @param {Target} target @param {string} branch @param {string} path */
  async function checkOneFileExistence(target, branch, path) {
    const result = await git.getJson(target, `${repoPathOf(target)}/contents/${encPath(path)}?ref=${enc(branch)}`, `GitHub lookup of '${path}' failed`);
    if (!result.ok) return result;
    if (!result.found) return { ok: true, state: { path, exists: false } };
    if (Array.isArray(result.json) || result.json.type !== "file") return notRegularFileFailure(path);
    return { ok: true, state: { path, exists: true } };
  }

  /** @param {string} path @param {unknown} entry */
  function stateFromListingEntry(path, entry) {
    if (entry === undefined) return { ok: true, state: { path, exists: false } };
    if (!isRegularFileEntry(entry)) return notRegularFileFailure(path);
    return { ok: true, state: { path, exists: true } };
  }

  /** @param {{ files: readonly WriteFile[] }} required */
  function groupWriteFilesByDirectory({ files }, _options = {}) {
    /** @type {Map<string, WriteFile[]>} */
    const filesByDir = new Map();
    for (const file of files) {
      const { dir } = splitRepoPath(file.path);
      const bucket = filesByDir.get(dir);
      if (bucket) bucket.push(file);
      else filesByDir.set(dir, [file]);
    }

    return filesByDir;
  }

  /** @param {{ target: Target, branch: string, dirFiles: WriteFile[], entries: any[], stateByPath: Map<string, { path: string, exists: boolean }> }} required */
  async function resolveDirectoryFileStates({ target, branch, dirFiles, entries, stateByPath }, _options = {}) {
    const entryByName = new Map(entries.map((entry) => [extractStringField(entry, "name"), entry]));
    const listingMayBeIncomplete = entries.length >= CONTENTS_API_DIRECTORY_LISTING_CAP;
    for (const file of dirFiles) {
      const entry = entryByName.get(splitRepoPath(file.path).name);
      const resolved = entry || !listingMayBeIncomplete ? stateFromListingEntry(file.path, entry) : await checkOneFileExistence(target, branch, file.path);
      if (!resolved.ok) return resolved;
      stateByPath.set(file.path, resolved.state);
    }
    return { ok: true };
  }

  /** @param {{ target: Target, branch: string, dir: string, dirFiles: WriteFile[], stateByPath: Map<string, { path: string, exists: boolean }> }} required */
  async function checkDirectoryFileExistence({ target, branch, dir, dirFiles, stateByPath }, _options = {}) {
    const directoryPath = dir ? `/${encPath(dir)}` : "";
    const listUrl = `${repoPathOf(target)}/contents${directoryPath}?ref=${enc(branch)}`;
    const listResult = await git.getJson(target, listUrl, `GitHub directory lookup of '${dir}' failed`);
    if (!listResult.ok) return listResult;
    if (!listResult.found) {
      for (const file of dirFiles) stateByPath.set(file.path, { path: file.path, exists: false });
      return { ok: true };
    }
    const entries = listResult.json;
    if (!Array.isArray(entries)) {
      return { ok: false, code: PROVIDER_ERROR, message: `'${dir}' is a file on the branch, not a directory` };
    }
    return resolveDirectoryFileStates({ target, branch, dirFiles, entries, stateByPath });
  }

  /** One directory listing per distinct parent directory, falling back to a per-file lookup only when
   *  a listing may be truncated. @param {Target} target @param {string} branch @param {readonly WriteFile[]} files */
  async function checkFileExistence(target, branch, files) {
    const filesByDir = groupWriteFilesByDirectory({ files });

    /** @type {Map<string, { path: string, exists: boolean }>} */
    const stateByPath = new Map();
    for (const [dir, dirFiles] of filesByDir) {
      const resolved = await checkDirectoryFileExistence({ target, branch, dir, dirFiles, stateByPath });
      if (!resolved.ok) return resolved;
    }
    return { ok: true, fileStates: files.map((file) => stateByPath.get(file.path)) };
  }

  /** @param {Target & { branch: string, files: readonly WriteFile[] }} input */
  async function planFileWrite(input) {
    const repoPath = repoPathOf(input);
    const refJson = await git.getJson(input, `${repoPath}/git/ref/heads/${encPath(input.branch)}`, "GitHub branch lookup failed");
    if (!refJson.ok) return refJson;
    if (!refJson.found) return { ok: false, code: "branch-not-found", message: `branch '${input.branch}' does not exist in ${input.owner}/${input.repo}` };
    const parentCommitSha = extractStringField(refJson.json.object, "sha");
    if (!parentCommitSha) return { ok: false, code: PROVIDER_ERROR, message: "GitHub branch lookup response did not include a sha" };

    const commitJson = await git.getJson(input, `${repoPath}/git/commits/${enc(parentCommitSha)}`, "GitHub parent-commit lookup failed");
    if (!commitJson.ok) return commitJson;
    if (!commitJson.found) return { ok: false, code: PROVIDER_ERROR, message: "GitHub parent-commit lookup returned 404 for a sha this call just resolved" };
    const baseTreeSha = extractStringField(commitJson.json.tree, "sha");
    if (!baseTreeSha) return { ok: false, code: PROVIDER_ERROR, message: "GitHub parent-commit response did not include a tree sha" };

    const existence = await checkFileExistence(input, input.branch, input.files);
    if (!existence.ok) return existence;
    return { ok: true, plan: { parentCommitSha, baseTreeSha, fileStates: existence.fileStates } };
  }

  /** @param {{ target: Target, treeSha: string, trees: Map<string, any[]> }} required */
  async function readModeTree({ target, treeSha, trees }, _options = {}) {
    let tree = trees.get(treeSha);
    if (!tree) {
      const result = await git.getJson(target, `${repoPathOf(target)}/git/trees/${enc(treeSha)}`, "GitHub file-mode lookup failed");
      if (!result.ok) return result;
      if (!result.found || !Array.isArray(result.json.tree) || result.json.truncated === true) {
        return { ok: false, code: PROVIDER_ERROR, message: "GitHub returned an incomplete tree — refusing to guess file modes" };
      }
      tree = result.json.tree;
      trees.set(treeSha, tree);
    }
    return { ok: true, tree };
  }

  /** @param {{ entry: any }} required */
  function isModeDirectory({ entry }, _options = {}) {
    return entry.type === "tree" && typeof entry.sha === "string" && !!entry.sha;
  }

  /** @param {{ entry: any, path: string }} required */
  function modeFromBlobEntry({ entry, path }, _options = {}) {
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) return notRegularFileFailure(path);
    return { ok: true, mode: entry.mode };
  }

  /** @param {{ target: Target, baseTreeSha: string, file: WriteFile, trees: Map<string, any[]> }} required */
  async function readFileMode({ target, baseTreeSha, file, trees }, _options = {}) {
    let treeSha = baseTreeSha;
    const segments = file.path.split("/");
    for (let index = 0; index < segments.length; index++) {
      const loaded = await readModeTree({ target, treeSha, trees });
      if (!loaded.ok) return loaded;
      const entry = loaded.tree.find(entry => entry.path === segments[index]);
      if (!entry) break;
      if (index === segments.length - 1) return modeFromBlobEntry({ entry, path: file.path });
      if (!isModeDirectory({ entry })) return notRegularFileFailure(file.path);
      treeSha = entry.sha;
    }
    return { ok: true, mode: "100644" };
  }

  /** Read each directory of the CONFIRMED tree, never the mutable branch. Non-recursive
   * lookups avoid GitHub's recursive-tree truncation limit and preserve executable blobs.
   * @param {{ target: Target, baseTreeSha: string, files: readonly WriteFile[] }} required */
  async function readFileModes({ target, baseTreeSha, files }) {
    /** @type {Map<string, any[]>} */
    const trees = new Map();
    /** @type {Map<string, string>} */
    const modes = new Map();
    for (const file of files) {
      const result = await readFileMode({ target, baseTreeSha, file, trees });
      if (!result.ok) return result;
      modes.set(file.path, result.mode);
    }
    return { ok: true, modes };
  }

  /** @param {{ input: Target & { files: readonly WriteFile[] }, modes: Map<string, string> }} required */
  async function buildWriteBlobEntries({ input, modes }, _options = {}) {
    /** @type {Map<string, string>} */
    const blobShaByHash = new Map();
    /** @type {Record<string, unknown>[]} */
    const entries = [];
    for (const file of input.files) {
      const hash = createHash("sha256").update(Buffer.from(file.content, "utf8")).digest("hex");
      let blobSha = blobShaByHash.get(hash);
      if (!blobSha) {
        const blobResult = await git.createBlob(input, file.content);
        if (!blobResult.ok) return blobResult;
        blobSha = blobResult.sha;
        blobShaByHash.set(hash, blobSha);
      }
      entries.push({ path: file.path, mode: modes.get(file.path), type: "blob", sha: blobSha });
    }
    return { ok: true, entries };
  }

  /**
   * @param {Target & { branch: string, commitMessage: string, files: readonly WriteFile[] }} input
   * @param {{ parentCommitSha: string, baseTreeSha: string }} plan
   */
  async function commitFiles(input, plan) {
    const repoPath = repoPathOf(input);
    const fileModes = await readFileModes({ target: input, baseTreeSha: plan.baseTreeSha, files: input.files });
    if (!fileModes.ok) return fileModes;
    const blobs = await buildWriteBlobEntries({ input, modes: fileModes.modes });
    if (!blobs.ok) return blobs;

    const treeResult = await git.postJson(input, `${repoPath}/git/trees`, { tree: blobs.entries, base_tree: plan.baseTreeSha }, "GitHub tree creation failed");
    if (!treeResult.ok) return treeResult;
    const newTreeSha = extractStringField(treeResult.json, "sha");
    if (!newTreeSha) return { ok: false, code: PROVIDER_ERROR, message: "GitHub tree creation response did not include a sha" };

    const commitResult = await git.postJson(
      input,
      `${repoPath}/git/commits`,
      { message: input.commitMessage, tree: newTreeSha, parents: [plan.parentCommitSha] },
      "GitHub commit creation failed"
    );
    if (!commitResult.ok) return commitResult;
    const commitSha = extractStringField(commitResult.json, "sha");
    if (!commitSha) return { ok: false, code: PROVIDER_ERROR, message: "GitHub commit creation response did not include a sha" };

    const refResult = await git.updateRef(input, input.branch, commitSha);
    if (!refResult.ok) return refResult;
    return { ok: true, commitSha, commitUrl: `https://github.com/${input.owner}/${input.repo}/commit/${commitSha}` };
  }

  return { planFileWrite, commitFiles };
}
