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

test("a missing canonical manifest reads predecessor ownership at the parent commit and publishes canonical ownership", async () => {
  const { kit, calls } = kitFrom([
    json(200, {}), json(200, { object: { sha: SHA_A } }), json(200, { tree: { sha: "t" } }),
    json(404, {}), manifestOf({ version: 2, files: [
      { path: "nested/site/old.html", sha: SHA_A }, { path: "nested/site/edited.html", sha: SHA_A },
    ] }),
    json(201, { sha: "b1" }), json(200, { sha: SHA_A }), json(200, { sha: "b".repeat(40) }),
    json(201, { sha: "mb" }), json(201, { sha: "nt" }), json(201, { sha: "c1" }), json(200, {}),
  ]);
  const result = await createSiteCommitter(kit)({ ...INPUT, folder: "nested/site", previousManagedManifestPath: ".previous/managed-files.json" });
  assert.equal(result.ok, true, "predecessor ownership allows the publish to complete");
  assert.deepEqual(calls.slice(3, 5).map(call => call.url), [
    `${API}/contents/nested/site/.jini/managed-files.json?ref=${SHA_A}`,
    `${API}/contents/nested/site/.previous/managed-files.json?ref=${SHA_A}`,
  ], "both ownership lookups read the captured parent commit");
  assert.deepEqual(calls.slice(6, 8).map(call => call.url), [
    `${API}/contents/nested/site/old.html?ref=${SHA_A}`,
    `${API}/contents/nested/site/edited.html?ref=${SHA_A}`,
  ], "both stale files are verified against the captured parent commit");
  const tree = JSON.parse(calls[9].body).tree;
  assert.deepEqual(tree.filter(entry => entry.sha === null), [
    { path: "nested/site/old.html", mode: "100644", type: "blob", sha: null },
  ], "only the unchanged stale file is deleted");
  assert.equal(result.filesDeleted, 1, "the publish reports one deleted file");
  assert.deepEqual(result.divergedPaths, ["nested/site/edited.html"], "the edited stale file is preserved and reported");
  assert.deepEqual(tree.find(entry => entry.path === "nested/site/.jini/managed-files.json"),
    { path: "nested/site/.jini/managed-files.json", mode: "100644", type: "blob", sha: "mb" }, "the publish writes canonical ownership in the target folder");
  assert.equal(tree.some(entry => entry.path === "nested/site/.previous/managed-files.json"), false, "the predecessor manifest is left untouched");
  assert.deepEqual(calls.filter(call => call.url.includes("/git/refs")), [
    { url: `${API}/git/refs/heads/main`, method: "PATCH", body: JSON.stringify({ sha: "c1" }) },
  ], "the cutover and publish share one non-forced update to the branch");
});

test("an existing empty canonical manifest takes precedence over the predecessor", async () => {
  const { kit, calls } = kitFrom([
    json(200, {}), json(200, { object: { sha: SHA_A } }), json(200, { tree: { sha: "t" } }),
    manifestOf({ version: 2, files: [] }), json(201, { sha: "b1" }),
    json(201, { sha: "mb" }), json(201, { sha: "nt" }), json(201, { sha: "c1" }), json(200, {}),
  ]);
  const result = await createSiteCommitter(kit)({ ...INPUT, folder: "nested/site", previousManagedManifestPath: ".previous/managed-files.json" });
  assert.equal(result.ok, true, "empty canonical ownership still permits publishing");
  assert.deepEqual(calls.filter(call => call.url.includes("/contents/")).map(call => call.url), [
    `${API}/contents/nested/site/.jini/managed-files.json?ref=${SHA_A}`,
  ], "only the canonical manifest is requested, pinned to the parent commit");
});

test("a rejected canonical lookup refuses the publish without reading predecessor ownership or writing", async () => {
  const { kit, calls } = kitFrom([
    json(200, {}), json(200, { object: { sha: SHA_A } }), json(200, { tree: { sha: "t" } }),
    json(500, { message: "unavailable" }),
  ]);
  const result = await createSiteCommitter(kit)({ ...INPUT, folder: "nested/site", previousManagedManifestPath: ".previous/managed-files.json" });
  assert.deepEqual(result, { ok: false, code: "provider-error", message: "unavailable" }, "a canonical server error is a provider refusal");
  assert.deepEqual(calls.slice(3), [
    { url: `${API}/contents/nested/site/.jini/managed-files.json?ref=${SHA_A}`, method: "GET", body: undefined },
  ], "the pinned canonical lookup is the last request, with no predecessor read or write");
});

test("the manifest lists every written path sorted, keeping duplicates in input order; its blob failing fails the commit", async () => {
  const files = [{ path: "b.html", data: "1" }, { path: "a.html", data: "2" }, { path: "c.html", data: "3" }, { path: "a.html", data: "4" }];
  const { kit, calls } = kitFrom([json(200, {}), json(404, {}), json(201, { sha: "s1" }), json(201, { sha: "s2" }), json(201, { sha: "s3" }), json(201, { sha: "s4" }), json(500, { message: "quota" })]);
  assert.deepEqual(await createSiteCommitter(kit)({ ...INPUT, branch: "new", files }), { ok: false, code: "provider-error", message: "quota" });
  const manifest = JSON.parse(Buffer.from(JSON.parse(calls[6].body).content, "base64").toString("utf8"));
  assert.deepEqual(manifest, { version: 2, files: [{ path: "a.html", sha: "s2" }, { path: "a.html", sha: "s4" }, { path: "b.html", sha: "s1" }, { path: "c.html", sha: "s3" }] });
});
