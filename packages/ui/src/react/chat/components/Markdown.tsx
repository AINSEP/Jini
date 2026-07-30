/**
 * @module Markdown
 *
 * A pocket-sized markdown renderer for assistant chat message text. No
 * `dangerouslySetInnerHTML` — output is a tree of typed React elements, so
 * untrusted text can't smuggle markup through.
 *
 * DELIBERATE SUBSET, not a full port: OD's `runtime/markdown.tsx` (734
 * lines) additionally handles GFM pipe tables, a code-comment directive
 * syntax, and per-block copy-to-clipboard affordances tied to OD's
 * `lib/copy-to-clipboard` + `Icon` — all reasonable follow-up work, left out
 * here to land the core hook/component/slot surface first. This renderer
 * covers what most assistant turns actually use: ATX headings (`#`…`###`),
 * fenced code blocks, ordered/unordered lists, blockquotes, a horizontal
 * rule, paragraphs, and inline `` `code` ``/`**bold**`/`*italic*`/bare
 * autolinks. TODO(follow-up): port GFM tables + per-block copy button once
 * this component has a real host to validate against.
 */
import { Fragment, type ReactNode } from 'react';

export interface MarkdownProps {
  children: string;
}

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'bq'; text: string }
  | { kind: 'code'; lang: string | null; body: string }
  | { kind: 'hr' };

export function Markdown({ children }: MarkdownProps) {
  const blocks = parseBlocks(children);
  return (
    <>
      {blocks.map((block, i) => (
        <Fragment key={i}>{renderBlock(block)}</Fragment>
      ))}
    </>
  );
}

function parseBlocks(input: string): Block[] {
  const lines = input.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  // Every `lines[i]` access below is guarded by an `i < lines.length` check
  // (either this loop's own condition or an inner `while`'s left-hand
  // operand, short-circuited before the index is read) — `lines` is a
  // `string[]` from `String.prototype.split`, which never contains
  // `undefined` entries, so the index is always in range and always a
  // string. The `?? ''`/non-null-assertion sites below are TS-only
  // fallbacks for `noUncheckedIndexedAccess`-style indexing with no real
  // runtime path; using `!` documents that instead of instrumenting an
  // unreachable branch (same convention as `ToolCard.tsx`'s `baseName`
  // comment).
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim() || null;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // skip closing fence (or end of input if unterminated)
      blocks.push({ kind: 'code', lang, body: body.join('\n') });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      // Both capture groups are mandatory (non-optional) in this pattern, so
      // whenever `heading` itself is truthy, `heading[1]`/`heading[2]` are
      // always matched strings (never `undefined`) — same dead-fallback
      // reasoning as the `lines[i]` accesses above.
      blocks.push({ kind: 'h', level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! });
      i += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        quoted.push(lines[i]!.replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'bq', text: quoted.join('\n') });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+[.)]\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !isBlockStart(lines[i]!)) {
      paragraph.push(lines[i]!);
      i += 1;
    }
    blocks.push({ kind: 'p', text: paragraph.join('\n') });
  }
  return blocks;
}

function isBlockStart(line: string): boolean {
  return /^```/.test(line) || /^(#{1,3})\s+/.test(line) || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line) || /^>\s?/.test(line) || /^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line);
}

function renderBlock(block: Block): ReactNode {
  switch (block.kind) {
    case 'h': {
      const Tag = (`h${block.level}` as const) as 'h1' | 'h2' | 'h3';
      return <Tag>{renderInline(block.text)}</Tag>;
    }
    case 'p':
      return <p>{renderInline(block.text)}</p>;
    case 'ul':
      return (
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      );
    case 'bq':
      return <blockquote>{renderInline(block.text)}</blockquote>;
    case 'code':
      return (
        <pre>
          <code data-lang={block.lang ?? undefined}>{block.body}</code>
        </pre>
      );
    case 'hr':
      return <hr />;
  }
}

// Inline pass: `code`, **bold**, *italic*/_italic_, bare http(s) autolinks.
// Processes left-to-right with a single regex alternation so spans never
// nest incorrectly across kinds.
const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(https?:\/\/[^\s)]+)/g;

function renderInline(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null = INLINE_RE.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [whole, code, bold, italic, link] = match;
    if (code) nodes.push(<code key={key++}>{code.slice(1, -1)}</code>);
    else if (bold) nodes.push(<strong key={key++}>{bold.slice(2, -2)}</strong>);
    else if (italic) nodes.push(<em key={key++}>{italic.slice(1, -1)}</em>);
    else if (link)
      nodes.push(
        <a key={key++} href={link} target="_blank" rel="noreferrer">
          {link}
        </a>,
      );
    // `whole` is `match[0]` — a successful `RegExpExecArray` always has a
    // defined (if possibly empty) full-match string at index 0, so this
    // fallback is unreachable (same dead-fallback reasoning as above).
    lastIndex = match.index + whole!.length;
    match = INLINE_RE.exec(text);
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
