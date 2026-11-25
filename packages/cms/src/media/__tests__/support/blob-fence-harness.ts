/** Test harness for the fenced blob GC: a shared "database" (kernel locks, repos, journal, byte store)
 * that several `createBlobGc` instances use as if each were its own process. */
import { AsyncLocalStorage } from "node:async_hooks";
import type { BlobFenceKernelPort, BlobOwnershipProbes, BlobUnlinkJournalRow } from "@jini-ai/core/contracts/blob-gc";
import { InMemoryBlobStore } from "../../blob-store.memory.js";
import { computeBlobStorageKey } from "../../blob-key.js";
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryMediaRepo } from "../../repo.memory.js";
import { createBlobGc, type BlobUnlinkJournalPort } from "../../blob-gc-fence.js";

export const DAY = 24 * 60 * 60 * 1000;
export const WS = "ws-1";
export const SHA = "ab".repeat(32);
export const KEY = computeBlobStorageKey({ workspaceId: WS, sha256: SHA });

/** A kernel whose key locks are shared by every connection and released when the transaction ends. */
export function createSharedLockKernel(): BlobFenceKernelPort & { readonly locked: string[]; heldKeys(): string[] } {
  const tails = new Map<string, Promise<void>>();
  const tx = new AsyncLocalStorage<Array<() => void>>();
  const held = new WeakMap<Array<() => void>, string[]>();
  const locked: string[] = [];
  return {
    locked,
    /** Keys this async context's open transaction holds (empty outside a transaction). */
    heldKeys() { const releases = tx.getStore(); return releases ? [...(held.get(releases) ?? [])] : []; },
    async transaction(fn) {
      const releases: Array<() => void> = [];
      try { return await tx.run(releases, fn); } finally { for (const release of releases) release(); }
    },
    async lockKey(key) {
      const releases = tx.getStore();
      if (!releases) throw new Error("lockKey outside a transaction");
      const previous = tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const mine = new Promise<void>((resolve) => { release = resolve; });
      tails.set(key, previous.then(() => mine));
      releases.push(release);
      held.set(releases, [...(held.get(releases) ?? []), key]);
      locked.push(key);
      await previous;
    },
  };
}

export function createMemoryJournal(): BlobUnlinkJournalPort & { rows: Map<string, BlobUnlinkJournalRow> } {
  const rows = new Map<string, BlobUnlinkJournalRow>();
  const id = (r: { workspaceId: string; storageKey: string }) => `${r.workspaceId}\u0000${r.storageKey}`;
  return {
    rows,
    async upsert(row) { rows.set(id(row), row); },
    async get(required) { return rows.get(id(required)) ?? null; },
    async list(_required, optional = {}) {
      const due = [...rows.values()].filter((r) => !optional.dueAt || !r.nextAttemptAt || r.nextAttemptAt <= optional.dueAt);
      return due.slice(0, optional.limit ?? due.length);
    },
    async remove(required) { rows.delete(id(required)); },
  };
}

export function createGate(): { wait: () => Promise<void>; open: () => void; reached: Promise<void> } {
  let open!: () => void; let reachedResolve!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  const reached = new Promise<void>((resolve) => { reachedResolve = resolve; });
  return { wait: () => { reachedResolve(); return opened; }, open, reached };
}

export function allClearProbes(overrides: Partial<BlobOwnershipProbes> = {}): BlobOwnershipProbes {
  return { hasLiveEntryRefs: async () => false, oldestRetainedRecoveryAgeMs: async () => null, pendingJobOwners: async () => [], ...overrides };
}

/** One shared database plus a factory for per-process GC instances over it. */
export function createSharedWorld(options: { now?: number } = {}) {
  let now = options.now ?? Date.parse("2026-01-01T00:00:00.000Z");
  const kernel = createSharedLockKernel();
  const blobRepo = new InMemoryAssetBlobRepo({});
  const mediaRepo = new InMemoryMediaRepo({});
  const renditionRepo = new InMemoryAssetRenditionRepo({});
  const journal = createMemoryJournal();
  const blobStore = new InMemoryBlobStore();
  const clock = { nowMs: () => now };
  const gc = (probes: BlobOwnershipProbes = allClearProbes(), optional: Parameters<typeof createBlobGc>[1] = {}) =>
    createBlobGc({ kernel, blobRepo, mediaRepo, renditionRepo, journal, blobStore, probes, clock }, optional);
  return { kernel, blobRepo, mediaRepo, renditionRepo, journal, blobStore, clock, gc, advance: (ms: number) => { now += ms; } };
}

/** A tombstoned blob row with its bytes on disk. */
export async function seedTombstone(world: ReturnType<typeof createSharedWorld>, purgeReason?: "owner-purge" | "trash-ttl") {
  await world.blobStore.put({ workspaceId: WS, sha256: SHA, bytes: new Uint8Array([1, 2, 3]) });
  await world.blobRepo.save({
    id: "blob-1", workspaceId: WS, sha256: SHA, storageKey: KEY, createdByPrincipal: "user:a",
    createdAt: new Date(world.clock.nowMs()).toISOString(), status: "tombstoned",
    tombstonedAt: new Date(world.clock.nowMs()).toISOString(), ...(purgeReason ? { purgeReason } : {}),
  });
}

/** Wraps `methods` on `target` in place so each call records which fence keys were held when it ran. */
export function recordHeldKeys<T extends object>(kernel: { heldKeys(): string[] }, target: T, methods: ReadonlyArray<keyof T & string>, log: Array<{ call: string; held: string[] }>): T {
  for (const name of methods) {
    const original = (target[name] as (...args: unknown[]) => unknown).bind(target);
    Object.assign(target, { [name]: (...args: unknown[]) => { log.push({ call: name, held: kernel.heldKeys() }); return original(...args); } });
  }
  return target;
}
