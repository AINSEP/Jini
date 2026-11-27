import assert from "node:assert/strict";
import { test } from "vitest";
import { setImmediate } from "node:timers/promises";
import { resolveMediaByteSizes } from "../byte-size.js";

type Required = Parameters<typeof resolveMediaByteSizes>[0];

/** Owner's 2026-10-04 decision: stat only the supplied batch, bounded to eight lookups. */
test("media sizes read returned distinct hashes in one workspace batch and keep eight stats in flight", async () => {
  const hashes = Array.from({ length: 19 }, (_, index) => `hash-${index}`);
  let lookups = 0;
  const keys: string[] = [];
  let active = 0;
  let peak = 0;
  const deps = {
    workspaceId: "returned-workspace",
    assetBlobRepo: {
      list: async ({ workspaceId }: { workspaceId: string }, { sha256s }: { sha256s?: readonly string[] } = {}) => {
        assert.equal(workspaceId, "returned-workspace", "the blob batch is workspace scoped");
        assert.deepEqual(sha256s, hashes, "the blob batch contains only distinct returned hashes");
        lookups++;
        return hashes.map((sha256) => ({ sha256, storageKey: `original/${sha256}` }));
      },
    },
    blobStore: {
      sizeOf: async ({ storageKey }: { storageKey: string }) => {
        keys.push(storageKey);
        active++;
        peak = Math.max(peak, active);
        await setImmediate();
        active--;
        return 13;
      },
      get: async () => { throw new Error("sizes must never download payloads"); },
    },
  } as unknown as Required["deps"];
  const media = [...hashes, hashes[0]!].map((sha256) => ({ source: { sha256 } }));
  const result = await resolveMediaByteSizes({ deps, media });
  assert.equal(peak, 8, "at most eight original-blob stats run at once");
  assert.equal(active, 0, "every stat settles before returning");
  assert.equal(lookups, 1, "one blob repository read serves the returned page");
  assert.deepEqual(keys.toSorted(), hashes.map((hash) => `original/${hash}`).toSorted(), "each original key is statted once");
  assert.deepEqual([...result.values()], Array(19).fill(13), "known sizes survive the batch lookup");
});

test("media sizes preserve zero and isolate missing rows, missing files, and storage errors", async () => {
  const hashes = ["zero", "missing-row", "missing-file", "stat-error", "healthy"];
  const deps = {
    workspaceId: "ws",
    assetBlobRepo: {
      list: async () => hashes.filter((sha256) => sha256 !== "missing-row").map((sha256) => ({ sha256, storageKey: sha256 })),
    },
    blobStore: {
      sizeOf: async ({ storageKey }: { storageKey: string }) => {
        if (storageKey === "stat-error") throw new Error("permission denied");
        if (storageKey === "missing-file") return null;
        return storageKey === "zero" ? 0 : 13;
      },
    },
  } as unknown as Required["deps"];
  const media = hashes.map((sha256) => ({ source: { sha256 } }));
  const sizes = await resolveMediaByteSizes({ deps, media });
  assert.deepEqual(hashes.map((hash) => sizes.get(hash)), [0, null, null, null, 13], "zero stays known while missing rows and failed stats stay unknown");
  deps.assetBlobRepo.list = async () => { throw new Error("repo unavailable"); };
  const unavailable = await resolveMediaByteSizes({ deps, media });
  assert.deepEqual(hashes.map((hash) => unavailable.get(hash)), hashes.map(() => null), "a failed batch lookup leaves every size unknown");
});

test("older blob adapters report null without payload or repository I/O; empty pages do nothing", async () => {
  let lookups = 0;
  let downloads = 0;
  const deps = {
    workspaceId: "ws",
    assetBlobRepo: { list: async () => { lookups++; throw new Error("unnecessary repo I/O"); } },
    blobStore: { get: async () => { downloads++; throw new Error("unnecessary payload I/O"); } },
  } as unknown as Required["deps"];
  const media = [{ source: { sha256: "unknown" } }];
  assert.deepEqual([...await resolveMediaByteSizes({ deps, media })], [["unknown", null]], "an older adapter keeps every size unknown");
  const sizedStore = { ...deps.blobStore, sizeOf: async () => { throw new Error("unnecessary stat I/O"); } };
  assert.deepEqual([...await resolveMediaByteSizes({ deps: { ...deps, blobStore: sizedStore }, media: [] })], [], "an empty page needs no blob rows or stats");
  assert.equal(lookups, 0, "missing stat capability and empty pages perform no database calls");
  assert.equal(downloads, 0, "byte sizes never download payloads");
});

test("a later size read recovers after a transient repository failure without reusing a null result", async () => {
  let unavailable = true;
  const lookedUp: unknown[] = [];
  const statted: unknown[] = [];
  const deps = {
    workspaceId: "garden",
    assetBlobRepo: { list: async (required: unknown, options: unknown) => {
      lookedUp.push([required, options]);
      if (unavailable) throw new Error("storage temporarily unavailable");
      return [{ sha256: "flower", storageKey: "orig/flower" }];
    } },
    blobStore: { sizeOf: async (required: unknown) => { statted.push(required); return 812; } },
  } as unknown as Required["deps"];
  const media = [{ source: { sha256: "flower" } }];
  assert.deepEqual(await resolveMediaByteSizes({ deps, media }), new Map([["flower", null]]));
  assert.deepEqual(statted, []);
  unavailable = false;
  assert.deepEqual(await resolveMediaByteSizes({ deps, media }), new Map([["flower", 812]]));
  assert.deepEqual(lookedUp, [
    [{ workspaceId: "garden" }, { sha256s: ["flower"] }], [{ workspaceId: "garden" }, { sha256s: ["flower"] }],
  ]);
  assert.deepEqual(statted, [{ storageKey: "orig/flower" }]);
});
