// @ts-check
import { createHash } from "node:crypto";

import { enc, encPath, extractStringField, isOk, parseJsonBody, providerErrorMessage, repoPathOf } from "./write-files.mjs";

/**
 * @file Pushes a site backup into a folder of a PRIVATE GitHub repository. Moved out of core
 * (`apps/website/src/features/site-backup/github-push.ts`) unchanged in behavior.
 *
 * Three steps, the tool (`site_backup_*` in core) sequencing them: `inspectBackupRepository` checks
 * the repository BEFORE anything is uploaded (it must exist, be private — a backup holds the whole
 * database — be pushable and non-empty, and the folder must not be a file); `uploadBackupBlob` sends
 * one file as a git blob; `commitBackupTree` replaces the backup folder with a tree of the uploaded
 * blobs on top of the planned parent, with an unforced ref update (a moved branch is `diverged`).
 * No recursive tree fetch and no deletion list are needed: the folder's tree is replaced whole.
 *
 * Large sites (2026-10-06, a 212 MiB backup failed live): every request gets
 * {@link BACKUP_CLIENT_OPTIONS} — a long socket-idle budget, because GitHub stays silent while it
 * stores a big blob, and retries with backoff for timeouts, 5xx and rate limits. Small text files ride
 * inline in the tree requests ({@link BACKUP_INLINE_TEXT_MAX_BYTES}) instead of one blob POST each,
 * which keeps a first backup of ~1500 files to a few hundred writes, under GitHub's content-creation
 * limits.
 *
 * @typedef {import("./write-files.mjs").Target} Target
 * @typedef {import("./write-files.mjs").GitDataClient} GitDataClient
 * @typedef {{ path: string, blobSha: string, bytes: number, sha256: string }} UploadedBackupBlob
 * @typedef {{ path: string, text: string, bytes: number, sha256: string }} InlineBackupText
 */

/**
 * The backup's GitHub client. The 2-minute idle budget (the backup egress policy allows it; the
 * custom-credential one caps every request at 10 s) is what a 42 MiB database blob needed: the 10 s
 * cap timed out while GitHub was still answering. Waits follow GitHub's REST guidance: `retry-after`
 * first, a minute for a secondary limit without one, never longer than 10 minutes in one wait.
 *
 * @type {{ timeoutMs: number, retry: import("./write-files.mjs").RetryPolicy }}
 */
export const BACKUP_CLIENT_OPTIONS = {
  timeoutMs: 120_000,
  retry: { maxAttempts: 5, baseBackoffMs: 2_000, maxBackoffMs: 30_000, rateLimitWaitMs: 60_000, maxWaitMs: 10 * 60_000 },
};

/** A UTF-8 file up to this size goes inline in a tree request instead of as its own blob. */
export const BACKUP_INLINE_TEXT_MAX_BYTES = 512 * 1024;

const PROVIDER_ERROR = "provider-error";

/** One tree request's share of the folder: GitHub abandons a request it cannot finish in 10 s, so a
 *  large folder is built over several chained `base_tree` requests rather than one. */
const TREE_CHUNK_MAX_ENTRIES = 300;
const TREE_CHUNK_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Splits the folder's entries into tree requests, by entry count and inline-text bytes.
 *
 * @param {readonly (UploadedBackupBlob | InlineBackupText)[]} entries
 * @complexity O(n).
 */
function chunkTreeEntries(entries) {
  /** @type {(UploadedBackupBlob | InlineBackupText)[][]} */
  const chunks = [[]];
  let bytes = 0;
  for (const entry of entries) {
    const size = entry.path.length + ("text" in entry ? entry.bytes : 64);
    const current = chunks[chunks.length - 1];
    if (current.length > 0 && (current.length >= TREE_CHUNK_MAX_ENTRIES || bytes + size > TREE_CHUNK_MAX_BYTES)) {
      chunks.push([entry]);
      bytes = size;
    } else {
      current.push(entry);
      bytes += size;
    }
  }
  return chunks;
}

/** @param {UploadedBackupBlob | InlineBackupText} entry */
function treeEntry(entry) {
  return "text" in entry ? { path: entry.path, mode: "100644", type: "blob", content: entry.text } : { path: entry.path, mode: "100644", type: "blob", sha: entry.blobSha };
}

/** @param {GitDataClient} git */
export function createBackupPusher(git) {
  /** @param {{ json: any, name: string }} required */
  function checkBackupPrivacy({ json, name }, _options = {}) {
    const fallbackVisibility = json.private === true ? "private" : "public";
    const visibility = typeof json.visibility === "string" ? json.visibility : fallbackVisibility;
    if (json.private !== true || visibility !== "private") {
      return {
        ok: false,
        code: "repo-not-private",
        message:
          `repository ${name} is ${visibility}. A site backup contains the whole database — members, form submissions, admin accounts — ` +
          "which would be exposed to everyone who can read that repository. Back up only to a private repository.",
      };
    }
    return undefined;
  }

  /** @param {Target} target */
  async function checkRepository(target) {
    const name = `${target.owner}/${target.repo}`;
    const repoJson = await git.getJson(target, repoPathOf(target), "GitHub repository lookup failed");
    if (!repoJson.ok) return repoJson;
    if (!repoJson.found) {
      return { ok: false, code: "repo-not-found", message: `repository ${name} was not found, or this credential cannot see it` };
    }
    const json = repoJson.json;
    const privacy = checkBackupPrivacy({ json, name });
    if (privacy) return privacy;
    const permissions = json.permissions;
    if (typeof permissions === "object" && permissions !== null && permissions.push === false) {
      return { ok: false, code: "no-push-permission", message: `this credential can read ${name} but cannot push to it` };
    }
    const defaultBranch = extractStringField(json, "default_branch");
    const htmlUrl = extractStringField(json, "html_url");
    if (!defaultBranch || !htmlUrl) return { ok: false, code: PROVIDER_ERROR, message: "GitHub repository lookup response did not include a default branch or URL" };
    return { ok: true, defaultBranch, htmlUrl };
  }

  /** GitHub answers 409 for the ref of an EMPTY repository. @param {Target} target @param {string} branch */
  async function readBranchTip(target, branch) {
    const name = `${target.owner}/${target.repo}`;
    const refResult = await git.send(target, { method: "GET", url: `${repoPathOf(target)}/git/ref/heads/${encPath(branch)}` });
    if (refResult.kind !== "response") return git.nonResponseFailure(refResult);
    const refResponse = refResult.response;
    if (refResponse.status === 409) {
      return { ok: false, code: "repo-empty", message: `repository ${name} is empty. Add a first commit (for example a README) on GitHub, then back up again.` };
    }
    if (refResponse.status === 404) return { ok: false, code: "branch-not-found", message: `branch '${branch}' does not exist in ${name}` };
    if (!isOk(refResponse)) return { ok: false, code: PROVIDER_ERROR, message: providerErrorMessage(refResponse, "GitHub branch lookup failed") };
    const refBody = parseJsonBody(refResponse);
    const parentCommitSha = refBody.ok ? extractStringField(refBody.json?.object, "sha") : "";
    if (!parentCommitSha) return { ok: false, code: PROVIDER_ERROR, message: "GitHub branch lookup response did not include a sha" };

    return readBackupParentTree({ target, parentCommitSha });
  }

  /** @param {{ target: Target, parentCommitSha: string }} required */
  async function readBackupParentTree({ target, parentCommitSha }, _options = {}) {
    const commitJson = await git.getJson(target, `${repoPathOf(target)}/git/commits/${enc(parentCommitSha)}`, "GitHub parent-commit lookup failed");
    if (!commitJson.ok) return commitJson;
    const baseTreeSha = commitJson.found ? extractStringField(commitJson.json.tree, "sha") : "";
    if (!baseTreeSha) return { ok: false, code: PROVIDER_ERROR, message: "GitHub parent-commit lookup did not return a tree sha" };
    return { ok: true, parentCommitSha, baseTreeSha };
  }

  /** @param {Target & { branch?: string, folder: string }} input */
  async function inspectBackupRepository(input) {
    const repo = await checkRepository(input);
    if (!repo.ok) return repo;
    const branch = input.branch ?? repo.defaultBranch;

    const tip = await readBranchTip(input, branch);
    if (!tip.ok) return tip;

    const folderJson = await git.getJson(input, `${repoPathOf(input)}/contents/${encPath(input.folder)}?ref=${enc(branch)}`, "GitHub folder lookup failed");
    if (!folderJson.ok) return folderJson;
    if (folderJson.found && !Array.isArray(folderJson.json)) {
      return { ok: false, code: "folder-is-file", message: `'${input.folder}' exists on branch '${branch}' but is not a folder — refusing to replace it` };
    }
    return { ok: true, state: { branch, parentCommitSha: tip.parentCommitSha, baseTreeSha: tip.baseTreeSha, htmlUrl: repo.htmlUrl, folderExists: folderJson.found } };
  }

  /** @param {Target} target @param {{ path: string, content: Uint8Array }} file */
  async function uploadBackupBlob(target, file) {
    const result = await git.createBlob(target, file.content);
    if (!result.ok) return result;
    const sha256 = createHash("sha256").update(file.content).digest("hex");
    return { ok: true, blob: { path: file.path, blobSha: result.sha, bytes: file.content.byteLength, sha256 } };
  }

  /**
   * The backup folder's tree, built over chained requests: each one adds a chunk of entries on top of
   * the previous one's tree (`base_tree`), the first starting empty, so the folder still REPLACES
   * whatever was there.
   *
   * @param {Target} input @param {string} repoPath @param {readonly (UploadedBackupBlob | InlineBackupText)[]} entries
   * @complexity O(n) entries over ceil(n / chunk) requests.
   */
  async function createFolderTree(input, repoPath, entries) {
    /** @type {string | undefined} */
    let folderTreeSha;
    for (const chunk of chunkTreeEntries(entries)) {
      const folderTree = await git.postJson(
        input,
        `${repoPath}/git/trees`,
        { ...(folderTreeSha !== undefined ? { base_tree: folderTreeSha } : {}), tree: chunk.map(treeEntry) },
        "GitHub folder tree creation failed"
      );
      if (!folderTree.ok) return folderTree;
      folderTreeSha = extractStringField(folderTree.json, "sha");
      if (!folderTreeSha) return { ok: false, code: PROVIDER_ERROR, message: "GitHub folder tree creation response did not include a sha" };
    }
    return { ok: true, sha: /** @type {string} */ (folderTreeSha) };
  }

  /**
   * @param {Target & { branch: string, folder: string, commitMessage: string, parentCommitSha: string,
   *   baseTreeSha: string, htmlUrl: string, entries: readonly (UploadedBackupBlob | InlineBackupText)[] }} input
   */
  async function commitBackupTree(input) {
    const repoPath = repoPathOf(input);

    const folderTree = await createFolderTree(input, repoPath, input.entries);
    if (!folderTree.ok) return folderTree;
    const folderTreeSha = folderTree.sha;

    const rootTree = await git.postJson(
      input,
      `${repoPath}/git/trees`,
      { base_tree: input.baseTreeSha, tree: [{ path: input.folder, mode: "040000", type: "tree", sha: folderTreeSha }] },
      "GitHub tree creation failed"
    );
    if (!rootTree.ok) return rootTree;
    const rootTreeSha = extractStringField(rootTree.json, "sha");
    if (!rootTreeSha) return { ok: false, code: PROVIDER_ERROR, message: "GitHub tree creation response did not include a sha" };

    const commit = await git.postJson(
      input,
      `${repoPath}/git/commits`,
      { message: input.commitMessage, tree: rootTreeSha, parents: [input.parentCommitSha] },
      "GitHub commit creation failed"
    );
    if (!commit.ok) return commit;
    const commitSha = extractStringField(commit.json, "sha");
    if (!commitSha) return { ok: false, code: PROVIDER_ERROR, message: "GitHub commit creation response did not include a sha" };

    const ref = await git.updateRef(input, input.branch, commitSha);
    if (!ref.ok) {
      if (ref.code !== "diverged") return ref;
      return {
        ok: false,
        code: "diverged",
        message: `branch '${input.branch}' moved since the backup was planned (someone pushed to it). Nothing was overwritten. Call site_backup_plan again.`,
      };
    }
    return { ok: true, commitSha, commitUrl: `${input.htmlUrl}/commit/${commitSha}` };
  }

  return { inspectBackupRepository, uploadBackupBlob, commitBackupTree };
}
