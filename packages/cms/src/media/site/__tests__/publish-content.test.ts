import { expect, it, vi } from "vitest";
import { contributeMediaPublish } from "../publish-content.js";

it("refuses a missing staged blob without writing media", async () => {
  const save = vi.fn();
  const sha256 = "a".repeat(64);
  const handler = contributeMediaPublish().build({ workspaceId: "w", clock: { nowMs: () => 0 }, idGen: { newId: () => "id" },
    ports: { media: { repo: { findById: async () => null, findBySlug: async () => null, list: async () => [], save },
      assetBlobRepo: { findByHash: async () => null }, blobStore: { exists: async () => false } } } } as unknown as Parameters<ReturnType<typeof contributeMediaPublish>["build"]>[0]);
  const entity = { entityType: "media", id: "id", schemaVersion: 1, contentHash: "hash", hashVersion: 1, requiredBlobs: [sha256],
    state: { kind: "media", slug: "image", source: { sha256 } } };
  expect(await handler.precheck({ entity })).toBe(`required blob '${sha256}' is not available on this destination`);
  expect(save).not.toHaveBeenCalled();
});
