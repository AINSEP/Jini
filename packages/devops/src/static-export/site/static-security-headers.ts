import type { SecurityHeaderSet } from "@jini-ai/core/contracts/server/security-headers";
import { escapeHtml } from "@jini-ai/core/text";

/**
 * @file Carries the live server's public-page security headers into a static export, which is
 * plain files served by someone else's host. Every value comes from the ONE shared set in
 * `@jini-ai/cms/public-http/middleware/public-page-security-headers`; nothing here retypes a header.
 *
 * - A host that reads a `_headers` file ({@link renderHeadersFile}'s format), applied to every
 *   path. How the file must reach that host (e.g. as its own upload field, never a public asset)
 *   is the host plugin's concern, documented in its deploy module.
 * - A host with its own header config format renders it in its plugin's deploy module from the
 *   publish's `responseHeaders`.
 * - Everywhere else (a host with no header config, a hand-copied folder): only what HTML
 *   itself can say, via {@link withSecurityMeta}.
 *
 * What a `<meta>` CANNOT carry, so those hosts go without it:
 * - `X-Content-Type-Options`: a response header only; no HTML equivalent exists.
 * - `Content-Security-Policy-Report-Only`: browsers ignore report-only in `<meta http-equiv>`. An
 *   ENFORCED meta CSP is deliberately not emitted instead: the live server does not enforce one
 *   (it would break html-format Pages and vendor embeds, see the live middleware's doc), and a static
 *   copy must not break where the live site works.
 * `Referrer-Policy` has an exact HTML equivalent (`<meta name="referrer">`) and is written into every
 * exported HTML page for every host, so it holds even where a header file is not applied.
 */


/** The `_headers` file format some static hosts read: a path pattern, then two-space-indented `Name: value` lines. */
export function renderHeadersFile({ headers }: { headers: SecurityHeaderSet }, _optional: Record<string, never> = {}): string {
  const lines = Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`);
  return `/*\n${lines.join("\n")}\n`;
}

const HEAD_OPEN_TAG = /<head(\s[^>]*)?>/i;

/**
 * Inserts `<meta name="referrer">` as the first child of `<head>`, so a page's own later referrer
 * meta (if any) still wins, exactly as it would over the live header. Unchanged when the HTML has no
 * `<head>` or the set has no `Referrer-Policy`.
 *
 * @complexity O(n) in the length of `html` (one regex scan).
 */
export function withSecurityMeta({ html, headers }: { html: string; headers: SecurityHeaderSet }, _optional: Record<string, never> = {}): string {
  const referrerPolicy = headers["Referrer-Policy"];
  if (referrerPolicy === undefined) return html;
  return html.replace(HEAD_OPEN_TAG, (tag) => `${tag}<meta name="referrer" content="${escapeHtml({ text: referrerPolicy })}">`);
}
