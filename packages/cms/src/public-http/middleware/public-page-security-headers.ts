/**
 * @file The ONE header set every public page carries, wherever it is served from. The live server
 * sends it as response headers (`server/inbound/public-http/middleware/public-page-security-headers.ts`,
 * which documents each header and why the CSP is report-only); a static export carries it as the
 * host's own header config or an HTML `<meta>` (`features/site-export/static-security-headers.ts`).
 * Lives in `contracts/` because `features/site-export` never imports from `server/inbound/**`.
 * Change a value here and both follow; never copy these values anywhere else.
 */

import { CSP_REPORT_ONLY_HEADER, isDeclaredOrigin, type SecurityHeaderSet } from "@jini-ai/core/contracts/server/security-headers";
import type { PublicThemeResources } from "@jini-ai/core/contracts/site/core-public-page-security-headers";

/**
 * Format the host's report-only policy using declared theme origins; this never creates an enforced CSP.
 * @param required Theme-owned resource origins. Provider frame declarations extend only their own directive.
 * @returns The same header set for live pages, publishing and static exports. No I/O or mutation.
 * @complexity O(r) declared resource URLs; URL parsing rejects malformed data.
 */
export function createPublicPageSecurityHeaderSet({ resources }: { resources: PublicThemeResources }, { frameOrigins = [] }: { frameOrigins?: readonly string[] } = {}): SecurityHeaderSet {
  const origins = (urls: readonly string[]) => [...new Set(urls.map(url => new URL(url).origin))].join(' ');
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: https:",
    "media-src 'self' https:",
    `script-src 'self' 'unsafe-inline' ${origins(resources.scripts)}`.trimEnd(),
    `style-src 'self' 'unsafe-inline' ${origins(resources.styles)}`.trimEnd(),
    `font-src 'self' data: ${origins(resources.fonts)}`.trimEnd(),
    `frame-src 'self' ${[...new Set(['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://player.vimeo.com', ...frameOrigins.filter(value => isDeclaredOrigin({ value }))])].join(' ')}`,
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");

  return Object.freeze({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    [CSP_REPORT_ONLY_HEADER]: csp,
  });
}

