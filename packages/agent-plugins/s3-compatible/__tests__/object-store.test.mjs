/**
 * @file Pins `object-stores/s3-compatible.mjs`, the `s3_compatible` `ObjectStoreProvider` that absorbed
 * Tovu core's former `S3BlobStore` (deleted; see git history of `media/blob-store.s3.ts`). Every unit case
 * of that adapter's former suite is ported here against the object-store
 * contract (`get`/`head` report absence as `null` instead of throwing / `false`), plus the provider's
 * own surface: refused configuration, `host.wrapFetch`, `keyPrefix`, endpoint derivation, signal and
 * timeout bounds, and the share-capability delegation to the publish target.
 *
 * The host's signing client is an in-process fake S3 (path-style `PUT`/`GET`/`HEAD`/`DELETE
 * /{bucket}/{key...}`, objects in a `Map`, `If-None-Match: *` honored, forced per-method/key answers).
 * Nothing opens a socket. The case that signed with the first host's real `aws4fetch` signer and
 * recomputed the SigV4 signature moved to that host (Tovu's s3-compatible overlay, 2026-11-02): it
 * proves the host's signer, and Jini plugins import no signing library.
 *
 * NOT ported (disclosed): the `uploadMedia()` → `/m/...` rendition-route end-to-end case and the
 * OpenTelemetry span cases. Both exercise Tovu host wiring (`RouteDeps`, `trackFetch`), which this
 * plugin no longer owns; here the tracing seam is `host.wrapFetch`, pinned below.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import provider from "../object-stores/s3-compatible.mjs";
import deployTargetModule from "../targets/s3-compatible.mjs";

const BUCKET = "tovu-media-test";
const SHA = createHash("sha256").update("fixture").digest("hex");
const KEY = `ws/ws-1/blobs/${SHA.slice(0, 2)}/${SHA}`;
const BYTES = new TextEncoder().encode("hello from S3ObjectStore");

/**
 * An in-memory S3-compatible endpoint behind a fake signing client.
 * @param {{ bucket?: string }} [optional]
 */
function fakeS3(optional = {}) {
  const bucket = optional.bucket ?? BUCKET;
  const objects = new Map();
  const forced = new Map();
  /** @type {{ url: string, init: RequestInit }[]} */
  const requests = [];
  /** @type {object[]} */
  const signerInputs = [];

  /** @param {string} url */
  function keyOf(url) {
    const path = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    const slash = path.indexOf("/");
    // Only the fixture bucket exists: silently discarding this segment would hide wrong-bucket writes.
    return path.slice(0, slash) === bucket ? path.slice(slash + 1) : undefined;
  }

  /** @param {string} key @param {RequestInit} init */
  function answer(key, init) {
    const method = init.method;
    const headers = new Headers(init.headers);
    if (method === "PUT") {
      if (headers.get("if-none-match") === "*" && objects.has(key)) return new Response(null, { status: 412 });
      objects.set(key, { bytes: new Uint8Array(init.body), headers });
      return new Response(null, { status: 200 });
    }
    const stored = objects.get(key);
    if (method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (!stored) return new Response(null, { status: 404 });
    const length = { "content-length": String(stored.bytes.byteLength) };
    return method === "GET" ? new Response(stored.bytes, { headers: length }) : new Response(null, { headers: length });
  }

  const client = {
    /** @param {string} url @param {RequestInit} init */
    async fetch(url, init) {
      requests.push({ url, init });
      const key = keyOf(url);
      if (key === undefined) return new Response("NoSuchBucket", { status: 404 });
      const scripted = forced.get(`${init.method}:${key}`);
      if (scripted) return scripted();
      return answer(key, init);
    },
  };
  return {
    objects,
    requests,
    signerInputs,
    host: {
      createSigV4Client(input) {
        signerInputs.push(input);
        return client;
      },
    },
    /** @param {string} method @param {string} key @param {(() => Response | Promise<Response>) | undefined} respond */
    force(method, key, respond) {
      if (respond === undefined) forced.delete(`${method}:${key}`);
      else forced.set(`${method}:${key}`, respond);
    },
  };
}

/**
 * A ready store over `host`, asserting the provider accepted the input.
 * @param {{ host: object }} required
 * @param {{ settings?: object, fields?: object, secret?: string }} [optional]
 */
function makeStore(required, optional = {}) {
  const result = provider.create({
    settings: optional.settings ?? { bucket: BUCKET },
    credential: {
      fields: optional.fields ?? { accessKeyId: "test-access-key-id", region: "us-east-1", endpoint: "https://objects.example.test" },
      secret: optional.secret ?? "test-secret-access-key",
    },
    host: required.host,
  });
  assert.equal(result.status, "ok");
  return result.value;
}

test("put() writes the bare key path-style under the bucket and hands the host signer the credential", async () => {
  const s3 = fakeS3();
  const store = makeStore({ host: s3.host });

  assert.deepEqual(await store.put({ key: KEY, bytes: BYTES }), { written: true });

  assert.equal(s3.requests[0].url, `https://objects.example.test/${BUCKET}/${KEY}`);
  assert.equal(s3.requests[0].init.method, "PUT");
  assert.equal(s3.requests[0].init.body, BYTES);
  assert.deepEqual(s3.signerInputs, [{ accessKeyId: "test-access-key-id", secretAccessKey: "test-secret-access-key", service: "s3", region: "us-east-1" }]);
  assert.deepEqual([...s3.objects.keys()], [KEY]);
});

test("blank/omitted endpoints derive the AWS host, trailing slashes are stripped, and keyPrefix namespaces every operation", async () => {
  for (const endpoint of [undefined, "", "   ", "https://objects.example.test///", "  https://objects.example.test/  "]) {
    const s3 = fakeS3({ bucket: "media bucket" });
    const fields = { accessKeyId: "id", region: "eu-west-2", ...(endpoint === undefined ? {} : { endpoint }) };
    const store = makeStore({ host: s3.host }, { settings: { bucket: "media bucket", keyPrefix: "tenant media/" }, fields });

    await store.put({ key: KEY, bytes: BYTES });
    await store.put({ key: KEY, bytes: BYTES }, { ifAbsent: true });
    assert.deepEqual(await store.get({ key: KEY }), BYTES);
    assert.deepEqual(await store.head({ key: KEY }), { size: BYTES.byteLength });
    await store.delete({ key: KEY });

    const host = endpoint?.includes("objects.example.test") ? "https://objects.example.test" : "https://s3.eu-west-2.amazonaws.com";
    assert.deepEqual(s3.requests.map(({ url, init }) => [init.method, url]),
      ["PUT", "PUT", "GET", "HEAD", "DELETE"].map((method) => [method, `${host}/media%20bucket/tenant%20media/${KEY}`]));
  }
});

test("object keys are byte-identical to S3BlobStore's keyPrefix + storageKey: each '/' segment is encoded independently", async () => {
  const s3 = fakeS3();
  const store = makeStore({ host: s3.host }, { settings: { bucket: BUCKET, keyPrefix: "a b/c?d/" } });
  await store.put({ key: "x#y/z%w", bytes: BYTES });
  assert.equal(s3.requests[0].url, `https://objects.example.test/${BUCKET}/a%20b/c%3Fd/x%23y/z%25w`);
  assert.deepEqual([...s3.objects.keys()], ["a b/c?d/x#y/z%w"]);
});

test("put() then get() round-trips the exact bytes written", async () => {
  const store = makeStore({ host: fakeS3().host });
  await store.put({ key: KEY, bytes: BYTES });
  assert.deepEqual(Buffer.from(await store.get({ key: KEY })), Buffer.from(BYTES));
});

test("get() of a missing key resolves null (the object-store contract), not a rejection", async () => {
  const store = makeStore({ host: fakeS3().host });
  assert.equal(await store.get({ key: "ws/ws-1/blobs/zz/does-not-exist" }), null);
});

test("head() reports the size right after put() and null after delete()", async () => {
  const store = makeStore({ host: fakeS3().host });
  await store.put({ key: KEY, bytes: BYTES });
  assert.deepEqual(await store.head({ key: KEY }), { size: BYTES.byteLength });
  await store.delete({ key: KEY });
  assert.equal(await store.head({ key: KEY }), null);
});

test("head() distinguishes a genuine 404 from 403/429/5xx instead of collapsing every non-ok response into null", async () => {
  const s3 = fakeS3();
  const store = makeStore({ host: s3.host });
  await store.put({ key: KEY, bytes: BYTES });
  assert.equal(await store.head({ key: "ws/ws-1/blobs/zz/never-existed" }), null);
  for (const status of [403, 429, 500]) {
    s3.force("HEAD", KEY, () => new Response(null, { status }));
    await assert.rejects(() => store.head({ key: KEY }), { message: `S3ObjectStore.head: failed to check '${KEY}' — HTTP ${status}` });
  }
});

test("head() rejects a missing, malformed or unsafe content-length rather than guessing a size, and accepts 0", async () => {
  const s3 = fakeS3();
  const store = makeStore({ host: s3.host });
  for (const length of [undefined, "-1", "1.5", "12abc", "99999999999999999999"]) {
    s3.force("HEAD", KEY, () => new Response(null, { status: 200, headers: length === undefined ? {} : { "content-length": length } }));
    await assert.rejects(() => store.head({ key: KEY }), { message: "S3ObjectStore.head: storage did not return a valid content length" });
  }
  s3.force("HEAD", KEY, () => new Response(null, { status: 200, headers: { "content-length": "0" } }));
  assert.deepEqual(await store.head({ key: KEY }), { size: 0 });
});

test("provider failures for writes, reads and deletes reject without changing stored objects", async () => {
  const s3 = fakeS3();
  const store = makeStore({ host: s3.host });
  const errorBody = "provider denied write";
  for (const status of [403, 500]) {
    s3.force("PUT", KEY, () => new Response(errorBody, { status }));
    for (const options of [{}, { ifAbsent: true }]) {
      await assert.rejects(() => store.put({ key: KEY, bytes: BYTES }, options), {
        message: `S3ObjectStore.put: failed to write '${KEY}' — HTTP ${status} — ${errorBody}`,
      });
    }
    assert.equal(s3.objects.size, 0, "a failed write must not create an object");
  }
  s3.force("PUT", KEY, undefined);

  const existing = "ws/ws-1/blobs/bb/" + "b".repeat(64);
  await store.put({ key: existing, bytes: BYTES });
  for (const status of [403, 500]) {
    s3.force("PUT", existing, () => new Response(errorBody, { status }));
    await assert.rejects(() => store.put({ key: existing, bytes: new Uint8Array([9]) }, { ifAbsent: true }), {
      message: `S3ObjectStore.put: failed to write '${existing}' — HTTP ${status} — ${errorBody}`,
    });
    assert.deepEqual(Buffer.from(await store.get({ key: existing })), Buffer.from(BYTES));
    s3.force("GET", existing, () => new Response(null, { status }));
    await assert.rejects(() => store.get({ key: existing }), { message: `S3ObjectStore.get: failed to read '${existing}' — HTTP ${status}` });
    s3.force("DELETE", existing, () => new Response(null, { status }));
    await assert.rejects(() => store.delete({ key: existing }), { message: `S3ObjectStore.delete: failed to delete '${existing}' — HTTP ${status}` });
    assert.equal(s3.objects.size, 1);
    s3.force("GET", existing, undefined);
    assert.deepEqual(Buffer.from(await store.get({ key: existing })), Buffer.from(BYTES));
  }
});

test("write failures bound provider error bodies at 200 characters and keep the HTTP error when the body is unreadable", async () => {
  for (const unreadable of [false, true]) {
    const s3 = fakeS3();
    s3.force("PUT", KEY, () => new Response(
      unreadable ? new ReadableStream({ start(controller) { controller.error(new Error("body unreadable")); } }) : "x".repeat(250),
      { status: 403 },
    ));
    const store = makeStore({ host: s3.host });
    for (const options of [{}, { ifAbsent: true }]) {
      await assert.rejects(() => store.put({ key: KEY, bytes: BYTES }, options), {
        message: `S3ObjectStore.put: failed to write '${KEY}' — HTTP 403${unreadable ? "" : ` — ${"x".repeat(200)}`}`,
      });
    }
  }
});

test("put({ ifAbsent }) on a fresh key writes and reports written: true", async () => {
  const s3 = fakeS3();
  const store = makeStore({ host: s3.host });
  assert.deepEqual(await store.put({ key: KEY, bytes: BYTES }, { ifAbsent: true }), { written: true });
  assert.equal(new Headers(s3.requests[0].init.headers).get("if-none-match"), "*");
  assert.deepEqual(Buffer.from(await store.get({ key: KEY })), Buffer.from(BYTES));
});

test("put({ ifAbsent }) on an occupied key reports written: false and leaves the existing object untouched", async () => {
  const store = makeStore({ host: fakeS3().host });
  const firstBytes = new TextEncoder().encode("real production bytes, written first");
  const secondBytes = new TextEncoder().encode("stock seed bytes — must not win");
  assert.deepEqual(await store.put({ key: KEY, bytes: firstBytes }, { ifAbsent: true }), { written: true });
  assert.deepEqual(await store.put({ key: KEY, bytes: secondBytes }, { ifAbsent: true }), { written: false });
  assert.deepEqual(Buffer.from(await store.get({ key: KEY })), Buffer.from(firstBytes),
    "the first writer's bytes must survive — the 412 must stop the second PUT from landing");
});

test("a 412 on a plain put() (no ifAbsent) is a failure, not a silent written: false", async () => {
  const s3 = fakeS3();
  s3.force("PUT", KEY, () => new Response(null, { status: 412 }));
  const store = makeStore({ host: s3.host });
  await assert.rejects(() => store.put({ key: KEY, bytes: BYTES }), { message: `S3ObjectStore.put: failed to write '${KEY}' — HTTP 412` });
});

test("put() sends contentType as content-type and passes caller headers through; contentType and ifAbsent win over a stray caller header", async () => {
  const s3 = fakeS3();
  const store = makeStore({ host: s3.host });
  await store.put({ key: KEY, bytes: BYTES }, {
    contentType: "image/png",
    ifAbsent: true,
    headers: { "content-disposition": "attachment", "cache-control": "no-store", "content-type": "text/plain", "If-None-Match": "etag-1" },
  });
  assert.deepEqual(Object.fromEntries(new Headers(s3.requests[0].init.headers)), {
    "content-disposition": "attachment",
    "cache-control": "no-store",
    "content-type": "image/png",
    "if-none-match": "*",
  });
  await store.put({ key: KEY, bytes: BYTES });
  assert.deepEqual(Object.fromEntries(new Headers(s3.requests[1].init.headers)), {}, "no options means no extra headers");
});

test("put(): enforced content-type and If-None-Match replace a caller header of ANY casing — never a combined 'etag-1, *' value", async () => {
  const s3 = fakeS3();
  const store = makeStore({ host: s3.host });
  await store.put({ key: KEY, bytes: BYTES }, {
    contentType: "image/png",
    ifAbsent: true,
    headers: { "if-none-match": "etag-1", "Content-Type": "text/plain", "X-Custom": "kept" },
  });
  const sent = new Headers(s3.requests[0].init.headers);
  assert.equal(sent.get("if-none-match"), "*");
  assert.equal(sent.get("content-type"), "image/png");
  assert.equal(sent.get("x-custom"), "kept");
  assert.deepEqual([...sent.keys()].sort(), ["content-type", "if-none-match", "x-custom"]);
  assert.equal(await store.put({ key: KEY, bytes: BYTES }, { ifAbsent: true, headers: { "IF-NONE-MATCH": "etag-2" } }).then((r) => r.written), false, "the stored object makes the precondition fail");
});

test("delete() is idempotent — deleting an already-absent key is not an error", async () => {
  const s3 = fakeS3();
  s3.force("DELETE", KEY, () => new Response(null, { status: 404 }));
  const store = makeStore({ host: s3.host });
  await store.delete({ key: KEY });
  s3.force("DELETE", KEY, undefined);
  await store.delete({ key: "ws/ws-1/blobs/zz/never-existed" });
  assert.equal(await store.head({ key: "ws/ws-1/blobs/zz/never-existed" }), null);
});

test("a transport failure rejects every method as 'request failed' naming the key, for Error and non-Error causes", async () => {
  for (const cause of [new Error("connect ECONNREFUSED"), "socket hang up"]) {
    const host = { createSigV4Client: () => ({ fetch: async () => { throw cause; } }) };
    const store = makeStore({ host });
    const text = cause instanceof Error ? cause.message : cause;
    await assert.rejects(() => store.put({ key: KEY, bytes: BYTES }), { message: `S3ObjectStore.put: request failed for '${KEY}' — ${text}` });
    await assert.rejects(() => store.get({ key: KEY }), { message: `S3ObjectStore.get: request failed for '${KEY}' — ${text}` });
    await assert.rejects(() => store.head({ key: KEY }), { message: `S3ObjectStore.head: request failed for '${KEY}' — ${text}` });
    await assert.rejects(() => store.delete({ key: KEY }), { message: `S3ObjectStore.delete: request failed for '${KEY}' — ${text}` });
  }
});

test("get() is bounded at 120s and head() at 30s, combined with the caller's signal; put()/delete() carry only the caller's signal", async (t) => {
  const timeouts = [];
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (ms) => {
    timeouts.push(ms);
    return realTimeout(ms);
  });
  const s3 = fakeS3();
  const store = makeStore({ host: s3.host });
  await store.put({ key: KEY, bytes: BYTES });
  await store.get({ key: KEY });
  await store.head({ key: KEY });
  await store.delete({ key: KEY });
  assert.deepEqual(timeouts, [120_000, 30_000]);
  assert.equal("signal" in s3.requests[0].init, false, "no caller signal, no timeout: put sends none");
  assert.ok(s3.requests[1].init.signal instanceof AbortSignal);
  assert.ok(s3.requests[2].init.signal instanceof AbortSignal);
  assert.equal("signal" in s3.requests[3].init, false);

  const controller = new AbortController();
  const { signal } = controller;
  await store.put({ key: KEY, bytes: BYTES }, { signal });
  await store.get({ key: KEY }, { signal });
  await store.head({ key: KEY }, { signal });
  await store.delete({ key: KEY }, { signal });
  const [put, get, head, del] = s3.requests.slice(4).map(({ init }) => init.signal);
  assert.equal(put, signal);
  assert.equal(del, signal);
  assert.notEqual(get, signal, "get combines the caller's signal with its timeout");
  assert.notEqual(head, signal);
  assert.equal(get.aborted || head.aborted, false);
  controller.abort(new Error("caller gave up"));
  assert.equal(get.aborted && head.aborted, true, "aborting the caller's signal aborts the combined one");
});

test("host.wrapFetch wraps the signed fetch once, and every object call goes through the wrapper", async () => {
  const s3 = fakeS3();
  const traced = [];
  let wraps = 0;
  const host = {
    ...s3.host,
    wrapFetch(fetchFn) {
      wraps += 1;
      return async (url, init) => {
        traced.push(init.method);
        return fetchFn(url, init);
      };
    },
  };
  const store = makeStore({ host });
  await store.put({ key: KEY, bytes: BYTES });
  await store.get({ key: KEY });
  await store.head({ key: KEY });
  await store.delete({ key: KEY });
  assert.equal(wraps, 1);
  assert.deepEqual(traced, ["PUT", "GET", "HEAD", "DELETE"]);
  assert.equal(s3.requests.length, 4, "the wrapper still reaches the signing client");
});

test("a transport failure surfacing through host.wrapFetch still rejects as 'request failed'", async () => {
  const host = { ...fakeS3().host, wrapFetch: () => async () => { throw new TypeError("fetch failed"); } };
  const store = makeStore({ host });
  await assert.rejects(() => store.delete({ key: KEY }), { message: `S3ObjectStore.delete: request failed for '${KEY}' — fetch failed` });
});

test("create() refuses missing input as not_configured naming every missing field, never throws, and never builds a signer", () => {
  const s3 = fakeS3();
  const full = { accessKeyId: "id", region: "us-east-1" };
  const cases = [
    [{ settings: { bucket: BUCKET }, host: s3.host }, "credential.fields.accessKeyId, credential.fields.region, credential.secret"],
    [{ settings: { bucket: BUCKET }, credential: { secret: "s" }, host: s3.host }, "credential.fields.accessKeyId, credential.fields.region"],
    [{ settings: { bucket: BUCKET }, credential: { fields: { ...full, accessKeyId: "" }, secret: "s" }, host: s3.host }, "credential.fields.accessKeyId"],
    [{ settings: { bucket: BUCKET }, credential: { fields: { accessKeyId: "id" }, secret: "s" }, host: s3.host }, "credential.fields.region"],
    [{ settings: { bucket: BUCKET }, credential: { fields: full, secret: "" }, host: s3.host }, "credential.secret"],
    [{ settings: {}, credential: { fields: full, secret: "s" }, host: s3.host }, "settings.bucket"],
    [{ settings: { bucket: "" }, credential: { fields: full, secret: "s" }, host: s3.host }, "settings.bucket"],
    [{ credential: { fields: full, secret: "s" }, host: s3.host }, "settings.bucket"],
    [{ host: s3.host }, "credential.fields.accessKeyId, credential.fields.region, credential.secret, settings.bucket"],
  ];
  for (const [input, names] of cases) {
    assert.deepEqual(provider.create(input), {
      status: "rejected",
      error: { code: "not_configured", message: `S3-compatible object store is missing required input(s): ${names}.` },
    });
  }
  assert.equal(s3.signerInputs.length, 0);
});

test("createArtifactStore() delegates to the publish target's share capability with the same input", async () => {
  /** @type {{ url: string, init: RequestInit }[]} */
  const sent = [];
  const signer = [];
  class DeployError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  const kit = {
    DeployError,
    checkDeploymentUrl: async () => ({ status: "ready" }),
    createSigV4Client(input) {
      signer.push(input);
      return { fetch: async (url, init) => { sent.push({ url, init }); return new Response(null, { status: 204 }); } };
    },
  };
  const credential = { accessKeyId: "id", bucket: "share-bucket", region: "us-east-1", publicUrl: "https://cdn.example.test/", token: "secret" };
  const store = provider.createArtifactStore({ credential, kit });
  const direct = deployTargetModule.createArtifactStore({ credential, kit });
  assert.deepEqual(Object.keys(store).sort(), Object.keys(direct).sort());
  assert.deepEqual(signer[0], { accessKeyId: "id", secretAccessKey: "secret", service: "s3", region: "us-east-1" });

  const key = `_share/${"a".repeat(16)}/site.tovu.zip`;
  await store.delete({ key });
  assert.deepEqual(sent.map(({ url, init }) => [init.method, url]), [["DELETE", `https://s3.us-east-1.amazonaws.com/share-bucket/${key}`]]);
  await assert.rejects(() => store.delete({ key: "not-a-share" }), { message: "Invalid share artifact key." });
  assert.throws(() => provider.createArtifactStore({ credential: { token: "secret" }, kit }, {}), DeployError);
});
