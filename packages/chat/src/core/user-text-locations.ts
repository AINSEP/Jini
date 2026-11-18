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

/** Finder for the location holding a candidate token. Candidates must be asked in increasing start order, as a
 * `String.replace` callback visits them. A URL, quoted path or rooted path wins over the rootless identifier path.
 * @complexity O(n) for the spans of an n-character text, then O(1) amortized per candidate. */
export function locationFinder({ text }: { readonly text: string }): (start: number, end: number) => { readonly url: boolean } | undefined {
  // Only quoted paths may contain whitespace; unquoted paths and URLs end there, and at , | ; and invisible
  // separators, so an adjacent secret glued after them cannot inherit the exemption.
  // A quoted path ends at its first matching quote, which must sit on a word boundary, so an
  // apostrophe later in the line ("don't") cannot close an unterminated quote and exempt the gap.
  // Require a root boundary so a slash inside an opaque token cannot exempt that token, and a
  // folder after the root so a bare "/" + token is not mistaken for a path.
  const rooted: Span[] = [...text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`,|;\u200B-\u200D\uFEFF]+|(?<!\w)(["'`])(?:~\/|[a-z]:[\\/]|\\\\|\/)[^\r\n"'`\\/]+[\\/](?:(?!\1)[^\r\n])*\1(?!\w)|(?<![\w+\/=\\~.-])(?:~\/|[a-z]:[\\/]|\\\\|\/)[^\s<>"'`,|;\u200B-\u200D\uFEFF\\/]+[\\/][^\s<>"'`,|;\u200B-\u200D\uFEFF]*/gi)]
    .map(match => ({ start: match.index!, end: match.index! + match[0].length, url: /^[a-z][a-z0-9+.-]*:\/\//i.test(match[0]) }));
  // The part of a hand-typed unquoted path after a space (Work/CustomerPortal…) has no root.
  const rootless: Span[] = [...text.matchAll(/[^\s<>"'`,|;\u200B-\u200D\uFEFF]+/g)]
    .filter(match => isIdentifierPath({ text: match[0] }))
    .map(match => ({ start: match.index!, end: match.index! + match[0].length, url: false }));
  const inRooted = sweep(rooted);
  const inRootless = sweep(rootless);
  return (start, end) => inRooted(start, end) ?? inRootless(start, end);
}
