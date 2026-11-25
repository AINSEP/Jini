import { escapeHtml } from "@jini-ai/core/text";

/**
 * @file The one HTML answer the public newsletter token routes (`confirm`, `unsubscribe`) share: a bare
 * page with a heading and a sentence, a human clicked an emailed link and reads the result. Every answer is
 * `text/html; charset=utf-8`; the specs mark themselves `bufferedReply` so the host writes it through Express's
 * own `res.send`, keeping `Content-Length` and the weak ETag the hand-written routes produced.
 */

/** The rendered page: markup-escaped title and message in a minimal document.
 * @complexity O(n) in the text length.
 */
function renderPage({ title, message }: { readonly title: string; readonly message: string }, _optional: Record<string, never> = {}): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml({ text: title })}</title></head>
<body>
  <h1>${escapeHtml({ text: title })}</h1>
  <p>${escapeHtml({ text: message })}</p>
</body>
</html>`;
}

/** One finished newsletter page as a web `Response` with the given status.
 * @complexity O(n) in the text length.
 */
export function newsletterPage(
  { status, title, message }: { readonly status: number; readonly title: string; readonly message: string },
  _optional: Record<string, never> = {},
): Response {
  return new Response(renderPage({ title, message }), { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** The query `token` as a string; anything else (absent, repeated, non-string) is the empty token, which the
 *  token verifier refuses as invalid exactly as a malformed one.
 * @complexity O(1).
 */
export function queryToken({ query }: { readonly query: Readonly<Record<string, unknown>> }, _optional: Record<string, never> = {}): string {
  return typeof query.token === "string" ? query.token : "";
}

/** A public, cookie-less newsletter raw route in the exact shape `@jini-ai/http-kit`'s `RawRouteSpec` mounts,
 *  kept structural so this package never imports the server toolkit. */
export interface NewsletterPublicRawRoute<Deps> {
  readonly method: "get" | "post";
  readonly path: string;
  readonly bufferedReply: true;
  handle(required: { readonly raw: import("@jini-ai/core/contracts/server").RouteInputContext; readonly deps: Deps }, optional: { readonly signal: AbortSignal }): Promise<Response>;
}
