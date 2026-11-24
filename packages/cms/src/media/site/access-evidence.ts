type AccessEvidencePost = { readonly memberAccessJson?: string | null };

/** Access settings only: never entry bodies or a visitor's entitlement decision. */
export interface AssetReferenceScan {
  readonly referencing: Array<AccessEvidencePost>;
  readonly opaqueGated: Array<AccessEvidencePost>;
}

/** Derived reverse index: access metadata only, no retained post bodies or visitor decisions. */
export interface AssetReferenceIndex {
  readonly byAsset: Map<string, Set<AccessEvidencePost>>;
  readonly opaqueGated: Set<AccessEvidencePost>;
}

type ScanCache = Map<string, { expiresAt: number; value: Promise<AssetReferenceIndex> }>;
const postCaches = new WeakMap<object, ScanCache>();
const widgetCaches = new WeakMap<object, Set<ScanCache>>();

/** Shares the existing bounded cache with both repository write owners.
 * @complexity O(1); stores one link per post/widget repository pair. */
export function getMediaAccessEvidenceCache({ postRepo, entryRepo }: { postRepo: object; entryRepo?: object }, _optional = {}): ScanCache {
  let cache = postCaches.get(postRepo);
  if (!cache) { cache = new Map(); postCaches.set(postRepo, cache); }
  if (entryRepo) {
    let linked = widgetCaches.get(entryRepo);
    if (!linked) { linked = new Set(); widgetCaches.set(entryRepo, linked); }
    linked.add(cache);
  }
  return cache;
}

/** A content write drops derived access settings before the next conditional request.
 * Clearing also detaches pending scans: their completion never re-inserts old evidence.
 * @complexity O(c) for the owner's caches, each holding its site's workspace index; no storage I/O. */
export function invalidateMediaAccessEvidence({ owner }: { owner: object }, _optional = {}): void {
  postCaches.get(owner)?.clear();
  for (const cache of widgetCaches.get(owner) ?? []) cache.clear();
}
