import { describe, it, expect } from "vitest";

import { createFileBlobIndex, type PackedEntity } from "../../transfer/index.js";
import { createPlanPublishToPeer, type PlanPublishToPeerHost } from "../push-plan.js";
import type { PublishContentHandler } from "../type-registry.js";

type Ports = Record<string, never>;

const clock = { nowMs: () => Date.parse("2026-10-01T12:00:00.000Z") };
const idGen = { newId: () => "id-1" };
const credential = { id: "peer-1", label: "Peer site", baseUrl: "https://peer.example", remoteWorkspaceId: "remote", apiKey: "k" };

function entity(entityType: string, id: string, state: Record<string, unknown>): PackedEntity {
  return { entityType, id, schemaVersion: 1, hashVersion: 1, state, contentHash: `h-${id}`, requiredBlobs: [] };
}

function setup(entities: PackedEntity[]) {
  const pushed: Array<{ keys: string[]; origin?: string; overwrite?: readonly string[] }> = [];
  const catalogReads: unknown[] = [];
  const urlCalls: Array<{ id: unknown; origin: string | undefined }> = [];
  const handlers = [...new Set(entities.map((e) => e.entityType))].map((entityType) => ({
    entityType, schemaVersion: 1, permission: "content.write", dependsOn: [],
    pack: async function* () { yield* entities.filter((e) => e.entityType === entityType); },
    inspect: async () => null, precheck: async () => null, apply: async () => { throw new Error("a plan never applies"); },
  }) as unknown as PublishContentHandler);
  const host: PlanPublishToPeerHost<Ports> = {
    catalog: {
      build: (deps) => {
        catalogReads.push(deps);
        return { handlers, handlerByType: new Map(handlers.map((h) => [h.entityType, h])), applyOrder: handlers.map((h) => h.entityType) };
      },
    },
    pushBundleToPeer: (async ({ required }: { deps: { credential: typeof credential }; required: { bundle: { entities: PackedEntity[] }; overwriteEntityKeys?: readonly string[] } }) => {
      pushed.push({ keys: required.bundle.entities.map((e) => `${e.entityType}:${e.id}`), ...(required.overwriteEntityKeys ? { overwrite: required.overwriteEntityKeys } : {}) });
      return { bundleId: "bundle-9", blobsUploaded: [], blobsUnavailable: [], notSupportedByLive: [{ entityType: "gizmo", count: 1 }], liveCanOverwrite: true,
        plan: { domain: "d", planId: "plan-1", planHash: "h", details: { refused: false, rows: [] } } };
    }) as never,
    entryPublicPath: ({ post, ctx }) => {
      urlCalls.push({ id: (post as { id?: unknown }).id, origin: ctx.originOverride });
      return { canonicalUrl: `${ctx.originOverride}/${(post as { slug?: string }).slug}` };
    },
  };
  const plan = createPlanPublishToPeer(host);
  const run = (input: Parameters<typeof plan>[1] = {}, workspaceName?: string) => plan({
    deps: {
      workspaceId: "local", authorize: async () => ({ allowed: true, reason: "ok" }),
      publishContentDeps: { workspaceId: "local", clock, idGen, ports: {} },
      workspaceRepo: { findById: async () => (workspaceName ? { name: workspaceName } : null) },
      blobStore: { exists: async () => false, get: async () => new Uint8Array() } as never,
      fileBlobIndex: createFileBlobIndex(),
    },
    peer: { credential, httpClient: { send: async () => ({}) } as never },
    principalId: "owner",
  }, input);
  return { run, pushed, catalogReads, urlCalls };
}

describe("createPlanPublishToPeer", () => {
  it("packs through the injected catalog, pushes through the injected transport and reports what was sent", async () => {
    const s = setup([entity("post", "p1", { title: "Hello", slug: "hello" }), entity("tag", "t1", { title: "News" })]);
    const out = await s.run();
    expect(s.catalogReads.length).toBeGreaterThan(0);
    expect(s.pushed).toEqual([{ keys: ["post:p1", "tag:t1"] }]);
    expect(out.bundleId).toBe("bundle-9");
    expect(out.peerId).toBe("peer-1");
    // one entity was held back by the peer, so it is not counted as sent
    expect(out.entityCount).toBe(1);
    expect(out.itemNames).toEqual({ "post:p1": ["Hello", "hello"], "tag:t1": ["News"] });
  });

  it("routes only post-shaped entities through the injected public-path resolver, against the peer's origin", async () => {
    const s = setup([entity("post", "p1", { slug: "hello" }), entity("page", "g1", { slug: "about" }), entity("tag", "t1", { slug: "news" })]);
    const out = await s.run();
    expect(out.publicUrls).toEqual({ "post:p1": "https://peer.example/hello", "page:g1": "https://peer.example/about" });
    expect(s.urlCalls.map((c) => c.origin)).toEqual(["https://peer.example", "https://peer.example"]);
  });

  it("narrows by selection before pushing and echoes the overwrite set only when one was given", async () => {
    const s = setup([entity("post", "p1", { slug: "a" }), entity("post", "p2", { slug: "b" })]);
    const out = await s.run({ selectedEntityKeys: ["post:p2"], overwriteEntityKeys: ["post:p2"] });
    expect(s.pushed).toEqual([{ keys: ["post:p2"], overwrite: ["post:p2"] }]);
    expect(out.overwriteEntityKeys).toEqual(["post:p2"]);
    expect("overwriteEntityKeys" in (await s.run())).toBe(false);
  });
});
