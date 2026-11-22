/**
 * @file Plain text -> paragraph/list blocks, for author prose that arrives as one JSON string
 * (`plugin.json` `description`/`extensions.jini.summary`, a skill's frontmatter `description`).
 * Rendered as one `<p>` with `white-space: normal` that prose collapsed into a single wall of text
 * however the author broke it. Text only: the blocks hold strings that React escapes on render, so
 * nothing here can turn into markup.
 */

export type PlainTextBlock = { kind: "paragraph"; lines: string[] } | { kind: "list"; items: string[] };

const BULLET = /^[-*•]\s+/;

/**
 * Blank lines separate blocks; inside a block a single newline is a line break. A block whose every
 * line starts with `- `, `* ` or `• ` is a list. Lines are trimmed and blank blocks dropped.
 *
 * @complexity O(n) in the text's length.
 */
export function toPlainTextBlocks({ text }: { text: string | null | undefined }, _options = {}): PlainTextBlock[] {
  if (!text) return [];
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((chunk) => chunk.split("\n").map((line) => line.trim()).filter((line) => line !== ""))
    .filter((lines) => lines.length > 0)
    .map((lines): PlainTextBlock =>
      lines.every((line) => BULLET.test(line))
        ? { kind: "list", items: lines.map((line) => line.replace(BULLET, "")) }
        : { kind: "paragraph", lines },
    );
}
