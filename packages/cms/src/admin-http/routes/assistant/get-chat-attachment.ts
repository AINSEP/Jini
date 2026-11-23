import type { ServerRoute } from "@jini-ai/core/contracts/server";

/**
 * @file `GET /api/attachments/:ref` — serves one staged chat attachment's bytes back to the
 * principal who uploaded it.
 *
 * WHY IT EXISTS. `@jini-ai/http-kit`'s attachment pack mounts only `POST`/`DELETE`, so bytes could
 * be staged and never read again. The admin's attachment preview modal could therefore only show
 * attachments from the current session, out of a client-side `File` cache; anything from an earlier
 * turn, or anything at all after a reload, had no URL to load from. This is that URL.
 *
 * WHERE THE WORK IS. Everything that decides whether these bytes may be served —
 * ownership, sidecar validation, path containment, and the file-identity gate — lives in the
 * host's owner-scoped attachment reader (`readAttachment`), which states the authorization rule and
 * the path-safety argument in full. This file is the HTTP shell: session gate, one call, safe headers.
 *
 * NOT A PROXY, unlike every other route on this path. `POST`/`DELETE /api/attachments` forward to
 * the agent daemon because the live `AttachmentStore` lives in that process. This route does not,
 * for two reasons: the daemon's `AttachmentStore` port exposes no non-mutating owner-scoped read
 * (see the reader's module doc), and the principal this route authorizes against is minted in
 * THE HOST'S process by its admin session gate — comparing it here means no trusted-header hop
 * between the check and the value it checks.
 *
 * AUTHENTICATION is the host's session gate on the `/api/attachments` prefix, mounted by the
 * host's assistant composition module. Express's `app.use(path, ...)` matches that prefix AND every
 * subpath, so this route is covered by the same gate that covers the upload it reads back — no
 * second mount, which would be a second thing to keep in sync. The host's route test asserts the
 * unauthenticated 401 through a real request rather than assuming that.
 *
 * SECURITY — this route serves attacker-influenced bytes, so it applies the same response policy as
 * the host's media-original route rather than hand-rolling a different one (the host injects that
 * route's own disallowed-inline set and SVG policy, so the two cannot drift apart):
 *  - `Content-Type` is ALWAYS `sniffContentType(bytes)`, computed from the bytes this response is
 *    about to send. The `kind` the store recorded at upload is never consulted for it — and could
 *    not be trusted for it anyway: `detectAttachmentKind` classifies a real AVIF as `'file'` today,
 *    so the stored `kind` is known to be wrong for at least one real format while the sniffer used
 *    here handles it.
 *  - a sniffed `text/html`/`application/xhtml+xml`/`image/svg+xml` is forced to
 *    `application/octet-stream` + `Content-Disposition: attachment`. A chat composer accepts any
 *    file, so an uploaded `.html` or `.svg` is an ordinary occurrence, and either is a same-origin
 *    stored-XSS vector if a browser ever renders it inline.
 *  - `X-Content-Type-Options: nosniff` is always set, without which the defusal above is moot.
 *  - a restrictive `Content-Security-Policy` and `Cross-Origin-Resource-Policy` ride along, and
 *    `Cache-Control: private, no-store` keeps one principal's attachment out of any shared cache.
 *  - `Range` is honored, so a `<video>` attachment can seek instead of buffering the whole file.
 *
 * NO `Content-Disposition: filename`. The stored display name is available but is not put in a
 * header here: `sanitizeAttachmentName`'s allowlist has not been checked against what a
 * `Content-Disposition` value may safely contain, and a header built from an unverified allowlist
 * is exactly the kind of claim this repo's false-comment register exists to stop. A filename can be
 * added once that is checked.
 */

/** The registered path. The host also names it when it builds a failure reply for this route. */
export const CHAT_ATTACHMENT_READ_PATH = "/api/attachments/:ref";

/** What the injected `Range` parser decides; `start`/`end` are inclusive and already in bounds. */
export type ChatAttachmentRange =
  | { kind: "none" }
  | { kind: "unsatisfiable" }
  | { kind: "range"; start: number; end: number };

/** The owner-scoped read: bytes, or one opaque refusal (the reason never reaches the wire). */
export type ChatAttachmentReadResult = { ok: true; bytes: Uint8Array } | { ok: false };

/** The deps this route reads. Every field is the host's: the reader, the session principal, the
 * sniffer, the `Range` parser, its media response policy, and its redacted failure reply. */
export interface ChatAttachmentReadRouteDeps {
  /** Owner-scoped reader, already bound to the host's upload directory. */
  readAttachment(required: { ref: string; ownerId: string }): Promise<ChatAttachmentReadResult>;
  /** The authenticated principal's id from the request locals; throws when the gate did not run. */
  ownerIdOf(required: { locals: Record<string, unknown> }): string;
  sniffContentType(required: { bytes: Uint8Array }): string;
  parseRangeHeader(required: { header: string | undefined; totalLength: number }): ChatAttachmentRange;
  disallowedInlineContentTypes: ReadonlySet<string>;
  svgContentSecurityPolicy: string;
  /** The host's redacted 500 for an unexpected failure. */
  failureResponse(required: { error: unknown; request: Request; locals: Record<string, unknown> }): Response;
}

/** The single, deliberately non-disclosing refusal. Every distinct reason
 *  the owner-scoped reader can refuse for — unknown ref, malformed ref, another principal's
 *  attachment, a file that changed since upload — produces this exact response, so a caller cannot
 *  probe for which one applies. Mirrors `AttachmentStore.resolveForRun`'s own non-disclosure
 *  contract. The ref is deliberately not echoed back: it is caller-controlled, and there is nothing
 *  to confirm about it. */
const ATTACHMENT_NOT_FOUND_TEXT = JSON.stringify({ error: "attachment was not found", code: "NOT_FOUND" });

/** The 404 every refusal answers, with its length stated as a finished body. */
function notFoundResponse(): Response {
  return new Response(ATTACHMENT_NOT_FOUND_TEXT, { status: 404, headers: {
    "cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": String(new TextEncoder().encode(ATTACHMENT_NOT_FOUND_TEXT).byteLength),
  } });
}

/**
 * The security headers listed in this file's header, then the (possibly range-sliced) body.
 * @complexity O(1) aside from the byte copy for a partial range.
 */
function attachmentBytesResponse(
  { bytes, range, contentType, svgContentSecurityPolicy }: { bytes: Uint8Array; range: ChatAttachmentRange; contentType: { safe: string; forceDownload: boolean }; svgContentSecurityPolicy: string },
  _optional: Record<string, never> = {},
): Response {
  const totalLength = bytes.byteLength;
  const headers = new Headers({
    "x-content-type-options": "nosniff",
    "content-security-policy": contentType.safe === "image/svg+xml" ? svgContentSecurityPolicy : "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "cache-control": "private, no-store",
    "content-type": contentType.safe,
    "accept-ranges": "bytes",
  });
  if (contentType.forceDownload) headers.set("content-disposition", "attachment");
  if (range.kind === "unsatisfiable") {
    headers.set("content-range", `bytes */${totalLength}`);
    return new Response(null, { status: 416, headers });
  }
  // Finished bodies state their length, so the adapter does not switch to chunked encoding.
  const body = range.kind === "range" ? bytes.slice(range.start, range.end + 1) : bytes.slice();
  headers.set("content-length", String(body.byteLength));
  if (range.kind === "range") headers.set("content-range", `bytes ${range.start}-${range.end}/${totalLength}`);
  return new Response(body, { status: range.kind === "range" ? 206 : 200, headers });
}

/**
 * Builds the attachment read route over the host's reader and response policy. Unexpected
 * failures go to the host's redacted failure reply.
 * @complexity O(n) time/space in the attachment bytes read and served.
 */
export function createChatAttachmentReadRoute({ deps }: { deps: ChatAttachmentReadRouteDeps }, _optional: Record<string, never> = {}): ServerRoute {
  return {
    method: "GET",
    path: CHAT_ATTACHMENT_READ_PATH,
    handler: async ({ request, params, locals = {} }) => {
      try {
        const ref = String(params.ref);
        const result = await deps.readAttachment({ ref, ownerId: deps.ownerIdOf({ locals }) });
        if (!result.ok) return notFoundResponse();

        const sniffed = deps.sniffContentType({ bytes: result.bytes });
        const forceDownload = deps.disallowedInlineContentTypes.has(sniffed);
        const range = deps.parseRangeHeader({ header: request.headers.get("range") ?? undefined, totalLength: result.bytes.byteLength });
        return attachmentBytesResponse({ bytes: result.bytes, range, contentType: {
          safe: forceDownload ? "application/octet-stream" : sniffed,
          forceDownload,
        }, svgContentSecurityPolicy: deps.svgContentSecurityPolicy });
      } catch (error) {
        // The owner-scoped reader classifies every expected failure as a refusal rather than
        // throwing, so anything reaching here is genuinely unexpected (a filesystem fault between the
        // identity check and the read, say). Reported without detail — a store failure can carry
        // filesystem paths a caller must not see, the same SEC-005 redaction `attachments.ts` applies.
        return deps.failureResponse({ error, request, locals });
      }
    },
  };
}
