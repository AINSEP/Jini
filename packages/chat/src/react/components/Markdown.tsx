/**
 * @module Markdown
 *
 * A pocket-sized markdown renderer for assistant chat message text. No
 * `dangerouslySetInnerHTML` — output is a tree of typed React elements, so
 * untrusted text can't smuggle markup through.
 *
 * DELIBERATE SUBSET, not a full port: OD's `runtime/markdown.tsx` (734
 * lines) additionally handles a code-comment directive syntax — reasonable
 * follow-up work, left out here since no host has a concrete requirement
 * for it yet. Fenced code blocks DO now carry a per-block copy button
 * (`CopyCodeButton` below), reusing `useCopyToClipboard`
 * (`../hooks/useCopyToClipboard.js`) — the same hook `MessageRow.tsx`'s
 * per-message copy button is built on, so both share one secure-context/
 * fallback implementation. The two stay separate *components*, not one
 * shared button: a per-message copy sits in a `.jini-message-actions` row
 * alongside future branch/feedback siblings, while a per-block copy sits
 * on the code block itself and copies only that block's own source, not
 * the whole message — different placement and different copy scope, so a
 * shared component would mean threading scope-specific behavior through a
 * control neither call site actually wants generic. This renderer now
 * also covers GFM pipe tables — ported from OD's `runtime/markdown.tsx`
 * (`splitTableCells`/`parseTableAlignRow`/table block parsing and
 * rendering), including a wide-table pop-out (`TableBlock` below): a table
 * whose rendered width exceeds its own box gets an "Expand table" affordance
 * that reopens it full-size in a native `<dialog>`, mirroring the same
 * overflow-detection + `<dialog>` pattern one existing downstream admin host
 * already built for its own "Show in modal" affordance on other overflowing
 * content (a matched `useOverflowDetection` hook + native-`<dialog>` modal
 * pair) — kept as a *self-contained* copy here rather than an import, since
 * `@jini-ai/chat` cannot depend on a downstream host package, and every
 * other Jini host gets the same affordance this way. Everything else this
 * renderer covers:
 * ATX headings (`#`…`###`), fenced code blocks, ordered/unordered lists,
 * blockquotes, a horizontal rule, paragraphs, and inline `` `code` ``/
 * `**bold**`/`*italic*`/bare autolinks — including inside table cells, via
 * the same `renderInline` pass every other block uses. TODO(follow-up): port
 * the code-comment directive syntax once a host needs it.
 */
import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js';
import { useT } from '../hooks/context.js';
import { Icon } from './Icon.js';

export interface MarkdownProps {
  children: string;
}

type TableAlign = 'left' | 'right' | 'center' | null;

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'bq'; text: string }
  | { kind: 'code'; lang: string | null; body: string }
  | { kind: 'table'; aligns: TableAlign[]; headers: string[]; rows: string[][] }
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

// GFM pipe-table cell split, ported verbatim (logic-for-logic) from OD's
// `runtime/markdown.tsx`. Walks char-by-char rather than a naive `split('|')`
// so it can honor three cell-content rules without placeholder substitution:
// `\|` is a literal pipe inside a cell, a `|` inside a backtick code span is
// cell content rather than a column boundary, and a single optional leading
// `|` plus an unescaped trailing `|` are row terminators, not empty cells.
function splitTableCells(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  if (line[i] === '|') i++;
  for (; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (ch === '`') {
      inCode = !inCode;
      cur += ch;
      continue;
    }
    if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (cells.length === 0 || tail !== '') cells.push(tail);
  return cells;
}

// Recognizes a GFM alignment row (`| --- | :---: | ---: |`) and returns the
// per-column alignment, or `null` if `line` isn't one — used both to detect
// where a table starts and to read its column alignment.
function parseTableAlignRow(line: string): TableAlign[] | null {
  if (!line.includes('|')) return null;
  const cells = splitTableCells(line);
  if (cells.length === 0) return null;
  const aligns: TableAlign[] = [];
  for (const cell of cells) {
    if (!/^:?-{1,}:?$/.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
  }
  return aligns;
}

// A table starts at `i` when `lines[i]` is a pipe-bearing header row
// immediately followed by a valid alignment row at `lines[i + 1]`.
function isTableStartAt(lines: string[], i: number): boolean {
  const header = lines[i];
  const sep = lines[i + 1];
  if (header === undefined || sep === undefined) return false;
  if (!header.includes('|')) return false;
  return parseTableAlignRow(sep) !== null;
}

// Collects the body rows following a table's header + alignment row —
// every subsequent non-blank, pipe-bearing line, matching OD's greedy
// table-body rule. Called only once `isTableStartAt` has confirmed `i`
// through `i + 1` are the header/alignment pair; returns the new cursor.
function collectTableRows(lines: string[], start: number): { rows: string[][]; next: number } {
  const rows: string[][] = [];
  let i = start;
  while (i < lines.length) {
    const row = lines[i];
    if (row === undefined || row.trim() === '' || !row.includes('|')) break;
    rows.push(splitTableCells(row));
    i++;
  }
  return { rows, next: i };
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
    if (isTableStartAt(lines, i)) {
      const aligns = parseTableAlignRow(lines[i + 1]!)!;
      const headers = splitTableCells(line);
      const { rows, next } = collectTableRows(lines, i + 2);
      blocks.push({ kind: 'table', aligns, headers, rows });
      i = next;
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
    while (i < lines.length && lines[i]!.trim() !== '' && !isBlockStart(lines, i)) {
      paragraph.push(lines[i]!);
      i += 1;
    }
    blocks.push({ kind: 'p', text: paragraph.join('\n') });
  }
  return blocks;
}

function isBlockStart(lines: string[], i: number): boolean {
  const line = lines[i]!;
  return (
    /^```/.test(line)
    || /^(#{1,3})\s+/.test(line)
    || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    || /^>\s?/.test(line)
    || /^\s*[-*]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || isTableStartAt(lines, i)
  );
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
      return <CodeBlock lang={block.lang} body={block.body} />;
    case 'table':
      return <TableBlock aligns={block.aligns} headers={block.headers} rows={block.rows} />;
    case 'hr':
      return <hr />;
  }
}

interface CodeBlockProps {
  lang: string | null;
  body: string;
}

// Fenced code block ('renderBlock' case 'code') plus its copy affordance. 'CopyCodeButton' below
// sits in its own small toolbar row above the '<pre>', not overlaid on top of it: an overlay
// button would sit over whatever code happens to render at that corner, and '.jini-message-
// content pre' already carries its own horizontal scrollbar at the bottom of the element -- a
// separate row above avoids colliding with either.
function CodeBlock({ lang, body }: CodeBlockProps): ReactNode {
  return (
    <div className="jini-md-code-block">
      <div className="jini-md-code-toolbar">
        <CopyCodeButton code={body} />
      </div>
      <pre>
        <code data-lang={lang ?? undefined}>{body}</code>
      </pre>
    </div>
  );
}

interface CopyCodeButtonProps {
  /** The fenced block's exact source text -- never a DOM/innerText read, so it survives the round trip byte-for-byte (indentation, trailing spaces, any markup-like characters inside the fence). */
  code: string;
}

// Per-block copy affordance for CodeBlock above. Mirrors MessageRow.tsx's CopyMessageButton
// one-for-one in shape -- same hook, same icon swap, same visually-hidden aria-live announce --
// but stays its own component rather than a shared one; see this module's header comment for why.
function CopyCodeButton({ code }: CopyCodeButtonProps): ReactNode {
  const t = useT();
  const { copied, copy } = useCopyToClipboard();
  return (
    <>
      <button
        type="button"
        className="jini-md-code-copy"
        aria-label={copied ? t('Copied') : t('Copy code')}
        onClick={() => {
          void copy(code);
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
      {/* Visually hidden, not decorative -- same reasoning as MessageRow.tsx's own copy-status
          span: the icon swap above says nothing to a screen reader on its own. */}
      <span className="jini-md-code-copy-status" aria-live="polite">
        {copied ? t('Copied to clipboard') : ''}
      </span>
    </>
  );
}

interface TableBlockProps {
  aligns: TableAlign[];
  headers: string[];
  rows: string[][];
}

// Renders the `<table>` element itself — shared between the inline (possibly
// scroll-clipped) copy and the pop-out modal's full-size copy, so the two
// never drift. Each cell goes through the same `renderInline` pass every
// other block uses, so `**bold**`/`` `code` ``/links inside a cell render as
// markup rather than literal text.
function renderTableElement({ aligns, headers, rows }: TableBlockProps): ReactNode {
  const cellStyle = (idx: number): { textAlign: 'left' | 'right' | 'center' } | undefined => {
    const align = aligns[idx];
    return align ? { textAlign: align } : undefined;
  };
  return (
    <table className="jini-md-table">
      <thead>
        <tr>
          {headers.map((cell, idx) => (
            <th key={idx} style={cellStyle(idx)}>{renderInline(cell)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {headers.map((_, cellIndex) => (
              <td key={cellIndex} style={cellStyle(cellIndex)}>{renderInline(row[cellIndex] ?? '')}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Width-only overflow check for the table wrap below — a *deliberately*
// narrower copy of the downstream host's own overflow-detection hook (see
// this file's own module doc), same `ResizeObserver` + mount-time-check
// shape, not an import of it: this package cannot depend on a downstream
// host's app code, and a table can only ever overflow horizontally (its
// wrap never constrains height), so this version skips that hook's
// vertical-axis branch entirely.
const TABLE_OVERFLOW_SLACK_PX = 1;

function useTableOverflow(): { wrapRef: RefObject<HTMLDivElement | null>; isOverflowing: boolean } {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const check = () => setIsOverflowing(el.scrollWidth > el.clientWidth + TABLE_OVERFLOW_SLACK_PX);
    const observer = new ResizeObserver(check);
    observer.observe(el);
    check();
    return () => observer.disconnect();
  }, []);

  return { wrapRef, isOverflowing };
}

// Wide-table pop-out: the inline table always renders (scroll-clipped by its
// own `.jini-md-table-wrap` if wider than the message column), and once it
// genuinely overflows its own box an "Expand table" button appears to reopen
// it full-size in a native `<dialog>` — same open/close/backdrop/Escape
// lifecycle as the downstream host's own overflow-modal component (see this
// file's own module doc), kept self-contained here for the same reason
// `useTableOverflow` above is: no downstream-host dependency, and every
// Jini host gets the affordance.
// `<dialog>`'s `showModal`/`close` methods are unimplemented in jsdom (and on any real browser too
// old to support the element at all) — falls back to the plain `open` attribute in either case,
// same guarded fallback shape that host component's own dialog lifecycle hook uses for the
// identical reason.
function openTableDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
    return;
  }
  dialog.setAttribute('open', '');
}

function closeTableDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === 'function') {
    if (dialog.open) dialog.close();
    return;
  }
  dialog.removeAttribute('open');
}

function TableBlock(props: TableBlockProps): ReactNode {
  const { wrapRef, isOverflowing } = useTableOverflow();
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (expanded) openTableDialog(dialog);
    else closeTableDialog(dialog);
  }, [expanded]);

  return (
    <div className="jini-md-table-block">
      <div className="jini-md-table-wrap" ref={wrapRef}>
        {renderTableElement(props)}
      </div>
      {isOverflowing ? (
        <button type="button" className="jini-md-table-expand" onClick={() => setExpanded(true)}>
          Expand table
        </button>
      ) : null}
      <dialog
        ref={dialogRef}
        className="jini-md-table-modal"
        onCancel={(e) => {
          e.preventDefault();
          setExpanded(false);
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) setExpanded(false);
        }}
      >
        <button type="button" className="jini-md-table-modal-close" onClick={() => setExpanded(false)} aria-label="Close">
          ×
        </button>
        <div className="jini-md-table-modal-body">{expanded ? renderTableElement(props) : null}</div>
      </dialog>
    </div>
  );
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
