import { readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative, sep } from "node:path";

import type { BlobStorePort } from "../index.js";
import type { BlobGc } from "../blob-gc-fence.js";
import { computeBlobStorageKey } from "../blob-key.js";

/**
 * @file `hydrateBlobStoreFromSeed()` — fills in stock blob BYTES for `asset_blobs` rows a fresh
 * site inherited from `content.seed.db` (see `hydrate-content-db-from-seed.ts`'s header for that
 * half of the pair).
 *
 * -----------------------------------------------------------------------------------------------
 * The gap this closes
 * -----------------------------------------------------------------------------------------------
 * `npm run seed:site` prunes and ships `content.seed.db` — including `media`/`asset_blobs` rows,
 * neither of which is in `seed-site.mjs`'s `PRUNE_TABLES` list. `hydrateContentDbFromSeed()` then
 * copies those rows into a fresh deploy's `content.db` on first boot. Nothing analogous ever
 * shipped the BYTES those rows' `storage_key`s point at: the Dockerfile's build stage previously
 * extracted only `content.seed.db` before `RUN rm -rf sites` wiped the whole `sites/` tree (which
 * is where `uploads/` — and therefore every blob's bytes — actually lives). Confirmed live on
 * the hosted production site's `/admin/media`: real `media`/`asset_blobs` rows, zero corresponding files, every
 * preview 500s and falls back to the placeholder icon. This function is the missing other half —
 * same "read-only stock source shipped in the image, copied into the site's own mutable copy"
 * shape `seedSiteThemes()` and `hydrateContentDbFromSeed()` already use for `themes/` and
 * `content.db`. The Dockerfile's own build stage now stages the matching `uploads/` payload
 * alongside `content.seed.db` (see that file's comment at the extraction loop) — this function is
 * the boot-time consumer of that payload.
 *
 * -----------------------------------------------------------------------------------------------
 * Why this does NOT reuse either sibling's "whole-thing presence" gate
 * -----------------------------------------------------------------------------------------------
 * `hydrateContentDbFromSeed()` gates on one file's existence; `seedSiteThemes()` gates on one
 * directory's existence — both correct for a THING that is copied once, as a single unit, and never
 * partially seeded again. `uploads/` is not that shape: it is a content-addressed, ever-growing SET
 * of independent files that real usage adds to throughout a site's life, and — the reason this
 * function exists at all — it may already hold real files (from a boot before this function
 * existed, or from ordinary use) by the time this code ships. A whole-directory presence gate would
 * make the fix's own effect depend on incidental state this code has no way to inspect (does
 * `uploads/` already exist for some unrelated reason?) and could silently leave THIS EXACT bug
 * unfixed on the very deploy meant to fix it. So the gate here applies the same underlying rule —
 * never touch something that might already be real, only fill in what is provably absent — at the
 * store's actual unit of identity: one content-addressed key at a time, via `BlobStorePort
 * .putIfAbsent()`. An existing key, however it got there, is left exactly as it is; only a key
 * genuinely missing from the live store gets written. This also means the function is safe to run
 * on EVERY boot, not just a first one: every call after the first is an all-`skipped` no-op once
 * the store catches up.
 *
 * This used to be a separate `exists()` check followed by a separate `put()` — a check-then-act
 * pair with a real TOCTOU gap: a real uploader's write landing in that gap got silently overwritten
 * by this function's stock seed bytes. `putIfAbsent()` collapses the two into one call the adapter
 * itself makes atomic (the local store's `"wx"` open flag; the s3-compatible object-store provider's
 * conditional `If-None-Match` PUT — see each provider's own doc), closing the gap outright rather than narrowing
 * it. Safe to do unconditionally specifically because this store is content-addressed: whichever
 * writer's bytes end up stored for a given key, they are — short of a sha256 collision — the same
 * bytes any other writer for that key would have written; `putIfAbsent` only needs to guarantee no
 * concurrent writer's write gets torn or clobbered, not that this function's copy "wins".
 *
 * -----------------------------------------------------------------------------------------------
 * Why this goes through `BlobStorePort`, not a filesystem copy
 * -----------------------------------------------------------------------------------------------
 * The SOURCE (the seed payload the image ships) is always a plain directory — that's how the
 * Dockerfile stages it, mirroring `content.seed.db`'s own extraction. The DESTINATION is whatever
 * `createMediaBlobStore()` (`features/object-storage`) resolved for this deployment: the local
 * filesystem store by default, or the bundled s3-compatible object-store provider for any operator
 * who sets the host's media blob-store env var to `s3` (or picks a remote provider in the site's storage setting). Writing straight to a filesystem path would
 * silently stop working — with no error, just permanently-missing bytes on the very backend this
 * fix exists to protect against — the moment an operator makes that switch. Going through
 * `blobStore.putIfAbsent()` instead means this function needs no change at all if the backend
 * changes: same one call, whichever `BlobStorePort` implementation `deps.ts` handed it.
 *
 * Architectural role:
 * Fire-and-forget async boot effect (unlike its two sync siblings above — `BlobStorePort` itself is
 * async), wired the same way `media/bootstrap.ts`'s `ensureCoreMediaTransform` chain is in
 * `deps.ts`: does not gate any request, and its caller logs-and-swallows failure so one bad seed
 * file can never fail boot. Pure filesystem-read + port-write effect, no domain logic of its own.
 */

/**
 * `seedUploadsDir`'s expected shape for one blob file, relative to that root:
 * `ws/{workspaceId}/blobs/{sha256[0..1]}/{sha256}` — `computeBlobStorageKey`'s own template
 * (`blob-key.ts`). Anything else found under the seed payload is not this function's to interpret.
 */
const SEED_BLOB_PATH_PATTERN = /^ws\/([^/]+)\/blobs\/[0-9a-f]{2}\/([0-9a-f]{64})$/;

/** One seed file this run could not resolve into a live blob, and why. */
export interface HydrateBlobStoreFromSeedFailure {
  readonly relativePath: string;
  readonly error: string;
}

/**
 * `"seeded"` — at least one previously-missing blob was written, none failed.
 * `"already-present"` — every seed blob already existed in the live store; nothing written.
 * `"no-seed-source"` — `seedUploadsDir` does not exist (a site with no shipped upload payload).
 * `"partial"` — at least one seed file could not be resolved or written; see `failed`.
 */
export type HydrateBlobStoreFromSeedStatus = "seeded" | "already-present" | "no-seed-source" | "partial";

export interface HydrateBlobStoreFromSeedResult {
  readonly status: HydrateBlobStoreFromSeedStatus;
  /** Number of blobs actually written to the live store this run. */
  readonly copied: number;
  /** Number of seed blobs that already existed in the live store and were left untouched. */
  readonly skipped: number;
  readonly failed: readonly HydrateBlobStoreFromSeedFailure[];
}

export interface HydrateBlobStoreFromSeedRequired {
  /** The read-only stock upload payload shipped with the image (sibling of `content.seed.db`). */
  readonly seedUploadsDir: string;
  /** The site's real, running blob store — only `putIfAbsent` is needed. */
  readonly blobStore: Pick<BlobStorePort, "putIfAbsent">;
  /** The cross-process blob fence (`createBlobGc(...)`): each seed write runs under its key, so an
   *  unlinker in another process cannot interleave with a hydration of the same bytes. */
  readonly blobFence: Pick<BlobGc, "claimWrite">;
}

/**
 * Recursively lists every FILE under `dir`, as paths relative to `root` with `/`-separated
 * segments regardless of platform — matching the `/`-joined shape `computeBlobStorageKey` and
 * `storage_key` column values already use.
 *
 * @returns `[]` when `root` itself does not exist (a site with no shipped upload payload) — not an
 *   error, mirrors `hydrateContentDbFromSeed`'s `no-seed-source` treatment of an absent stock file.
 * @complexity O(n) in the number of files and directories under `root`.
 */
async function listSeedBlobRelativePaths({ root }: { root: string }, { dir = root }: { dir?: string } = {}): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const results: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listSeedBlobRelativePaths({ root }, { dir: full })));
      continue;
    }
    if (entry.isFile()) {
      results.push(relative(root, full).split(sep).join("/"));
    }
  }
  return results;
}

/** One seed file's resolution — extracted so {@link hydrateBlobStoreFromSeed}'s own loop is pure
 *  tallying, never a decision. See that function's own doc, and this file's header, for the per-key
 *  `putIfAbsent` gate this implements. */
type SeedBlobOutcome =
  | { readonly kind: "copied" }
  | { readonly kind: "skipped" }
  | { readonly kind: "failed"; readonly failure: HydrateBlobStoreFromSeedFailure };

/**
 * Resolves ONE seed file: shape-check its path, then read + `putIfAbsent` its bytes.
 * @throws Never — every failure mode (bad path shape, unreadable file, store write failure) is
 *   reported as a `"failed"` outcome instead, matching {@link hydrateBlobStoreFromSeed}'s own
 *   "never fail the whole run over one bad seed file" contract.
 */
async function resolveOneSeedBlob(
  { seedUploadsDir, blobStore, blobFence, relativePath }: { seedUploadsDir: string; blobStore: Pick<BlobStorePort, "putIfAbsent">; blobFence: Pick<BlobGc, "claimWrite">; relativePath: string },
  _optional: Record<string, never> = {}
): Promise<SeedBlobOutcome> {
  const match = SEED_BLOB_PATH_PATTERN.exec(relativePath);
  const [, workspaceId, sha256] = match ?? [];
  if (workspaceId === undefined || sha256 === undefined) {
    return {
      kind: "failed",
      failure: {
        relativePath,
        error: "does not match the expected ws/{workspaceId}/blobs/{shard}/{sha256} shape",
      },
    };
  }

  try {
    const bytes = await readFile(join(seedUploadsDir, relativePath));
    // Single atomic call — see this file's header for why a separate `exists()` check first
    // would reopen the exact TOCTOU gap this function used to have.
    const storageKey = computeBlobStorageKey({ workspaceId, sha256 });
    const { written } = await blobFence.claimWrite({ workspaceId, sha256, storageKey, kind: "hydrate", work: () => blobStore.putIfAbsent({ workspaceId, sha256, bytes }) });
    return written ? { kind: "copied" } : { kind: "skipped" };
  } catch (err) {
    return { kind: "failed", failure: { relativePath, error: err instanceof Error ? err.message : String(err) } };
  }
}

/** Derives the run-level status from the tallies — see {@link HydrateBlobStoreFromSeedStatus}'s own doc. */
function computeHydrateStatus({ copied, failedCount }: { copied: number; failedCount: number }, _optional: Record<string, never> = {}): HydrateBlobStoreFromSeedStatus {
  if (failedCount > 0) return "partial";
  return copied > 0 ? "seeded" : "already-present";
}

/**
 * Tops up the live blob store with any stock seed blob it is missing, one content-addressed key at
 * a time. See this file's header for why the gate is per-key rather than per-directory, and why the
 * write goes through `BlobStorePort` rather than a filesystem copy.
 *
 * @param required.seedUploadsDir - Read-only stock payload shipped with the image.
 * @param required.blobStore - The real, running blob store to fill in.
 * @returns Per-run outcome — see {@link HydrateBlobStoreFromSeedStatus}.
 * @throws Never for a missing/malformed individual seed file (recorded in `failed` instead, so one
 *   bad file cannot block the rest); only for an error `listSeedBlobRelativePaths` itself does not
 *   treat as "no seed source" (e.g. a permissions failure reading the seed payload's own tree).
 * @complexity O(n) blob-store round trips (one `putIfAbsent` per file) in the number of files under
 *   `seedUploadsDir` — bounded by how many blobs this site's seed ships, not by anything
 *   request-variable.
 */
export async function hydrateBlobStoreFromSeed(
  required: HydrateBlobStoreFromSeedRequired
): Promise<HydrateBlobStoreFromSeedResult> {
  const { seedUploadsDir, blobStore, blobFence } = required;

  const relativePaths = await listSeedBlobRelativePaths({ root: seedUploadsDir });
  if (relativePaths.length === 0) {
    return { status: "no-seed-source", copied: 0, skipped: 0, failed: [] };
  }

  let copied = 0;
  let skipped = 0;
  const failed: HydrateBlobStoreFromSeedFailure[] = [];

  for (const relativePath of relativePaths) {
    const outcome = await resolveOneSeedBlob({ seedUploadsDir, blobStore, blobFence, relativePath });
    if (outcome.kind === "copied") copied++;
    else if (outcome.kind === "skipped") skipped++;
    else failed.push(outcome.failure);
  }

  return { status: computeHydrateStatus({ copied, failedCount: failed.length }), copied, skipped, failed };
}
