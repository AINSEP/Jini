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
  const bindings = createHostBlobWriteBindings({ blobStore: { get } });
  const sha256 = createHash("sha256").update(new Uint8Array([1])).digest("hex");
  await expect(bindings.verifyStoredBlob({ storageKey: "key", sha256, byteLength: 1 })).rejects.toThrow("Stored blob 'key' failed verification");
});
