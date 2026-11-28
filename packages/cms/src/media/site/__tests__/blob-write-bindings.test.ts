import { bytesMatchSha256 } from "../../../publish/transfer/blob-staging.js";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createHostBlobWriteBindings, createProcessBlobFence } from "../blob-write-bindings.js";
import { withSha256Lock } from "../../index.js";

it("sorts and deduplicates unordered fence keys before entering shared locks", async () => {
  const fence = createProcessBlobFence();
  const order: string[] = [];
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const blocker = withSha256Lock({ key: "blob-fence:key:w:a", criticalSection: async () => { entered(); await gate; } });
  await held;
  const work = fence.withKeys({ workspaceId: "w", storageKeys: ["z", "a", "z"], work: async () => { order.push("work"); } });
  await withSha256Lock({ key: "blob-fence:key:w:z", criticalSection: async () => { order.push("z"); } });
  expect(order).toEqual(["z"]);
  release();
  await Promise.all([blocker, work]);
  expect(order).toEqual(["z", "work"]);
});

it("refuses stored bytes with matching length but a different digest", async () => {
  const get = vi.fn(async () => new Uint8Array([2]));
  const bindings = createHostBlobWriteBindings({ bytesMatchSha256, blobStore: { get } });
  const sha256 = createHash("sha256").update(new Uint8Array([1])).digest("hex");
  await expect(bindings.verifyStoredBlob({ storageKey: "key", sha256, byteLength: 1 })).rejects.toThrow("Stored blob 'key' failed verification");
});

it("uses the canonical workspace and digest key regardless of the bound storage driver", () => {
  const blobStore = { get: async () => { throw new Error("unexpected read"); } };
  const bindings = createHostBlobWriteBindings({ blobStore, bytesMatchSha256 });
  const sha256 = "ab" + "9".repeat(62);
  expect(bindings.storageKeyFor({ workspaceId: "site-one", sha256 })).toBe(`ws/site-one/blobs/ab/${sha256}`);
  expect(bindings.storageKeyFor({ workspaceId: "site-two", sha256 })).toBe(`ws/site-two/blobs/ab/${sha256}`);
});

it("asset fences serialize work on the same asset and keep it apart from storage-key locks", async () => {
  const fence = createProcessBlobFence();
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = fence.withAsset({ workspaceId: "w", assetId: "a1", work: async () => { order.push("first-start"); await gate; order.push("first-end"); return "one"; } });
  const second = fence.withAsset({ workspaceId: "w", assetId: "a1", work: async () => { order.push("second"); return "two"; } });
  const keyed = fence.withKeys({ workspaceId: "w", storageKeys: ["a1"], work: async () => { order.push("key"); return "key"; } });
  expect(await keyed).toBe("key");
  expect(order).toEqual(["first-start", "key"]);
  release();
  expect(await Promise.all([first, second])).toEqual(["one", "two"]);
  expect(order).toEqual(["first-start", "key", "first-end", "second"]);
});
