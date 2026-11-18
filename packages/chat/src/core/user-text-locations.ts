/**
 * @module user-text-locations
 *
 * Where in a user message a long token is a location (a URL, a file path, an identifier path) rather than a
 * secret. The spans are found once and then answered as a sorted sweep, so every opaque-token candidate costs
 * O(1) amortized instead of a scan over all spans (quadratic on a long message with many of both). No I/O.
 */

/** Recognize identifier paths, including the fragment after a space in a typed path.
 * Require multiple segments and readable words: arbitrary base64 and long digit-mixed runs
 * must still reach the entropy guard. Specific credential rules have already run. */
function isIdentifierPath({ text }: { readonly text: string }, _options = {}): boolean {
  const segments = text.replace(/^(?:[a-z]:|~)?[\\/]*/i, '').split(/[\\/]/).filter(Boolean);
  return segments.length >= 2 && segments.every(segment =>
    /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/.test(segment)
    || segment.split(/[-_.]/).every(word => /^[A-Z]$/.test(word)
      || /^[A-Z]?[a-z]{2,}(?:[A-Z][a-z]{2,}|[0-9]{1,4}(?=[A-Z][a-z]{2,}|$))*$/.test(word)));
}

interface Span {
  readonly start: number;
  readonly end: number;
  readonly url: boolean;
}

/** `contains(start, end)`: the first span holding `[start, end)`. Spans must be disjoint and sorted by start (what a
 * global regex match list is) and queries must not move backwards: the only span that can hold a query is the first
 * one ending after its start, since every later span starts at or after that one's end. A span is skipped for good
 * once it ends at or before a query's start, so all queries together cost O(spans + queries).
 * @complexity O(spans + queries) over all calls. */
function sweep(spans: readonly Span[]): (start: number, end: number) => Span | undefined {
  let next = 0;
  return (start, end) => {
    while (next < spans.length && spans[next]!.end <= start) next++;
    const span = spans[next];
    return span && span.start <= start && span.end >= end ? span : undefined;
  };
}

// Only quoted paths may contain whitespace; unquoted paths and URLs end there, and at , | ; and invisible
// separators, so an adjacent secret glued after them cannot inherit the exemption.
// A quoted path ends at its first matching quote, which must sit on a word boundary, so an
// apostrophe later in the line ("don't") cannot close an unterminated quote and exempt the gap.
// Require a root boundary so a slash inside an opaque token cannot exempt that token, and a
// folder after the root so a bare "/" + token is not mistaken for a path.
const PATH_SOURCE = String.raw`(?<!\w)(["'\x60])(?:~\/|[a-z]:[\\/]|\\\\|\/)[^\r\n"'\x60\\/]+[\\/](?:(?!\1)[^\r\n])*\1(?!\w)|(?<![\w+\/=\\~.-])(?:~\/|[a-z]:[\\/]|\\\\|\/)[^\s<>"'\x60,|;\u200B-\u200D\uFEFF\\/]+[\\/][^\s<>"'\x60,|;\u200B-\u200D\uFEFF]*`;
const URL_REST = /:\/\/[^\s<>"'`,|;\u200B-\u200D\uFEFF]+/y;
const SCHEME_CHAR = /[A-Za-z0-9+.-]/;

/** Start of the scheme whose `://` sits at `colon`, or -1: the leftmost letter in the run of scheme characters before
 * it that starts a word (the run's first character after a non-word character, or a letter after `.`, `+` or `-`).
 * This is where the former `\b[a-z][a-z0-9+.-]*:\/\/` match began, but each run is walked once from its `://` instead of
 * being re-read from every word boundary inside it, which was quadratic on a long run such as `a.a.a...`.
 * @complexity O(run length). */
function schemeStart(text: string, colon: number): number {
  let runStart = colon;
  while (runStart > 0 && SCHEME_CHAR.test(text[runStart - 1]!)) runStart -= 1;
  for (let at = runStart; at < colon; at += 1) {
    const startsWord = at === runStart ? !/\w/.test(text[at - 1] ?? '') : /[+.-]/.test(text[at - 1]!);
    if (startsWord && /[A-Za-z]/.test(text[at]!)) return at;
  }
  return -1;
}

/** URL spans, found from each `://`; one inside an earlier URL belongs to it. @complexity O(n). */
function urlSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (let colon = text.indexOf('://'); colon !== -1; colon = text.indexOf('://', colon + 1)) {
    if (colon < (spans.at(-1)?.end ?? 0)) continue;
    const start = schemeStart(text, colon);
    URL_REST.lastIndex = colon;
    const rest = URL_REST.exec(text);
    if (start !== -1 && rest) spans.push({ start, end: colon + rest[0].length, url: true });
  }
  return spans;
}

/** URLs and rooted or quoted paths as one left-to-right scan: the earliest match wins and the scan resumes at its end,
 * a URL winning a tie, exactly as one alternation regex with the URL first would read them.
 * @complexity O(n): each URL and each path match is visited once. */
function rootedSpans(text: string): Span[] {
  const urls = urlSpans(text);
  const paths = new RegExp(PATH_SOURCE, 'gi');
  const nextPath = (from: number): Span | undefined => {
    paths.lastIndex = from;
    const match = paths.exec(text);
    return match ? { start: match.index, end: match.index + match[0].length, url: false } : undefined;
  };
  const spans: Span[] = [];
  let path = nextPath(0);
  for (let at = 0, u = 0; ;) {
    while (u < urls.length && urls[u]!.start < at) u += 1;
    if (path && path.start < at) path = nextPath(at);
    const url = urls[u];
    const next = url && (!path || url.start <= path.start) ? url : path;
    if (!next) return spans;
    spans.push(next);
    at = next.end;
  }
}

/** Finder for the location holding a candidate token. Candidates must be asked in increasing start order, as a
 * `String.replace` callback visits them. A URL, quoted path or rooted path wins over the rootless identifier path.
 * @complexity O(n) for the spans of an n-character text, then O(1) amortized per candidate. */
export function locationFinder({ text }: { readonly text: string }): (start: number, end: number) => { readonly url: boolean } | undefined {
  const rooted = rootedSpans(text);
  // The part of a hand-typed unquoted path after a space (Work/CustomerPortal…) has no root.
  const rootless: Span[] = [...text.matchAll(/[^\s<>"'`,|;\u200B-\u200D\uFEFF]+/g)]
    .filter(match => isIdentifierPath({ text: match[0] }))
    .map(match => ({ start: match.index!, end: match.index! + match[0].length, url: false }));
  const inRooted = sweep(rooted);
  const inRootless = sweep(rootless);
  return (start, end) => inRooted(start, end) ?? inRootless(start, end);
}
