import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { BACKUP_CLIENT_OPTIONS, BACKUP_INLINE_TEXT_MAX_BYTES, createBackupPusher } from "../backup-push.mjs";
import { createGitDataClient } from "../write-files.mjs";
import { REPO, TARGET, res, scriptedKit } from "./fake-kit.mjs";

/** A pusher over a single-shot (no retry) client, so each scripted answer is consumed exactly once. */
function pusher(script) {
  const fake = scriptedKit(script);
  return { ...fake, backup: createBackupPusher(createGitDataClient(fake.kit)) };
}

const PRIVATE_REPO = { private: true, visibility: "private", permissions: { push: true }, default_branch: "main", html_url: "https://github.com/acme/site" };
const REF_OK = res(200, { object: { sha: "parent1" } });
const COMMIT_OK = res(200, { tree: { sha: "tree1" } });

test("backup client options: long idle budget and bounded retries, inline-text cap is 512 KiB", () => {
  assert.equal(BACKUP_CLIENT_OPTIONS.timeoutMs, 120_000);
  assert.deepEqual(BACKUP_CLIENT_OPTIONS.retry, { maxAttempts: 5, baseBackoffMs: 2_000, maxBackoffMs: 30_000, rateLimitWaitMs: 60_000, maxWaitMs: 600_000 });
  assert.equal(BACKUP_INLINE_TEXT_MAX_BYTES, 524_288);
});

test("inspect: a private, pushable, non-empty repository with an existing folder plans on the default branch", async () => {
  const { backup, requests, queue } = pusher([res(200, PRIVATE_REPO), REF_OK, COMMIT_OK, res(200, [{ name: "a" }])]);
  const result = await backup.inspectBackupRepository({ ...TARGET, folder: "backups/site one" });
  assert.deepEqual(result, { ok: true, state: { branch: "main", parentCommitSha: "parent1", baseTreeSha: "tree1", htmlUrl: "https://github.com/acme/site", folderExists: true } });
  assert.deepEqual(requests.map((r) => `${r.method} ${r.url}`), [
    `GET ${REPO}`,
    `GET ${REPO}/git/ref/heads/main`,
    `GET ${REPO}/git/commits/parent1`,
    `GET ${REPO}/contents/backups/site%20one?ref=main`,
  ]);
  assert.equal(queue.length, 0);
});

test("inspect: an explicit branch is used, and a missing folder is reported as not existing", async () => {
  const { backup, requests } = pusher([res(200, { ...PRIVATE_REPO, visibility: undefined }), REF_OK, COMMIT_OK, res(404, {})]);
  const result = await backup.inspectBackupRepository({ ...TARGET, branch: "bk/x", folder: "f" });
  assert.equal(result.ok, true);
  assert.equal(result.state.branch, "bk/x");
  assert.equal(result.state.folderExists, false);
  assert.equal(requests[1].url, `${REPO}/git/ref/heads/bk/x`);
  assert.equal(requests[3].url, `${REPO}/contents/f?ref=bk%2Fx`);
});

test("inspect: repository lookup failures are passed through or named", async () => {
  assert.deepEqual(await pusher([res(500, { message: "boom" })]).backup.inspectBackupRepository({ ...TARGET, folder: "f" }), {
    ok: false, code: "provider-error", message: "GitHub repository lookup failed: boom",
  });
  assert.deepEqual(await pusher([res(404, {})]).backup.inspectBackupRepository({ ...TARGET, folder: "f" }), {
    ok: false, code: "repo-not-found", message: "repository acme/site was not found, or this credential cannot see it",
  });
});

test("inspect: refuses a repository that is not private, whatever field says so", async () => {
  const cases = [
    [{ ...PRIVATE_REPO, private: false, visibility: undefined }, "public"],
    [{ ...PRIVATE_REPO, private: false, visibility: "public" }, "public"],
    [{ ...PRIVATE_REPO, private: true, visibility: "internal" }, "internal"],
  ];
  for (const [repo, shown] of cases) {
    const result = await pusher([res(200, repo)]).backup.inspectBackupRepository({ ...TARGET, folder: "f" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "repo-not-private");
    assert.match(result.message, new RegExp(`^repository acme/site is ${shown}\\. A site backup contains the whole database`));
  }
});

test("inspect: refuses a read-only credential and an incomplete repository answer", async () => {
  assert.deepEqual(await pusher([res(200, { ...PRIVATE_REPO, permissions: { push: false } })]).backup.inspectBackupRepository({ ...TARGET, folder: "f" }), {
    ok: false, code: "no-push-permission", message: "this credential can read acme/site but cannot push to it",
  });
  // No permissions object at all is not a refusal: GitHub omits it for some token kinds.
  const noPerms = await pusher([res(200, { ...PRIVATE_REPO, permissions: null, default_branch: undefined })]).backup.inspectBackupRepository({ ...TARGET, folder: "f" });
  assert.deepEqual(noPerms, { ok: false, code: "provider-error", message: "GitHub repository lookup response did not include a default branch or URL" });
  const noUrl = await pusher([res(200, { ...PRIVATE_REPO, html_url: 7 })]).backup.inspectBackupRepository({ ...TARGET, folder: "f" });
  assert.equal(noUrl.code, "provider-error");
});

test("inspect: branch-tip failures (transport, empty repo, missing branch, error, no sha)", async () => {
  const transport = Object.assign(new Error("socket"), { refusal: undefined });
  const t = await pusher([res(200, PRIVATE_REPO), transport]).backup.inspectBackupRepository({ ...TARGET, folder: "f" });
  assert.deepEqual(t, { ok: false, code: "network-unreachable", message: "GitHub could not be reached: the request failed before any response arrived (a network error or timeout).", logDetail: "detail: socket" });

  const empty = await pusher([res(200, PRIVATE_REPO), res(409, {})]).backup.inspectBackupRepository({ ...TARGET, folder: "f" });
  assert.deepEqual(empty, { ok: false, code: "repo-empty", message: "repository acme/site is empty. Add a first commit (for example a README) on GitHub, then back up again." });

  const missing = await pusher([res(200, PRIVATE_REPO), res(404, {})]).backup.inspectBackupRepository({ ...TARGET, folder: "f" });
  assert.deepEqual(missing, { ok: false, code: "branch-not-found", message: "branch 'main' does not exist in acme/site" });

  const error = await pusher([res(200, PRIVATE_REPO), res(502, "nope")]).backup.inspectBackupRepository({ ...TARGET, folder: "f" });
  assert.deepEqual(error, { ok: false, code: "provider-error", message: "GitHub branch lookup failed (status 502)" });

  for (const body of ["not json", { object: {} }]) {
    const noSha = await pusher([res(200, PRIVATE_REPO), res(200, body)]).backup.inspectBackupRepository({ ...TARGET, folder: "f" });
    assert.deepEqual(noSha, { ok: false, code: "provider-error", message: "GitHub branch lookup response did not include a sha" });
  }
});

test("inspect: parent-commit and folder lookup failures", async () => {
  const commitFail = await pusher([res(200, PRIVATE_REPO), REF_OK, res(500, {})]).backup.inspectBackupRepository({ ...TARGET, folder: "f" });
  assert.deepEqual(commitFail, { ok: false, code: "provider-error", message: "GitHub parent-commit lookup failed (status 500)" });
  for (const answer of [res(404, {}), res(200, { tree: {} })]) {
    const noTree = await pusher([res(200, PRIVATE_REPO), REF_OK, answer]).backup.inspectBackupRepository({ ...TARGET, folder: "f" });
    assert.deepEqual(noTree, { ok: false, code: "provider-error", message: "GitHub parent-commit lookup did not return a tree sha" });
  }
  const folderFail = await pusher([res(200, PRIVATE_REPO), REF_OK, COMMIT_OK, res(500, { message: "x" })]).backup.inspectBackupRepository({ ...TARGET, folder: "f" });
  assert.deepEqual(folderFail, { ok: false, code: "provider-error", message: "GitHub folder lookup failed: x" });
  const isFile = await pusher([res(200, PRIVATE_REPO), REF_OK, COMMIT_OK, res(200, { type: "file" })]).backup.inspectBackupRepository({ ...TARGET, folder: "f" });
  assert.deepEqual(isFile, { ok: false, code: "folder-is-file", message: "'f' exists on branch 'main' but is not a folder — refusing to replace it" });
});

test("upload: sends the bytes as a base64 blob and reports size and sha256", async () => {
  const content = new Uint8Array([1, 2, 3, 250]);
  const { backup, requests } = pusher([res(201, { sha: "blob1" })]);
  const result = await backup.uploadBackupBlob(TARGET, { path: "db.sqlite", content });
  assert.deepEqual(result, { ok: true, blob: { path: "db.sqlite", blobSha: "blob1", bytes: 4, sha256: createHash("sha256").update(content).digest("hex") } });
  assert.equal(requests[0].url, `${REPO}/git/blobs`);
  assert.deepEqual(JSON.parse(requests[0].body), { content: Buffer.from(content).toString("base64"), encoding: "base64" });
  const failed = await pusher([res(500, {})]).backup.uploadBackupBlob(TARGET, { path: "x", content });
  assert.deepEqual(failed, { ok: false, code: "provider-error", message: "GitHub blob creation failed (status 500)" });
});

const COMMIT_INPUT = { ...TARGET, branch: "main", folder: "backups", commitMessage: "Backup", parentCommitSha: "p1", baseTreeSha: "t0", htmlUrl: "https://github.com/acme/site" };

test("commit: one folder tree (blob + inline text), the root tree, the commit and an unforced ref update", async () => {
  const entries = [{ path: "db.sqlite", blobSha: "b1", bytes: 10, sha256: "h" }, { path: "a.txt", text: "hi", bytes: 2, sha256: "h2" }];
  const { backup, requests, queue } = pusher([res(201, { sha: "ft" }), res(201, { sha: "rt" }), res(201, { sha: "c1" }), res(200, {})]);
  const result = await backup.commitBackupTree({ ...COMMIT_INPUT, entries });
  assert.deepEqual(result, { ok: true, commitSha: "c1", commitUrl: "https://github.com/acme/site/commit/c1" });
  assert.deepEqual(JSON.parse(requests[0].body), {
    tree: [{ path: "db.sqlite", mode: "100644", type: "blob", sha: "b1" }, { path: "a.txt", mode: "100644", type: "blob", content: "hi" }],
  });
  assert.deepEqual(JSON.parse(requests[1].body), { base_tree: "t0", tree: [{ path: "backups", mode: "040000", type: "tree", sha: "ft" }] });
  assert.deepEqual(JSON.parse(requests[2].body), { message: "Backup", tree: "rt", parents: ["p1"] });
  assert.equal(requests[3].method, "PATCH");
  assert.equal(requests[3].url, `${REPO}/git/refs/heads/main`);
  assert.deepEqual(JSON.parse(requests[3].body), { sha: "c1" });
  assert.equal(queue.length, 0);
});

test("commit: a large folder is built over chained base_tree requests, split by entry count and by bytes", async () => {
  const many = Array.from({ length: 301 }, (_, i) => ({ path: `f${i}`, blobSha: `s${i}`, bytes: 1, sha256: "h" }));
  const byCount = pusher([res(201, { sha: "ft1" }), res(201, { sha: "ft2" }), res(201, { sha: "rt" }), res(201, { sha: "c" }), res(200, {})]);
  assert.equal((await byCount.backup.commitBackupTree({ ...COMMIT_INPUT, entries: many })).ok, true);
  const first = JSON.parse(byCount.requests[0].body);
  const second = JSON.parse(byCount.requests[1].body);
  assert.equal(first.tree.length, 300);
  assert.equal("base_tree" in first, false);
  assert.deepEqual(second, { base_tree: "ft1", tree: [{ path: "f300", mode: "100644", type: "blob", sha: "s300" }] });
  assert.equal(JSON.parse(byCount.requests[2].body).tree[0].sha, "ft2");

  const big = "x".repeat(1024 * 1024);
  const texts = [0, 1, 2].map((i) => ({ path: `t${i}`, text: big, bytes: big.length, sha256: "h" }));
  // Each 1 MiB text plus the next one would exceed the 2 MiB per-request share, so each rides alone.
  const byBytes = pusher([res(201, { sha: "a" }), res(201, { sha: "b" }), res(201, { sha: "d" }), res(201, { sha: "rt" }), res(201, { sha: "c" }), res(200, {})]);
  assert.equal((await byBytes.backup.commitBackupTree({ ...COMMIT_INPUT, entries: texts })).ok, true);
  assert.deepEqual(JSON.parse(byBytes.requests[0].body).tree.map((e) => e.path), ["t0"]);
  assert.deepEqual(JSON.parse(byBytes.requests[1].body).tree.map((e) => e.path), ["t1"]);
  assert.equal(JSON.parse(byBytes.requests[1].body).base_tree, "a");
  assert.deepEqual(JSON.parse(byBytes.requests[2].body).tree.map((e) => e.path), ["t2"]);
  assert.equal(byBytes.queue.length, 0);
});

test("commit: every step's failure and missing sha is reported, and nothing after it is sent", async () => {
  const entries = [{ path: "a", blobSha: "b", bytes: 1, sha256: "h" }];
  const cases = [
    [[res(500, {})], "GitHub folder tree creation failed (status 500)"],
    [[res(201, {})], "GitHub folder tree creation response did not include a sha"],
    [[res(201, { sha: "ft" }), res(500, {})], "GitHub tree creation failed (status 500)"],
    [[res(201, { sha: "ft" }), res(201, {})], "GitHub tree creation response did not include a sha"],
    [[res(201, { sha: "ft" }), res(201, { sha: "rt" }), res(500, {})], "GitHub commit creation failed (status 500)"],
    [[res(201, { sha: "ft" }), res(201, { sha: "rt" }), res(201, {})], "GitHub commit creation response did not include a sha"],
    [[res(201, { sha: "ft" }), res(201, { sha: "rt" }), res(201, { sha: "c" }), res(500, {})], "GitHub branch update failed (status 500)"],
  ];
  for (const [script, message] of cases) {
    const { backup, requests } = pusher(script);
    assert.deepEqual(await backup.commitBackupTree({ ...COMMIT_INPUT, entries }), { ok: false, code: "provider-error", message });
    assert.equal(requests.length, script.length);
  }
});

test("commit: a branch that moved since planning is diverged, with the re-plan instruction", async () => {
  const { backup } = pusher([res(201, { sha: "ft" }), res(201, { sha: "rt" }), res(201, { sha: "c" }), res(422, {})]);
  assert.deepEqual(await backup.commitBackupTree({ ...COMMIT_INPUT, entries: [{ path: "a", text: "t", bytes: 1, sha256: "h" }] }), {
    ok: false,
    code: "diverged",
    message: "branch 'main' moved since the backup was planned (someone pushed to it). Nothing was overwritten. Call site_backup_plan again.",
  });
});
