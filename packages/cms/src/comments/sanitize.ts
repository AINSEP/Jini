/**
 * @file A comments-scoped body sanitizer (SPEC-033 Non-Goals — no shared core `text` library
 * exists anywhere in this codebase for this to extract into; ADR-031 §2/§4's "core `text`
 * library" reference is design-forward, not something this spec can reuse). Strips HTML tags
 * entirely (comments render as plain text, never `dangerouslySetInnerHTML`-equivalent raw HTML on
 * any read path this spec builds) and collapses excess whitespace. Bounded, non-Turing-complete —
 * a fixed regex pass, not a parser.
 */
const TAG_PATTERN = /<[^>]*>/g;
const EXCESS_WHITESPACE = /[ \t]{2,}/g;
const EXCESS_BLANK_LINES = /\n{3,}/g;

/** Strips tags and normalizes whitespace; returns plain text without mutating the input.
 * @complexity O(n) time and space for n input characters.
 * @example sanitizeCommentBody({ raw: "<b>Hello</b>" }, {})
 */
export function sanitizeCommentBody({ raw }: { raw: string }, _optional: Record<string, never> = {}): string {
  return raw
    .replace(TAG_PATTERN, "")
    .replace(EXCESS_WHITESPACE, " ")
    .replace(EXCESS_BLANK_LINES, "\n\n")
    .trim();
}

const LINK_PATTERN = /https?:\/\/\S+/gi;

/** Counts HTTP(S) links in text; performs no I/O.
 * @complexity O(n) time and space for n input characters.
 * @example countLinks({ text: "https://example.com" }, {})
 */
export function countLinks({ text }: { text: string }, _optional: Record<string, never> = {}): number {
  return (text.match(LINK_PATTERN) ?? []).length;
}
