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
  type PublishHistoryRecorder,
} from "../peer-transport.js";
import type { PublishContentExportEnvelope } from "../export-bundle.js";
import { PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION } from "../../transfer/index.js";

/**
 * Pins the host seam `createPeerTransport` introduced: the injected redactor reaches EVERY error
 * this module emits (mutation `redact-not-applied`), the opened credential travels only as the
 * `Authorization` header on every leg (mutation `auth-header-dropped`), and the host copy/history
 * kind come from the host, not the engine.
 */

class FixtureEgressRefusal extends Error {
  readonly callerSafeMessage = "egress refused";
}

const credential: PeerTransportCredential = {
  id: "peer-1", label: "Live", baseUrl: "https://live.example", remoteWorkspaceId: "remote ws", apiKey: ["opaque", "fixture", "key"].join("-"),
};

/** Wraps every message so a test can see the redactor ran over it, whatever its text. */
const markingHost: PeerTransportHost = {
  redact: ({ text }) => ({ text: `R(${text})` }),
  asEgressRefusal: ({ err }) => (err instanceof FixtureEgressRefusal ? err : undefined),
  devHostsSetting: "EXAMPLE_DEV_HOSTS",
  productName: "Example",
  history: { kind: "example-peer" },
};
const marked = createPeerTransport({ host: markingHost });

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const BLOB = new Uint8Array([7, 8, 9]);
const BLOB_SHA = sha(BLOB);

function router(routes: Record<string, unknown>, calls: HttpRequest[] = []): { httpClient: PeerHttpClient; calls: HttpRequest[] } {
  const httpClient: PeerHttpClient = {
    send: async (request): Promise<HttpResponse> => {
      calls.push(request);
      const key = Object.keys(routes).find((suffix) => `${request.method} ${request.url}`.endsWith(suffix));
      if (key === undefined) return { status: 404, headers: {}, bodyText: "{}" };
      const body = routes[key];
      return typeof body === "string" ? { status: 200, headers: {}, bodyText: body } : { status: 200, headers: {}, bodyText: JSON.stringify(body) };
    },
  };
  return { httpClient, calls };
}

const bundle = (): PublishContentExportEnvelope => ({
  artifactFormatVersion: PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION, hashVersion: 1, sourceLabel: "Local", skipped: [], blobManifest: [BLOB_SHA],
  entities: [{ entityType: "post", requiredBlobs: [BLOB_SHA] } as unknown as PublishContentExportEnvelope["entities"][number]],
});
const pushSources = { blobSource: { exists: async () => true, get: async () => BLOB }, computeStorageKey: ({ sha256 }: { sha256: string }) => `k/${sha256}` };
const absentSink = { blobSink: { exists: async () => false, putIfAbsent: async () => ({ storageKey: "k", written: true }) }, workspaceId: "local", computeStorageKey: pushSources.computeStorageKey };

/** Every failure class the module can emit, each reached through the public bound functions. */
const failures: ReadonlyArray<[string, () => Promise<unknown>]> = [
  ["PEER_REJECTED", () => marked.callPeer({ deps: { ...router({}), credential }, request: { method: "GET", path: "/missing" } })],
  ["PEER_REJECTED credential kind", () => marked.callPeer({ deps: { httpClient: { send: async () => ({ status: 403, headers: {}, bodyText: JSON.stringify({ details: { reason: "credential_kind_not_permitted" } }) }) }, credential }, request: { method: "POST", path: "/x" } })],
  ["PEER_RESPONSE_INVALID not JSON", () => marked.callPeer({ deps: { ...router({ "/x": "not json" }), credential }, request: { method: "GET", path: "/x" } })],
  ["PEER_UNREACHABLE", () => marked.callPeer({ deps: { httpClient: { send: async () => { throw new Error("offline"); } }, credential }, request: { method: "GET", path: "/x" } })],
  ["EGRESS_REFUSED", () => marked.callPeer({ deps: { httpClient: { send: async () => { throw new FixtureEgressRefusal("10.0.0.1"); } }, credential }, request: { method: "GET", path: "/x" } })],
  ["EGRESS_REFUSED direct", async () => { throw marked.describePeerEgressRefusal({ err: new FixtureEgressRefusal("x"), baseUrl: credential.baseUrl }); }],
  ["requireObject", () => marked.confirmPeerImport({ deps: { ...router({ "/import/confirm": [] }), credential }, required: { planId: "p", planHash: "h" } })],
  ["no confirmation token", () => marked.confirmPeerImport({ deps: { ...router({ "/import/confirm": {} }), credential }, required: { planId: "p", planHash: "h" } })],
  ["PEER_CANNOT_OVERWRITE", () => marked.pushBundleToPeer({ deps: { ...router({ "/capabilities": { entityTypes: ["post"], features: [] } }), credential, ...pushSources }, required: { bundle: bundle(), overwriteEntityKeys: ["post:1"] } })],
  ["capabilities shape", () => marked.pushBundleToPeer({ deps: { ...router({ "/capabilities": {} }), credential, ...pushSources }, required: { bundle: bundle() } })],
  ["export shape", () => marked.pullBundleFromPeer({ ...router({ "/export": {} }), credential })],
  ["blob hash mismatch", () => marked.pullBlobsFromPeer({ deps: { ...router({ [`/blobs/${BLOB_SHA}`]: { dataBase64: "AAAA" } }), credential, ...absentSink }, required: { blobManifest: [BLOB_SHA] } })],
];

test("the injected redactor is applied to every error message the transport emits", async () => {
  for (const [label, run] of failures) {
    await assert.rejects(run(), (err: unknown) => {
      assert.ok(err instanceof PublishContentPeerTransportError, label);
      assert.match(err.message, /^R\(.*\)$/s, `${label}: ${err.message}`);
      return true;
    });
  }
});

test("host copy comes from the host: product name, dev-hosts setting and older-peer wording", async () => {
  const egress = marked.describePeerEgressRefusal({ err: new FixtureEgressRefusal("x"), baseUrl: "https://dev.internal:8443" });
  assert.equal(egress.code, "EGRESS_REFUSED");
  assert.match(egress.message, /\(EXAMPLE_DEV_HOSTS, a comma-separated list of hostnames — add 'dev\.internal'\)/);
  await assert.rejects(failures[2]![1](), /is 'live\.example' a Example instance\?/);
  await assert.rejects(failures[8]![1](), /is on an older Example, so it can't overwrite these yet/);
});

test("the credential travels only as the Bearer authorization header on every push and pull leg", async () => {
  const calls: HttpRequest[] = [];
  const recorded: Array<{ kind: string; target: string }> = [];
  const store: PublishHistoryRecorder = { recordSuccess: async ({ entry }) => { recorded.push({ kind: entry.kind, target: entry.target }); } };
  const { httpClient } = router({
    "/capabilities": { entityTypes: ["post"], features: ["overwrite-live"] }, "/blobs/probe": { missing: [BLOB_SHA] }, [`PUT https://live.example/api/admin/v1/workspaces/remote%20ws/publish-content/blobs/${BLOB_SHA}`]: {},
    "/bundles": { bundleId: "b1" }, "/import/plan": { planId: "p", planHash: "h" }, "/import/confirm": { confirmationToken: "t" }, "/import/execute": { runId: "r1" },
    "/export": { ...bundle(), entities: [] }, [`GET https://live.example/api/admin/v1/workspaces/remote%20ws/publish-content/blobs/${BLOB_SHA}`]: { dataBase64: Buffer.from(BLOB).toString("base64") },
  }, calls);
  const deps = { httpClient, credential, publishHistory: { store, workspaceId: "local", clock: { nowMs: () => 0 } } } as const;
  const pushed = await marked.pushBundleToPeer({ deps: { ...deps, ...pushSources }, required: { bundle: bundle() } });
  assert.deepEqual(pushed.blobsUploaded, [BLOB_SHA]);
  await marked.confirmPeerImport({ deps, required: { planId: "p", planHash: "h" } });
  await marked.executePeerImport({ deps, required: { bundleId: "b1", confirmationToken: "t" } });
  await marked.pullBundleFromPeer(deps);
  await marked.pullBlobsFromPeer({ deps: { ...deps, ...absentSink }, required: { blobManifest: [BLOB_SHA] } });
  assert.equal(calls.length, 9);
  for (const call of calls) {
    assert.equal(call.headers.authorization, `Bearer ${credential.apiKey}`, call.url);
    assert.ok(call.url.startsWith("https://live.example/api/admin/v1/workspaces/remote%20ws/publish-content/"), call.url);
    assert.equal(`${call.url} ${String(call.body ?? "")}`.includes(credential.apiKey), false);
  }
  assert.deepEqual(recorded, [{ kind: "example-peer", target: "peer-1" }]);
});
