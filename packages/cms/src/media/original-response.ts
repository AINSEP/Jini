import { parseRangeHeader } from "@jini-ai/http-kit/range";
import { documentContentType, documentDisplayFilename, MAX_DOCUMENT_BYTES } from "./document-ingress.js";
import { sniffContentType } from "./content-type-sniffer.js";
import { findMediaByIdOrSlug } from "./media-service.js";
import { sanitizeSvg } from "./sanitize-svg.js";
import type { AssetBlobRepoPort, BlobStorePort, MediaRecord, MediaRepoPort } from "./index.js";

/**
 * @file Framework-neutral decisions for serving a media asset's ORIGINAL bytes (the admin preview
 * `<img>`/`<video>` route, the public `/m/:id/original` route and the chat-attachment read route all
 * share them). Every function here returns plain data — `{ status, headers, body }` — and the host
 * writes it with its own HTTP framework; nothing here knows about a request or response object.
 *
 * SECURITY — these decisions serve attacker-influenced bytes. `uploadMedia`
 * validates its MIME allowlist and sanitizes SVG before storage. Legacy blobs may predate that
 * protection, and response types must describe the actual bytes rather than stored metadata. So:
 *  - `Content-Type` is NEVER the client's upload-time string — it is always
 *    `sniffContentType(bytes)`, computed fresh from the bytes this exact
 *    response is about to send (`content-type-sniffer.ts`).
 *  - SVG is sanitized before inline serving, including blobs that predate safe ingest.
 *  - A sniffed `text/html`/`application/xhtml+xml` (same-origin stored-XSS vectors
 *    if ever rendered inline) is
 *    forced to `application/octet-stream` + `Content-Disposition: attachment`
 *    rather than served as-is — see `DISALLOWED_INLINE_CONTENT_TYPES` below.
 *  - `X-Content-Type-Options: nosniff` is always set, so a browser trusts the
 *    Content-Type the response declares instead of re-sniffing the raw bytes
 *    itself (without this header, the HTML download defusal above is moot — a
 *    sniffing browser could still render forced-`octet-stream` bytes as HTML).
 *  - A restrictive `Content-Security-Policy` and `Cross-Origin-Resource-Policy`
 *    ride along as further defense in depth in case the response is ever
 *    reached by a path other than an `<img>`/`<video>` tag (e.g. direct
 *    navigation to the URL in a new tab).
 *  - `storageKey` is never taken from the request — it only ever comes from
 *    this workspace's own `assetBlobRepo` row, looked up by the media's own
 *    `source.sha256`, so there is no path from request input to the
 *    blob store's file-path resolution at all (no traversal surface to guard
 *    beyond "never wire a request field into `storageKey`").
 *  - Trashed assets are `trashed` (the host answers 410), mirroring `resolveMediaRendition`'s disclosed
 *    trashed-stands-in-for-purged mapping rather than inventing a new gone/not-found split.
 *
 * RANGE SUPPORT: `Range: bytes=...` is honored via `parseRangeHeader`
 * (`@jini-ai/http-kit/range`) so a `<video>` tag can seek instead of buffering the whole
 * file — see that module's doc comment for the exact malformed/multi-range/
 * out-of-bounds handling this defers to.
 */

/**
 * Keep inline logo styles and data images; sanitization strips references other than document-local
 * fragments and data URLs, so same-origin image loads are unnecessary. Retain the sandbox as
 * defense in depth when an SVG is opened as a top-level document.
 */
export const SVG_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";

/** Sniffed types that must never be served as their literal `Content-Type` — HTML (and
 * XHTML, which this route blocks even though `sniffContentType` currently folds it into
 * `"text/html"` — see that module's doc comment) are same-origin stored-XSS vectors if a browser
 * ever renders them inline. Kept as an explicit route-level check (rather than only trusting the
 * sniffer's own allowlist shape) so this invariant holds even if `content-type-sniffer.ts` is
 * later extended to recognize more textual formats.
 *
 * Exported (2026-08-24) — the public video-original route reuses
 * this same check rather than re-declaring it, so the routes' XSS defusal can't drift apart. */
export const DISALLOWED_INLINE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
]);

/** What a host writes: status, ordered header pairs, and the body (`null` when the reply has none). */
export interface MediaOriginalReply {
  readonly status: number;
  readonly headers: ReadonlyArray<readonly [name: string, value: string]>;
  readonly body: Uint8Array | null;
}

/** The `Content-Type` and optional `Content-Disposition` a reply declares for its bytes. */
export interface MediaOriginalType {
  readonly safe: string;
  readonly disposition: string | null;
}

/** The asset's source blob row, as the blob repo port returns it. */
export type MediaOriginalBlob = NonNullable<Awaited<ReturnType<AssetBlobRepoPort["findByHash"]>>>;

/** Outcome of {@link lookupMediaOriginalBlob}; the host maps `not-found` and `trashed` to its own responses. */
export type MediaOriginalLookup =
  | { readonly outcome: "ok"; readonly media: MediaRecord; readonly blob: MediaOriginalBlob }
  | { readonly outcome: "not-found" }
  | { readonly outcome: "trashed" };

/**
 * Looks up the media row and its source blob.
 *
 * `params.mediaId` (2026-09-07: resolved via `findMediaByIdOrSlug`, not a bare `findById`) may be
 * either the asset's real `id` or its `slug` — this route's `:mediaId` segment is exactly the kind
 * of hand-typeable reference the slug feature exists for. Safe to do here without the FK hazard
 * `resolveMediaRendition`'s own doc calls out for `asset_renditions`: this function's only downstream
 * key is `media.source.sha256` (blob content-addressing), never the raw `params.mediaId` itself.
 *
 * The caller decides what `not-found` looks like (readable-slugs plan S2b, 2026-09-23): an authenticated admin
 * caller keeps its historical `404 {error: "media '<x>' was not found"}` — an authenticated caller learning an
 * id doesn't exist is not a security concern. The public video route, however, must make an unknown asset
 * indistinguishable from a gate-denied one, or the difference is a free existence oracle for a caller who only
 * knows a slug is guessable. Returning an outcome keeps that policy at each host's own call site.
 *
 * @throws {Error} the same data-integrity-gap error the pre-extraction route threw, if the media row
 * exists but its source blob does not (see the inline comment at the throw site).
 * @complexity O(1) — at most two indexed lookups for the media row (slug, then id), plus one blob lookup.
 */
export async function lookupMediaOriginalBlob({ deps, params }: { deps: { mediaRepo: MediaRepoPort; assetBlobRepo: AssetBlobRepoPort }; params: { workspaceId: string; mediaId: string } }, _optional = {}): Promise<MediaOriginalLookup> {
  const media = await findMediaByIdOrSlug({ deps: { mediaRepo: deps.mediaRepo }, input: { workspaceId: params.workspaceId, idOrSlug: params.mediaId } });
  if (!media) return { outcome: "not-found" };
  if (media.status === "trashed") return { outcome: "trashed" };

  const blob = await deps.assetBlobRepo.findByHash({ workspaceId: params.workspaceId, sha256: media.source.sha256 });
  if (!blob) {
    // Data-integrity gap, not a routine 404 — `uploadMedia`'s invariant (bytes written before
    // the media row) means this should be unreachable. Mirrors `resolveMediaRendition`'s
    // identical branch in `rendition-service.ts`: thrown, not silently treated as not-found.
    throw new Error(`media '${media.id}': source blob for sha256 '${media.source.sha256}' was not found`);
  }
  return { outcome: "ok", media, blob };
}

/**
 * Chooses the declared type for bytes sniffed from their own content: a sniffed HTML/XHTML is forced to an
 * `octet-stream` download, anything else is served as sniffed.
 * @complexity O(1).
 */
export function inlineOriginalType({ sniffed }: { sniffed: string }, _optional = {}): MediaOriginalType {
  const forceDownload = DISALLOWED_INLINE_CONTENT_TYPES.has(sniffed);
  return { safe: forceDownload ? "application/octet-stream" : sniffed, disposition: forceDownload ? "attachment" : null };
}

/**
 * Old blobs may predate ingest sanitization; never authorize raw markup from its label. Sanitizes an
 * SVG's bytes and passes every other sniffed type through untouched (reuse ingest sanitization before
 * applying byte ranges).
 * @complexity O(n) in the SVG's size; O(1) otherwise.
 */
export async function sanitizeOriginalBytes({ sniffed, sourceBytes }: { sniffed: string; sourceBytes: Uint8Array }, _optional = {}): Promise<Uint8Array> {
  return sniffed === "image/svg+xml" ? sanitizeSvg({ bytes: sourceBytes }) : sourceBytes;
}

/** The security headers documented in this file's header, in the order a host writes them. */
function originalSecurityHeaders({ type }: { type: MediaOriginalType }, _optional = {}): Array<readonly [string, string]> {
  const headers: Array<readonly [string, string]> = [
    ["X-Content-Type-Options", "nosniff"],
    ["Content-Security-Policy", type.safe === "image/svg+xml" ? SVG_CONTENT_SECURITY_POLICY : "default-src 'none'; sandbox"],
    ["Cross-Origin-Resource-Policy", "same-origin"],
    ["Cache-Control", "private, no-store"],
    ["Content-Type", type.safe],
    ["Accept-Ranges", "bytes"],
  ];
  if (type.disposition !== null) headers.push(["Content-Disposition", type.disposition]);
  return headers;
}

/**
 * Decides the security headers, then the (possibly range-sliced) body: 200 full, 206 for a satisfiable
 * range, 416 (no body) for an unsatisfiable one. The security reasoning for each header stays in the module
 * doc above, not duplicated here.
 *
 * @complexity O(1) aside from the byte copy for a partial range.
 */
export function decideMediaOriginalReply({ bytes, rangeHeader, type }: { bytes: Uint8Array; rangeHeader: string | undefined; type: MediaOriginalType }, _optional = {}): MediaOriginalReply {
  const totalLength = bytes.byteLength;
  const headers = originalSecurityHeaders({ type });
  const range = parseRangeHeader({ header: rangeHeader, totalLength });
  if (range.kind === "unsatisfiable") {
    return { status: 416, headers: [...headers, ["Content-Range", `bytes */${totalLength}`]], body: null };
  }
  if (range.kind === "range") {
    return { status: 206, headers: [...headers, ["Content-Range", `bytes ${range.start}-${range.end}/${totalLength}`]], body: bytes.slice(range.start, range.end + 1) };
  }
  return { status: 200, headers, body: bytes };
}

/** RFC 5987 `Content-Disposition` for a document download under its display filename. @complexity O(n) in the filename. */
function documentDisposition({ media }: { media: MediaRecord }, _optional = {}): string {
  const filename = documentDisplayFilename(media);
  // RFC 5987 encoding keeps titles out of header syntax; storage keys never use names.
  // The UTF-8 round-trip turns a lone UTF-16 surrogate into U+FFFD, which
  // `encodeURIComponent` would otherwise reject with a URIError.
  const encoded = encodeURIComponent(new TextDecoder().decode(new TextEncoder().encode(filename))).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="document"; filename*=UTF-8''${encoded}`;
}

/**
 * Serves a document as a download under its display filename, with its filename-policy type.
 * Refuses (throws, so the host answers 500) a document over `MAX_DOCUMENT_BYTES` — before reading the
 * bytes when the store can report a size, and again on the bytes actually read.
 *
 * @complexity O(n) in the document's size (one read, one optional copy for a partial range).
 */
async function decideDocumentOriginal({ deps, media, blob, rangeHeader }: { deps: { blobStore: BlobStorePort }; media: MediaRecord; blob: { storageKey: string }; rangeHeader: string | undefined }, _optional = {}): Promise<MediaOriginalReply> {
  const size = await deps.blobStore.sizeOf?.({ storageKey: blob.storageKey });
  if (size != null && size > MAX_DOCUMENT_BYTES) throw new Error("document exceeds size limit");
  const bytes = await deps.blobStore.get({ storageKey: blob.storageKey });
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("document exceeds size limit");
  const type = { safe: documentContentType({ filename: media.originalFilename ?? "" }), disposition: documentDisposition({ media }) };
  return decideMediaOriginalReply({ bytes, rangeHeader, type });
}

/**
 * Serves an image/video inline under the type sniffed from its bytes (see the module doc's
 * SECURITY list): SVG is sanitized first, and HTML is forced to an `octet-stream` download.
 *
 * @complexity O(n) in the asset's size (read, optional SVG sanitize, optional range copy).
 */
async function decideInlineOriginal({ deps, blob, rangeHeader }: { deps: { blobStore: BlobStorePort }; blob: { storageKey: string }; rangeHeader: string | undefined }, _optional = {}): Promise<MediaOriginalReply> {
  const sourceBytes = await deps.blobStore.get({ storageKey: blob.storageKey });
  const sniffed = sniffContentType({ bytes: sourceBytes });
  const bytes = await sanitizeOriginalBytes({ sniffed, sourceBytes });
  // Every response here reflects this principal's authorization at request time and may name
  // whether a specific asset is trashed — never shared-cached; every outcome is `private, no-store`
  // since none of its bytes are safe to cache across principals/permission changes.
  return decideMediaOriginalReply({ bytes, rangeHeader, type: inlineOriginalType({ sniffed }) });
}

/**
 * Reads a looked-up asset's original bytes and decides its reply: a document is an attachment under its
 * filename-policy type, anything else is served inline under its sniffed type.
 * @complexity O(n) in the asset's size.
 */
export async function decideMediaOriginalForAsset({ deps, media, blob, rangeHeader }: { deps: { blobStore: BlobStorePort }; media: MediaRecord; blob: { storageKey: string }; rangeHeader: string | undefined }, _optional = {}): Promise<MediaOriginalReply> {
  return media.kind === "document"
    ? decideDocumentOriginal({ deps, media, blob, rangeHeader })
    : decideInlineOriginal({ deps, blob, rangeHeader });
}
