import type { UUID } from "@jini-ai/core/primitives";

/**
 * @file The blob content-type store — what lets the admin Media screen's "Images"/"Videos" tabs
 * filter by asset type.
 *
 * Why this is a host-owned port rather than a field on an existing one: `uploadMedia` and the
 * `AssetBlobRepoPort`/`MediaRepoPort` contracts live in `@jini-ai/cms` (a separate package and
 * repo). `uploadMedia` validates the client's declared `contentType` string against an advisory
 * allowlist and then DISCARDS it, and neither `AssetBlobRecord` nor `MediaRecord` has a field to
 * carry one. Threading a type through those frozen records would be an upstream change; this
 * narrow side port keeps the whole fix inside this host, and — because it is its own port — it
 * gets both a real adapter and an in-memory double, so it works against the host's SQLite
 * composition root AND the host's hermetic in-memory one.
 *
 * Keyed by `(workspaceId, sha256)`, not by media id, because the content type is a property of the
 * BYTES. That is also why blob dedup makes this free: two library entries that share one blob
 * share one recorded type.
 *
 * The stored value is always `sniffContentType(bytes)` — the real magic-byte answer — never the
 * client's upload-time string. The host's admin media original-bytes route's file header already establishes
 * that invariant for the byte-serving route ("`Content-Type` is NEVER the client's upload-time
 * string"); recording the declared string here instead would let an operator's "Images" tab
 * disagree with the `Content-Type` their browser is actually served, which is the same
 * attacker-controlled-string trust this system deliberately refuses everywhere else.
 *
 * A recorded value is therefore never absent-because-unknown: an unrecognized blob records the
 * sniffer's own `"application/octet-stream"`, a real answer. A MISSING entry means only "not
 * sniffed yet" — a blob written before this store existed. Because the value is a pure function of
 * bytes this system already stores, a missing entry is always recoverable by re-sniffing rather
 * than lost, which is what makes the read-path backfill in the host's admin media list route exact
 * rather than a guess.
 */
export interface MediaContentTypeStorePort {
  /**
   * The recorded content type for each of `sha256s` that has one. Sha256s with no recorded type
   * are simply ABSENT from the returned map — never present with a `null`/empty value — so a
   * caller can tell "not sniffed yet" from a recorded `application/octet-stream`.
   *
   * Batch-shaped rather than a per-row `get` specifically so the list route does not issue one
   * query per media card.
   */
  getMany(required: { workspaceId: UUID; sha256s: readonly string[] }): Promise<Map<string, string>>;

  /** Records (or overwrites) one blob's sniffed content type. Idempotent — re-recording the same
   *  bytes' type is a no-op in effect, which is what makes the list route's backfill safe to run
   *  concurrently with an upload of the same blob. */
  set(required: { workspaceId: UUID; sha256: string; contentType: string }): Promise<void>;
}

/**
 * `MediaContentTypeStorePort`'s in-memory adapter — the ADR-006 rule-of-two test double, backing
 * the host's hermetic composition root (same role
 * `media/provider-credential-store.memory.ts` plays for the provider credential port).
 *
 * Keyed by `${workspaceId} ${sha256}`: a flat composite-string map rather than a nested one, for
 * the reason that sibling documents — every method is already workspace-scoped, and neither
 * component can contain a space, so no id pair can collide.
 */
export class InMemoryMediaContentTypeStore implements MediaContentTypeStorePort {
  private readonly rows = new Map<string, string>();

  private static keyOf({ workspaceId, sha256 }: { workspaceId: UUID; sha256: string }, _optional: Record<string, never> = {}): string {
    return `${workspaceId} ${sha256}`;
  }

  async getMany(required: { workspaceId: UUID; sha256s: readonly string[] }): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const sha256 of required.sha256s) {
      const contentType = this.rows.get(InMemoryMediaContentTypeStore.keyOf({ workspaceId: required.workspaceId, sha256 }));
      // Absent stays absent — see the port's `getMany` doc for why a miss must not become a null.
      if (contentType !== undefined) found.set(sha256, contentType);
    }
    return found;
  }

  async set(required: { workspaceId: UUID; sha256: string; contentType: string }): Promise<void> {
    this.rows.set(InMemoryMediaContentTypeStore.keyOf({ workspaceId: required.workspaceId, sha256: required.sha256 }), required.contentType);
  }
}
