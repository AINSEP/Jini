/** Verified bytes precede staging; a failed blob leg cannot produce a staged bundle. The host's
 *  credential resolver and outbound transport are injected fakes, so this pins the seam itself. */
import { describe, it, expect } from "vitest";
import { createPullAndStageFromPeer, type PublishContentPullDeps } from "../pull.js";
import { InMemoryPublishContentBundleRepo } from "../../transfer/bundle-staging.js";
import { contentHash } from "../content-hash.js";
import type { PeerTransportCredential } from "../peer-transport.js";

const OWNER = "caller-principal";
const NOW = "2026-10-01T12:00:00.000Z";
const SHA = "a".repeat(64);

function entity(id: string) {
  const state = { title: `Live ${id}` };
  return { entityType: "pull-fixture", id, schemaVersion: 1, hashVersion: 1, contentHash: contentHash({ entityType: "pull-fixture", state }), requiredBlobs: [], state };
}

function setup(over: { failBlobs?: Error } = {}) {
  const events: string[] = [];
  const stored: string[] = [];
  const repo = new InMemoryPublishContentBundleRepo();
  const save = repo.save.bind(repo);
  repo.save = async (input) => { events.push("save"); return save(input); };
  const httpClient = { send: async () => { throw new Error("unused"); } };
  const credential: PeerTransportCredential = { id: "peer-1", label: "Live site", baseUrl: "https://live.example", remoteWorkspaceId: "remote-ws", apiKey: "k" };
  const resolved: unknown[] = [];
  const bundleCalls: unknown[] = [];
  const blobCalls: unknown[] = [];
  const envelope = { artifactFormatVersion: 1, hashVersion: 1, sourceLabel: "peer-declared", sourcePrincipalId: "someone-else", entities: [entity("one")], blobManifest: [SHA] };
  const deps: PublishContentPullDeps = {
    workspaceId: "local-ws", clock: { nowMs: () => Date.parse(NOW) }, idGen: { newId: () => "bundle-1" },
    publishContentBundleRepo: repo, publishContentPeerHttpClient: httpClient,
    blobStore: { exists: async () => false, putIfAbsent: async ({ sha256 }) => ({ storageKey: sha256, written: true }) },
  };
  const pullAndStageFromPeer = createPullAndStageFromPeer({ host: {
    resolveCredential: async (args) => { resolved.push(args.input); return credential; },
    pullBundleFromPeer: (async (peer: unknown) => { events.push("bundle"); bundleCalls.push(peer); return envelope; }) as never,
    pullBlobsFromPeer: (async ({ deps: d, required }: { deps: { computeStorageKey: (r: { sha256: string }) => string; workspaceId: string; blobSink: unknown }; required: { blobManifest: readonly string[] } }) => {
      events.push("blobs");
      blobCalls.push({ key: d.computeStorageKey({ sha256: SHA }), workspaceId: d.workspaceId, sink: d.blobSink, manifest: required.blobManifest });
      if (over.failBlobs) throw over.failBlobs;
      stored.push(SHA);
      return { downloaded: [SHA], alreadyPresent: [], unavailable: [], deferredOverCap: [] };
    }) as never,
  } });
  return { deps, repo, events, stored, resolved, bundleCalls, blobCalls, httpClient, pullAndStageFromPeer };
}

describe("pullAndStageFromPeer", () => {
  it("fetches the bundle, stores verified blobs, then stages it owned by the authenticated caller", async () => {
    const f = setup();
    const result = await f.pullAndStageFromPeer({ deps: f.deps, input: { peerId: "peer-1", principalId: OWNER } });
    expect(f.events).toEqual(["bundle", "blobs", "save"]);
    expect(result).toStrictEqual({ peerId: "peer-1", peerLabel: "Live site", bundleId: "bundle-1", expiresAt: "2026-10-02T12:00:00.000Z", entityCount: 1, blobManifest: [SHA], blobsDownloaded: [SHA], blobsAlreadyPresent: [], blobsUnavailable: [], blobsDeferred: [] });
    const row = await f.repo.findById({ workspaceId: "local-ws", id: "bundle-1" });
    expect(row?.sourcePrincipalId).toBe(OWNER);
    expect(JSON.parse(row!.entitiesJson)).toStrictEqual([entity("one")]);
  });

  it("opens the credential for this workspace and the named peer, and sends through the host's client", async () => {
    const f = setup();
    await f.pullAndStageFromPeer({ deps: f.deps, input: { peerId: "peer-1", principalId: OWNER } });
    expect(f.resolved).toStrictEqual([{ workspaceId: "local-ws", id: "peer-1" }]);
    expect((f.bundleCalls[0] as { httpClient: unknown }).httpClient).toBe(f.httpClient);
  });

  it("keys local blob storage by this instance's workspace, never the peer's", async () => {
    const f = setup();
    await f.pullAndStageFromPeer({ deps: f.deps, input: { peerId: "peer-1", principalId: OWNER } });
    const call = f.blobCalls[0] as { key: string; workspaceId: string; sink: unknown; manifest: string[] };
    expect(call.workspaceId).toBe("local-ws");
    expect(call.key).toContain("local-ws");
    expect(call.key).not.toContain("remote-ws");
    expect(call.sink).toBe(f.deps.blobStore);
    expect(call.manifest).toStrictEqual([SHA]);
  });

  it("a failed blob leg aborts the pull without staging anything", async () => {
    const f = setup({ failBlobs: new Error("bytes do not hash to the requested sha") });
    await expect(f.pullAndStageFromPeer({ deps: f.deps, input: { peerId: "peer-1", principalId: OWNER } })).rejects.toThrow("bytes do not hash");
    expect(f.events).toEqual(["bundle", "blobs"]);
    expect(await f.repo.findById({ workspaceId: "local-ws", id: "bundle-1" })).toBeNull();
  });
});
