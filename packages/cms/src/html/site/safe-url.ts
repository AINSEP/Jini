import type { JsonValue } from "@jini-ai/core/primitives";

/**
 * Fixed placeholder origin {@link safeImageSrc} resolves a claimed same-origin-relative `src` against.
 * This is a pure string function with no real request/origin available to it — any two-part fixed
 * origin works equally well as the resolution anchor, since only the RELATIONSHIP between the
 * resolved URL's origin and this one is ever inspected below, never the placeholder value itself.
 */
const SAFE_HREF_RESOLUTION_BASE = "https://jini-safehref.invalid/";

const SAFE_HREF_RESOLUTION_ORIGIN = new URL(SAFE_HREF_RESOLUTION_BASE).origin;

/**
 * The image-shaped sibling of `toAllowedHref` (`@jini-ai/cms/navigation`, the href standard) — the allowlist an author-supplied `attrs.src` must pass
 * before it reaches public HTML. Returns `null` when the value is not safe to emit, and the caller
 * degrades to {@link mediaPlaceholder} exactly as it did when `src` was refused unconditionally.
 *
 * ## Why this exists rather than the old blanket refusal
 *
 * Until 2026-08-12 the `"image"` case never read `src` at all. That was safe but blunt: it silently
 * broke the toolbar's own "Img by URL" control, which produced content that could never render. The
 * owner's objection was the right one — *"why is that even bad to refuse an attribute source? If the
 * user is saying they want it, why bar it?"* — and `toAllowedHref` (the href standard) already demonstrates
 * the correct answer for the identical problem class: validate the scheme, do not ban the feature.
 *
 * ## What is rejected, and why each one matters
 *
 * - **`data:` / `blob:` / `file:` / `javascript:` and every other scheme.** Only `http(s)` is
 *   allowed, by allowlist rather than denylist, so a scheme nobody thought of fails closed.
 * - **The authenticated admin media URL** (`/workspaces/{ws}/media/{id}/original`, `api.ts`'s
 *   `mediaOriginalUrl`). This is the non-obvious one and the reason the blanket refusal existed at
 *   all: the editor's own node view legitimately previews via that URL on an authenticated admin
 *   surface, so it can genuinely end up in `attrs.src`. Emitting it publicly gives every reader a
 *   broken image and discloses internal routing. A ref-based node is the supported way to publish
 *   managed media — that path is untouched above.
 * - **Protocol-relative paths.** `//host/x` inherits the page scheme, which is not a decision an
 *   author should make implicitly here. Relative paths are allowed (imgbyurl, 2026-10-11), with
 *   the same parsed-path admin-preview rejection; nodes carrying media refs still use that path.
 *
 * Note there is deliberately no server-side fetch anywhere in this path: the emitted URL is loaded
 * by the READER's browser, so this introduces no SSRF surface. Ingesting the URL server-side to
 * mint a real ref would — and would also have to solve `src/platform/http`'s (ADR-038) UTF-8 text buffering,
 * which corrupts binary bytes. See `PostEditor.tsx`'s toolbar comment for that full trade-off.
 */

/**
 * TM-TOVU-2026-08-12-A round 2 (two auditors, chased empirically — see
 * `tiptap-render-contract.test.ts`'s image-security rows for the probe evidence this fix is
 * built from): the admin-media rejection above used to test the RAW string. `[^/]+` cannot span a
 * `/`, so an interposed dot-segment defeats it while a real browser resolves the segment away
 * before requesting — `.../media/id/./original` and `.../media/x/../id/original` BOTH evaded the
 * old regex and landed on the exact blocked admin route. Testing `new URL(src).pathname` instead
 * closes this: WHATWG's URL parser removes `.`/`..` path segments (and folds a stray `\` into `/`
 * in the process) during parsing, so the check now sees exactly what a browser will request.
 *
 * Userinfo credentials (`https://user:pass@host/x.png`) are rejected too, and deliberately NOT
 * folded into `toAllowedHref`: an `<img>` auto-fires the request on page load, with no reader
 * click and no address-bar/status-bar text for them to notice — unlike a link, which requires a
 * navigation gesture first. Silently shipping whatever an author pasted as embedded Basic-Auth
 * credentials to a third-party host on every single page view is a materially different risk than
 * the same string sitting inert in an `href` until clicked, so it is rejected here even though
 * `toAllowedHref`'s identical-looking allowance stays untouched (pre-existing, accepted, out of scope).
 *
 * Two other vectors were investigated and are NOT fixed, for stated reasons rather than left
 * silently unconsidered:
 *  - **Punycode/IDN homographs** (`https://xn--.../x.png`): not actionable at this layer. The
 *    homograph-phishing threat model is about deceiving a user who is shown a host string and
 *    makes a trust decision on it (address bar, link hover) — an `<img src>` fetch shows the
 *    reader no URL text at all, so there is nothing here for a confusable domain to spoof.
 *  - **Backslash/authority-delimiter confusion**: probed directly against Node's real WHATWG `URL`
 *    parser rather than reasoned about — no input was found where the parsed host differs from
 *    what the raw string suggests. The admin-media check above is host-agnostic BY DESIGN (it
 *    matches the path shape on any host, since this pure function is never given the admin
 *    origin), so host confusion has no distinct surface to exploit here; a backslash-based
 *    dot-segment attempt against the admin path is closed by the same `.pathname` fix above, since
 *    WHATWG folds `\` to `/` before resolving dot-segments.
 *
 * Residual, not closed: a `%2F`-encoded or doubled `/` inside the admin path both still evade this
 * check (`.pathname` does not decode `%2F`, and does not collapse consecutive slashes). Traced —
 * not curled end-to-end against a running server — to Express's router matching route segments on
 * the raw, undecoded path before decoding each one, so a segment containing a literal `%2F` does
 * not functionally reach the same route as the real `/workspaces/{id}/media/{id}/original`, and an
 * empty segment from `//` is not a valid id for any real workspace/asset either. Left unfixed
 * rather than guessed at further; flagged here so it is a known, reasoned gap and not an
 * unconsidered one.
 */
export function safeImageSrc({ value, isPrivatePath }: { value: JsonValue | undefined; isPrivatePath: (path: string) => boolean }, _optional = {}): string | null {
  if (typeof value !== "string") return null;
  const src = value.trim();
  const absolute = /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(src);
  if (!absolute && !isPlainRelativeImageSrc({ src })) return null;
  const parsed = parseImageSrc({ src });
  return parsed && isPublicImageUrl({ parsed, absolute, isPrivatePath }) ? src : null;
}

/** {@link safeImageSrc}'s shape gate for a non-absolute `src`: non-empty, no whitespace or
 *  backslash, no scheme, not protocol-relative. @complexity O(src.length). */
function isPlainRelativeImageSrc({ src }: { src: string }, _optional = {}): boolean {
  return src.length > 0 && !/[\s\\]|^[a-z][a-z\d+.-]*:|^\/\//i.test(src);
}

/** WHATWG-parses `src` against the fixed resolution base; `null` when the parser rejects it. */
function parseImageSrc({ src }: { src: string }, _optional = {}): URL | null {
  try {
    return new URL(src, SAFE_HREF_RESOLUTION_BASE);
  } catch {
    return null;
  }
}

/** {@link safeImageSrc}'s checks on the PARSED URL: a relative `src` must stay on the resolution
 *  origin (the parser strips leading control characters, so `"\u0001//evil.example"` resolves
 *  off-site), never the admin original-media route, never credentials. @complexity O(1). */
function isPublicImageUrl({ parsed, absolute, isPrivatePath }: { parsed: URL; absolute: boolean; isPrivatePath: (path: string) => boolean }, _optional = {}): boolean {
  if (!absolute && parsed.origin !== SAFE_HREF_RESOLUTION_ORIGIN) return false;
  if (isPrivatePath(parsed.pathname)) return false;
  return !parsed.username && !parsed.password;
}

/**
 * A YouTube video id extracted from a `youtube` node's `attrs.src` (`@tiptap/extension-youtube`,
 * 2026-08-11 — coordinator-approved, license-verified) and independently re-derived here rather than
 * trusted — the SAME "never trust attrs a direct API write could set to anything" discipline every
 * other node/mark case in this file follows, sharper here because the payoff for an attacker is
 * bigger: `attrs.src` feeds an `<iframe src>`, and the editor's own conversion to a safe embed URL
 * (`getEmbedUrlFromYoutubeUrl`, confirmed against the installed dist) runs client-side at RENDER
 * time, not at insert time — `bodyJson` stores whatever URL shape the author pasted (`watch?v=`,
 * `youtu.be/`, already-`/embed/`, …), so this renderer cannot skip re-deriving it.
 *
 * Deliberately narrower than the editor's own URL matcher: extracts only an id from one of the four
 * URL shapes the extension itself recognizes, validated against a conservative `[\w-]{1,32}`
 * (real ids are 11 chars; the slack is for future format changes, not because a longer value is
 * trusted). Anything else — a non-YouTube host, a bare id with no recognizable URL shape,
 * `javascript:`, `data:` — returns `null`, and the caller degrades to the ordinary media placeholder
 * rather than ever building an `<iframe>` from an unrecognized string.
 */
const YOUTUBE_ID_PATTERN = /^[\w-]{1,32}$/;

const YOUTUBE_URL_PATTERN = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]+)/;

export function extractYoutubeVideoId({ value }: { value: JsonValue | undefined }, _optional = {}): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(YOUTUBE_URL_PATTERN);
  const id = match?.[1];
  return id && YOUTUBE_ID_PATTERN.test(id) ? id : null;
}
