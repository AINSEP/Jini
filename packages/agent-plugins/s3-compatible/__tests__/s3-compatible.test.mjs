// Moved from Tovu's apps/website/src/features/agent-plugins/__tests__/unit/bundled-deploy-s3-compatible.unit.test.ts (types stripped), then with the plugin into Jini
// (2026-11-02): the host kit is now `./fake-deploy-host-kit.mjs`, a test double over the same devops helpers.
import assert from "node:assert/strict";
import test from "node:test";

import { DeployError } from "@jini-ai/devops/deploy";

import path from "node:path";
import { pathToFileURL } from "node:url";

import { createFakeDeployHostKit } from "./fake-deploy-host-kit.mjs";

import { installNetworkGuard } from "./vitest-compat.mjs";

/**
 * @file The bundled `s3-compatible` plugin's module
 * (`targets/s3-compatible.mjs`).
 *
 * MOVED, not re-authored, from Tovu core's
 * `features/deployments/static-publish/__tests__/s3-compatible-target.unit.test.ts`: every case below
 * the "Moved" marker is that file's, unchanged except that `S3CompatibleDeployTarget` and
 * `toDeployLinkStatus` now come from the plugin module bound to a host kit (whose SigV4 client calls
 * the faked global `fetch` with one signed `Request`). The network guard fails the file if any call
 * reaches an unfaked `fetch`. The cases at the end are new: the module contract.
 *
 * In Jini (2026-11-02) the kit is `./fake-deploy-host-kit.mjs`: its SigV4 client keeps the first
 * host's `aws4fetch` call shape (one signed `Request`, SigV4-shaped `Authorization` with the real
 * credential scope) but has no built-in retries and a placeholder signature. The `aws4fetch` notes
 * below explain status choices made against the real signer; they stay valid without its retries.
 * Real signature verification is the host signer's test (Tovu: its s3-compatible overlay).
 */

installNetworkGuard();

const MODULE_PATH = path.resolve(import.meta.dirname, "../targets/s3-compatible.mjs");


const loaded = (await import(pathToFileURL(MODULE_PATH).href));
const { S3CompatibleDeployTarget, toDeployLinkStatus } = loaded.bindS3Compatible(createFakeDeployHostKit());


/**
 * @file `S3CompatibleDeployTarget` — SigV4-signed PUT per file (spec §1/§2), path-style addressing,
 * endpoint derivation for plain AWS S3, bounded upload concurrency, and the honest terminal `status`
 * this target decides from a real reachability check (spec §3a's "uploaded, not yet reachable"
 * requirement — this file proves the LOWER half of that contract; `adapter.ts`'s own test proves the
 * `StaticPublishOutcome` mapping built on top of it).
 *
 * Every test replaces `globalThis.fetch` with a recording fake — this target (via `aws4fetch`'s
 * `AwsClient.fetch`) and the reused `checkDeploymentUrl` helper both call the bare global `fetch`, so
 * intercepting it here is sufficient to keep this suite hermetic; no real network call is ever made.
 */

const CONFIG = {
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "s3cr3t",
  bucket: "my-bucket",
  region: "us-east-1",
  publicUrl: "https://my-bucket.s3.us-east-1.amazonaws.com",
};

const FILES = [
  { file: "index.html", data: "<html>home</html>", contentType: "text/html" },
  { file: "about/index.html", data: "<html>about</html>", contentType: "text/html" },
  { file: "robots.txt", data: "User-agent: *" },
];


/**
 * Installs a recording fake for `globalThis.fetch`, restored by the caller. `respond` decides the
 * response for each call by URL/method — defaults to a 200 for anything unmatched, so a test only
 * needs to special-case the calls it cares about.
 *
 * `aws4fetch`'s `AwsClient.fetch(url, init)` calls `this.sign(url, init)` first, which returns a real
 * signed `Request` object, and THEN calls the global `fetch` with that ONE `Request` argument (no
 * separate `init`) — confirmed by reading `aws4fetch.cjs.js` directly rather than assumed from its
 * `.d.ts`. So method/headers must be read off the `Request` object itself, never off a second `init`
 * argument, which `checkDeploymentUrl`'s own unsigned probes never pass either.
 */
function installFakeFetch(respond) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const call =
      input instanceof Request
        ? { url: input.url, method: input.method, headers: input.headers }
        : { url: typeof input === "string" ? input : input.toString(), method: init?.method ?? "GET", headers: new Headers(init?.headers) };
    if (input instanceof Request && input.method === "PUT") call.bodyBytes = input.clone().arrayBuffer().then(bytes => Buffer.from(bytes));
    calls.push(call);
    return respond(call);
  });
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function okResponse() {
  return new Response("", { status: 200 });
}

/** A response whose `.ok`/`.status` are readable but whose body read itself fails — proves
 *  `safeErrorBody`'s own `catch { return ""; }` never lets a body-read failure mask the original
 *  HTTP error. Duck-typed rather than a real `Response` subclass: every call site only ever reads
 *  `.ok`, `.status`, `.headers.get(...)`, and `.text()` off it. */
function brokenBodyResponse(status) {
  return { ok: false, status, headers: new Headers(), text: () => Promise.reject(new Error("body read exploded")) };
}

/** This target's own retry bound for the manifest read-verify-delete-write cycle — a literal here
 *  (not imported), matching this file's own `MANAGED_MANIFEST_KEY` literal above and its stated
 *  reasoning: a test importing the real constant could silently stop proving what it claims to if
 *  the production value ever changed without the test noticing. */
const MAX_MANIFEST_WRITE_ATTEMPTS = 3;

/** The dedicated-prefix manifest key this target must maintain — a literal here (not imported) so a
 *  test that changes the real constant's value is forced to also re-examine this file's own
 *  assumptions about it, the same reasoning `CONFIG`/`FILES` above are plain literals rather than
 *  imports from the production module. Declared here (not only near the CRITICAL FIX section below) so
 *  the plain default responder immediately below can reference it. */
const MANAGED_MANIFEST_KEY = ".tovu/managed-keys.json";

/** Default fake response for tests below that don't care about the managed-keys manifest at all — a GET
 *  for it must be answered with a REAL, verified 404 ("no manifest yet"), never a generic empty 200 body.
 *  A 200-with-empty-body used to be silently tolerated as "nothing was ever managed" (the exact
 *  read-failure defect this target's SECOND-ROUND CRITICAL FIX note, finding 2, closes) — this target now
 *  correctly refuses to guess at an unreadable manifest, so a fixture that doesn't otherwise care about
 *  manifest behavior must give it a REAL "not found" to stay a realistic simulation. Every other call
 *  gets the same generic `okResponse()` these tests already relied on. */
function respondIgnoringManifest(call) {
  if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("Not Found", { status: 404 });
  return okResponse();
}

/** Extracts `{url, method}` from whatever `globalThis.fetch` was actually called with — mirrors
 *  `installFakeFetch`'s own `Call` builder (see that function's doc): `aws4fetch`'s `AwsClient.fetch`
 *  always calls the global `fetch` with ONE signed `Request` object, but `checkDeploymentUrl`'s own
 *  plain unauthenticated reachability probe calls it with a bare string URL and a separate `init` —
 *  NOT a `Request`. A hand-rolled mock below that blindly casts `input as Request` throws on that second
 *  shape (`new URL(undefined)` inside `Request.url` access), which `checkDeploymentUrl` then reports as
 *  "not reachable" rather than the real cause — a mock bug, not a genuine unreachable-link finding. */
function requestUrlAndMethod(input) {
  if (input instanceof Request) return { url: input.url, method: input.method };
  return { url: typeof input === "string" ? input : input.toString(), method: "GET" };
}

test("publish: signs and PUTs every file to a path-style object URL, then reports 'ready' when the public URL is reachable", async () => {
  const fake = installFakeFetch(respondIgnoringManifest);
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const files = [...FILES, { file: "asset.bin", data: new Uint8Array([0, 255, 128, 65]) }];
    const result = await target.publish({ files, projectName: "demo" });

    assert.equal(result.targetId, "s3-compatible");
    assert.equal(result.url, CONFIG.publicUrl);
    assert.equal(result.status, "ready");

    const probes = fake.calls.filter((call) => call.url === `${CONFIG.publicUrl}/`);
    assert.equal(probes.length, 1, "publish must probe the configured public URL");
    assert.equal(probes[0].method, "HEAD");
    assert.equal(probes[0].headers.get("authorization"), null, "the public probe must be unsigned");

    // 4 file uploads + 1 managed-keys manifest write (always written last, see this target's own
    // CRITICAL fix note) + 1 reachability HEAD probe against publicUrl.
    const uploadCalls = fake.calls.filter((c) => c.method === "PUT" && !c.url.endsWith("managed-keys.json"));
    assert.equal(uploadCalls.length, 4);
    for (const file of files) {
      const call = uploadCalls.find(c => c.url.endsWith(`/my-bucket/${file.file}`));
      assert.ok(call, `missing upload for ${file.file}`);
      assert.deepEqual(await call.bodyBytes, Buffer.from(file.data));
    }

    const indexCall = uploadCalls.find((c) => c.url.endsWith("/my-bucket/index.html"));
    assert.ok(indexCall, `expected a PUT to .../my-bucket/index.html, got: ${uploadCalls.map((c) => c.url).join(", ")}`);
    assert.equal(indexCall.url, "https://s3.us-east-1.amazonaws.com/my-bucket/index.html");

    const nestedCall = uploadCalls.find((c) => c.url.endsWith("/my-bucket/about/index.html"));
    assert.ok(nestedCall, "nested deploy-relative paths must be preserved in the object key");

    // SigV4 signature present, scoped to service "s3" and the configured region — proves aws4fetch
    // actually signed the request rather than a plain unauthenticated PUT reaching the fake.
    const auth = indexCall.headers.get("authorization") ?? "";
    assert.match(auth, /^AWS4-HMAC-SHA256 /);
    assert.match(auth, /\/us-east-1\/s3\/aws4_request/);

    // Content-Type forwarded from DeployFile.contentType.
    assert.equal(indexCall.headers.get("content-type"), "text/html");
  } finally {
    fake.restore();
  }
});

test("publish: falls back to application/octet-stream when DeployFile.contentType is absent", async () => {
  const fake = installFakeFetch(respondIgnoringManifest);
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await target.publish({ files: [{ file: "robots.txt", data: "User-agent: *" }], projectName: "demo" });
    const uploadCall = fake.calls.find((c) => c.method === "PUT");
    assert.equal(uploadCall.headers.get("content-type"), "application/octet-stream");
  } finally {
    fake.restore();
  }
});

test("publish: an explicit endpoint is used verbatim (trailing slash stripped); a blank/omitted endpoint derives the plain-AWS-S3 host from region", async () => {
  const fake = installFakeFetch(respondIgnoringManifest);
  try {
    const target = new S3CompatibleDeployTarget({ ...CONFIG, region: "auto", endpoint: "https://abc123.r2.cloudflarestorage.com/" });
    await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    const uploadCall = fake.calls.find((c) => c.method === "PUT");
    assert.equal(uploadCall.url, "https://abc123.r2.cloudflarestorage.com/my-bucket/index.html");
  } finally {
    fake.restore();
  }
});

test("publish: throws DeployError naming the failing file when a PUT is rejected — never leaks credentials in the message", async () => {
  const fake = installFakeFetch((call) => (call.url.endsWith("about/index.html") ? new Response("Forbidden", { status: 403 }) : okResponse()));
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(
      () => target.publish({ files: FILES, projectName: "demo" }),
      (err) => {
        assert.ok(err instanceof DeployError);
        assert.match(err.message, /about\/index\.html/);
        assert.match(err.message, /403/);
        assert.doesNotMatch(err.message, new RegExp(CONFIG.secretAccessKey));
        assert.doesNotMatch(err.message, new RegExp(CONFIG.accessKeyId));
        return true;
      }
    );
  } finally {
    fake.restore();
  }
});

test("publish: reports 'link-delayed' (never throws) when every upload succeeds but the public URL is not yet reachable", async () => {
  const fake = installFakeFetch((call) => {
    if (call.url === `${CONFIG.publicUrl}/`) {
      assert.equal(call.headers.get("authorization"), null);
      return new Response("Not Found", { status: 404 });
    }
    return respondIgnoringManifest(call);
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const result = await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    assert.equal(result.status, "link-delayed");
    assert.equal(result.url, CONFIG.publicUrl);
    assert.deepEqual(fake.calls.filter((call) => call.url === `${CONFIG.publicUrl}/`).map((call) => call.method), ["HEAD", "GET"]);
  } finally {
    fake.restore();
  }
});

test("checkReachability: a plain unauthenticated probe against the given URL — reachable:true on 200, and never signed", async () => {
  const fake = installFakeFetch(() => okResponse());
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const check = await target.checkReachability("https://example.test/site");
    assert.equal(check.reachable, true);
    // Never signed — no Authorization header on the reachability probe.
    assert.ok(!fake.calls[0].headers.get("authorization"), "checkReachability must be a plain unauthenticated probe, never SigV4-signed");
  } finally {
    fake.restore();
  }
});

// ---------------------------------------------------------------------------
// toDeployLinkStatus — direct-invoke only. `publish()` always calls `checkDeploymentUrl` with no
// `detectProtected` option (see that call site), so a real `publish()` can never itself produce a
// `DeploymentUrlCheck` with `status: "protected"` — this function's own "protected" arm is
// otherwise unreachable through this file's real call path. Exported solely so this branch has a
// seam; see its doc comment.
// ---------------------------------------------------------------------------

test("toDeployLinkStatus: a reachable check is always 'ready', regardless of any status field", () => {
  const check = { reachable: true };
  assert.equal(toDeployLinkStatus(check), "ready");
});

test("toDeployLinkStatus: an unreachable check reporting status: 'protected' maps to 'protected'", () => {
  const check = { reachable: false, status: "protected" };
  assert.equal(toDeployLinkStatus(check), "protected");
});

test("toDeployLinkStatus: an unreachable check with no (or any other) status falls back to 'link-delayed'", () => {
  assert.equal(toDeployLinkStatus({ reachable: false }), "link-delayed");
  assert.equal(toDeployLinkStatus({ reachable: false, status: "failed" }), "link-delayed");
});

// ---------------------------------------------------------------------------
// CRITICAL FIX (2026-08-19, Codex 5.6-sol audit): stale-object cleanup via a managed-keys manifest
// ---------------------------------------------------------------------------

test("CRITICAL: publish deletes a previously-published key that is no longer part of the export, while an unrelated bucket object is left alone", async () => {
  // Simulates a small slice of real S3 semantics: a bucket that already holds an object this target
  // never wrote ('unrelated/human-uploaded.txt'), plus a manifest recording what Tovu published LAST
  // time — including 'secret-announcement/index.html', a page that has since been unpublished (removed
  // from this export), WITH the etag Tovu itself recorded observing when it wrote that key. Proves the
  // actual mechanism: the stale key's LIVE etag is verified (a HEAD call) to still match before the
  // stale key gets a real DELETE call; the unrelated key never does.
  const SECRET_ETAG = '"secret-announcement-etag"';
  const bucket = new Map([
    ["unrelated/human-uploaded.txt", "not Tovu's — must never be touched"],
    ["secret-announcement/index.html", "<html>old secret page</html>"],
    [MANAGED_MANIFEST_KEY, JSON.stringify({ version: 2, keys: [{ key: "secret-announcement/index.html", etag: SECRET_ETAG }] })],
  ]);
  const deletedKeys = [];

  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const { url, method } = requestUrlAndMethod(input);
    const key = decodeURIComponent(new URL(url).pathname.replace(`/${CONFIG.bucket}/`, ""));

    if (method === "GET" && key === MANAGED_MANIFEST_KEY) {
      const body = bucket.get(MANAGED_MANIFEST_KEY);
      return body !== undefined ? new Response(body, { status: 200 }) : new Response("Not Found", { status: 404 });
    }
    if (method === "HEAD" && key === "secret-announcement/index.html") {
      return new Response("", { status: 200, headers: { etag: SECRET_ETAG } });
    }
    if (method === "PUT") {
      bucket.set(key, "uploaded");
      return new Response("", { status: 200, headers: { etag: '"new-etag"' } });
    }
    if (method === "DELETE") {
      deletedKeys.push(key);
      bucket.delete(key);
      return new Response(null, { status: 204 }); // a 204 body MUST be null — the Fetch spec forbids a body on this status
    }
    return new Response("", { status: 200 });
  });

  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    // This publish's export no longer includes 'secret-announcement/index.html' — the page was
    // unpublished. Only 'index.html' is published this time.
    await target.publish({ files: [{ file: "index.html", data: "<html>home</html>" }], projectName: "demo" });

    assert.deepEqual(deletedKeys, ["secret-announcement/index.html"], "the removed, previously-managed, etag-VERIFIED page must be explicitly deleted");
    assert.equal(bucket.has("unrelated/human-uploaded.txt"), true, "an object this target never wrote must never be deleted");
    assert.equal(bucket.get("unrelated/human-uploaded.txt"), "not Tovu's — must never be touched", "the unrelated object's content must be untouched, not merely its key");
  } finally {
    globalThis.fetch = original;
  }
});

test("CRITICAL: the managed-keys manifest is updated to the new export set ONLY AFTER upload and delete both succeed — never before", async () => {
  const STALE_ETAG = '"stale-etag"';
  const INDEX_ETAG = '"index-etag"';
  let manifest = JSON.stringify({ version: 2, keys: [{ key: "stale.html", etag: STALE_ETAG }] });
  const fake = installFakeFetch(async (call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) {
      return new Response(manifest, { status: 200 });
    }
    if (call.method === "HEAD" && call.url.endsWith("/stale.html")) return new Response("", { status: 200, headers: { etag: STALE_ETAG } });
    if (call.method === "PUT" && call.url.endsWith(MANAGED_MANIFEST_KEY)) manifest = (await call.bodyBytes).toString("utf8");
    if ((call.method === "PUT" || call.method === "HEAD") && call.url.endsWith("/index.html")) return new Response("", { headers: { etag: INDEX_ETAG } });
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });

    const manifestPut = fake.calls.find((c) => c.method === "PUT" && c.url.endsWith(MANAGED_MANIFEST_KEY));
    const indexPut = fake.calls.find((c) => c.method === "PUT" && c.url.endsWith("/index.html"));
    const staleDelete = fake.calls.find((c) => c.method === "DELETE" && c.url.endsWith("/stale.html"));

    assert.ok(indexPut, "the current export must be uploaded");
    assert.ok(staleDelete, "the stale, no-longer-exported, etag-verified key must be deleted");
    assert.ok(manifestPut, "the manifest must be rewritten to the new export set");

    assert.deepEqual(JSON.parse((await manifestPut.bodyBytes).toString("utf8")), { version: 2, keys: [{ key: "index.html", etag: INDEX_ETAG }] });
    const manifestIndex = fake.calls.indexOf(manifestPut);
    const indexPutIndex = fake.calls.indexOf(indexPut);
    const staleDeleteIndex = fake.calls.indexOf(staleDelete);
    assert.ok(manifestIndex > indexPutIndex, "the manifest write must happen AFTER the upload, never before");
    assert.ok(manifestIndex > staleDeleteIndex, "the manifest write must happen AFTER the delete, never before");
    const callsBefore = fake.calls.length;
    await target.publish({ files: [], projectName: "demo" });
    assert.deepEqual(fake.calls.slice(callsBefore).filter(c => c.method === "DELETE").map(c => new URL(c.url).pathname), ["/my-bucket/index.html"]);
    assert.deepEqual(JSON.parse(manifest), { version: 2, keys: [] });
  } finally {
    fake.restore();
  }
});

test("CRITICAL: a delete failure for a stale key throws (never silently drops the key from tracking) and does not update the manifest", async () => {
  const STALE_ETAG = '"stale-etag"';
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) {
      return new Response(JSON.stringify({ version: 2, keys: [{ key: "stale.html", etag: STALE_ETAG }] }), { status: 200 });
    }
    if (call.method === "HEAD" && call.url.endsWith("/stale.html")) return new Response("", { status: 200, headers: { etag: STALE_ETAG } });
    if (call.method === "DELETE" && call.url.endsWith("/stale.html")) return new Response("Forbidden", { status: 403 });
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(
      () => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }),
      (err) => {
        assert.ok(err instanceof DeployError);
        assert.match(err.message, /stale\.html/);
        return true;
      }
    );
    const manifestPut = fake.calls.find((c) => c.method === "PUT" && c.url.endsWith(MANAGED_MANIFEST_KEY));
    assert.equal(manifestPut, undefined, "a failed cleanup must never let the manifest 'forget' the still-undeleted stale key");
  } finally {
    fake.restore();
  }
});

test("CRITICAL: the FIRST publish ever (no prior manifest) deletes nothing — an unrelated pre-existing bucket object is never touched just because it wasn't in this export", async () => {
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("Not Found", { status: 404 });
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    const deletes = fake.calls.filter((c) => c.method === "DELETE");
    assert.deepEqual(deletes, [], "with no known managed-keys history, nothing may be inferred as safe to delete");
  } finally {
    fake.restore();
  }
});

// ---------------------------------------------------------------------------
// SECOND-ROUND CRITICAL FIX (2026-08-19, three independent auditors — Claude Sonnet 5, Codex 5.6-sol,
// Codex 5.6-terra): ownership-trust, a transient-read-failure data-loss hole, and no cross-publisher
// concurrency guard at all — all three confirmed independently against the manifest layer above.
// ---------------------------------------------------------------------------

test("CRITICAL (ownership-trust defect): a LEGACY (pre-provenance) manifest entry with no recorded etag does NOT authorize deletion — the object survives, untouched", async () => {
  const bucket = new Map([
    ["stale.html", "still here — this target cannot prove it still matches what it once wrote"],
    // The exact shape this target wrote BEFORE today's fix — a bare key list, no per-key etag. A
    // hand-edited manifest that merely lists a key (e.g. someone adding 'billing.csv' by hand) is
    // indistinguishable from this at the wire level — neither can prove ownership.
    [MANAGED_MANIFEST_KEY, JSON.stringify({ version: 1, keys: ["stale.html"] })],
  ]);
  const deletedKeys = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const { url, method } = requestUrlAndMethod(input);
    const key = decodeURIComponent(new URL(url).pathname.replace(`/${CONFIG.bucket}/`, ""));
    if (method === "GET" && key === MANAGED_MANIFEST_KEY) {
      const body = bucket.get(MANAGED_MANIFEST_KEY);
      return body !== undefined ? new Response(body, { status: 200 }) : new Response("Not Found", { status: 404 });
    }
    if (method === "PUT") {
      bucket.set(key, "uploaded");
      return new Response("", { status: 200, headers: { etag: '"new-etag"' } });
    }
    if (method === "DELETE") {
      deletedKeys.push(key);
      bucket.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response("", { status: 200 });
  });

  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    assert.deepEqual(deletedKeys, [], "a legacy manifest entry with no recorded etag must never be auto-deleted");
    assert.equal(bucket.has("stale.html"), true, "content with no verifiable provenance must survive the publish untouched");
  } finally {
    globalThis.fetch = original;
  }
});

test("CRITICAL (ownership-trust defect): a v2 manifest entry whose recorded etag no longer matches the LIVE object (something else wrote to that key since) does NOT authorize deletion", async () => {
  const TOVU_ETAG = '"tovu-original-etag"';
  const LIVE_ETAG = '"someone-else-wrote-this-etag"';
  const bucket = new Map([
    ["about.html", "content that changed after Tovu last published it"],
    [MANAGED_MANIFEST_KEY, JSON.stringify({ version: 2, keys: [{ key: "about.html", etag: TOVU_ETAG }] })],
  ]);
  const deletedKeys = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const { url, method } = requestUrlAndMethod(input);
    const key = decodeURIComponent(new URL(url).pathname.replace(`/${CONFIG.bucket}/`, ""));
    if (method === "GET" && key === MANAGED_MANIFEST_KEY) {
      const body = bucket.get(MANAGED_MANIFEST_KEY);
      return body !== undefined ? new Response(body, { status: 200 }) : new Response("Not Found", { status: 404 });
    }
    if (method === "HEAD" && key === "about.html") {
      // The live verification check — reports the CURRENT etag, which no longer matches what Tovu
      // itself recorded writing.
      return new Response("", { status: 200, headers: { etag: LIVE_ETAG } });
    }
    if (method === "PUT") {
      bucket.set(key, "uploaded");
      return new Response("", { status: 200, headers: { etag: '"new-etag"' } });
    }
    if (method === "DELETE") {
      deletedKeys.push(key);
      bucket.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response("", { status: 200 });
  });

  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const result = await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    assert.deepEqual(deletedKeys, [], "diverged content (an etag mismatch) must never be auto-deleted");
    assert.equal(bucket.has("about.html"), true, "content that changed since Tovu wrote it must survive the publish");
    assert.match(result.statusMessage ?? "", /about\.html/, "the diverged key must be reported to the caller, not silently dropped");
  } finally {
    globalThis.fetch = original;
  }
});

test("a candidate deletion whose LIVE-verification HEAD itself fails is skipped for THAT key only — never blocks the whole publish", async () => {
  const ETAG = '"stable-etag"';
  const bucket = new Map([
    ["flaky-check.html", "content"],
    [MANAGED_MANIFEST_KEY, JSON.stringify({ version: 2, keys: [{ key: "flaky-check.html", etag: ETAG }] })],
  ]);
  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const { url, method } = requestUrlAndMethod(input);
    const key = decodeURIComponent(new URL(url).pathname.replace(`/${CONFIG.bucket}/`, ""));
    if (method === "GET" && key === MANAGED_MANIFEST_KEY) {
      const body = bucket.get(MANAGED_MANIFEST_KEY);
      return body !== undefined ? new Response(body, { status: 200 }) : new Response("Not Found", { status: 404 });
    }
    if (method === "HEAD" && key === "flaky-check.html") throw new TypeError("ECONNRESET");
    if (method === "PUT") return new Response("", { status: 200, headers: { etag: '"new-etag"' } });
    if (method === "DELETE") throw new Error("must never be called for an unverifiable key");
    return new Response("", { status: 200 });
  });

  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const result = await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    assert.equal(result.status, "ready");
    assert.equal(bucket.has("flaky-check.html"), true, "an unverifiable candidate must survive, not be guessed-deleted");
  } finally {
    globalThis.fetch = original;
  }
});

test("CRITICAL (read-failure defect): a manifest read that fails for a reason OTHER than a verified 404 FAILS THE WHOLE PUBLISH — never silently treated as 'no manifest'", async () => {
  // 403, not 500/429: `aws4fetch`'s `AwsClient.fetch` has its OWN built-in retry-with-exponential-backoff
  // for any 5xx/429 response (real `setTimeout` waits, up to 10 attempts by default — verified by reading
  // `aws4fetch.cjs.js` directly) — pre-existing library behavior, unrelated to and untouched by this fix,
  // still fully mocked (no real network), but genuinely slow in a test. This target's own code treats
  // every non-2xx-non-404 identically (see `fetchManagedManifest`'s own doc), so a 403 exercises the
  // EXACT SAME code path as a 500 would, without paying aws4fetch's real retry delay.
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("Forbidden", { status: 403 });
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(
      () => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }),
      (err) => {
        assert.ok(err instanceof DeployError);
        return true;
      }
    );
    // The manifest must NEVER be overwritten off the back of an unreadable read — that would
    // permanently forget whatever the unreadable manifest used to track.
    const manifestPut = fake.calls.find((c) => c.method === "PUT" && c.url.endsWith(MANAGED_MANIFEST_KEY));
    assert.equal(manifestPut, undefined, "an unreadable manifest must never be silently overwritten");
  } finally {
    fake.restore();
  }
});

test("a manifest read that returns 200 with a body that is not valid JSON fails the whole publish — distinct from a verified 404", async () => {
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("not json at all {{{", { status: 200 });
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(() => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }), (err) => err instanceof DeployError);
  } finally {
    fake.restore();
  }
});

test("CRITICAL (concurrency defect): the exact traced race — a manifest write rejected as a conflict (412) retries against the FRESH manifest, never silently overwriting a concurrent publisher's already-completed work", async () => {
  // The audit's own traced scenario (sol/terra, 2026-08-19): initial manifest {x}; publisher A wants
  // final set {x} (an unchanged republish); publisher B wants final set {} (x unpublished). Pre-fix,
  // whichever publisher's manifest write landed SECOND would blindly overwrite the first with no check —
  // "the manifest says x exists, but the object is gone" was one reachable outcome; the other was two
  // publishers each stranding half the other's work. This test drives PUBLISHER A (the republisher)
  // through a SCRIPTED conflict: A's own manifest read observes a state that is stale by the time A's
  // own write lands, because publisher B has ALREADY raced ahead in between and fully committed {} —
  // deterministic, not relying on incidental Promise.all interleaving to reproduce the race.
  const X_ETAG = '"x-etag-original"';
  const bucket = new Map([["x.html", { body: "content", etag: X_ETAG }]]);
  let manifestGetCount = 0;
  let manifestPutCount = 0;

  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const { url, method } = requestUrlAndMethod(input);
    if (!url.startsWith("https://s3.us-east-1.amazonaws.com/my-bucket/")) {
      // Not a bucket-API call (e.g. `checkDeploymentUrl`'s own plain reachability probe against
      // `config.publicUrl`, a DIFFERENT virtual-hosted-style host) — generic success.
      return new Response("", { status: 200 });
    }
    const key = decodeURIComponent(new URL(url).pathname.replace(`/${CONFIG.bucket}/`, ""));

    if (method === "GET" && key === MANAGED_MANIFEST_KEY) {
      manifestGetCount += 1;
      if (manifestGetCount === 1) {
        // Publisher A's OWN first read — a snapshot from BEFORE publisher B raced ahead and unpublished
        // x.html. This is genuinely stale by the time A's own write below is attempted.
        return new Response(JSON.stringify({ version: 2, keys: [{ key: "x.html", etag: X_ETAG }] }), { status: 200, headers: { etag: '"manifest-etag-stale"' } });
      }
      // Every read AFTER the first sees the REAL current bucket state — publisher B has ALREADY deleted
      // x.html and committed an empty manifest by this point.
      const obj = bucket.get(MANAGED_MANIFEST_KEY);
      return obj !== undefined ? new Response(obj.body, { status: 200, headers: { etag: obj.etag } }) : new Response("Not Found", { status: 404 });
    }
    if (method === "HEAD" && key === "x.html") {
      const obj = bucket.get("x.html");
      return obj !== undefined ? new Response("", { status: 200, headers: { etag: obj.etag } }) : new Response("Not Found", { status: 404 });
    }
    if (method === "PUT" && key === MANAGED_MANIFEST_KEY) {
      manifestPutCount += 1;
      const req = input;
      const ifMatch = req.headers.get("if-match");
      const current = bucket.get(MANAGED_MANIFEST_KEY);
      // Real conditional-write semantics, uniformly applied on every attempt — no per-attempt scripting
      // needed: publisher A's FIRST attempt conditions on its own now-stale read (rejected, since
      // publisher B already won and rewrote the manifest to a different etag); its retry conditions on
      // the FRESH etag it just re-read, which naturally matches.
      if (current === undefined || current.etag !== ifMatch) return new Response("", { status: 412 });
      const body = await req.text();
      const newEtag = `"manifest-etag-write-${manifestPutCount}"`;
      bucket.set(key, { body, etag: newEtag });
      return new Response("", { status: 200, headers: { etag: newEtag } });
    }
    if (method === "PUT") {
      // Publisher A re-uploading x.html unchanged — a fresh etag every time is realistic (most
      // providers do not guarantee ETag stability for a re-PUT even of identical bytes).
      bucket.set(key, { body: "content", etag: '"x-etag-reuploaded"' });
      return new Response("", { status: 200, headers: { etag: '"x-etag-reuploaded"' } });
    }
    if (method === "DELETE") {
      bucket.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response("", { status: 200 });
  });

  // Publisher B's own race is not driven through a second `publish()` call — it is PRE-BAKED into the
  // mock's post-first-write bucket state (empty manifest, x.html gone), exactly what B's own completed
  // publish would have produced. This isolates the assertion to publisher A's own retry behavior:
  // simulating B's full independent run through a second live `publish()` call would reintroduce the
  // same uncontrolled interleaving this rewrite deliberately avoids.
  bucket.set(MANAGED_MANIFEST_KEY, { body: JSON.stringify({ version: 2, keys: [] }), etag: '"manifest-etag-B-won"' });
  bucket.delete("x.html");
  // Restore x.html's pre-race existence for A's OWN read/upload path below (the delete above only
  // primes what A's SECOND manifest read will observe; A's first read is independently scripted above).
  bucket.set("x.html", { body: "content", etag: X_ETAG });

  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    // Publisher A republishes x.html — unchanged, from its own point of view.
    const result = await target.publish({ files: [{ file: "x.html", data: "content" }], projectName: "demo" });

    assert.equal(result.status, "ready", `publisher A's publish must still succeed after retrying past the conflict, got: ${JSON.stringify(result)}`);
    assert.equal(manifestGetCount, 2, "a conflict must trigger exactly one fresh re-read, not a blind retry against the same stale state");
    assert.equal(manifestPutCount, 2, "the first (rejected) attempt plus one successful retry");

    // The core correctness bar this fix exists for: the FINAL manifest must never claim a key that is
    // actually gone from the bucket, and publisher A's own republished content must survive.
    assert.equal(bucket.has("x.html"), true, "publisher A's own republished key must survive its own successful publish");
    const finalManifest = JSON.parse(bucket.get(MANAGED_MANIFEST_KEY).body);
    for (const { key: trackedKey } of finalManifest.keys) {
      assert.equal(bucket.has(trackedKey), true, `the manifest claims '${trackedKey}' exists but the object is gone — exactly the traced data-loss race`);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("CRITICAL (concurrency defect): a provider that does NOT support conditional writes (501) degrades to an unconditional write rather than blocking publishing, and discloses the residual risk", async () => {
  // 501 is genuinely required here (unlike the read-failure test above) — it IS the exact status this
  // target's own `writeManagedManifestConditional` keys off to detect "unsupported". But 501 is also
  // >= 500, which triggers `aws4fetch`'s OWN built-in retry-with-exponential-backoff (real `setTimeout`
  // waits, up to 10 attempts by default — see the read-failure test's own comment). Stubbing
  // `globalThis.setTimeout` to fire immediately makes those real (but entirely pre-existing,
  // library-internal, still fully mocked) retries instant without changing what is actually retried or
  // how many times — a test-timing fix only, never touching aws4fetch's or this target's own logic.
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn, ..._rest) => {
    fn();
    return 0;
  });

  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("Not Found", { status: 404 });
    if (call.method === "PUT" && call.url.endsWith(MANAGED_MANIFEST_KEY) && call.headers.get("if-none-match") === "*") {
      return new Response("Not Implemented", { status: 501 });
    }
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const result = await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    assert.equal(result.status, "ready", "publishing must still succeed end-to-end even without conditional-write support");
    const manifestPuts = fake.calls.filter((c) => c.method === "PUT" && c.url.endsWith(MANAGED_MANIFEST_KEY));
    assert.ok(manifestPuts.length >= 2, "expected an initial conditional attempt plus a fallback unconditional write");
    assert.equal(manifestPuts.at(-1).headers.get("if-none-match"), null, "the fallback write must be unconditional, not repeat the unsupported precondition");
    assert.match(result.statusMessage ?? "", /conditional|concurrency|precondition/i, "the residual risk must be disclosed to the caller, not silently absorbed");
  } finally {
    fake.restore();
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("publish: an endpoint that is present but blank/whitespace-only falls back to deriving the plain-AWS-S3 host from region", async () => {
  const fake = installFakeFetch(respondIgnoringManifest);
  try {
    const target = new S3CompatibleDeployTarget({ ...CONFIG, endpoint: "   " });
    await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    const uploadCall = fake.calls.find((c) => c.method === "PUT" && c.url.endsWith("/index.html"));
    assert.equal(uploadCall.url, "https://s3.us-east-1.amazonaws.com/my-bucket/index.html");
  } finally {
    fake.restore();
  }
});

test("publish: an upload failure whose error body cannot even be read still throws a bounded DeployError (safeErrorBody never masks the original failure)", async () => {
  const fake = installFakeFetch((call) => (call.method === "PUT" && !call.url.endsWith(MANAGED_MANIFEST_KEY) ? brokenBodyResponse(500) : okResponse()));
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(
      () => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }),
      (err) => {
        assert.ok(err instanceof DeployError);
        assert.match(err.message, /index\.html/);
        assert.match(err.message, /HTTP 500/);
        return true;
      }
    );
  } finally {
    fake.restore();
  }
});

test("publish: a stale key's DELETE returning 404 (already gone) is treated as success, not a failure", async () => {
  const STALE_ETAG = '"stale-etag"';
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) {
      return new Response(JSON.stringify({ version: 2, keys: [{ key: "stale.html", etag: STALE_ETAG }] }), { status: 200 });
    }
    if (call.method === "HEAD" && call.url.endsWith("/stale.html")) return new Response("", { status: 200, headers: { etag: STALE_ETAG } });
    if (call.method === "DELETE" && call.url.endsWith("/stale.html")) return new Response("Not Found", { status: 404 });
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const result = await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    assert.equal(result.status, "ready", "a 404 on an already-gone stale key must not fail the publish");
    const manifestPut = fake.calls.find((c) => c.method === "PUT" && c.url.endsWith(MANAGED_MANIFEST_KEY));
    assert.ok(manifestPut, "the manifest must still be written after a 404-on-delete (treated as success)");
  } finally {
    fake.restore();
  }
});

test("publish: a stale key's DELETE that throws at the transport layer surfaces as a bounded DeployError naming the key", async () => {
  const STALE_ETAG = '"stale-etag"';
  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const { url, method } = requestUrlAndMethod(input);
    if (method === "GET" && url.endsWith(MANAGED_MANIFEST_KEY)) {
      return new Response(JSON.stringify({ version: 2, keys: [{ key: "stale.html", etag: STALE_ETAG }] }), { status: 200 });
    }
    if (method === "HEAD" && url.endsWith("/stale.html")) return new Response("", { status: 200, headers: { etag: STALE_ETAG } });
    if (method === "DELETE" && url.endsWith("/stale.html")) throw new TypeError("ECONNRESET");
    return new Response("", { status: 200 });
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(
      () => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }),
      (err) => {
        assert.ok(err instanceof DeployError);
        assert.match(err.message, /stale\.html/);
        assert.match(err.message, /ECONNRESET/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("a candidate deletion whose live HEAD succeeds but reports no ETag is skipped, not deleted (unverifiable, not diverged)", async () => {
  const ETAG = '"stable-etag"';
  const bucket = new Map([
    ["no-etag.html", "content"],
    [MANAGED_MANIFEST_KEY, JSON.stringify({ version: 2, keys: [{ key: "no-etag.html", etag: ETAG }] })],
  ]);
  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const { url, method } = requestUrlAndMethod(input);
    const key = decodeURIComponent(new URL(url).pathname.replace(`/${CONFIG.bucket}/`, ""));
    if (method === "GET" && key === MANAGED_MANIFEST_KEY) {
      const body = bucket.get(MANAGED_MANIFEST_KEY);
      return body !== undefined ? new Response(body, { status: 200 }) : new Response("Not Found", { status: 404 });
    }
    if (method === "HEAD" && key === "no-etag.html") return new Response("", { status: 200 }); // no etag header at all
    if (method === "PUT") return new Response("", { status: 200, headers: { etag: '"new-etag"' } });
    if (method === "DELETE") throw new Error("must never be called for an unverifiable key");
    return new Response("", { status: 200 });
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const result = await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    assert.equal(result.status, "ready");
    assert.equal(bucket.has("no-etag.html"), true, "a HEAD with no etag header must never authorize deletion");
  } finally {
    globalThis.fetch = original;
  }
});

test("a candidate deletion whose live HEAD returns a non-throwing 404 is skipped, not deleted", async () => {
  const ETAG = '"stable-etag"';
  const bucket = new Map([[MANAGED_MANIFEST_KEY, JSON.stringify({ version: 2, keys: [{ key: "already-gone.html", etag: ETAG }] })]]);
  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const { url, method } = requestUrlAndMethod(input);
    const key = decodeURIComponent(new URL(url).pathname.replace(`/${CONFIG.bucket}/`, ""));
    if (method === "GET" && key === MANAGED_MANIFEST_KEY) {
      const body = bucket.get(MANAGED_MANIFEST_KEY);
      return body !== undefined ? new Response(body, { status: 200 }) : new Response("Not Found", { status: 404 });
    }
    if (method === "HEAD" && key === "already-gone.html") return new Response("Not Found", { status: 404 });
    if (method === "PUT") return new Response("", { status: 200, headers: { etag: '"new-etag"' } });
    if (method === "DELETE") throw new Error("must never be called for a key already confirmed gone");
    return new Response("", { status: 200 });
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const result = await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    assert.equal(result.status, "ready");
  } finally {
    globalThis.fetch = original;
  }
});

test("a manifest whose v2 keys[] contains a malformed (non-object) entry is treated as an unrecognized shape — fails the whole publish", async () => {
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response(JSON.stringify({ version: 2, keys: ["not-an-object"] }), { status: 200 });
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(() => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }), (err) => err instanceof DeployError);
  } finally {
    fake.restore();
  }
});

test("a manifest whose v2 entry has a non-string key is treated as an unrecognized shape", async () => {
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response(JSON.stringify({ version: 2, keys: [{ key: 123, etag: "x" }] }), { status: 200 });
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(() => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }), (err) => err instanceof DeployError);
  } finally {
    fake.restore();
  }
});

test("a v2 manifest entry with a blank etag is normalized to 'no recorded provenance' — never auto-deleted", async () => {
  const bucket = new Map([["blank-etag.html", "content"]]);
  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const { url, method } = requestUrlAndMethod(input);
    const key = decodeURIComponent(new URL(url).pathname.replace(`/${CONFIG.bucket}/`, ""));
    if (method === "GET" && key === MANAGED_MANIFEST_KEY) return new Response(JSON.stringify({ version: 2, keys: [{ key: "blank-etag.html", etag: "" }] }), { status: 200 });
    if (method === "PUT") return new Response("", { status: 200, headers: { etag: '"new-etag"' } });
    if (method === "DELETE") throw new Error("must never be called for an unverifiable (blank-etag) key");
    return new Response("", { status: 200 });
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    assert.equal(bucket.has("blank-etag.html"), true);
  } finally {
    globalThis.fetch = original;
  }
});

test("a v1 manifest whose keys field is not an array is treated as an unrecognized shape", async () => {
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response(JSON.stringify({ version: 1, keys: "not-an-array" }), { status: 200 });
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(() => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }), (err) => err instanceof DeployError);
  } finally {
    fake.restore();
  }
});

test("a v1 manifest whose keys array contains a non-string entry is treated as an unrecognized shape", async () => {
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response(JSON.stringify({ version: 1, keys: ["ok.html", 42] }), { status: 200 });
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(() => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }), (err) => err instanceof DeployError);
  } finally {
    fake.restore();
  }
});

test("a manifest body that parses to a JSON null is treated as an unrecognized shape, not a verified 404", async () => {
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("null", { status: 200 });
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(() => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }), (err) => err instanceof DeployError);
  } finally {
    fake.restore();
  }
});

test("a previously-managed key that is STILL part of the current export is skipped without any HEAD or DELETE call", async () => {
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response(JSON.stringify({ version: 2, keys: [{ key: "index.html", etag: '"whatever"' }] }), { status: 200 });
    if (call.method === "HEAD") throw new Error("must never verify a key that is still part of the current export");
    if (call.method === "DELETE") throw new Error("must never delete a key that is still part of the current export");
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const result = await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    assert.equal(result.status, "ready");
  } finally {
    fake.restore();
  }
});

test("a manifest that (defensively) lists its own key is skipped without any HEAD or DELETE call", async () => {
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) {
      return new Response(JSON.stringify({ version: 2, keys: [{ key: MANAGED_MANIFEST_KEY, etag: '"whatever"' }] }), { status: 200 });
    }
    if (call.method === "HEAD") throw new Error("must never verify the manifest's own key against itself");
    if (call.method === "DELETE") throw new Error("must never delete the manifest key via the stale-key path");
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const result = await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    assert.equal(result.status, "ready");
  } finally {
    fake.restore();
  }
});

test("publish: an empty file set uploads nothing but still runs the manifest cleanup pass", async () => {
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response(JSON.stringify({ version: 2, keys: [{ key: "old.html", etag: '"old-etag"' }] }), { status: 200 });
    if (call.method === "HEAD" && call.url.endsWith("/old.html")) return new Response("", { status: 200, headers: { etag: '"old-etag"' } });
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const result = await target.publish({ files: [], projectName: "demo" });
    assert.equal(result.status, "ready");
    const uploadCalls = fake.calls.filter((c) => c.method === "PUT" && !c.url.endsWith(MANAGED_MANIFEST_KEY));
    assert.equal(uploadCalls.length, 0, "an empty file set must upload nothing");
    const deleteCalls = fake.calls.filter((c) => c.method === "DELETE");
    assert.deepEqual(deleteCalls.map((c) => c.url.endsWith("/old.html")), [true], "with no current keys, every previously-managed, verified key becomes stale");
  } finally {
    fake.restore();
  }
});

test("publish: when two uploads fail concurrently, only the FIRST recorded failure propagates (never overwritten by a second)", async () => {
  const files = [
    { file: "a.html", data: "a" },
    { file: "b.html", data: "b" },
  ];
  let failA;
  let failB;
  const a = new Promise(resolve => { failA = resolve; });
  const b = new Promise(resolve => { failB = resolve; });
  let bothStarted;
  const started = new Promise(resolve => { bothStarted = resolve; });
  let uploads = 0;
  const fake = installFakeFetch(call => {
    if (call.method !== "PUT") return okResponse();
    if (++uploads === 2) bothStarted();
    return call.url.endsWith("/a.html") ? a : b;
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const publishing = target.publish({ files, projectName: "demo" });
    await started;
    failB(new Response("first failure", { status: 403 }));
    await new Promise(resolve => setImmediate(resolve));
    failA(new Response("second failure", { status: 401 }));
    await assert.rejects(
      publishing,
      (err) => {
        assert.ok(err instanceof DeployError);
        assert.match(err.message, /b\.html.*403/);
        assert.doesNotMatch(err.message, /a\.html/);
        return true;
      }
    );
  } finally {
    fake.restore();
  }
});

test("publish: exhausts MAX_MANIFEST_WRITE_ATTEMPTS retries and throws a bounded DeployError when the manifest write keeps conflicting", async () => {
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("Not Found", { status: 404 });
    if (call.method === "PUT" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("", { status: 412 });
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(
      () => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }),
      (err) => {
        assert.ok(err instanceof DeployError);
        assert.match(err.message, /Concurrent publish detected/);
        return true;
      }
    );
    const manifestPuts = fake.calls.filter((c) => c.method === "PUT" && c.url.endsWith(MANAGED_MANIFEST_KEY));
    assert.equal(manifestPuts.length, MAX_MANIFEST_WRITE_ATTEMPTS, "must retry exactly MAX_MANIFEST_WRITE_ATTEMPTS times before giving up loudly");
  } finally {
    fake.restore();
  }
});

/** The `"unsupported"` outcome degrades to an unconditional write and keeps going — the OLD bug was
 *  that `MAX_MANIFEST_WRITE_ATTEMPTS`'s own bound check sat only in the `"conflict"` arm, unreachable
 *  from `"unsupported"`'s own `continue`. A provider that keeps answering `"unsupported"` even for the
 *  now-unconditional write (a provider that cannot do THIS write shape at all, not merely one lacking
 *  conditional-write support) would re-enter that arm forever — an unbounded request flood, not a
 *  single hang, since each request still has its own timeout. Proves the ceiling now applies to this
 *  outcome too. */
test("publish: a provider reporting 'unsupported' for BOTH the conditional AND the degraded unconditional write throws a bounded DeployError instead of looping forever", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn) => {
    fn();
    return 0;
  });
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("Not Found", { status: 404 });
    // EVERY manifest write is rejected as unsupported, regardless of `if-none-match` — this provider
    // cannot do this write shape at all, not merely the conditional form.
    if (call.method === "PUT" && call.url.endsWith(MANAGED_MANIFEST_KEY)) {
      return new Response("UnsupportedOperation: manifest writes are not implemented", { status: 400 });
    }
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(
      () => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }),
      (err) => {
        assert.ok(err instanceof DeployError);
        assert.match(err.message, /unsupported.*retries were exhausted/i);
        return true;
      }
    );
    const manifestPuts = fake.calls.filter((c) => c.method === "PUT" && c.url.endsWith(MANAGED_MANIFEST_KEY));
    assert.equal(manifestPuts.length, MAX_MANIFEST_WRITE_ATTEMPTS, "must stop after MAX_MANIFEST_WRITE_ATTEMPTS attempts, never loop forever");
  } finally {
    fake.restore();
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("publish: a 409 manifest-write response is treated as a conflict, identically to 412", async () => {
  let putCount = 0;
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("Not Found", { status: 404 });
    if (call.method === "PUT" && call.url.endsWith(MANAGED_MANIFEST_KEY)) {
      putCount += 1;
      return putCount === 1 ? new Response("", { status: 409 }) : okResponse();
    }
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const result = await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    assert.equal(result.status, "ready", "a 409 must retry and eventually succeed, just like a 412");
    assert.equal(putCount, 2);
  } finally {
    fake.restore();
  }
});

test("publish: a 400 manifest-write response naming an unsupported operation degrades to an unconditional write, just like a 501", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn) => {
    fn();
    return 0;
  });
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("Not Found", { status: 404 });
    if (call.method === "PUT" && call.url.endsWith(MANAGED_MANIFEST_KEY) && call.headers.get("if-none-match") === "*") {
      return new Response("UnsupportedOperation: conditional writes are not implemented", { status: 400 });
    }
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const result = await target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" });
    assert.equal(result.status, "ready");
    const manifestPuts = fake.calls.filter((c) => c.method === "PUT" && c.url.endsWith(MANAGED_MANIFEST_KEY));
    assert.ok(manifestPuts.length >= 2, "expected a conditional attempt plus an unconditional fallback write");
  } finally {
    fake.restore();
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("publish: a genuine 400 manifest-write response (not naming an unsupported operation) throws rather than degrading", async () => {
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("Not Found", { status: 404 });
    if (call.method === "PUT" && call.url.endsWith(MANAGED_MANIFEST_KEY) && call.headers.get("if-none-match") === "*") {
      return new Response("Malformed request body", { status: 400 });
    }
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(
      () => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }),
      (err) => {
        assert.ok(err instanceof DeployError);
        assert.match(err.message, /HTTP 400/);
        assert.match(err.message, /Malformed request body/);
        return true;
      }
    );
  } finally {
    fake.restore();
  }
});

test("publish: a 5xx manifest-write failure throws a bounded DeployError", async () => {
  const fake = installFakeFetch((call) => {
    if (call.method === "GET" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("Not Found", { status: 404 });
    if (call.method === "PUT" && call.url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("boom", { status: 503 });
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(
      () => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }),
      (err) => {
        assert.ok(err instanceof DeployError);
        assert.match(err.message, /HTTP 503/);
        return true;
      }
    );
  } finally {
    fake.restore();
  }
});

test("publish: a manifest write that throws at the transport layer surfaces as a bounded DeployError", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const { url, method } = requestUrlAndMethod(input);
    if (method === "GET" && url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("Not Found", { status: 404 });
    if (method === "PUT" && url.endsWith(MANAGED_MANIFEST_KEY)) throw new TypeError("network down");
    return new Response("", { status: 200 });
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(
      () => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }),
      (err) => {
        assert.ok(err instanceof DeployError);
        assert.match(err.message, /network down/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("publish: a manifest read that throws at the transport layer fails the whole publish with a bounded DeployError", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const { url, method } = requestUrlAndMethod(input);
    if (method === "GET" && url.endsWith(MANAGED_MANIFEST_KEY)) throw new TypeError("DNS failure");
    return new Response("", { status: 200 });
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    await assert.rejects(
      () => target.publish({ files: [{ file: "index.html", data: "x" }], projectName: "demo" }),
      (err) => {
        assert.ok(err instanceof DeployError);
        assert.match(err.message, /DNS failure/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("publish: uploads at most 8 files concurrently (bounded worker pool), even for a large file set", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const { url, method } = requestUrlAndMethod(input);
    if (method === "GET" && url.endsWith(MANAGED_MANIFEST_KEY)) return new Response("Not Found", { status: 404 }); // verified: no manifest yet
    if (method === "PUT") {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return okResponse();
    }
    return okResponse();
  });
  try {
    const target = new S3CompatibleDeployTarget(CONFIG);
    const manyFiles = Array.from({ length: 40 }, (_, i) => ({ file: `page-${i}.html`, data: "x" }));
    await target.publish({ files: manyFiles, projectName: "demo" });
    assert.ok(maxInFlight <= 8, `expected at most 8 concurrent uploads, observed ${maxInFlight}`);
    assert.ok(maxInFlight >= 2, `expected genuine concurrency (not fully serial), observed ${maxInFlight}`);
  } finally {
    globalThis.fetch = original;
  }
});

// ---- New: the hosting plugin module contract ----

const CREDENTIAL = {
  token: CONFIG.secretAccessKey,
  accessKeyId: CONFIG.accessKeyId,
  bucket: CONFIG.bucket,
  region: CONFIG.region,
  publicUrl: CONFIG.publicUrl,
};

test("module create(): maps the saved credential (token = secret key) onto the target and publishes with it", async () => {
  const fake = installFakeFetch(respondIgnoringManifest);
  try {
    const target = loaded.default.create({ credential: CREDENTIAL, config: {}, kit: createFakeDeployHostKit() });
    assert.equal(target.id, "s3-compatible");
    const result = await target.publish({ files: [FILES[0]], projectName: "demo" });
    assert.equal(result.url, CONFIG.publicUrl);
    const upload = fake.calls.find((c) => c.method === "PUT" && c.url.endsWith("/my-bucket/index.html"));
    assert.match(upload?.headers.get("authorization") ?? "", /Credential=AKIAEXAMPLE\/.*\/us-east-1\/s3\/aws4_request/);
  } finally {
    fake.restore();
  }
});

test("module create(): an explicit endpoint on the credential is used", async () => {
  const fake = installFakeFetch(respondIgnoringManifest);
  try {
    const target = loaded.default.create({ credential: { ...CREDENTIAL, region: "auto", endpoint: "https://abc123.r2.cloudflarestorage.com" }, config: {}, kit: createFakeDeployHostKit() });
    await target.publish({ files: [FILES[0]], projectName: "demo" });
    assert.ok(fake.calls.some((c) => c.url === "https://abc123.r2.cloudflarestorage.com/my-bucket/index.html"));
  } finally {
    fake.restore();
  }
});

test("module create(): a credential missing required fields throws the exact legacy text, before any network call", () => {
  const fake = installFakeFetch(() => assert.fail("no network"));
  try {
    assert.throws(() => loaded.default.create({ credential: { token: "s3cr3t", accessKeyId: "AKIA" }, config: {}, kit: createFakeDeployHostKit() }), {
      name: "DeployError",
      message: "S3-compatible credential is missing required field(s): bucket, region, publicUrl.",
    });
    assert.equal(fake.calls.length, 0);
  } finally {
    fake.restore();
  }
});

test("module contract: no config fields, served from the root, and responseHeaders add no file (S3 has no header config)", async () => {
  assert.equal(loaded.default.validateConfig?.({}), null);
  assert.equal(loaded.default.basePath?.({}), undefined);
  const fake = installFakeFetch(respondIgnoringManifest);
  try {
    const target = loaded.default.create({ credential: CREDENTIAL, config: {}, kit: createFakeDeployHostKit() });
    await (target.publish)({ files: [FILES[0]], projectName: "demo", responseHeaders: { "X-Frame-Options": "DENY" } });
    const uploads = fake.calls.filter((c) => c.method === "PUT" && !c.url.endsWith("managed-keys.json")).map((c) => c.url);
    assert.deepEqual(uploads, ["https://s3.us-east-1.amazonaws.com/my-bucket/index.html"]);
  } finally {
    fake.restore();
  }
});


test("module verifyCredential signs HeadBucket and classifies each provider response", async () => {
  for (const endpoint of [undefined, "https://account.r2.cloudflarestorage.com/ "]) {
    for (const status of [200, 401, 403, 429, 500]) {
      const fake = installFakeFetch(() => new Response("", { status }));
      try {
        const result = await loaded.default.verifyCredential({ credential: { ...CREDENTIAL, ...(endpoint ? { endpoint } : {}) }, kit: createFakeDeployHostKit() });
        assert.deepEqual(result, status === 200 ? { ok: true } : { ok: false, reason: status === 401 || status === 403 ? "rejected" : "unreachable", statusCode: status });
        assert.equal(fake.calls.length, 1);
        assert.equal(fake.calls[0].url, endpoint ? "https://account.r2.cloudflarestorage.com/my-bucket" : "https://s3.us-east-1.amazonaws.com/my-bucket");
        assert.equal(fake.calls[0].method, "HEAD");
        assert.match(fake.calls[0].headers.get("authorization") ?? "", /Credential=AKIAEXAMPLE\/.*\/us-east-1\/s3\/aws4_request/);
      } finally { fake.restore(); }
    }
  }
});

test("module hostingSetup selects provider guidance and requires bucket and region", () => {
  for (const [endpoint, provider] of [["", "aws"], ["https://s3.amazonaws.com", "aws"], ["https://a.r2.cloudflarestorage.com", "cloudflare-r2"], ["https://s3.us-west.backblazeb2.com", "backblaze-b2"], ["https://nyc3.digitaloceanspaces.com", "digitalocean-spaces"], ["https://s3.wasabisys.com", "wasabi"], ["https://minio.example", "minio"], ["https://storage.example", "generic"]]) {
    const setup = loaded.default.hostingSetup({ fields: { bucket: " my-bucket ", region: " us-east-1 ", endpoint: endpoint } });
    assert.equal(setup.provider, provider);
    assert.ok(setup.steps.length > 0);
    assert.match(JSON.stringify(setup.steps), /my-bucket/);
  }
  for (const field of ["bucket", "region"]) {
    assert.throws(() => loaded.default.hostingSetup({ fields: { bucket: "b", region: "r", [field]: " " } }), new RegExp(`'${field}'.*required`));
  }
});
