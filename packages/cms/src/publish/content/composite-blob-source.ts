import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { orFallback } from "@jini-ai/core/errors/idioms";

import type { FileBlobIndexPort } from "../transfer/file-blob-index.js";

/**
 * @file `publish-files-plan-2026-09-24.md` §3 — the composite {@link PeerBlobSource} a file-tree type
 * (`theme-files` today) needs on both legs a blob can travel by: the PUSH driver
 * (`pushBundleToPeer`, the host's peer transport) reads a source blob to upload it; the destination's own
 * `GET .../blobs/:sha` route (the host's blob-GET route) reads a source blob to SERVE it to
 * a pulling peer. Neither call site knows or cares whether a sha's bytes live in the media blob store
 * (a `post`/`page`/`media` entity's blobs) or only on disk inside a theme's own tree
 * (`FileBlobIndexPort`, filled by the host theme type's `pack()`) — this module is
 * what makes that distinction invisible to both of them, checking the blob store FIRST (the common,
 * cheaper case for every pre-existing type) and falling back to the file index only when the store
 * does not have it.
 *
 * ## Why bytes are re-hashed here rather than trusted from `pack()`
 *
 * `FileBlobIndexEntry` records only a path and a size — never the bytes, and never a "this file is
 * still exactly what it was when packed" guarantee. Time passes between a `pack()` call (an operator
 * opening the publish dialog) and a peer actually fetching a blob (after confirming a plan, possibly
 * minutes later); the file on disk could have been edited, replaced, or deleted in between by the
 * SAME author working on their theme in an editor. Re-hashing at read time, and refusing to serve
 * bytes that no longer match the sha they are addressed by, is what keeps this source honest to the
 * content-addressed contract every other blob in this feature already holds: the sha IS the identity,
 * so bytes that don't hash to it are not "the blob some caller asked for", they are stale or wrong
 * data that happens to still sit at the recorded path.
 *
 * ## Why the check lives in `exists()`, not only in `get()`
 *
 * Both call sites above gate a `get()` behind an `exists()` check first (this module's whole point is
 * to make that existing two-step shape work for a file-index-backed blob too, with no call-site
 * change). If `exists()` only checked "is there a `FileBlobIndexEntry`" without verifying the bytes,
 * a caller would see `exists() -> true` and then have `get()` throw for a file that changed underneath
 * it — turning an ordinary "the file moved on" case into an unhandled exception neither call site
 * catches today (`pushBundleToPeer`'s own blob loop has no `try/catch` around its `get()` call, and
 * nor does the host's blob-GET route). Doing the full read-and-hash inside `exists()` too means a changed or
 * missing file answers `false`, which both callers already treat as "unavailable" — see
 * `blobsUnavailable`/`404 BLOB_NOT_FOUND` at each site — with no call-site change required.
 * `get()` re-verifies independently anyway (this file's own header) rather than trusting a same-tick
 * `exists()` call, so a TOCTOU race between the two still fails CLOSED (a thrown error, never a
 * silent return of wrong bytes) instead of relying on caller discipline to always check first.
 */

/** The narrow blob-read seam the peer push driver and the blob-GET route consume — `BlobStorePort`'s
 *  read half, widened with `sha256` so this module can fall back to a {@link FileBlobIndexPort} lookup.
 *  Declared here (structurally) because the host's peer transport owns the driver; its own
 *  `PeerBlobSource` has this exact shape, so the two are mutually assignable. */
export interface PeerBlobSource {
  exists(input: { sha256: string; storageKey: string }, optional?: {}): Promise<boolean>;
  get(input: { sha256: string; storageKey: string }, optional?: {}): Promise<Uint8Array>;
}

/** Thrown by {@link createCompositePeerBlobSource}'s `get()` only in the TOCTOU window between an
 *  `exists()` check and this call — every call site gates on `exists()` first, so this is a rare
 *  defensive backstop, never the documented "unavailable" path (that is `exists()` returning `false`,
 *  which every caller already treats as ordinary). Not caught anywhere by design: a genuine race this
 *  narrow is exceptional enough that surfacing it as a hard failure is more honest than silently
 *  reporting the blob as merely absent. */
export class FileBlobUnavailableError extends Error {
  constructor({ sha256, reason }: { sha256: string; reason: string }) {
    super(`file blob '${sha256}' is unavailable: ${reason}`);
    this.name = "FileBlobUnavailableError";
  }
}

/** The narrow `BlobStorePort` read seam this module needs — never the write half, so a composite
 *  source can never be mistaken for something that writes to the media blob store. */
export interface CompositeBlobStoreRead {
  exists(input: { storageKey: string }, optional?: {}): Promise<boolean>;
  get(input: { storageKey: string }, optional?: {}): Promise<Uint8Array>;
}

/** @complexity O(bytes) — one file read plus one sha256 digest. */
async function readAndVerify({ entry, sha256 }: { entry: { absPath: string; size: number }; sha256: string }, _optional = {}): Promise<Uint8Array | null> {
  const bytes = await orFallback({ work: () => readFile(entry.absPath), fallback: null, step: "Read indexed publish blob" });
  if (bytes === null) return null; // moved, deleted, or otherwise unreadable since it was packed.
  const actual = createHash("sha256").update(bytes).digest("hex");
  return actual === sha256 ? bytes : null;
}

/**
 * Builds the blob source both blob-serving call sites share — see this file's header for the full
 * reasoning. `blobStore` is checked first on every call, so every pre-existing type (`post`/`page`/
 * `media`) is unaffected: its blobs are never in `fileBlobIndex`, so the fallback is never reached for
 * them.
 *
 * @complexity Each method is O(1) plus, on the fallback path only, one file read and one hash
 *   (`readAndVerify`'s own bound).
 */
export function createCompositePeerBlobSource(deps: {
  readonly blobStore: CompositeBlobStoreRead;
  readonly fileBlobIndex: FileBlobIndexPort;
}, _optional = {}): PeerBlobSource {
  return {
    async exists({ sha256, storageKey }) {
      if (await deps.blobStore.exists({ storageKey })) return true;
      const entry = deps.fileBlobIndex.get({ sha256 });
      if (!entry) return false;
      return (await readAndVerify({ entry, sha256 })) !== null;
    },
    async get({ sha256, storageKey }) {
      if (await deps.blobStore.exists({ storageKey })) return deps.blobStore.get({ storageKey });
      const entry = deps.fileBlobIndex.get({ sha256 });
      if (!entry) {
        throw new FileBlobUnavailableError({ sha256, reason: "not present in the blob store or the file index" });
      }
      const verified = await readAndVerify({ entry, sha256 });
      if (!verified) {
        throw new FileBlobUnavailableError({ sha256, reason: "the file at its indexed path no longer hashes to the requested sha256" });
      }
      return verified;
    },
  };
}
