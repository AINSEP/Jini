/**
 * @file Owner rule (2026-09-24): "links should open a new tab" — any link that leaves the current
 * site should open in a new tab, `rel="noopener noreferrer"` set so the new tab can't reach back
 * into this page via `window.opener`. Implemented ONCE, generically, at server render time
 * ({@link markOffSiteLinksOpenInNewTab}'s one call site per render path — see `render.ts`'s
 * `pageShell` and `routes/site/pages.ts`/`routes/site/products.ts`'s response send sites) rather than
 * requiring every theme author (there are seven static themes alone, plus every declarative/
 * templated/handlebars theme) to remember `target="_blank"` on every individual outbound `<a>` they
 * author into a page/post body, a partial, or a theme file.
 *
 * Pure and synchronous: given the same assembled page `html` and the same `siteHost`, always
 * produces the same output. No I/O, no theme knowledge — this module only ever sees the final HTML
 * string a render path already produced.
 */

import { escapeHtml } from "@jini-ai/core/text";

/** Matches one `<a …>` OPENING tag (never `</a>`, never a self-contained element) — the only part of
 *  an anchor that carries `href`/`rel`/`target`. Non-greedy `[^>]*` stops at the tag's own `>`, so a
 *  `>` inside a later sibling element can never be swallowed into this match. */
const ANCHOR_OPEN_TAG = /<a\b[^>]*>/gi;

/** An absolute `http:`/`https:` URL — the only scheme this rule ever treats as "off-site" candidate.
 *  A relative href (`pricing.html`, `/blog`, `#anchor`), a `mailto:`/`tel:` href, or any other scheme
 *  fails this and is left untouched — "open in a new tab" has no meaning for a mail/phone handoff,
 *  and a relative href can only ever resolve to this same site. */
const ABSOLUTE_HTTP_HREF = /^https?:\/\//i;

/** Reads one double- or single-quoted HTML attribute's value out of a tag string, or `undefined` if
 *  the attribute is absent. Case-insensitive on the attribute name (`HREF`/`href` both match), as
 *  HTML itself is. @complexity O(tag length). */
function readAttrValue({ tag, attrName }: { tag: string; attrName: string }, _optional = {}): string | undefined {
  const match = new RegExp(`[\\s"']${attrName}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(` ${tag}`);
  if (!match) return undefined;
  // The pattern's `"…"|'…'` alternation guarantees exactly one of groups 2/3 participated in the
  // match (an empty value is "" , never undefined), so there is no third, neither-quoted case.
  return match[2] ?? (match[3] as string);
}

/** `true` when the tag already carries a `target` attribute at all — the author's own explicit
 *  choice, which this rule must never override (owner instruction: "don't override an explicit
 *  target the author set"), regardless of what value it carries. */
function hasTargetAttr({ tag }: { tag: string }, _optional = {}): boolean {
  return /[\s"']target\s*=/i.test(` ${tag}`);
}

/** Lowercases and strips one leading `www.` label, so `www.example.com` and `example.com` compare
 *  equal — an author linking `https://www.<own-domain>/…` (or the reverse: the site itself served
 *  under `www.`, linking to its own bare-domain form) must not be treated as off-site over a `www.`
 *  mismatch alone. Every other subdomain is a genuinely different host and stays distinct. */
function normalizeHost({ host }: { host: string }, _optional = {}): string {
  const lower = host.trim().toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

/**
 * `true` when `href` is an absolute `http(s)` URL whose host differs from `siteHost` — the one
 * predicate {@link markOffSiteLinksOpenInNewTab} rewrites on. A malformed absolute-looking href
 * (fails `new URL()`) is treated as NOT off-site: this rule only ever ADDS `target`/`rel`, so the
 * safe default on an unparseable href is to leave it exactly as the author wrote it rather than guess.
 *
 * @complexity O(1) — one regex test plus, only on a match, one `URL` parse.
 */
function isOffSiteHref({ href, siteHost }: { href: string; siteHost: string }, _optional = {}): boolean {
  if (!ABSOLUTE_HTTP_HREF.test(href)) return false;
  let hostname: string;
  try {
    hostname = new URL(href).hostname;
  } catch {
    return false;
  }
  return normalizeHost({ host: hostname }) !== normalizeHost({ host: siteHost });
}

/** Merges `add` into whatever tokens `existingRel` (a raw, possibly-`undefined` `rel` attribute
 *  value) already carries, de-duplicated and order-preserving-for-existing-tokens — an off-site link
 *  already authored with `rel="nofollow"` becomes `rel="nofollow noopener noreferrer"`, never a
 *  second `rel` attribute and never a duplicated token if the author already wrote `noopener`
 *  themselves. @complexity O(tokens). */
function mergeRelTokens({ existingRel, add }: { existingRel: string | undefined; add: readonly string[] }, _optional = {}): string {
  const tokens = (existingRel ?? "").split(/\s+/).filter((t) => t.length > 0);
  for (const token of add) {
    if (!tokens.includes(token)) tokens.push(token);
  }
  return tokens.join(" ");
}

/** Replaces an existing attribute's value in `tag`, or appends `name="value"` before the tag's own
 *  closing `>` (or `/>` for a self-closed anchor, though real markup never writes one) when the
 *  attribute is absent. @complexity O(tag length). */
function withAttr({ tag, name, value, options }: { tag: string; name: string; value: string; options: { replaceIfPresent: boolean } }, _optional = {}): string {
  const escaped = escapeHtml({ text: value });
  if (options.replaceIfPresent && readAttrValue({ tag, attrName: name }) !== undefined) {
    return tag.replace(new RegExp(`([\\s"'])(${name})\\s*=\\s*("[^"]*"|'[^']*')`, "i"), (_match, leading: string, attribute: string) => `${leading}${attribute}="${escaped}"`);
  }
  const insertion = ` ${name}="${escaped}"`;
  return /\/>\s*$/.test(tag) ? tag.replace(/\/>\s*$/, () => `${insertion} />`) : tag.replace(/>\s*$/, () => `${insertion}>`);
}

/**
 * Rewrites one already-matched `<a …>` open tag so it opens off-site in a new tab: always merges
 * `noopener`/`noreferrer` into `rel` (adding the attribute if the tag had none), and adds
 * `target="_blank"` only when the tag carries no `target` at all — an author's own explicit target
 * (even `target="_self"`) is left exactly as authored, per the owner's instruction.
 *
 * @complexity O(tag length).
 */
function withOffSiteLinkAttrs({ tag }: { tag: string }, _optional = {}): string {
  const mergedRel = mergeRelTokens({ existingRel: readAttrValue({ tag, attrName: "rel" }), add: ["noopener", "noreferrer"] });
  const withRel = withAttr({ tag, name: "rel", value: mergedRel, options: { replaceIfPresent: true } });
  return hasTargetAttr({ tag: withRel }) ? withRel : withAttr({ tag: withRel, name: "target", value: "_blank", options: { replaceIfPresent: false } });
}

/**
 * Scans an assembled page's HTML for every `<a href>` that points off-site and rewrites it to open
 * in a new tab — see this file's header for the full rule and why it lives here rather than in each
 * theme. Same-site links (relative, or absolute to `siteHost` itself), `mailto:`/`tel:`/other
 * non-http(s) schemes, and bare `#anchor` hrefs are returned byte-identical.
 *
 * @param html The fully assembled page HTML (a complete document or a fragment — this function only
 *   ever touches `<a>` open tags, so it is safe to call on either).
 * @param siteHost The current request's own host (e.g. `req.hostname` — already port-free), used to
 *   tell "absolute link to this same site" apart from a genuinely off-site link.
 * @complexity O(n) over `html`'s length — one regex pass locating every `<a>` open tag, plus O(1)
 *   attribute work per tag found (bounded by the page's own authored link count, never
 *   user-collection-sized).
 */
export function markOffSiteLinksOpenInNewTab({ html, siteHost }: { html: string; siteHost: string }, _optional = {}): string {
  return html.replace(ANCHOR_OPEN_TAG, (tag) => {
    const href = readAttrValue({ tag, attrName: "href" });
    if (href === undefined || !isOffSiteHref({ href, siteHost })) return tag;
    return withOffSiteLinkAttrs({ tag });
  });
}

/**
 * True when `html`, after stripping a leading BOM and any run of leading whitespace/HTML comments,
 * starts with `<!doctype html` or an `<html` tag (case-insensitive). An `"html"`-format Page body
 * that matches this is a COMPLETE document the author wrote their own `<head>` for — not a fragment
 * {@link renderBareEntryDocument} should wrap. Only the PREFIX is inspected (never a scan for a
 * `<html>` tag anywhere in the string), so an ordinary fragment that merely mentions "doctype" or
 * "<html>" later in its body — e.g. in a code sample — never false-positives into passthrough.
 *
 * Exported for direct unit coverage of the detection rule without constructing a full
 * {@link renderBareEntryDocument} call for every prefix variant (BOM, comment, case).
 *
 * @complexity O(n) over `html`'s length — one linear scan stripping alternating whitespace/comment
 * runs, each consumed exactly once, plus one bounded regex test against the remaining prefix.
 */
export function isFullHtmlDocument({ html }: { html: string }, _optional = {}): boolean {
  let rest = html.charCodeAt(0) === 0xfeff ? html.slice(1) : html;
  for (;;) {
    const withoutLeadingSpace = rest.replace(/^\s+/, "");
    const comment = /^<!--[\s\S]*?-->/.exec(withoutLeadingSpace);
    if (!comment) {
      rest = withoutLeadingSpace;
      break;
    }
    rest = withoutLeadingSpace.slice(comment[0].length);
  }
  return /^<!doctype html/i.test(rest) || /^<html[\s>]/i.test(rest);
}

/**
 * Splices `page-head.ts`'s `serializeHeadElements()` output into an already-complete static-tier
 * document's `<head>` (SPEC-008 T045 gap fix). `renderStaticPage`'s output bypasses `pageShell`
 * entirely — a static theme's page is already a full `<!doctype html>` document, not a body
 * fragment — which meant `extraHead` (the SEO fold's title/canonical/meta/OG/JSON-LD) was silently
 * dropped for every static-tier home page even though the route layer always computed it. Mirrors
 * {@link pageShell}'s own "fold's `<title>` wins" rule: when `extraHead` carries a `<title>`, the
 * theme's own hardcoded one is removed so the page never ships two competing tags. `extraHead`'s
 * elements are inserted immediately before `</head>` (append, not replace) so the theme's own
 * meta/link/script tags survive untouched. A no-op when `extraHead` is empty/absent, or when `html`
 * has no `</head>` to splice into (defensive — every real static page has one; this is the same
 * "never throw, degrade to what's already there" contract `renderStaticPage` itself follows).
 *
 * Exported (2026-08-19 follow-up) so `routes/site/pages.ts` can reuse this SAME splice for the two
 * other static-tier `renderStaticPage` call sites that bypass `renderSite`/`pageShell` entirely and
 * therefore had the identical drop: the marketing `/:slug` theme-page branch (no backing post, so
 * there is no `renderSite` call in the mix at all) and `renderViaTemplate`'s template-picker render.
 * One splice implementation, not a second parallel one — see those call sites' own docs for which
 * static-tier renders were deliberately left OUT (the admin theme-preview iframe and the 404/
 * diagnostic pages) and why.
 *
 * `preserveThemeTitle` lets entry-less static routes keep an authored title when no explicit Site
 * title is set. The fold still supplies all other head elements, and its title is kept when the
 * theme has none. Entry-bearing callers retain the default fold-wins policy.
 * @example injectExtraHeadIntoStaticPage(html, extraHead, { preserveThemeTitle: true })
 */
export function injectExtraHeadIntoStaticPage(
  { html, extraHead }: { html: string; extraHead: string | undefined }, options: { preserveThemeTitle?: boolean } = {},
): string {
  if (!extraHead) return html;
  const withoutOwnTitle = extraHead.includes("<title>") ? removeThemeOwnTitleElement({ html }) : html;
  if (options.preserveThemeTitle && withoutOwnTitle !== html) {
    return insertBeforeUncommentedTag({ html, tag: "head", markup: removeThemeOwnTitleElement({ html: extraHead }) });
  }
  return insertBeforeUncommentedTag({ html: withoutOwnTitle, tag: "head", markup: extraHead });
}

/**
 * Insert `markup` immediately before the first `tag` match that is real markup rather than a mention
 * inside an HTML comment; returns `html` unchanged when there is none. The global regex walks
 * the selected closing-tag candidates through its `lastIndex`.
 *
 * A plain `html.replace(/<\/body>/i, ...)` was a live bug: a theme's pre-JS cloak comment in the
 * document head said `</body>` literally, so the visitor-chat mount and script were spliced into
 * that comment and the site chat FAB never loaded. Same lesson as {@link removeThemeOwnTitleElement}.
 *
 * @complexity O(n·k) over `html`'s length and the number of `tag` occurrences — k is 1 or 2 for any
 * real template.
 */
export function insertBeforeUncommentedTag({ html, tag, markup }: { html: string; tag: "head" | "body"; markup: string }, _optional = {}): string {
  const pattern = new RegExp(`</${tag}>`, "gi");
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    if (isInsideHtmlComment({ html, index: match.index })) continue;
    return html.slice(0, match.index) + markup + html.slice(match.index);
  }
  return html;
}

/**
 * True when `index` falls inside an HTML comment. Walks `<!--`/`-->` pairs from the start rather
 * than pattern-matching around `index`, because only a left-to-right scan can tell an opener that is
 * still open at `index` from one that already closed before it. An unterminated `<!--` is treated as
 * swallowing everything after it, which is exactly what a browser's parser does.
 *
 * @complexity O(n) over `html`'s length.
 */
function isInsideHtmlComment({ html, index }: { html: string; index: number }, _optional = {}): boolean {
  const CLOSE = "-->";
  let cursor = 0;
  for (;;) {
    const open = html.indexOf("<!--", cursor);
    if (open === -1 || open > index) return false;
    const close = html.indexOf(CLOSE, open + "<!--".length);
    if (close === -1 || index < close + CLOSE.length) return true;
    cursor = close + CLOSE.length;
  }
}

/**
 * Remove the document's own `<title>` element — the FIRST one that is real markup rather than an
 * incidental mention inside an HTML comment.
 *
 * The naive `html.replace(/<title>[\s\S]*?<\/title>/i, "")` this replaces was a live bug, not a
 * hypothetical one: `themes/static/basic/render/pages/page-shell.html`'s head opens with a comment
 * explaining its title placeholder, and that prose says `<title>` literally. The unanchored pattern
 * matched the mention inside the comment and ran its lazy tail to the real `</title>` further down,
 * deleting the comment's own `-->` along the way. Every head element after it — the theme-token
 * `<style>`, the `theme.css` link, the theme-toggle script — then parsed as comment text, so
 * `/contact`, `/team`, `/faq` and `/terms-of-service` served completely unstyled pages that looked
 * blank above the fold. Scanning for the first *uncommented* occurrence is the same lesson
 * {@link injectPageTitle} (`features/theme/static-render.ts`) already learned on this very template;
 * that one anchors on the placeholder's exact element text, which is unavailable here because this
 * runs after the placeholder has been substituted with a real title.
 *
 * Skipping only the OPEN tag (not a whole candidate element) matters: a lazy whole-element match
 * starting inside the comment consumes the real title as its tail, so a scan that rejected whole
 * matches would find no second candidate and leave two competing `<title>` tags on the page.
 *
 * @complexity O(n·k) worst case over `html`'s length and the number of `<title>` occurrences — k is
 * 1 or 2 for any real template.
 */
function removeThemeOwnTitleElement({ html }: { html: string }, _optional = {}): string {
  const openTag = /<title>/gi;
  for (let open = openTag.exec(html); open !== null; open = openTag.exec(html)) {
    if (isInsideHtmlComment({ html, index: open.index })) continue;
    const closeTag = /<\/title>/gi;
    closeTag.lastIndex = open.index + open[0].length;
    const close = closeTag.exec(html);
    if (close === null) return html;
    return html.slice(0, open.index) + html.slice(close.index + close[0].length);
  }
  return html;
}
