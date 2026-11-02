/**
 * @file Edge answers of `targets/s3-compatible.mjs` the website suite does not reach: an upload that
 * throws at the transport layer (Error and non-Error), manifest-write refusals with an empty body, the
 * share store's signal and verify rules, and credentials or setup fields that are simply absent. The
 * signing client is a scripted fake (the port the host kit hands in); nothing opens a socket.
 */
import assert from "node:assert/strict";
import test from "node:test";

import target from "../targets/s3-compatible.mjs";

class DeployError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const CREDENTIAL = { accessKeyId: "id", bucket: "b", region: "us-east-1", publicUrl: "https://cdn.example.test/", token: "secret", endpoint: "https://s3.example.test" };
const MANIFEST = "https://s3.example.test/b/.tovu/managed-keys.json";

/** A kit whose signing client answers each request from `respond(method, url, init)`. */
function kitWith(respond, extra = {}) {
  const sent = [];
  const signer = [];
  const kit = {
    DeployError,
    timeouts: { QUICK: 100 },
    checkDeploymentUrl: async () => ({ reachable: true, statusCode: 200 }),
    createSigV4Client(input) {
      signer.push(input);
      return {
        async fetch(url, init) { sent.push({ method: init.method, url }); return respond(init.method, url, init); },
        async sign(url, init) { return { url, headers: { authorization: "signed" }, method: init.method }; },
      };
    },
    ...extra,
  };
  return { kit, sent, signer };
}

test("an upload that throws at the transport layer is a bounded 502 naming the file, for Error and non-Error causes", async () => {
  for (const [thrown, text] of [[new Error("socket hang up"), "socket hang up"], ["plain string failure", "plain string failure"]]) {
    const { kit } = kitWith((method) => { if (method === "PUT") throw thrown; return new Response(null, { status: 404 }); });
    await assert.rejects(target.create({ credential: CREDENTIAL, kit }).publish({ files: [{ file: "index.html", data: "x" }] }),
      (error) => error instanceof DeployError && error.status === 502 && error.message === `Failed to upload 'index.html' to S3-compatible storage: ${text}`);
  }
});

test("manifest-write refusals with an empty body carry only the status; a 4xx other than 400 is a 400, a 5xx a 502", async () => {
  const cases = [
    [400, "Failed to update the Tovu-managed object manifest: HTTP 400", 400],
    [403, "Failed to update the Tovu-managed object manifest: HTTP 403", 400],
    [503, "Failed to update the Tovu-managed object manifest: HTTP 503", 502],
  ];
  for (const [status, message, deployStatus] of cases) {
    const { kit } = kitWith((method, url) => {
      if (url === MANIFEST) return method === "GET" ? new Response(null, { status: 404 }) : new Response("", { status });
      return new Response(null, { status: 200, headers: { etag: '"e1"' } });
    });
    await assert.rejects(target.create({ credential: CREDENTIAL, kit }).publish({ files: [{ file: "a.html", data: "a" }] }),
      (error) => error.message === message && error.status === deployStatus);
  }
});

const SHARE_KEY = `_share/${"a".repeat(16)}/site.tovu.zip`;

test("share upload honors the caller's abort signal before sending anything, and works without one", async () => {
  const { kit, sent } = kitWith(() => new Response(null, { status: 200 }));
  const store = target.createArtifactStore({ credential: CREDENTIAL, kit });
  const aborted = AbortSignal.abort(new Error("cancelled by caller"));
  await assert.rejects(store.upload({ key: SHARE_KEY, bytes: new Uint8Array([1]), headers: {} }, { signal: aborted }), { message: "cancelled by caller" });
  assert.deepEqual(sent, []);
  assert.deepEqual(await store.upload({ key: SHARE_KEY, bytes: new Uint8Array([1]), headers: { "Cache-Control": "no-store", "X-Robots-Tag": "none" } }, { signal: new AbortController().signal }), { url: `https://cdn.example.test/${SHARE_KEY}` });
  assert.deepEqual(await store.upload({ key: SHARE_KEY, bytes: new Uint8Array([1]), headers: {} }), { url: `https://cdn.example.test/${SHARE_KEY}` });
  assert.equal(sent.length, 2);
});

test("share verify: refuses a URL that is not this key's public URL without a request; absence means 404 or 410", async () => {
  const heads = [];
  let status = 404;
  const { kit } = kitWith(() => new Response(null, { status: 500 }), {
    fetch: async (url, init) => { heads.push([init.method, url, init.redirect]); return new Response(null, { status }); },
  });
  const store = target.createArtifactStore({ credential: CREDENTIAL, kit });
  const url = `https://cdn.example.test/${SHARE_KEY}`;
  assert.equal(await store.verify({ key: SHARE_KEY, url: "https://evil.example/x", present: true, bytes: 1 }), false);
  assert.deepEqual(heads, []);
  assert.equal(await store.verify({ key: SHARE_KEY, url, present: false }), true);
  status = 410;
  assert.equal(await store.verify({ key: SHARE_KEY, url, present: false }), true);
  status = 200;
  assert.equal(await store.verify({ key: SHARE_KEY, url, present: false }), false);
  assert.deepEqual(heads[0], ["HEAD", url, "error"]);
});

test("verifyCredential signs with empty strings for absent key id, region and bucket rather than 'undefined'", async () => {
  const fetched = [];
  const { kit, signer } = kitWith(() => new Response(null, { status: 200 }), {
    fetch: async (url, init) => { fetched.push([url, init.method]); return new Response(null, { status: 403 }); },
  });
  const result = await target.verifyCredential({ credential: { token: "t", endpoint: "https://r2.example.test" }, kit });
  assert.deepEqual(result, { ok: false, reason: "rejected", statusCode: 403 });
  assert.deepEqual(signer, [{ accessKeyId: "", secretAccessKey: "t", service: "s3", region: "" }]);
  assert.deepEqual(fetched, [["https://r2.example.test/", "HEAD"]]);
});

test("hostingSetup with no endpoint field at all is plain AWS", () => {
  assert.equal(target.hostingSetup({ fields: { bucket: "b", region: "eu-west-1" } }).provider, "aws");
});

test("the manifest lists keys sorted; an export listing one path twice keeps both entries in input order", async () => {
  let manifestBody;
  let tag = 0;
  const { kit } = kitWith((method, url, init) => {
    if (url === MANIFEST) {
      if (method === "GET") return new Response(null, { status: 404 });
      manifestBody = JSON.parse(init.body);
      return new Response(null, { status: 200 });
    }
    tag += 1;
    return new Response(null, { status: 200, headers: { etag: `"e${tag}"` } });
  });
  const files = [{ file: "b.html", data: "1" }, { file: "a.html", data: "2" }, { file: "b.html", data: "3" }];
  await target.create({ credential: CREDENTIAL, kit }).publish({ files });
  assert.deepEqual(manifestBody.keys.map((k) => k.key), ["a.html", "b.html", "b.html"]);
  assert.equal(manifestBody.version, 2);
});
