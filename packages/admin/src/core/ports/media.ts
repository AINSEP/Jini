/**
 * @file `AdminMediaPort` — uploaded binary assets (images, video, documents) and their metadata.
 *
 * ## Media has a genuine hard delete; identity and members do not
 *
 * `AdminIdentityPort` deliberately has no `deleteUser` (disable is the audited primitive — see
 * that file's header), and `AdminMembersPort` has no delete at all. Media is different: the
 * reference implementation's media route group implements a real two-rung deletion ladder (`trashMedia` soft-deletes,
 * `deleteMedia` hard-purges the row and the underlying blob) because the audit-trail argument for
 * principals does not apply to binary assets the same way, and unbounded blob storage is a real
 * operational cost a purely-soft-delete model would leave unaddressed. `deleteMedia` is gated by a
 * narrower permission than `trashMedia` in the reference implementation (a `.force`-suffixed
 * permission), and the backend rejects a purge attempt on an asset that has not been trashed first
 * — a host should surface that rejection rather than let a caller purge directly. Once
 * `deleteMedia` succeeds it is genuinely irreversible; do not render it with "undo" affordances.
 *
 * ## `mediaOriginalUrl` is synchronous and returns a URL, not a `Promise`
 *
 * Every other method here fetches JSON. This one does not — it hands back the byte-serving URL for
 * an asset's original file, meant to be assigned directly to an `<img src>`/`<video src>` (or
 * similar) so the browser issues its own authenticated, same-origin request. Wrapping it in a
 * `Promise<string>` would force every caller through an `await` for a value that is really just
 * string formatting. A host serves the asset's `Content-Type` sniffed from file content server
 * side, not trusted from upload metadata — expect non-renderable content types (e.g. a sniffed
 * HTML/SVG) to come back as a non-rendering attachment rather than inline-rendered.
 */

/** A previously-uploaded binary asset and its editable metadata. */
export interface AdminMedia {
  readonly id: string;
  readonly title: string;
  readonly alt: string;
  readonly caption: string;
  readonly credit: string;
  /** Content hash of the stored blob — a host may use this for de-duplication or integrity checks;
   *  not meant to be operator-facing. */
  readonly sha256: string;
  readonly status: "active" | "trashed";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface AdminMediaPort {
  listMedia(): Promise<readonly AdminMedia[]>;
  /** Synchronous URL builder, not a request — see the file header. */
  mediaOriginalUrl(id: string): string;
  uploadMedia(
    input: { filename: string; contentType: string; dataBase64: string },
    options?: { alt?: string; caption?: string; credit?: string },
  ): Promise<AdminMedia>;
  updateMedia(
    id: string,
    patch: { title?: string; alt?: string; caption?: string; credit?: string },
  ): Promise<AdminMedia>;
  /** Soft delete — reversible via `deleteMedia`'s counterpart trash state. Safe to offer as an
   *  undoable action in a panel. */
  trashMedia(id: string): Promise<AdminMedia>;
  /**
   * Hard purge. Irreversible — see the file header. Expect a conflict-class rejection (with a
   * referencing-entities list on the error body, per `../transport/errors.ts`'s "`body` is kept
   * raw" decision) when the asset is still trashed-but-referenced elsewhere, and a not-found-class
   * rejection when it has not been trashed first.
   */
  deleteMedia(id: string): Promise<{ purged: boolean }>;
}
