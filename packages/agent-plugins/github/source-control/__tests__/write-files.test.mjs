import assert from "node:assert/strict";
import test from "node:test";

import { createFileWriter, createGitDataClient, encPath, extractStringField, providerErrorMessage, repoPathOf, retryDelayMs } from "../write-files.mjs";
import { REPO, TARGET, res, scriptedKit } from "./fake-kit.mjs";

const POLICY = { maxAttempts: 4, baseBackoffMs: 100, maxBackoffMs: 250, rateLimitWaitMs: 60_000, maxWaitMs: 5_000 };
const resp = (status, headers, bodyText = "") => ({ kind: "response", response: { status, bodyText, ...(headers ? { headers } : {}) } });

function writer(script, options) {
  const fake = scriptedKit(script, options);
  return { ...fake, files: createFileWriter(createGitDataClient(fake.kit)) };
}

test("path helpers: base URL with or without a trailing slash, per-segment encoding, non-object fields", () => {
  assert.equal(repoPathOf({ ...TARGET, baseUrl: "https://ghe.example/api/v3" }), "https://ghe.example/api/v3/repos/acme/site");
  assert.equal(repoPathOf({ ...TARGET, owner: "a b", repo: "c/d" }), "https://api.github.com/repos/a%20b/c%2Fd");
  assert.equal(encPath("a b/c#d"), "a%20b/c%23d");
  assert.equal(extractStringField(null, "x"), "");
  assert.equal(extractStringField("str", "x"), "");
  assert.equal(extractStringField({ x: 1 }, "x"), "");
  assert.equal(extractStringField({ x: "v" }, "x"), "v");
  assert.equal(providerErrorMessage({ status: 400, bodyText: '{"message":5}' }, "F"), "F (status 400)");
});

test("retryDelayMs: transport failures back off unless the egress policy refused", () => {
  assert.equal(retryDelayMs({ kind: "network-unreachable", refused: false }, 1, POLICY), 100);
  assert.equal(retryDelayMs({ kind: "network-unreachable", refused: false }, 2, POLICY), 200);
  assert.equal(retryDelayMs({ kind: "network-unreachable", refused: false }, 3, POLICY), 250);
  assert.equal(retryDelayMs({ kind: "network-unreachable", refused: true }, 1, POLICY), undefined);
});

test("retryDelayMs: 5xx backs off, a plain 4xx is final", () => {
  assert.equal(retryDelayMs(resp(503), 1, POLICY), 100);
  assert.equal(retryDelayMs(resp(500), 2, POLICY), 200);
  assert.equal(retryDelayMs(resp(404), 1, POLICY), undefined);
  assert.equal(retryDelayMs(resp(403, { "x-ratelimit-remaining": "12" }, "forbidden"), 1, POLICY), undefined);
});

test("retryDelayMs: rate limits follow GitHub's documented order", () => {
  assert.equal(retryDelayMs(resp(429, { "Retry-After": "7" }), 1, POLICY), 7_000);
  assert.equal(retryDelayMs(resp(403, { "retry-after": "0" }), 1, POLICY), 0);
  // An unusable retry-after falls through to the reset header, then to the fixed secondary-limit wait.
  assert.equal(retryDelayMs(resp(429, { "retry-after": "-1" }), 1, POLICY), 60_000);
  assert.equal(retryDelayMs(resp(429, { "retry-after": "soon" }), 1, POLICY), 60_000);
  assert.equal(retryDelayMs(resp(429), 1, POLICY), 60_000);
  assert.equal(retryDelayMs(resp(403, { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1" }), 1, POLICY), 1_000);
  const future = Math.floor(Date.now() / 1000) + 100;
  const wait = retryDelayMs(resp(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(future) }), 1, POLICY);
  assert.ok(wait > 90_000 && wait <= 101_000, `waits until the reset, got ${wait}`);
  assert.equal(retryDelayMs(resp(403, { "x-ratelimit-remaining": "0" }), 1, POLICY), 60_000);
  assert.equal(retryDelayMs(resp(403, undefined, "You have exceeded a secondary rate limit"), 1, POLICY), 60_000);
  assert.equal(retryDelayMs(resp(403, undefined, "Abuse Detection mechanism"), 1, POLICY), 60_000);
});

test("client: retries a transient failure with the kit's sleep, and stops at maxAttempts", async () => {
  const sleeps = [];
  const sleep = async (ms) => void sleeps.push(ms);
  const { kit, requests } = scriptedKit([res(502, {}), Object.assign(new Error("reset"), {}), res(200, { ok: 1 })], { sleep });
  const git = createGitDataClient(kit, { retry: POLICY });
  assert.deepEqual(await git.getJson(TARGET, `${REPO}/x`, "F"), { ok: true, found: true, json: { ok: 1 } });
  assert.deepEqual(sleeps, [100, 200]);
  assert.equal(requests.length, 3);

  const capped = scriptedKit([res(500, {}), res(500, {}), res(500, {}), res(500, {})], { sleep });
  const result = await createGitDataClient(capped.kit, { retry: POLICY }).getJson(TARGET, `${REPO}/x`, "F");
  assert.deepEqual(result, { ok: false, code: "provider-error", message: "F (status 500)" });
  assert.equal(capped.requests.length, 4);
});

test("client: a wait longer than maxWaitMs is reported, not slept on; a refusal is never retried", async () => {
  const sleeps = [];
  const long = scriptedKit([res(429, { message: "slow down" }, { "retry-after": "3600" })], { sleep: async (ms) => void sleeps.push(ms) });
  assert.deepEqual(await createGitDataClient(long.kit, { retry: POLICY }).getJson(TARGET, `${REPO}/x`, "F"), { ok: false, code: "provider-error", message: "F: slow down" });
  assert.deepEqual(sleeps, []);

  const refused = scriptedKit([Object.assign(new Error("blocked"), { refusal: "host not allowed" })]);
  const out = await createGitDataClient(refused.kit, { retry: POLICY }).postJson(TARGET, `${REPO}/y`, { a: 1 }, "F");
  assert.deepEqual(out, { ok: false, code: "network-unreachable", message: "the request to GitHub was refused: host not allowed", logDetail: "detail: blocked" });
  assert.equal(refused.requests.length, 1);
});

test("client: without a kit sleep the default timer is used for a zero-second retry-after", async () => {
  const { kit, requests } = scriptedKit([res(429, {}, { "retry-after": "0" }), res(200, [])]);
  assert.deepEqual(await createGitDataClient(kit, { retry: POLICY }).getJson(TARGET, `${REPO}/x`, "F"), { ok: true, found: true, json: [] });
  assert.equal(requests.length, 2);
});

test("client: request shape — auth, API version, JSON body only when there is one, custom timeout", async () => {
  const { kit, requests } = scriptedKit([res(200, {}), res(201, "not json"), res(200, "{bad")]);
  const git = createGitDataClient(kit, { timeoutMs: 1234 });
  await git.getJson(TARGET, `${REPO}/a`, "F");
  assert.deepEqual(requests[0], {
    method: "GET", url: `${REPO}/a`, timeoutMs: 1234,
    headers: { Authorization: "Bearer tok", Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" },
  });
  assert.deepEqual(await git.postJson(TARGET, `${REPO}/b`, { k: "v" }, "F"), { ok: false, code: "provider-error", message: "GitHub returned a non-JSON response." });
  assert.equal(requests[1].headers["Content-Type"], "application/json");
  assert.equal(requests[1].body, '{"k":"v"}');
  assert.deepEqual(await git.getJson(TARGET, `${REPO}/c`, "F"), { ok: false, code: "provider-error", message: "GitHub returned a non-JSON response." });
  const blob = await scriptedKitBlob([res(500, {})]);
  assert.equal(blob.code, "provider-error");
});

async function scriptedKitBlob(script) {
  return createGitDataClient(scriptedKit(script).kit).createBlob(TARGET, "x");
}

test("client: updateRef — a transport failure is network-unreachable", async () => {
  const { kit } = scriptedKit([new Error("down")]);
  assert.deepEqual(await createGitDataClient(kit).updateRef(TARGET, "main", "s"), {
    ok: false, code: "network-unreachable", message: "GitHub could not be reached: the request failed before any response arrived (a network error or timeout).", logDetail: "detail: down",
  });
});

const PLAN_INPUT = { ...TARGET, branch: "main" };
const REF = res(200, { object: { sha: "p1" } });
const COMMIT = res(200, { tree: { sha: "t1" } });

test("plan: one listing per directory decides create vs update for every file", async () => {
  const files = [{ path: "index.html", content: "" }, { path: "docs/a.md", content: "" }, { path: "docs/b.md", content: "" }, { path: "new/c.md", content: "" }];
  const { files: w, requests } = writer([REF, COMMIT, res(200, [{ name: "index.html", type: "file", download_url: "u" }]), res(200, [{ name: "a.md", type: "file", download_url: "u" }]), res(404, {})]);
  const result = await w.planFileWrite({ ...PLAN_INPUT, files });
  assert.deepEqual(result, {
    ok: true,
    plan: { parentCommitSha: "p1", baseTreeSha: "t1", fileStates: [
      { path: "index.html", exists: true }, { path: "docs/a.md", exists: true }, { path: "docs/b.md", exists: false }, { path: "new/c.md", exists: false },
    ] },
  });
  assert.deepEqual(requests.map((r) => r.url), [
    `${REPO}/git/ref/heads/main`, `${REPO}/git/commits/p1`, `${REPO}/contents?ref=main`, `${REPO}/contents/docs?ref=main`, `${REPO}/contents/new?ref=main`,
  ]);
});

test("plan: refuses to overwrite a symlink, submodule or directory, and a parent that is a file", async () => {
  for (const entry of [{ name: "x", type: "file", download_url: null }, { name: "x", type: "dir" }]) {
    const { files: w } = writer([REF, COMMIT, res(200, [entry])]);
    assert.deepEqual(await w.planFileWrite({ ...PLAN_INPUT, files: [{ path: "x", content: "" }] }), {
      ok: false, code: "provider-error", message: "'x' already exists on the branch but is not a regular file — refusing to overwrite it with a blob",
    });
  }
  const { files: w } = writer([REF, COMMIT, res(200, { type: "file" })]);
  assert.deepEqual(await w.planFileWrite({ ...PLAN_INPUT, files: [{ path: "d/x", content: "" }] }), { ok: false, code: "provider-error", message: "'d' is a file on the branch, not a directory" });
});

test("plan: a possibly-truncated listing falls back to a per-file lookup for names it does not show", async () => {
  const full = Array.from({ length: 1000 }, (_, i) => ({ name: `n${i}`, type: "file", download_url: "u" }));
  const files = [{ path: "d/n1", content: "" }, { path: "d/f1", content: "" }, { path: "d/f2", content: "" }];
  const { files: w, requests } = writer([REF, COMMIT, res(200, full), res(200, { type: "file" }), res(404, {})]);
  assert.deepEqual(await w.planFileWrite({ ...PLAN_INPUT, files }), {
    ok: true, plan: { parentCommitSha: "p1", baseTreeSha: "t1", fileStates: [{ path: "d/n1", exists: true }, { path: "d/f1", exists: true }, { path: "d/f2", exists: false }] },
  });
  assert.equal(requests[3].url, `${REPO}/contents/d/f1?ref=main`);

  for (const answer of [res(200, []), res(200, { type: "symlink" })]) {
    const bad = writer([REF, COMMIT, res(200, full), answer]);
    assert.equal((await bad.files.planFileWrite({ ...PLAN_INPUT, files: [{ path: "d/zz", content: "" }] })).message, "'d/zz' already exists on the branch but is not a regular file — refusing to overwrite it with a blob");
  }
  const failed = writer([REF, COMMIT, res(200, full), res(500, {})]);
  assert.deepEqual(await failed.files.planFileWrite({ ...PLAN_INPUT, files: [{ path: "d/zz", content: "" }] }), { ok: false, code: "provider-error", message: "GitHub lookup of 'd/zz' failed (status 500)" });
});

test("plan: each lookup's failure or incomplete answer is reported", async () => {
  const cases = [
    [[res(500, {})], { ok: false, code: "provider-error", message: "GitHub branch lookup failed (status 500)" }],
    [[res(404, {})], { ok: false, code: "branch-not-found", message: "branch 'main' does not exist in acme/site" }],
    [[res(200, {})], { ok: false, code: "provider-error", message: "GitHub branch lookup response did not include a sha" }],
    [[REF, res(500, {})], { ok: false, code: "provider-error", message: "GitHub parent-commit lookup failed (status 500)" }],
    [[REF, res(404, {})], { ok: false, code: "provider-error", message: "GitHub parent-commit lookup returned 404 for a sha this call just resolved" }],
    [[REF, res(200, {})], { ok: false, code: "provider-error", message: "GitHub parent-commit response did not include a tree sha" }],
    [[REF, COMMIT, res(500, {})], { ok: false, code: "provider-error", message: "GitHub directory lookup of '' failed (status 500)" }],
  ];
  for (const [script, expected] of cases) {
    assert.deepEqual(await writer(script).files.planFileWrite({ ...PLAN_INPUT, files: [{ path: "x", content: "" }] }), expected);
  }
});

const COMMIT_INPUT = { ...TARGET, branch: "main", commitMessage: "msg" };
const PLAN = { parentCommitSha: "p1", baseTreeSha: "t1" };

test("commit: keeps each file's mode, shares one blob per distinct content, then tree, commit and ref", async () => {
  const files = [{ path: "run.sh", content: "same" }, { path: "lib/a.js", content: "same" }, { path: "lib/new.js", content: "other" }, { path: "top.txt", content: "t" }];
  const rootTree = res(200, { tree: [{ path: "run.sh", type: "blob", mode: "100755" }, { path: "lib", type: "tree", sha: "libsha" }] });
  const libTree = res(200, { tree: [{ path: "a.js", type: "blob", mode: "100644" }] });
  const script = [rootTree, libTree, res(201, { sha: "b-same" }), res(201, { sha: "b-other" }), res(201, { sha: "b-t" }), res(201, { sha: "nt" }), res(201, { sha: "c9" }), res(200, {})];
  const { files: w, requests, queue } = writer(script);
  assert.deepEqual(await w.commitFiles({ ...COMMIT_INPUT, files }, PLAN), { ok: true, commitSha: "c9", commitUrl: "https://github.com/acme/site/commit/c9" });
  assert.deepEqual(requests.slice(0, 2).map((r) => r.url), [`${REPO}/git/trees/t1`, `${REPO}/git/trees/libsha`]);
  assert.deepEqual(JSON.parse(requests[5].body), {
    base_tree: "t1",
    tree: [
      { path: "run.sh", mode: "100755", type: "blob", sha: "b-same" },
      { path: "lib/a.js", mode: "100644", type: "blob", sha: "b-same" },
      { path: "lib/new.js", mode: "100644", type: "blob", sha: "b-other" },
      { path: "top.txt", mode: "100644", type: "blob", sha: "b-t" },
    ],
  });
  assert.deepEqual(JSON.parse(requests[6].body), { message: "msg", tree: "nt", parents: ["p1"] });
  assert.equal(queue.length, 0);
});

test("commit: refuses to guess modes from an incomplete tree, or to overwrite a non-file", async () => {
  const incomplete = "GitHub returned an incomplete tree — refusing to guess file modes";
  for (const answer of [res(404, {}), res(200, { tree: "x" }), res(200, { tree: [], truncated: true })]) {
    assert.deepEqual(await writer([answer]).files.commitFiles({ ...COMMIT_INPUT, files: [{ path: "a", content: "" }] }, PLAN), { ok: false, code: "provider-error", message: incomplete });
  }
  assert.deepEqual(await writer([res(500, {})]).files.commitFiles({ ...COMMIT_INPUT, files: [{ path: "a", content: "" }] }, PLAN), { ok: false, code: "provider-error", message: "GitHub file-mode lookup failed (status 500)" });
  const notRegular = (p) => ({ ok: false, code: "provider-error", message: `'${p}' already exists on the branch but is not a regular file — refusing to overwrite it with a blob` });
  const roots = [
    [{ path: "d", type: "blob", mode: "100644" }, "d/x"],
    [{ path: "d", type: "tree", sha: "" }, "d/x"],
    [{ path: "d", type: "tree" }, "d/x"],
    [{ path: "a", type: "tree", sha: "s" }, "a"],
    [{ path: "a", type: "blob", mode: "120000" }, "a"],
    [{ path: "a", type: "commit", mode: "160000" }, "a"],
  ];
  for (const [entry, p] of roots) {
    assert.deepEqual(await writer([res(200, { tree: [entry] })]).files.commitFiles({ ...COMMIT_INPUT, files: [{ path: p, content: "" }] }, PLAN), notRegular(p));
  }
});

test("commit: each write step's failure or missing sha stops the commit", async () => {
  const modes = res(200, { tree: [] });
  const cases = [
    [[modes, res(500, {})], { ok: false, code: "provider-error", message: "GitHub blob creation failed (status 500)" }],
    [[modes, res(201, {})], { ok: false, code: "provider-error", message: "GitHub blob creation response did not include a sha" }],
    [[modes, res(201, { sha: "b" }), res(500, {})], { ok: false, code: "provider-error", message: "GitHub tree creation failed (status 500)" }],
    [[modes, res(201, { sha: "b" }), res(201, {})], { ok: false, code: "provider-error", message: "GitHub tree creation response did not include a sha" }],
    [[modes, res(201, { sha: "b" }), res(201, { sha: "t" }), res(500, {})], { ok: false, code: "provider-error", message: "GitHub commit creation failed (status 500)" }],
    [[modes, res(201, { sha: "b" }), res(201, { sha: "t" }), res(201, {})], { ok: false, code: "provider-error", message: "GitHub commit creation response did not include a sha" }],
    [[modes, res(201, { sha: "b" }), res(201, { sha: "t" }), res(201, { sha: "c" }), res(422, {})], { ok: false, code: "diverged", message: "the branch has moved since this write was confirmed — refusing to overwrite it" }],
  ];
  for (const [script, expected] of cases) {
    const { files: w, requests } = writer(script);
    assert.deepEqual(await w.commitFiles({ ...COMMIT_INPUT, files: [{ path: "a", content: "x" }] }, PLAN), expected);
    assert.equal(requests.length, script.length);
  }
});
