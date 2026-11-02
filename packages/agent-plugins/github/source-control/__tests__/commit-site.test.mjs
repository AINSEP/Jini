import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRepositoryFolder, prefixRepositoryPath, repositoryPathContained } from "@jini-ai/devops/source-control";

import { createSiteCommitter } from "../commit-site.mjs";

// Edge cases of the site committer driven through a hand-built kit (the port core passes in), so the
// thrown-value shapes core's own kit never produces — a non-Error redirect refusal, a thrown string —
// are reachable. The main flows are pinned by apps/website/.../bundled-github-commit-site.unit.test.ts.

const API = "https://api.github.com/repos/octo/demo";
const SHA_A = "a".repeat(40);

/** @param {unknown[]} script answers in order: a Response, or a value to throw */
function kitFrom(script, { redirectRefusal = () => false } = {}) {
  const calls = [];
  const queue = [...script];
  const kit = {
    // The real path policy core's kit carries (required since 1485b4e49's target folder); a
    // permissive fake here would hide the committer's own containment refusals.
    repositoryPaths: { normalizeFolder: normalizeRepositoryFolder, prefixPath: prefixRepositoryPath, contains: repositoryPathContained },
    async fetch(url, init) {
      calls.push({ url, method: init.method ?? "GET", body: init.body });
      const next = queue.shift();
      if (next instanceof Response) return next;
      throw next;
    },
    redirectGuardInit: (init) => init,
    assertNotRedirected: () => {},
    isRedirectRefusal: redirectRefusal,
  };
  return { kit, calls, queue };
}
const json = (status, body) => new Response(JSON.stringify(body), { status });
const manifestOf = (value) => json(200, { content: Buffer.from(JSON.stringify(value)).toString("base64") });
const INPUT = { token: "t", owner: "octo", repo: "demo", branch: "main", commitMessage: "m", files: [{ path: "index.html", data: "<p>" }] };

test("a redirect refusal thrown as a non-Error is still provider-error, with its text", async () => {
  const { kit } = kitFrom(["redirect to evil.example refused"], { redirectRefusal: (err) => err === "redirect to evil.example refused" });
  assert.deepEqual(await createSiteCommitter(kit)(INPUT), { ok: false, code: "provider-error", message: "redirect to evil.example refused" });
});

test("a thrown non-Error value is network-unreachable with its text; so is a failed branch lookup", async () => {
  assert.deepEqual(await createSiteCommitter(kitFrom(["socket hang up"]).kit)(INPUT), { ok: false, code: "network-unreachable", message: "socket hang up" });
  const { kit, calls } = kitFrom([json(200, { default_branch: "main" }), new Error("ECONNRESET")]);
  assert.deepEqual(await createSiteCommitter(kit)(INPUT), { ok: false, code: "network-unreachable", message: "ECONNRESET" });
  assert.equal(calls[1].url, `${API}/git/ref/heads/main`);
});

test("a blob POST that never gets a response is network-unreachable", async () => {
  const { kit, calls } = kitFrom([json(200, {}), json(404, {}), new Error("timeout-ish")]);
  assert.deepEqual(await createSiteCommitter(kit)(INPUT), { ok: false, code: "network-unreachable", message: "timeout-ish" });
  assert.equal(calls[2].url, `${API}/git/blobs`);
});

test("a manifest whose JSON is not an object is refused, never read as 'nothing owned'", async () => {
  const { kit } = kitFrom([json(200, {}), json(200, { object: { sha: "p" } }), json(200, { tree: { sha: "t" } }), manifestOf(5)]);
  assert.deepEqual(await createSiteCommitter(kit)(INPUT), {
    ok: false, code: "provider-error",
    message: "GitHub managed-manifest content did not match a recognized shape — cannot confirm which paths this adapter previously owned.",
  });
});

test("a live blob answer without a sha is unverifiable: the dropped path is kept and reported diverged", async () => {
  const { kit, calls, queue } = kitFrom([
    json(200, {}), json(200, { object: { sha: "p" } }), json(200, { tree: { sha: "t" } }),
    manifestOf({ version: 2, files: [{ path: "old.html", sha: SHA_A }] }),
    json(201, { sha: "b1" }),
    json(200, { sha: 12 }),
    json(201, { sha: "mb" }), json(201, { sha: "nt" }), json(201, { sha: "c1" }), json(200, {}),
  ]);
  const result = await createSiteCommitter(kit)(INPUT);
  assert.deepEqual(result.divergedPaths, ["old.html"]);
  assert.equal(result.filesDeleted, 0);
  assert.equal(calls[5].url, `${API}/contents/old.html?ref=main`);
  assert.equal(JSON.parse(calls[7].body).tree.some((e) => e.path === "old.html"), false);
  assert.equal(queue.length, 0);
});

test("the manifest lists every written path sorted, keeping duplicates in input order; its blob failing fails the commit", async () => {
  const files = [{ path: "b.html", data: "1" }, { path: "a.html", data: "2" }, { path: "c.html", data: "3" }, { path: "a.html", data: "4" }];
  const { kit, calls } = kitFrom([json(200, {}), json(404, {}), json(201, { sha: "s1" }), json(201, { sha: "s2" }), json(201, { sha: "s3" }), json(201, { sha: "s4" }), json(500, { message: "quota" })]);
  assert.deepEqual(await createSiteCommitter(kit)({ ...INPUT, branch: "new", files }), { ok: false, code: "provider-error", message: "quota" });
  const manifest = JSON.parse(Buffer.from(JSON.parse(calls[6].body).content, "base64").toString("utf8"));
  assert.deepEqual(manifest, { version: 2, files: [{ path: "a.html", sha: "s2" }, { path: "a.html", sha: "s4" }, { path: "b.html", sha: "s1" }, { path: "c.html", sha: "s3" }] });
});
