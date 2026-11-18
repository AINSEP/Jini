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

const NATIVE_FETCH_FORBIDDEN = async () => { throw new Error("the credentialed account probe must not use kit.fetch"); };

/** A kit whose guarded `httpClient` answers from `answer` (an Error is thrown, as a transport failure is). */
function probeKit(answer) {
  const { kit, requests, sendOptions } = scriptedKit([answer]);
  kit.fetch = NATIVE_FETCH_FORBIDDEN;
  return { kit, requests, sendOptions };
}
const jsonResponse = (status, body) => res(status, body);

test("readAccountLabel: GET /user with the token through the guarded client, bounded, redirects refused, login only", async () => {
  const { kit, requests, sendOptions } = probeKit(jsonResponse(200, { login: "octo", email: "secret@example.com" }));
  assert.equal(await provider.create({ kit }).readAccountLabel("tok1"), "octo");
  assert.deepEqual(requests, [{ method: "GET", url: "https://api.github.com/user", headers: { Authorization: "Bearer tok1", Accept: "application/vnd.github+json" }, timeoutMs: 10_000 }]);
  assert.deepEqual(sendOptions, [{ redirect: "error" }]);
});

test("readAccountLabel: every failure is null, never a throw", async () => {
  const answers = [jsonResponse(401, { login: "x" }), jsonResponse(302, { login: "x" }), jsonResponse(200, "null"), jsonResponse(200, "[]"), jsonResponse(200, { login: "" }), jsonResponse(200, { login: 3 }), jsonResponse(200, "not json"), new Error("offline")];
  for (const answer of answers) {
    assert.equal(await provider.create(probeKit(answer)).readAccountLabel("t"), null);
  }
});

const EVIL_ORIGIN = "https://redirected.example.invalid";

/**
 * A kit shaped like production on both outbound paths, with an API that answers `GET /user` with a
 * redirect to another host. `fetch` follows redirects (native `fetch` defaults to `redirect: "follow"`)
 * and `httpClient.send` is the guarded client (it refuses a redirect when the caller passes
 * `redirect: "error"`). `wire` lists every request that reached a host, with its credential header.
 */
function redirectingKit() {
  const wire = [];
  const reach = (url, headers) => {
    wire.push({ url, authorization: headers.Authorization });
    return url.startsWith(EVIL_ORIGIN) ? { status: 200, body: { login: "attacker-controlled" } } : { status: 302, location: `${EVIL_ORIGIN}/user` };
  };
  const { kit } = scriptedKit([]);
  kit.fetch = async (url, init) => {
    let answer = reach(url, init.headers);
    if (answer.status === 302) answer = reach(answer.location, init.headers);
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
  kit.httpClient.send = async (request, options = {}) => {
    const answer = reach(request.url, request.headers);
    if (answer.status !== 302) return res(answer.status, answer.body);
    if (options.redirect === "error") throw new Error("redirect response refused by the request's redirect policy");
    return res(200, reach(answer.location, request.headers).body);
  };
  return { kit, wire };
}

test("readAccountLabel: a redirect is refused; no request with the credential reaches the redirected host", async () => {
  const { kit, wire } = redirectingKit();
  assert.equal(await provider.create({ kit }).readAccountLabel("tok-secret"), null);
  assert.deepEqual(wire.filter((hit) => hit.url.startsWith(EVIL_ORIGIN)), [], "the redirect target was contacted");
  assert.equal(wire.length, 1);
  assert.equal(wire[0].authorization, "Bearer tok-secret");
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
