import assert from "node:assert/strict";
import test from "node:test";

import provider from "../github.mjs";
import { BACKUP_INLINE_TEXT_MAX_BYTES } from "../backup-push.mjs";
import { REPO, TARGET, res, scriptedKit } from "./fake-kit.mjs";

test("validateTarget: accepts GitHub-shaped owner/repo names and names the bad one otherwise", () => {
  assert.equal(provider.validateTarget({ owner: "acme-co", repo: "site.v2_x" }), null);
  assert.equal(provider.validateTarget({ owner: "-acme", repo: "site" }), "invalid GitHub owner '-acme'");
  assert.equal(provider.validateTarget({ owner: "a".repeat(80), repo: "site" }), `invalid GitHub owner '${"a".repeat(60)}'`);
  assert.equal(provider.validateTarget({ owner: "acme", repo: "a/b" }), "invalid GitHub repo 'a/b'");
  assert.equal(provider.validateTarget({ owner: "acme", repo: "." }), "invalid GitHub repo '.'");
  assert.equal(provider.validateTarget({ owner: "acme", repo: ".." }), "invalid GitHub repo '..'");
  assert.equal(provider.validateTarget({ owner: "acme", repo: "r".repeat(101) }), `invalid GitHub repo '${"r".repeat(100)}'`);
});

/** A kit whose `fetch` answers from `answer` and records each call. */
function fetchKit(answer) {
  const calls = [];
  const { kit } = scriptedKit([]);
  kit.fetch = async (url, init) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { kit, calls };
}
const jsonResponse = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

test("readAccountLabel: GET /user with the token, bounded, and returns only the login", async () => {
  const { kit, calls } = fetchKit(jsonResponse(200, { login: "octo", email: "secret@example.com" }));
  assert.equal(await provider.create({ kit }).readAccountLabel("tok1"), "octo");
  assert.equal(calls[0].url, "https://api.github.com/user");
  assert.deepEqual(calls[0].init.headers, { Authorization: "Bearer tok1", Accept: "application/vnd.github+json" });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("readAccountLabel: every failure is null, never a throw", async () => {
  const answers = [jsonResponse(401, { login: "x" }), jsonResponse(200, "null"), jsonResponse(200, "[]"), jsonResponse(200, { login: "" }), jsonResponse(200, { login: 3 }), jsonResponse(200, "not json"), new Error("offline")];
  for (const answer of answers) {
    assert.equal(await provider.create(fetchKit(answer)).readAccountLabel("t"), null);
  }
});

test("create: exposes the write and backup operations, the backup ones on the retrying long-idle client", async () => {
  const sleeps = [];
  const fake = scriptedKit([res(503, {}), res(404, {})], { sleep: async (ms) => void sleeps.push(ms) });
  const ops = provider.create({ kit: fake.kit });
  assert.equal(ops.backupInlineTextMaxBytes, BACKUP_INLINE_TEXT_MAX_BYTES);
  assert.equal(typeof ops.commitSite, "function");
  for (const name of ["planFileWrite", "commitFiles", "uploadBackupBlob", "commitBackupTree"]) assert.equal(typeof ops[name], "function");
  const result = await ops.inspectBackupRepository({ ...TARGET, folder: "f" });
  assert.equal(result.code, "repo-not-found");
  assert.deepEqual(sleeps, [2_000]);
  assert.equal(fake.requests[0].timeoutMs, 120_000);
  assert.equal(fake.requests[0].url, REPO);

  const single = scriptedKit([res(503, { message: "busy" })]);
  const plan = await provider.create({ kit: single.kit }).planFileWrite({ ...TARGET, branch: "main", files: [] });
  assert.deepEqual(plan, { ok: false, code: "provider-error", message: "GitHub branch lookup failed: busy" });
  assert.equal(single.requests.length, 1);
  assert.equal(single.requests[0].timeoutMs, 30_000);
});
