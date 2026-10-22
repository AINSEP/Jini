/**
 * @module strip
 *
 * Post-stream `<artifact>` removal/summarization and the streaming-display
 * counterpart that surfaces an in-flight (not-yet-closed) artifact block.
 */
import { computeSkipRanges, isRealArtifactOpenAt, rangeContains, type Range } from './markdown-context.js';
import { parseQuotedAttrs } from './markup-attributes.js';
import {
  recoverHtmlArtifactFromPrecedingDocument,
  recoverHtmlDocumentFromMarkdownFence,
  recoverStandaloneHtmlDocument,
} from './recover.js';

const OPEN = '<artifact';
const CLOSE = '</artifact>';
const HTML_FENCE_RE = /```(?:html|HTML)\s*\n([\s\S]*?)\n```/g;

type MarkdownFenceRange = { start: number; end: number; html: string };

function findUnskipped(content: string, needle: string, fromIndex: number, ranges: ReadonlyArray<Range>): number {
  let from = fromIndex;
  // `needle` (always `CLOSE`, non-empty) makes `content.indexOf` itself
  // return -1 once `from` runs past `content.length` — the loop always exits
  // through the `idx === -1` check below, so no bounded `while` or trailing
  // fallback return is needed for this to provably terminate.
  for (;;) {
    const idx = content.indexOf(needle, from);
    if (idx === -1) return -1;
    if (!rangeContains({ ranges: ranges, p: idx })) return idx;
    from = idx + needle.length;
  }
}

// Like `findUnskipped(OPEN, …)` but also rejects prefix-shared literals like
// `<artifactual` — only `<artifact` followed by whitespace counts as a real
// protocol open. Matches the streaming parser's `findOpenTag` real-open guard
// so the two paths agree on what a renderer will treat as a tag.
function findRealOpen(content: string, fromIndex: number, ranges: ReadonlyArray<Range>): number {
  let from = fromIndex;
  // Same reasoning as findUnskipped: `OPEN` is a fixed non-empty literal, so
  // `content.indexOf` alone provides the bound safety once `from` runs past
  // `content.length` — no separate bounded `while` is needed.
  for (;;) {
    const idx = content.indexOf(OPEN, from);
    if (idx === -1) return -1;
    if (rangeContains({ ranges: ranges, p: idx }) || !isRealArtifactOpenAt({ content: content, idx: idx })) {
      from = idx + OPEN.length;
      continue;
    }
    return idx;
  }
}

// For complete (non-streaming) content, an unclosed fence renders as a code
// block extending to end of input — the stripper mirrors that, otherwise a
// literal `<artifact …>` tucked into a trailing code example (no trailing
// newline) gets treated as a real protocol tag and eaten.
function completeContentSkipRanges({ content }: { content: string }): Range[] {
  const { ranges, unclosedFenceStart } = computeSkipRanges({ buffer: content });
  return unclosedFenceStart !== null ? [...ranges, [unclosedFenceStart, content.length]] : ranges;
}

/** Positions of a complete real block: its `<artifact`, the open tag's `>`, and its `</artifact>`. */
type ArtifactBlock = { open: number; openEnd: number; close: number };

/**
 * The first complete real `<artifact …>…</artifact>` block at or after
 * `fromIndex`, or `null` when there is no real open, the open tag never
 * terminates with `>`, or no real close follows it.
 */
function findCompleteArtifactBlock(
  { content, ranges }: { content: string; ranges: ReadonlyArray<Range> },
  { fromIndex = 0 }: { fromIndex?: number } = {},
): ArtifactBlock | null {
  const open = findRealOpen(content, fromIndex, ranges);
  if (open === -1) return null;
  const openEnd = content.indexOf('>', open);
  if (openEnd === -1) return null;
  const close = findUnskipped(content, CLOSE, openEnd, ranges);
  return close === -1 ? null : { open, openEnd, close };
}

/**
 * Remove the first real `<artifact …>…</artifact>` block from `content`.
 *
 * "Real" excludes any `<artifact` substring that a Markdown-rendering chat
 * surface would render as inline code or part of a fenced code block —
 * those are literal recitations of the protocol and must survive intact,
 * otherwise a rendered reply gets silently truncated mid-explanation.
 *
 * If no real open tag exists, `content` is returned unchanged. If a real
 * open exists but no matching real close is found, `content` is also
 * returned unchanged (refusing to strip is safer than truncating to
 * end-of-string when a tag is malformed or still streaming).
 *
 * @complexity O(n) in `content.length` — one skip-range computation plus a
 *   pair of linear scans for the open/close tags.
 */
export function stripArtifact({ content }: { content: string }): string {
  const block = findCompleteArtifactBlock({ content, ranges: completeContentSkipRanges({ content }) });
  if (!block) return content;
  return (content.slice(0, block.open) + content.slice(block.close + CLOSE.length)).trim();
}

function findSingleRecoverableHtmlFence(content: string): MarkdownFenceRange | null {
  HTML_FENCE_RE.lastIndex = 0;
  let recovered: MarkdownFenceRange | null = null;
  let count = 0;
  let match: RegExpExecArray | null = HTML_FENCE_RE.exec(content);
  while (match !== null) {
    const html = (match[1] || '').replace(/^﻿/, '').trim();
    if (recoverHtmlDocumentFromMarkdownFence({ sourceText: match[0] }) === html) {
      recovered = { start: match.index, end: match.index + match[0].length, html };
      count += 1;
    }
    match = HTML_FENCE_RE.exec(content);
  }
  return count === 1 ? recovered : null;
}

function findRecoverablePrecedingHtmlArtifact(sourceText: string): string | null {
  const ranges = completeContentSkipRanges({ content: sourceText });

  let from = 0;
  // `findRealOpen` already returns -1 once `from` runs past `sourceText.length`
  // (it inherits the same `indexOf`-based bound safety), so this loop also
  // always exits through an inner return — no trailing fallback needed.
  for (;;) {
    const block = findCompleteArtifactBlock({ content: sourceText, ranges }, { fromIndex: from });
    if (!block) return null;

    const attrs = parseQuotedAttrs({ raw: sourceText.slice(block.open, block.openEnd) });
    const recovered = recoverHtmlArtifactFromPrecedingDocument({
      artifactHtml: sourceText.slice(block.openEnd + 1, block.close),
      identifier: attrs['identifier'],
      sourceText,
    });
    if (recovered) return recovered;

    from = block.close + CLOSE.length;
  }
}

function stripRecoverablePrecedingHtml(content: string, sourceText: string): string | null {
  const recovered = findRecoverablePrecedingHtmlArtifact(sourceText);
  if (!recovered) return null;

  const start = content.lastIndexOf(recovered);
  if (start === -1) return null;

  return `${content.slice(0, start)}${content.slice(start + recovered.length)}`.trim();
}

/**
 * Display-only cleanup for a fallback shape some models emit: a complete
 * HTML document as a standalone reply, or as a single ```html fenced block,
 * instead of using the `<artifact>` protocol. A host that persists that
 * recovered document as a real file (see `resolvePersistedArtifactHtml` in
 * `./recover.js`) uses this helper to remove the now-duplicate raw document
 * from the rendered chat bubble.
 *
 * Must never be used to rewrite the canonical stored message content — only
 * the *display* copy — because that content is the transcript future agent
 * turns and forked conversations read from.
 *
 * @complexity O(n) in `content.length` (plus one bounded regex scan over `sourceText` for the fence-recovery path).
 */
export function stripRecoveredHtmlFallbackForDisplay({ content }: { content: string }, { sourceText = content }: { sourceText?: (string) | undefined } = {}): string {
  const withoutPrecedingDocument = stripRecoverablePrecedingHtml(content, sourceText);
  if (withoutPrecedingDocument !== null) return withoutPrecedingDocument;

  if (recoverStandaloneHtmlDocument({ sourceText: content })) return '';

  const fence = findSingleRecoverableHtmlFence(content);
  if (!fence) return content;
  return `${content.slice(0, fence.start)}${content.slice(fence.end)}`.trim();
}

/**
 * A persisted file a host confirms an artifact save wrote to storage.
 * `identifier` is the artifact manifest's `metadata.identifier` when present
 * — the strongest link, since it survives a collision-suffix rename that
 * would break a name-only match.
 */
export interface PersistedArtifactFileRef {
  name: string;
  identifier?: string;
}

type ArtifactFileExt = '.html' | '.jsx' | '.tsx' | '.css' | '.svg' | '.md';

// Checked in order; the first rule whose identifier suffix, exact type, or type substring matches wins.
const EXTENSION_RULES: ReadonlyArray<{ ext: ArtifactFileExt; typeIncludes: readonly string[]; typeEquals?: string }> = [
  { ext: '.tsx', typeIncludes: ['tsx'] },
  { ext: '.jsx', typeIncludes: ['jsx', 'react'] },
  { ext: '.css', typeIncludes: ['css'] },
  { ext: '.svg', typeIncludes: ['svg'] },
  { ext: '.md', typeIncludes: ['markdown'], typeEquals: 'md' },
];

// The on-disk extension a persist path would pick from the artifact's type/identifier.
function artifactExtensionForAttrs(attrs: Record<string, string>): ArtifactFileExt {
  const type = (attrs['type'] || '').toLowerCase();
  const identifier = (attrs['identifier'] || '').toLowerCase();
  const rule = EXTENSION_RULES.find(
    (r) => identifier.endsWith(r.ext) || r.typeEquals === type || r.typeIncludes.some((hint) => type.includes(hint)),
  );
  return rule?.ext ?? '.html';
}

// The slug a persist path would derive the file name from.
function artifactBaseNameForAttrs(attrs: Record<string, string>): string {
  return (
    (attrs['identifier'] || attrs['title'] || 'artifact')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'artifact'
  );
}

/**
 * Find the persisted file this artifact block was saved to, or `null` when
 * persistence cannot be confirmed. Match order: manifest identifier first
 * (strongest — survives collision-suffix renames), then the derived
 * `<slug><ext>` / `<slug>-<n><ext>` file name.
 *
 * @complexity O(m) in `persistedFiles.length` (linear `find`s).
 */
export function matchPersistedArtifactFile({ attrs, persistedFiles }: { attrs: Record<string, string>; persistedFiles: ReadonlyArray<PersistedArtifactFileRef> }
): PersistedArtifactFileRef | null {
  const identifier = attrs['identifier'] ?? '';
  if (identifier) {
    const byManifest = persistedFiles.find((f) => f.identifier === identifier);
    if (byManifest) return byManifest;
  }
  const ext = artifactExtensionForAttrs(attrs);
  const base = artifactBaseNameForAttrs(attrs);
  const namePattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-\\d+)?${ext.replace('.', '\\.')}$`);
  return persistedFiles.find((f) => namePattern.test(f.name)) ?? null;
}

/**
 * Replace every real `<artifact …>…</artifact>` block whose body is
 * CONFIRMED persisted to a file with a one-line summary, for use in a
 * multi-turn transcript sent back to the agent.
 *
 * Once an artifact lives on disk, an agent reads/edits it from there, never
 * from a transcript copy, so re-sending the whole body every turn is pure
 * waste — a large artifact balloons every subsequent turn's input. The
 * summary keeps the metadata the agent needs (`identifier`/`title`/`type`
 * plus the saved file name) and points it at the on-disk file.
 *
 * Persistence is confirmed against `persistedFiles` — evidence a host
 * derives from its own per-turn file-write bookkeeping (see
 * {@link import('../transcript.js').buildTranscript}'s
 * `resolvePersistedArtifactFiles` option). A save can fail validation or a
 * write, in which case the transcript copy is the ONLY surviving artifact
 * body — an unmatched block is left verbatim so a follow-up turn can still
 * inspect or repair it.
 *
 * Uses the same skip-range / real-open detection as {@link stripArtifact},
 * so a literal `<artifact …>` recited inside a code fence is left intact —
 * only genuine protocol blocks are summarized. Malformed / still-streaming
 * blocks (real open, no real close) are left untouched.
 *
 * @complexity O(n) in `content.length` across the whole scan (each iteration
 *   consumes at least one full artifact block or the remaining tail), times
 *   O(m) for the `persistedFiles` lookup per block.
 */
export function summarizeArtifactsForTranscript({ content, persistedFiles }: { content: string; persistedFiles: ReadonlyArray<PersistedArtifactFileRef> }): string {
  if (persistedFiles.length === 0) return content;
  let result = '';
  let cursor = 0;
  // Recompute skip ranges per iteration against the remaining tail so indices
  // stay valid as we consume the string left to right. Each iteration either
  // returns or consumes at least one whole block, so the loop terminates.
  for (;;) {
    const tail = content.slice(cursor);
    const block = findCompleteArtifactBlock({ content: tail, ranges: completeContentSkipRanges({ content: tail }) });
    // No real open, an open tag that never terminates, or a real open but no
    // real close — refuse to summarize (safer than eating to end-of-string on
    // a malformed/streaming tag). Keep the rest as-is.
    if (!block) return result + tail;
    const afterBlock = block.close + CLOSE.length;
    const attrs = parseQuotedAttrs({ raw: tail.slice(block.open, block.openEnd) });
    const persisted = matchPersistedArtifactFile({ attrs: attrs, persistedFiles: persistedFiles });
    result += persisted
      ? tail.slice(0, block.open) + artifactTranscriptSummary(attrs, persisted)
      : // Unconfirmed save — the transcript copy may be the only surviving
        // body. Keep the block verbatim and keep scanning past it.
        tail.slice(0, afterBlock);
    cursor += afterBlock;
  }
}

function artifactTranscriptSummary(attrs: Record<string, string>, persisted: PersistedArtifactFileRef): string {
  const id = attrs['identifier'] ?? '';
  const title = attrs['title'] ?? '';
  const type = attrs['type'] ?? 'text/html';
  const meta = [id ? `identifier="${id}"` : '', title ? `title="${title}"` : '', `type="${type}"`].filter(Boolean).join(', ');
  return `[artifact emitted on a prior turn — ${meta}. Its full content was saved to the file "${persisted.name}" and is NOT repeated here. Read or modify that file on disk (list/grep the workspace directory if it was since renamed); do not rely on this transcript for its contents.]`;
}

export interface StreamingArtifact {
  artifactType: string;
  title: string;
  identifier: string;
  /** The artifact body received so far — raw, possibly mid-token. */
  content: string;
}

/**
 * Split `content` around the first real `<artifact …>` whose closing
 * `</artifact>` has NOT yet arrived — i.e. an artifact whose body is still
 * streaming in. Returns the text *before* the open tag as `head` (safe to
 * render as Markdown) and the in-flight artifact as `live`.
 *
 * This is the streaming-display counterpart to {@link stripArtifact}: the
 * stripper removes a *completed* block once `</artifact>` lands, whereas
 * this surfaces the *incomplete* one so a chat surface can show a live
 * preview instead of leaking the raw `<artifact …>` tag plus half-written
 * body as text.
 *
 * Returns `{ head: content, live: null }` when there is no open artifact,
 * when the open tag already has a matching close (defer to the stripper),
 * or when the artifact `type` is a non-text/HTML kind (media artifacts must
 * not render as a code panel). "Real" open detection reuses the same
 * skip-range logic as the stripper.
 *
 * @complexity O(n) in `content.length`.
 */
export function splitStreamingArtifact({ content }: { content: string }): { head: string; live: StreamingArtifact | null } {
  const ranges = completeContentSkipRanges({ content });
  const open = findRealOpen(content, 0, ranges);
  if (open === -1) return { head: content, live: null };
  const gt = content.indexOf('>', open);
  if (gt === -1) {
    // The open tag's attributes are still streaming — the type/title aren't
    // known yet, but an artifact is starting, so show the box (empty body)
    // and hide the partial `<artifact …` tail from Markdown.
    return {
      head: content.slice(0, open).replace(/\s+$/, ''),
      live: { artifactType: '', title: '', identifier: '', content: '' },
    };
  }
  // A matching close means the block is complete; defer to stripArtifact.
  if (findUnskipped(content, CLOSE, gt, ranges) !== -1) return { head: content, live: null };
  const attrs = parseQuotedAttrs({ raw: content.slice(open, gt) });
  const artifactType = attrs['type'] ?? '';
  // Only HTML/text artifacts read as code. An unknown type (attrs not fully
  // parsed, or omitted) is treated as code-eligible since the dominant case
  // is text/html; media/binary types fall through and render as raw text.
  if (artifactType && !/html|text\//i.test(artifactType)) return { head: content, live: null };
  return {
    head: content.slice(0, open).replace(/\s+$/, ''),
    live: {
      artifactType,
      title: attrs['title'] ?? '',
      identifier: attrs['identifier'] ?? '',
      content: content.slice(gt + 1),
    },
  };
}
