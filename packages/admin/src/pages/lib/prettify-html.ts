/**
 * @file A small, dependency-free HTML pretty-printer for the Pages editor's "HTML" tab.
 *
 * The owner reported the HTML view had "regressed" from a formatted tree back to a wall of text.
 * Checked first (`git log`/repo-wide grep for `prettier`/`js-beautify`/`html-format`/`CodeMirror`,
 * across both the host and Jini): no HTML formatter has EVER existed anywhere in this codebase — the
 * only precedent is `@jini-ai/ui/html-editor`'s `prettifyCss` (its CSS module),
 * which formats the CSS half of GrapesJS's export and explicitly argues for a small hand-rolled
 * tokenizer over a real parser or a bundled `prettier` build for exactly this reason: the added
 * weight isn't warranted for a formatting-only pass, and no such dependency exists in either
 * `package.json` in this repo already. This function is that same argument applied to HTML instead
 * of CSS, built fresh in the host first (when the Pages screen was host-only) and later moved here. So the report the
 * owner is remembering is not this codebase — build it anyway, since the request stands regardless.
 *
 * **Why the "wall of text" happens now specifically**: the host's legacy-doc-to-HTML conversion
 * script converted several Pages from Tiptap `doc` JSON to raw HTML
 * earlier the same session, and the renderer that produced that HTML emits zero inter-element
 * whitespace (`</h2><h2 id="...">`, `<p>...</p><p>...</p>`, directly concatenated). Hand-authored
 * page bodies with their own existing line breaks were never touched by this gap; only the
 * machine-generated ones show it.
 *
 * **The save-corruption risk, and how this function is constrained to avoid it**: `PageEditor.tsx`
 * wires this into a live, editable textarea, not a read-only viewer, so the formatted text an
 * operator sees IS what can end up saved once they start typing (see that file's own comment on the
 * `draftHtml`/`prevViewRef` wiring for the "view alone never dirties the page" half of that
 * decision). Whitespace injected purely for readability must therefore never change what a visitor
 * sees when the result is saved. This function is deliberately narrow to guarantee that:
 *
 * - It ONLY inserts a newline+indent at a boundary between two tags that were textually adjacent in
 *   the source (zero existing characters between them) AND are both members of {@link BLOCK_ELEMENTS}
 *   — ordinary block-level HTML tags (`div`, `p`, `h1`-`h6`, `li`, …). A whitespace-only text node
 *   between two such elements is not rendered by any browser (block/flex/grid layout all discard
 *   it), so this specific class of insertion is provably invisible once rendered, independent of
 *   which theme or CSS is applied — UNLESS a stylesheet overrides one of those tags to
 *   `display: inline` (rare for a structural tag; disclosed as a residual risk, not fixed here).
 * - It NEVER touches a text run, an inline element's boundary, or the inside of `<pre>`, `<script>`,
 *   `<style>`, or `<textarea>` (see {@link RAW_TEXT_ELEMENTS}) — those are copied through byte for
 *   byte. This is why `<p>Jini is a content platform <strong>vibecoded</strong> alongside…</p>`
 *   comes out exactly as authored: nothing inside a paragraph's mixed text/inline content is ever a
 *   zero-gap tag-to-tag boundary, so the rule never fires there.
 * - Existing whitespace between two tags (hand-authored formatting) is left completely alone — the
 *   rule only fires on a literal zero-character gap, so already-readable markup is a no-op through
 *   this function.
 *
 * @complexity O(n) two passes over the input length (tokenize, then print) — no backtracking, no
 * recursive descent, no DOM construction.
 */

/** Tags whose content the browser (and this formatter) treats as opaque: reformatting inside one of
 *  these could change literal, meaningful whitespace (`<pre>`/`<textarea>`) or corrupt embedded
 *  code (`<script>`/`<style>`) that happens to contain characters this tokenizer would otherwise
 *  read as markup. Content between an opening and closing tag of these names is copied verbatim. */
const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set(["script", "style", "pre", "textarea"]);

/** Void elements never have a closing tag or children — excluded from the open/close depth stack
 *  below (there is nothing to later pop). */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

/**
 * Ordinary block-level HTML tags. Whitespace-only text between two elements from this list is not
 * rendered by any layout mode (block, flex, grid) in a normal (non-overridden) stylesheet — see the
 * file header for why that specific property is what makes the insertion rule below safe.
 * Deliberately excludes inline-level and inline-with-fallback tags (`span`, `a`, `strong`, `em`,
 * `img`, `br`, `label`, `button`, …) — inserting whitespace next to one of those CAN become a
 * visible space once rendered, so this formatter never reformats around them at all.
 */
const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  "html", "head", "body", "header", "footer", "nav", "main", "section", "article", "aside",
  "div", "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup",
  "form", "fieldset", "legend", "blockquote", "figure", "figcaption", "hr",
  "details", "summary", "address", "pre",
]);

const INDENT = "  ";

/** One tag boundary (open/close/self-close) or an opaque run of everything else (text, comments,
 *  doctype, and raw-text-element content) between tag boundaries. */
type Token =
  | { kind: "tag"; text: string; tagKind: "open" | "close" | "self-close"; name: string }
  | { kind: "other"; text: string };

/** Matches one complete HTML tag, attributes included, with attribute values allowed to contain
 *  `>` when quoted (`data-x="a > b"`) so such a value is never mistaken for the tag's own end. */
const ATTRIBUTE_VALUE = String.raw`(?:"[^"]*"|'[^']*'|[^\s"'=<>]+)`;
const ATTRIBUTE = String.raw`\s+[^\s"'=<>]+(?:\s*=\s*${ATTRIBUTE_VALUE})?`;
const TAG_PATTERN = new RegExp(String.raw`<\/?([a-zA-Z][a-zA-Z0-9:-]*)(?:${ATTRIBUTE})*\s*\/?>`, "y");

/**
 * Consumes an HTML comment (`<!-- ... -->`) starting at `i`, if there is one — one of four token
 * shapes {@link tokenizeHtml} recognizes at each position, split out to a top-level function (each
 * scored on its own, independent of `tokenizeHtml`'s) so the tokenizer's own loop reads as a flat
 * dispatch instead of a wall of nested `if`s. Pushes directly onto `tokens` (rather than returning a
 * token to push) so a raw-text element's second, content token — see {@link consumeTag} — can use the
 * exact same shape without the caller needing to know a helper produced one token or two.
 *
 * @returns The index to resume tokenizing from, or `null` if `i` isn't the start of a comment.
 */
function consumeComment({ html, i, length, tokens }: { html: string; i: number; length: number; tokens: Token[] }, _options = {}): number | null {
  if (!html.startsWith("<!--", i)) return null;
  const end = html.indexOf("-->", i + 4);
  const stop = end === -1 ? length : end + 3;
  tokens.push({ kind: "other", text: html.slice(i, stop) });
  return stop;
}

/** Consumes a `<!doctype ...>` declaration starting at `i`, if there is one — see {@link consumeComment}. */
function consumeDoctype({ html, i, length, tokens }: { html: string; i: number; length: number; tokens: Token[] }, _options = {}): number | null {
  if (html.slice(i, i + 9).toLowerCase() !== "<!doctype") return null;
  const end = html.indexOf(">", i);
  const stop = end === -1 ? length : end + 1;
  tokens.push({ kind: "other", text: html.slice(i, stop) });
  return stop;
}

/** Tag metadata derived from one matched `<tag ...>` string — split out of {@link consumeTag} so its
 *  own ternary chain scores independently. `tagName` is {@link TAG_PATTERN}'s own capture group: the
 *  pattern only matches when a name is present, so (unlike the earlier re-match of `raw` with an
 *  `?.[1] ?? ""` fallback) there is no "no name" case to handle. */
function parseTagMeta({ raw, tagName }: { raw: string; tagName: string }, _options = {}): {
  name: string;
  tagKind: "open" | "close" | "self-close";
} {
  const isClose = raw.startsWith("</");
  const isSelfClose = !isClose && raw.endsWith("/>");
  const name = tagName.toLowerCase();
  const openKind: "open" | "self-close" = isSelfClose ? "self-close" : "open";
  const tagKind: "open" | "close" | "self-close" = isClose ? "close" : openKind;
  return { name, tagKind };
}

/** Consumes a {@link RAW_TEXT_ELEMENTS} element's entire opaque body as a second token, immediately
 *  after its opening tag — split out of {@link consumeTag}, called only when that tag just opened one,
 *  so its content is never re-tokenized as markup (see the file header). */
function consumeRawTextBody({ html, next, length, name, tokens }: { html: string; next: number; length: number; name: string; tokens: Token[] }, _options = {}): number {
  const closeMatch = new RegExp(`</${name}\\s*>`, "i").exec(html.slice(next));
  const rawEnd = closeMatch ? next + closeMatch.index + closeMatch[0].length : length;
  tokens.push({ kind: "other", text: html.slice(next, rawEnd) });
  return rawEnd;
}

/**
 * Consumes one HTML tag starting at `i`, if there is one — see {@link consumeComment}. When the tag
 * just opened a {@link RAW_TEXT_ELEMENTS} member, delegates to {@link consumeRawTextBody} to also
 * consume that element's entire body as a second token in the same call, so the resume index this
 * returns already skips past both.
 */
function consumeTag({ html, i, length, tokens }: { html: string; i: number; length: number; tokens: Token[] }, _options = {}): number | null {
  if (html[i] !== "<") return null;
  TAG_PATTERN.lastIndex = i;
  const match = TAG_PATTERN.exec(html);
  if (!match) return null;

  const raw = match[0];
  // TAG_PATTERN's group 1 is not optional, so a match always carries the tag name.
  const { name, tagKind } = parseTagMeta({ raw, tagName: match[1] ?? "" });
  tokens.push({ kind: "tag", text: raw, tagKind, name });
  const next = i + raw.length;

  if (tagKind === "open" && RAW_TEXT_ELEMENTS.has(name)) {
    return consumeRawTextBody({ html, next, length, name, tokens });
  }
  return next;
}

/** Consumes plain text (or an unmatched stray `<`, folded into the same run rather than looping
 *  forever on it) up to the next `<` — the fallback {@link tokenizeHtml} reaches when none of
 *  {@link consumeComment}/{@link consumeDoctype}/{@link consumeTag} claimed the current position, so
 *  unlike them this always succeeds and returns a plain index rather than `number | null`. */
function consumeText({ html, i, length, tokens }: { html: string; i: number; length: number; tokens: Token[] }, _options = {}): number {
  const next = html.indexOf("<", i + 1);
  const stop = next === -1 ? length : next;
  tokens.push({ kind: "other", text: html.slice(i, stop) });
  return stop;
}

/**
 * Splits raw HTML into a flat sequence of tag boundaries and opaque runs (text, comments, doctype,
 * and raw-text-element bodies). Not a real parser — no tree is built, no nesting is validated beyond
 * the simple open/close name stack {@link prettifyHtml} keeps for indentation — which is what keeps
 * this a single linear pass instead of a recursive-descent HTML parser.
 *
 * The loop itself is a flat dispatch across the four `consume*` helpers above, tried in order — each
 * returns the resume index on a match or `null` to fall through to the next. `consumeText` always
 * matches, so the chain always terminates.
 *
 * @param required.html Raw HTML, a full document or a fragment. Malformed input (an unmatched `<`, an
 * unclosed tag) degrades to treating the offending character as literal text rather than throwing —
 * this function must never fail on already-broken content.
 */
function tokenizeHtml({ html }: { html: string }, _options = {}): Token[] {
  const tokens: Token[] = [];
  const length = html.length;
  let i = 0;

  while (i < length) {
    i =
      consumeComment({ html, i, length, tokens }) ??
      consumeDoctype({ html, i, length, tokens }) ??
      consumeTag({ html, i, length, tokens }) ??
      consumeText({ html, i, length, tokens });
  }

  return tokens;
}

/** Whether `token` is a CLOSING tag for a block element — {@link prettifyHtml}'s own stack-pop
 *  trigger, split out (with {@link isOpeningBlockTag} and {@link isZeroGapBlockBoundary} below) so
 *  their `&&` chains score against these small top-level predicates instead of `prettifyHtml` itself.
 *  A type predicate (not a plain `boolean`) so callers that check this before reading `token.name`
 *  (there's no `name` on the `"other"` branch of {@link Token}) keep that narrowing. */
function isClosingBlockTag(token: Token): token is Extract<Token, { kind: "tag" }> {
  return token.kind === "tag" && token.tagKind === "close" && BLOCK_ELEMENTS.has(token.name);
}

/** Whether `token` is an OPENING tag for a block element that isn't void — {@link prettifyHtml}'s own
 *  stack-push trigger (a void element has no children to indent, so it never opens a new depth). */
function isOpeningBlockTag(token: Token): token is Extract<Token, { kind: "tag" }> {
  return (
    token.kind === "tag" &&
    token.tagKind === "open" &&
    BLOCK_ELEMENTS.has(token.name) &&
    !VOID_ELEMENTS.has(token.name)
  );
}

/** The one place {@link prettifyHtml} inserts whitespace: two block-element tags with zero characters
 *  between them in the source — see the file header for why this specific boundary is safe to fill.
 *  `prev === undefined` (the very first token) replaces the original `idx > 0` guard: `tokens[-1]` is
 *  already `undefined` in JS, so the caller can pass `tokens[idx - 1]` directly without computing `idx > 0`. */
function isBlockTag(token: Token): boolean {
  return token.kind === "tag" && BLOCK_ELEMENTS.has(token.name);
}

function isZeroGapBlockBoundary({ prev, token }: { prev: Token | undefined; token: Token }, _options = {}): boolean {
  return prev !== undefined && isBlockTag(prev) && isBlockTag(token);
}

/**
 * Pretty-prints HTML for display/editing in the Pages editor's HTML tab: indents nested block
 * elements onto their own lines, tree-style, without touching any text content, inline markup, or
 * `<pre>`/`<script>`/`<style>`/`<textarea>` bodies. See the file header for the exact safety rule
 * (zero-gap, both-sides-block boundaries only) and why it is safe to apply even though the result
 * can be saved as the page's real stored HTML.
 *
 * Idempotent: running it twice produces the same output as running it once (no zero-gap boundaries
 * remain after the first pass, since every insertion point it would touch is filled).
 *
 * @param required.html Raw HTML, a full document or a fragment. `""` returns `""`.
 * @returns The same markup with added structural whitespace only.
 */
export function prettifyHtml({ html }: { html: string }, _options = {}): string {
  if (html === "") return html;

  const tokens = tokenizeHtml({ html });
  const stack: string[] = [];
  let depth = 0;
  let out = "";

  for (const [idx, token] of tokens.entries()) {

    // Mirrors `prettifyCss`'s `}` handling: a closing tag renders at its PARENT's depth, so the
    // stack pops (and depth drops) before this token's own indent is computed below.
    if (isClosingBlockTag(token) && stack[stack.length - 1] === token.name) {
      stack.pop();
      depth = Math.max(0, depth - 1);
    }

    if (isZeroGapBlockBoundary({ prev: tokens[idx - 1], token })) {
      out += "\n" + INDENT.repeat(depth);
    }

    out += token.text;

    if (isOpeningBlockTag(token)) {
      stack.push(token.name);
      depth++;
    }
  }

  return out;
}
