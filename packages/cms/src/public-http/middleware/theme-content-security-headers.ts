import path from "node:path";

/**
 * @file The shared response-header fix for security pass 2026-08-13's Finding 1
 * (`ADS-memory/reports/security/2026-08-13-post-session-security-pass.md`) — a stored XSS where a
 * `.svg` (or top-level `.html`) file carrying a `<script>` tag, writable through Explore's general
 * `isThemeFileWritable` gate (`explore.ts`) everywhere OUTSIDE a compiled theme's `build.sourceDir`
 * (`d822d87` only closed the `sourceDir` instance), was served back executable, same-origin with
 * `/api/admin/*`, by every mount that serves a theme's own files raw.
 *
 * DELIBERATELY a serve-side fix, not a write-side one: `.svg` and top-level `.html` stay exactly as
 * writable as before this file exists (`explore.ts`'s `isThemeFileWritable`/`TEXT_READABLE_EXTENSIONS`/
 * `ASSET_EXTENSIONS`/`CONTENT_EDIT_LOCKED_GROUPS` — renamed from `READ_ONLY_GROUPS` 2026-08-29, same
 * asset/partial classification either name — are UNCHANGED) — SVGs and HTML partials are legitimate theme
 * assets (owner's "anyone can author themes" position), and this fix removes the actual risk (script
 * execution) without removing the capability (writing/reading real SVG/HTML content). See this
 * function's own doc below for why this is safe for `<img>`/`<link>`/`<script src>` consumption and
 * only removes the direct-navigation/iframe/object-embed exploit path.
 *
 * Applied identically to BOTH theme-file-serving mounts found while enumerating this class
 * (`registerThemeStaticAssets` at `/theme-assets/…` and `registerThemePreviewStatic` at
 * `/theme-preview/…` — the latter serves a theme's `preview/` build-output folder through its own,
 * separate `express.static` call and was independently vulnerable to the identical class before this
 * fix) — ONE shared function, not two copies that could drift apart the way `d822d87`'s narrowed
 * allowlist and the still-open general gate already drifted apart once this session.
 *
 * Options considered and rejected, recorded here so this is not re-litigated per caller:
 * - **Sanitize content at write time** — SVG XSS sanitization is a long-running, evasion-prone problem
 *   (`<foreignObject>`, `xlink:href` to `javascript:`, CSS `expression()`/`-moz-binding`, `<animate>`
 *   attribute injection, and more), no vetted sanitizer dependency exists in this codebase today, and a
 *   bespoke one risks exactly the false confidence `d822d87`'s narrowed-allowlist-plus-OR'd-general-gate
 *   already produced once. A top-level `.html` "partial" would need arbitrary-author-HTML sanitization,
 *   an even larger, riskier surface.
 * - **Isolate theme-asset serving on its own origin** (the standard `usercontent.com` pattern) — the
 *   architecturally "correct" long-term answer for untrusted content generally, but needs new DNS/TLS/
 *   CORS/deployment infrastructure this single-process, self-hostable product does not have today.
 *   Flagged for the owner as a future hardening step, not built under this fix's scope.
 * - **Ban `.svg`/top-level `.html` from the write allowlist** — explicitly rejected: real theme assets,
 *   and unnecessary once the serve-side risk (script execution) is actually the thing removed.
 */

/**
 * `sandbox` with NO `allow-scripts` token disables script execution (also forms, popups, and treats
 * the origin as opaque) for any document a browser constructs FROM this response — a direct navigation,
 * an `<iframe src="…">`, an `<object data="…">`/`<embed src="…">`. Per the CSP spec this applies
 * regardless of how the response was reached; it is not conditional on the request method or referrer.
 *
 * `default-src 'none'` is redundant with `sandbox` for the script-execution risk specifically (sandbox
 * already blocks script), but is included anyway to match the exact, already-proven pattern this
 * codebase uses for the identical problem in `apps/website/src/server/inbound/admin-http/routes/media/original.ts`'s
 * `DISALLOWED_INLINE_CONTENT_TYPES` handling — one convention, not two independently-invented ones for
 * the same risk.
 *
 * Deliberately NOT `Cross-Origin-Resource-Policy: same-origin` (media/original.ts's OTHER header): that
 * route is a private, session-gated admin preview; these mounts serve PUBLIC site assets that must
 * remain loadable cross-origin (a logo or icon referenced from anywhere the public site itself is
 * embedded/linked) — CORP `same-origin` would break that legitimate use with no XSS benefit, since CORP
 * governs cross-origin READS of the resource, not script execution.
 *
 * Deliberately NOT `X-Frame-Options`/`frame-ancestors`: those restrict who may EMBED this resource in a
 * frame, which would block legitimate cross-origin embedding of a public theme image — `sandbox`
 * already removes the actual risk (script execution) for the one embedding shape that would matter
 * (this resource loaded as the FRAMED DOCUMENT itself), without needing to also block being an `<img>`
 * inside someone else's frame.
 *
 * None of this affects `<img src>`/`<link rel=stylesheet>`/`<script src>` sub-resource fetches: those
 * fetch bytes for use INSIDE another document, and only that REFERENCING document's own CSP (unrelated
 * to and untouched by this header) governs whether anything executes — the fetched resource's own
 * response headers are irrelevant to a sub-resource fetch. This is why the fix can be a blanket,
 * mount-wide policy rather than a per-extension allowlist: it costs nothing for `.css`/`.js`/`.png`/
 * `.liquid`/etc. (none of them become a directly-navigated document in normal use), and it uniformly
 * covers every extension that IS dangerous today plus any that becomes dangerous in the future, closing
 * exactly the "narrowed one side of an OR, the other side still admits" trap `d822d87` fell into.
 */
const THEME_ASSET_CSP = "default-src 'none'; sandbox";

/**
 * Font files get `Access-Control-Allow-Origin: *`; nothing else on these mounts gets any CORS header.
 *
 * Why fonts need it (QA 2026-09-13): Theme Studio's preview is `<iframe sandbox="allow-scripts">`
 * with no `allow-same-origin`, so the previewed page runs in an opaque ("null") origin. The CSS Fonts
 * spec makes every `@font-face` load a CORS-mode fetch, so from that origin each theme font was
 * blocked and the preview silently fell back to system fonts. Stylesheets, images, and classic
 * scripts load in no-cors mode and are unaffected, which is why fonts were the only failure. The
 * published site is same-origin with these mounts and never needed the header.
 *
 * Why `*` and not an echoed `null`: allowing `null` grants exactly "any sandboxed or opaque-origin
 * document anywhere," which is no narrower than `*` and reads as a deliberate trust grant. `*` is the
 * standard for public static fonts: these bytes are identical for every requester (no session or
 * cookie changes them), browsers refuse `*` for credentialed reads, and no
 * `Access-Control-Allow-Credentials` is ever sent.
 *
 * Why fonts only, not the whole mount: CORS makes a response READABLE by script on any site. For a
 * self-hosted or intranet install, theme CSS/HTML/`.liquid` reachable only by network position would
 * become readable by any page the visitor opens. Fonts are the only asset type the preview needs.
 *
 * Rejected: adding `allow-same-origin` to the preview iframe (together with `allow-scripts`, theme JS
 * would run same-origin with `/api/admin/*` and can remove its own sandbox); a "same-origin path" for
 * the fonts (an opaque-origin document is cross-origin to every URL, so no path helps); inlining fonts
 * as `data:` URIs into the preview only (the preview would stop rendering what the live site renders).
 *
 * Matched on the request path's extension, case-insensitively, which is the extension of the file
 * `express.static` serves for that path.
 */
const CORS_LOADABLE_FONT_EXTENSIONS: ReadonlySet<string> = new Set([".woff2", ".woff", ".ttf", ".otf", ".eot"]);

/**
 * The response headers every theme-file mount sets: the two headers above on every response, plus
 * `Access-Control-Allow-Origin: *` when the request path is a font file (see
 * `CORS_LOADABLE_FONT_EXTENSIONS`). Server-neutral: the host's middleware writes these BEFORE its static
 * file server runs (not after), so the headers are present on every outcome that server can produce for
 * the request — a 200 with a body, a 304 Not Modified, a 404 fallthrough some other handler answers, a
 * Range 206 — rather than only the success path. Insertion order is the order the host writes them.
 *
 * @param required.path The request path (no query); its extension picks the font CORS header.
 * @complexity O(1).
 */
export function themeAssetSecurityHeaderSet({ path: requestPath }: { path: string }, _optional: Record<string, never> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": THEME_ASSET_CSP,
  };
  if (CORS_LOADABLE_FONT_EXTENSIONS.has(path.extname(requestPath).toLowerCase())) {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  return headers;
}
