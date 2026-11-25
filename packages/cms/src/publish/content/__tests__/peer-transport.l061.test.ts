import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import {
  createPeerTransport,
  PublishContentPeerTransportError,
  type PeerHttpClient,
  type PeerTransportCredential,
  type PeerTransportHost,
} from "../peer-transport.js";
import type { PublishContentExportEnvelope } from "../export-bundle.js";
import { PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION } from "../../transfer/index.js";

/** Neutral host: the redactor stands in for a host's secret-shape rules (one vendor token shape). */
const host: PeerTransportHost = {
  redact: ({ text }) => ({ text: text.replace(/ghp_[A-Za-z0-9]{36}/g, "[REDACTED]") }),
  asEgressRefusal: () => undefined,
  devHostsSetting: "EXAMPLE_DEV_HOSTS",
  productName: "Example",
  history: { kind: "example-peer" },
};
const { callPeer, pullBlobsFromPeer, pushBundleToPeer } = createPeerTransport({ host });

const credential: PeerTransportCredential = { id: "peer", label: "Live", baseUrl: "https://live.example", remoteWorkspaceId: "remote", apiKey: ["fixture", "credential"].join("-") };

test("peer failures preserve the live error id and safe typed disk refusal", async () => {
  const errorId = "b206dadf-1111-4444-8888-123456789abc";
  const message = "The server's disk is almost full (12 MB free, needs 62 MB) — free space or grow the disk.";
  for (const [status, body, expected] of [
    [500, { code: "INTERNAL_ERROR", error: "SECRET SQL", errorId }, `error id ${errorId}`],
    [507, { code: "INSUFFICIENT_STORAGE", error: message, errorId }, message],
  ] as const) {
    const deps = client({ reply: () => response({ status, bodyText: JSON.stringify(body) }) });
    await assert.rejects(callPeer({ deps, request: { method: "POST", path: "/route" } }), error => {
      assert.ok(error instanceof PublishContentPeerTransportError);
      assert.ok(error.message.includes(expected));
      assert.ok(error.message.includes(errorId));
      assert.ok(!error.message.includes("SECRET SQL"));
      return true;
    });
  }
});
function client({ reply }: { reply: (request: HttpRequest) => HttpResponse }, _options = {}) {
  const calls: HttpRequest[] = [];
  const httpClient: PeerHttpClient = { send: async (request) => { calls.push(request); return reply(request); } };
  return { httpClient, credential, calls };
}
function response({ status = 200, bodyText = "{}" }: { status?: number; bodyText?: string }, _options = {}): HttpResponse { return { status, headers: {}, bodyText }; }

test("L061 peer call preserves archive precedence, JSON/null encoding, empty body and deadlines", async () => {
  const deps = client({ reply: () => response({ status: 204 }) });
  const archive = new Uint8Array([1, 2]);
  for (const payload of [{}, { body: null }, { body: { x: 1 } }, { body: { ignored: true }, archive }]) {
    assert.equal(await callPeer({ deps, request: { method: "POST", path: "/route", ...payload } }), undefined);
  }
  assert.equal(deps.calls[0].body, undefined);
  assert.equal(deps.calls[0].headers["content-type"], undefined);
  assert.equal(deps.calls[1].body, "null");
  assert.equal(deps.calls[2].body, '{"x":1}');
  assert.equal(deps.calls[2].headers["content-type"], "application/json");
  assert.equal(deps.calls[3].body, archive);
  assert.equal(deps.calls[3].headers["content-type"], "application/zip");
  for (const call of deps.calls) {
    assert.equal(call.headers.authorization, `Bearer ${credential.apiKey}`);
    assert.equal(call.timeoutMs, 60_000);
    assert.equal(call.totalDeadlineMs, 60_000);
  }
});

test("L061 peer call retains rejection, invalid JSON and network error contracts", async () => {
  for (const status of [199, 300, 403, 500]) {
    const deps = client({ reply: () => response({ status, bodyText: "x".repeat(500) }) });
    await assert.rejects(callPeer({ deps, request: { method: "GET", path: "/route" } }), (err: unknown) => {
      assert.ok(err instanceof PublishContentPeerTransportError);
      assert.equal(err.code, "PEER_REJECTED");
      assert.equal(err.peerStatus, status);
      assert.equal(err.message, `the peer refused GET /route with HTTP ${status}`);
      return true;
    });
  }
  const refusal = client({ reply: () => response({ status: 403, bodyText: JSON.stringify({ details: { reason: "credential_kind_not_permitted" } }) }) });
  await assert.rejects(callPeer({ deps: refusal, request: { method: "POST", path: "/route" } }), /Connect this computer/);
  const invalid = client({ reply: () => response({ bodyText: "not-json" }) });
  await assert.rejects(callPeer({ deps: invalid, request: { method: "GET", path: "/route" } }), (err: unknown) => err instanceof PublishContentPeerTransportError && err.code === "PEER_RESPONSE_INVALID");
  const good = client({ reply: () => response({ bodyText: "null" }) });
  assert.equal(await callPeer({ deps: good, request: { method: "GET", path: "/route" } }), null);
  for (const failure of [new Error("offline"), "offline"]) {
    const httpClient: PeerHttpClient = { send: async () => { throw failure; } };
    await assert.rejects(callPeer({ deps: { httpClient, credential }, request: { method: "GET", path: "/route" } }), /could not be reached\.$/);
  }
});

test("L061 push pins mixed missing blobs and malformed probe fallback before stage/plan", async () => {
  const bundle: PublishContentExportEnvelope = { artifactFormatVersion: PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION, hashVersion: 1, sourceLabel: "Local", entities: [], blobManifest: ["held", "gone"], skipped: [] };
  for (const missing of [["held", 1, "gone"], undefined, "bad"]) {
    const deps = client({ reply: (request) => {
      if (request.url.endsWith("/blobs/probe")) return response({ bodyText: JSON.stringify({ missing }) });
      if (request.url.endsWith("/bundles")) return response({ bodyText: '{"bundleId":"b"}' });
      return response({});
    } });
    const result = await pushBundleToPeer({
                                            deps: { ...deps, computeStorageKey: ({ sha256: sha }: { sha256: string }, _options: Record<string, never> = {}) => sha, blobSource: {
        exists: async ({ sha256 }) => sha256 === "held", get: async () => new Uint8Array([1]),
      } },
                                            required: { bundle }
                                          });
    assert.deepEqual(result.blobsUploaded, Array.isArray(missing) ? ["held"] : []);
    assert.deepEqual(result.blobsUnavailable, Array.isArray(missing) ? ["gone"] : []);
    assert.ok(deps.calls.at(-2)?.url.endsWith("/bundles"));
    assert.ok(deps.calls.at(-1)?.url.endsWith("/import/plan"));
  }
});

test("L061 pull cap counts missing fetches, skips held blobs and deduplicates before network I/O", async () => {
  const bytes = Buffer.from("verified");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const deps = client({ reply: (request) => request.url.endsWith("/gone") ? response({ status: 404 }) : response({ bodyText: JSON.stringify({ dataBase64: bytes.toString("base64") }) }) });
  const written: string[] = [];
  const result = await pullBlobsFromPeer({
                                           deps: { ...deps, workspaceId: "local", maxBlobs: 2, computeStorageKey: ({ sha256: s }: { sha256: string }, _options: Record<string, never> = {}) => s, blobSink: {
      exists: async ({ storageKey }) => storageKey === "held",
      putIfAbsent: async ({ sha256 }) => { written.push(sha256); return { storageKey: sha256, written: true }; },
    } },
                                           required: { blobManifest: ["held", "gone", "gone", sha, "deferred", "held"] }
                                         });
  assert.deepEqual(result, { downloaded: [sha], alreadyPresent: ["held"], unavailable: ["gone"], deferredOverCap: ["deferred"] });
  assert.deepEqual(written, [sha]);
  assert.equal(deps.calls.length, 2);
});

test("L061 pull refuses malformed payloads and non-404 failures before any write", async () => {
  for (const reply of [response({ bodyText: "[]" }), response({}), response({ bodyText: '{"dataBase64":"garbage"}' }), response({ status: 500 })]) {
    const deps = client({ reply: () => reply });
    await assert.rejects(pullBlobsFromPeer({
                                             deps: { ...deps, workspaceId: "local", computeStorageKey: ({ sha256: s }: { sha256: string }, _options: Record<string, never> = {}) => s, blobSink: {
        exists: async () => false, putIfAbsent: async () => { assert.fail("must not write"); },
      } },
                                             required: { blobManifest: ["a".repeat(64)] }
                                           }), PublishContentPeerTransportError);
  }
});

test("L061 transport errors omit upstream messages and bodies, including opaque credentials", async () => {
  for (const failure of [new Error(credential.apiKey), credential.apiKey, { body: credential.apiKey }]) {
    const httpClient: PeerHttpClient = { send: async () => { throw failure; } };
    await assert.rejects(callPeer({ deps: { httpClient, credential }, request: { method: "GET", path: "/route" } }), (err: unknown) => {
      assert.ok(err instanceof PublishContentPeerTransportError);
      assert.equal(err.code, "PEER_UNREACHABLE");
      assert.equal(err.message, "the peer at 'live.example' could not be reached.");
      assert.equal(err.message.includes(credential.apiKey), false);
      return true;
    });
  }
  for (const status of [401, 403, 500]) {
    const deps = client({ reply: () => response({ status, bodyText: JSON.stringify({ error: credential.apiKey }) }) });
    await assert.rejects(callPeer({ deps, request: { method: "GET", path: "/route" } }), (err: unknown) => {
      assert.ok(err instanceof PublishContentPeerTransportError);
      assert.equal(err.code, "PEER_REJECTED");
      assert.equal(err.peerStatus, status);
      assert.equal(err.message, `the peer refused GET /route with HTTP ${status}`);
      assert.equal(err.message.includes(credential.apiKey), false);
      return true;
    });
  }
});

test("L061 diagnostics reuse secret redaction for credential-shaped request context", async () => {
  const secret = ["ghp", "_", "a".repeat(36)].join("");
  const deps = client({ reply: () => response({ status: 500 }) });
  await assert.rejects(callPeer({ deps, request: { method: "GET", path: `/route/${secret}` } }), (err: unknown) => {
    assert.ok(err instanceof PublishContentPeerTransportError);
    assert.equal(err.code, "PEER_REJECTED");
    assert.equal(err.message.includes(secret), false);
    assert.match(err.message, /REDACTED/);
    return true;
  });
});

test("L061 a peer cannot request uploads outside the selected manifest, even after a valid hash", async () => {
  for (const missing of [["unrelated"], ["selected", "unrelated"], ["unrelated", "selected"]]) {
    const deps = client({ reply: request => {
      assert.ok(request.url.endsWith("/blobs/probe"));
      return response({ bodyText: JSON.stringify({ missing }) });
    } });
    const bundle: PublishContentExportEnvelope = { artifactFormatVersion: PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION, hashVersion: 1, sourceLabel: "Local", entities: [], blobManifest: ["selected"], skipped: [] };
    await assert.rejects(pushBundleToPeer({
                                            deps: { ...deps,
        computeStorageKey: () => { return assert.fail("must not compute an unapproved storage key"); },
        blobSource: {
          exists: async () => { return assert.fail("must not probe local storage"); },
          get: async () => { return assert.fail("must not read local bytes"); },
        },
      },
                                            required: { bundle }
                                          }), (err: unknown) => {
      assert.ok(err instanceof PublishContentPeerTransportError);
      assert.equal(err.code, "PEER_RESPONSE_INVALID");
      assert.equal(err.message, "the peer requested a blob outside the selected manifest");
      return true;
    });
    assert.equal(deps.calls.length, 1, 'invalid probes must neither upload nor stage a bundle');
  }
});

test("L061 known peer refusals keep fixed operator guidance without echoing peer text", async () => {
  const cases: readonly [number, unknown, string][] = [
    [404, { code: "WORKSPACE_NOT_FOUND" }, "The destination workspace was not found; check the peer's workspace setting."],
    [404, { error: "workspace was not found" }, "The destination workspace was not found; check the peer's workspace setting."],
    [413, { code: "PAYLOAD_TOO_LARGE" }, "The transfer exceeds the peer's size limit; publish a smaller selection."],
    [409, { code: "PLAN_STALE" }, "The destination changed since the plan was checked; check what would change again."],
    [409, { code: "TOKEN_EXPIRED" }, "The confirmation expired; check and confirm the publish again."],
    [409, { code: "TOKEN_ALREADY_REDEEMED" }, "This confirmation was already used; check the publish result before trying again."],
    [409, { code: "RESTORE_POINT_UNAVAILABLE" }, "The peer could not create a restore point; repair its backup storage before publishing."],
    [404, { code: "BUNDLE_NOT_FOUND" }, "The staged bundle was not found on the peer; send the selection again."],
    [413, "proxy failure", "The transfer exceeds the peer's size limit; publish a smaller selection."],
    [409, null, "The peer reported a conflict; check what would change again before retrying."],
  ];
  for (const [status, body, guidance] of cases) {
    const bodyText = body !== null && typeof body === "object"
      ? JSON.stringify({ message: credential.apiKey, ...body }) : String(body);
    const deps = client({ reply: () => response({ status, bodyText }) });
    await assert.rejects(callPeer({ deps, request: { method: "POST", path: "/route" } }), err => {
      assert.ok(err instanceof PublishContentPeerTransportError);
      assert.equal(err.message, `the peer refused POST /route with HTTP ${status}. ${guidance}`);
      assert.equal(err.peerStatus, status);
      assert.equal(err.message.includes(credential.apiKey), false);
      return true;
    });
  }
  for (const body of [{ code: credential.apiKey, error: credential.apiKey }, { code: "__proto__" }, { error: `workspace was not found ${credential.apiKey}` }, []]) {
    const deps = client({ reply: () => response({ status: 404, bodyText: JSON.stringify(body) }) });
    await assert.rejects(callPeer({ deps, request: { method: "GET", path: "/route" } }), { message: "the peer refused GET /route with HTTP 404" });
  }
});

test("L061 network codes yield fixed diagnostics without exposing messages or causes", async () => {
  const cases: readonly [string, RegExp][] = [
    ["ECONNREFUSED", /peer refused the connection/], ["ENOTFOUND", /hostname could not be resolved/],
    ["CERT_HAS_EXPIRED", /TLS certificate could not be verified/], ["ERR_TLS_CERT_ALTNAME_INVALID", /TLS certificate could not be verified/],
    ["ETIMEDOUT", /connection timed out/],
  ];
  for (const [code, expected] of cases) {
    for (const failure of [Object.assign(new Error(credential.apiKey), { code }),
      new Error(credential.apiKey, { cause: { code, message: credential.apiKey } })]) {
      const httpClient: PeerHttpClient = { send: async () => { throw failure; } };
      await assert.rejects(callPeer({ deps: { httpClient, credential }, request: { method: "GET", path: "/route" } }), err => {
        assert.ok(err instanceof PublishContentPeerTransportError);
        assert.equal(err.code, "PEER_UNREACHABLE");
        assert.match(err.message, expected);
        assert.equal(err.message.includes(credential.apiKey), false);
        return true;
      });
    }
  }
});

test("L061 a repeated missing sha is probed, read and uploaded only once", async () => {
  const bundle: PublishContentExportEnvelope = { artifactFormatVersion: PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION,
    hashVersion: 1, sourceLabel: "Local", entities: [], blobManifest: ["held", "gone"], skipped: [] };
  const deps = client({ reply: request => {
    if (request.url.endsWith("/blobs/probe")) return response({ bodyText: JSON.stringify({ missing: ["held", "held", "gone", "gone", "held"] }) });
    if (request.url.endsWith("/bundles")) return response({ bodyText: '{"bundleId":"b"}' });
    return response({});
  } });
  const probes: string[] = [];
  const reads: string[] = [];
  const result = await pushBundleToPeer({
                                          deps: { ...deps, computeStorageKey: ({ sha256: sha }: { sha256: string }, _options: Record<string, never> = {}) => sha, blobSource: {
      exists: async ({ sha256 }) => { probes.push(sha256); return sha256 === "held"; },
      get: async ({ sha256 }) => { reads.push(sha256); return new Uint8Array([1]); },
    } },
                                          required: { bundle }
                                        });
  assert.deepEqual(probes, ["held", "gone"]);
  assert.deepEqual(reads, ["held"]);
  assert.deepEqual(result.blobsUploaded, ["held"]);
  assert.deepEqual(result.blobsUnavailable, ["gone"]);
  assert.equal(deps.calls.filter(request => request.method === "PUT").length, 1);
});

test("security cleanup pins network code precedence and every empty diagnostic branch", async () => {
  const refused = " The peer refused the connection; check that it is running and reachable.";
  const dns = " The peer's hostname could not be resolved; check its address and DNS.";
  const cases: readonly [unknown, string][] = [
    [null, ""], [undefined, ""], [7, ""], ["ECONNREFUSED", ""],
    [{}, ""], [{ cause: null }, ""], [{ cause: "ECONNREFUSED" }, ""], [{ cause: {} }, ""],
    [{ code: undefined, cause: { code: "ECONNREFUSED" } }, ""],
    [{ code: 7, cause: { code: "ECONNREFUSED" } }, ""],
    [{ code: "unknown", cause: { code: "ECONNREFUSED" } }, ""],
    [{ cause: { code: 7 } }, ""], [{ cause: { code: "unknown" } }, ""],
    [{ code: "ENOTFOUND", cause: { code: "ECONNREFUSED" } }, dns],
    [{ cause: { code: "ECONNREFUSED" } }, refused],
    [{ cause: { cause: { code: "ECONNREFUSED" } } }, ""],
    [Object.create({ code: "ECONNREFUSED" }), refused],
  ];
  for (const [failure, suffix] of cases) {
    const httpClient: PeerHttpClient = { send: async () => { throw failure; } };
    await assert.rejects(callPeer({ deps: { httpClient, credential }, request: { method: "GET", path: "/route" } }), {
      code: "PEER_UNREACHABLE", message: `the peer at 'live.example' could not be reached.${suffix}`,
    });
  }
  const reads: string[] = [];
  const failure = {
    get cause() { reads.push("cause"); return { code: "ECONNREFUSED" }; },
    get code() { reads.push("code"); return "ENOTFOUND"; },
  };
  await assert.rejects(callPeer({ deps: { credential, httpClient: { send: async () => { throw failure; } } }, request: { method: "GET", path: "/route" } }));
  assert.deepEqual(reads, ["cause", "code"]);
});

test("security cleanup pins peer code, legacy sentinel and HTTP fallback precedence", async () => {
  const workspace = "The destination workspace was not found; check the peer's workspace setting.";
  const stale = "The destination changed since the plan was checked; check what would change again.";
  const large = "The transfer exceeds the peer's size limit; publish a smaller selection.";
  const conflict = "The peer reported a conflict; check what would change again before retrying.";
  const cases: readonly [number, string, string | undefined][] = [
    [404, '{"code":"PLAN_STALE","error":"workspace was not found"}', stale],
    [413, '{"code":"PLAN_STALE"}', stale],
    [409, '{"code":"WORKSPACE_NOT_FOUND"}', workspace],
    [404, '{"code":7,"error":"workspace was not found"}', workspace],
    [404, '{"code":"unknown","error":"workspace was not found"}', workspace],
    [500, '{"error":"workspace was not found"}', undefined],
    [404, '{"error":7}', undefined], [404, '{}', undefined],
    [404, '{', undefined], [404, 'null', undefined], [404, 'true', undefined],
    [404, '"text"', undefined], [404, '[]', undefined],
    [413, '{}', large], [413, '{', large], [413, 'null', large],
    [409, '{}', conflict], [409, '{', conflict], [409, 'null', conflict],
  ];
  for (const [status, bodyText, guidance] of cases) {
    const deps = client({ reply: () => response({ status, bodyText }) });
    await assert.rejects(callPeer({ deps, request: { method: "GET", path: "/route" } }), {
      code: "PEER_REJECTED", peerStatus: status,
      message: `the peer refused GET /route with HTTP ${status}${guidance ? `. ${guidance}` : ""}`,
    });
  }
});
