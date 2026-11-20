/**
 * @file `publish-files-plan-2026-09-24.md` §3 — the process-wide address book a file-tree `pack()`
 * (today only `features/theme/publish-content.ts`'s theme walker) fills as it hashes files on disk,
 * so a PUSH or a PULL can later hand those exact bytes to a peer WITHOUT copying them into the media
 * blob store first. `composite-blob-source.ts` is the one reader; this module owns only the mapping
 * and its bound.
 *
 * ## Why an LRU, not an unbounded map
 *
 * The index is filled by every `pack()` call this process makes for the lifetime of the process
 * (never cleared between requests — {@link CreatePublishContentApplyPort}'s siblings all follow this
 * "one shared, process-lifetime instance" convention already, see `routes/types.ts`'s
 * `publishContentBundleRepo` doc for the identical reasoning applied to a different singleton). A
 * site with many themes, repeatedly re-packed across many admin sessions, would otherwise grow this
 * map without bound. Capping it at {@link FILE_BLOB_INDEX_MAX_ENTRIES} and evicting the
 * least-recently-touched entry keeps memory bounded while keeping the entries a caller is actually
 * about to use (the ones from the MOST RECENT `pack()`) resident.
 *
 * ## Why "recently touched" includes reads, not just inserts
 *
 * A `pack()` that runs again soon after (an operator re-opening the publish dialog) re-inserts the
 * same shas and bumps them for free. What an LRU protects against is a *read* pattern: a peer pulling
 * many blobs in one push touches the same recently-packed entries repeatedly, and those reads should
 * count as "still useful" exactly as much as the insert that created them did — otherwise a export
 * with more distinct blobs than the cap could evict an entry between two reads of it within the same
 * push. {@link FileBlobIndexPort.get} therefore bumps recency on every hit.
 */

/** One packed file's location on this machine and its size — never its bytes; a caller re-reads and
 *  re-hashes them at the moment it actually needs them (the host's composite blob source's own
 *  doc explains why a cached read would be unsafe here). */
export interface FileBlobIndexEntry {
  readonly absPath: string;
  readonly size: number;
}

/** The read/write seam `pack()` (write) and the composite blob source (read) share. A plain
 *  interface, not a class, so a test can substitute a trivial fake without constructing a real LRU. */
export interface FileBlobIndexPort {
  /** Records (or replaces) where `sha256`'s bytes live right now. Bumps recency like a fresh insert
   *  always would, even when `sha256` was already present — a re-pack of an unmoved file is still
   *  "just touched". */
  set(required: { sha256: string; entry: FileBlobIndexEntry }, optional?: Record<string, never>): void;
  /** The entry for `sha256`, or `undefined` when it was never recorded or has since been evicted.
   *  Bumps recency on a hit (this file's own header, "why reads count too"). */
  get(required: { sha256: string }, optional?: Record<string, never>): FileBlobIndexEntry | undefined;
  /** Current entry count — exposed for tests and diagnostics, never used to drive eviction from
   *  outside this module (eviction is this module's own invariant to hold, not a caller's). */
  readonly size: number;
}

/** §3's own cap: "LRU of 20k entries". Exported so a caller (or a test that wants to pin eviction
 *  behavior without allocating 20,000 real entries) can reference the exact number rather than
 *  re-deriving it. */
export const FILE_BLOB_INDEX_MAX_ENTRIES = 20_000;

/**
 * Builds a fresh, empty {@link FileBlobIndexPort} — one call per composition root, held as a
 * process-lifetime singleton and threaded through `RouteDeps.fileBlobIndex` (this file's own header).
 *
 * Backed by a `Map`: insertion order in a JS `Map` already IS recency order for this module's
 * purposes, because every {@link FileBlobIndexPort.get}/`.set` on an existing key re-inserts that key
 * (delete-then-set), which moves it to the end of the map's own iteration order. The least-recently-
 * touched entry is therefore always the map's own first key — no separate doubly-linked-list
 * bookkeeping is needed for an LRU this simple.
 *
 * @param optional.maxEntries - Test seam / operator override for {@link FILE_BLOB_INDEX_MAX_ENTRIES}. Must be
 *   at least 1; a non-positive cap would make every `set()` immediately evict what it just inserted,
 *   which is never a caller's real intent, so it is refused rather than silently producing an
 *   always-empty index.
 * @throws {RangeError} when `maxEntries` is not a positive integer.
 * @complexity Every operation is O(1) amortized (a `Map` delete+set / get / delete), matching a real
 *   LRU's own bound.
 */
export function createFileBlobIndex({ maxEntries = FILE_BLOB_INDEX_MAX_ENTRIES }: { maxEntries?: number } = {}): FileBlobIndexPort {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError(`createFileBlobIndex: maxEntries must be a positive integer, got ${maxEntries}`);
  }

  const entries = new Map<string, FileBlobIndexEntry>();

  function touch({ sha256, entry }: { sha256: string; entry: FileBlobIndexEntry }, _optional = {}): void {
    // Re-inserting an existing key does not itself move a `Map` key's iteration position — only a
    // fresh `set` on a key that is not already present appends. Deleting first is what makes a
    // re-touch of an existing key move it to the end, exactly like a real insert would.
    entries.delete(sha256);
    entries.set(sha256, entry);
  }

  return {
    set({ sha256, entry }) {
      touch({ sha256, entry });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    get({ sha256 }) {
      const found = entries.get(sha256);
      if (found === undefined) return undefined;
      touch({ sha256, entry: found });
      return found;
    },
    get size() {
      return entries.size;
    },
  };
}
