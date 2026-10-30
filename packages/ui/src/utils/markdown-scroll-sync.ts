import { parse, postprocess, preprocess } from 'micromark';
import { gfm } from 'micromark-extension-gfm';

// Split-view scroll sync between a raw markdown editor and its rendered
// preview. A naive ratio sync (scrollTop / scrollRange) drifts badly because
// a markdown source line and its rendered block have very different heights
// (a `## heading` is one short line in source but a tall heading block in
// preview). Instead we anchor on every top-level block: each block's source
// line maps to one top-level DOM element in the preview, and we piecewise-
// linearly interpolate scroll position between those anchor pairs so
// matching blocks line up at the top edge of both panes.

const CONTAINER_TOKENS = new Set(['blockQuote', 'listOrdered', 'listUnordered']);
const FLOW_BLOCK_TOKENS = new Set([
  'atxHeading',
  'setextHeading',
  'paragraph',
  'codeFenced',
  'codeIndented',
  'htmlFlow',
  'thematicBreak',
  'table',
]);

// Computed styles that influence text wrapping/line height. Copied from the
// textarea onto a hidden mirror so the mirror wraps identically. `box-sizing`,
// `width`, and borders are forced separately so the content box matches
// regardless of the textarea's own box model.
const MIRROR_COPIED_STYLES = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-transform',
  'text-indent',
  'tab-size',
  'white-space',
  'overflow-wrap',
  'word-break',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
];

function hasVerticalProgression(offsets: number[]): boolean {
  if (offsets.length <= 1) return true;
  // `offsets` is a module-private function's only argument, always built
  // internally (by `measureEditorBlockOffsets`/`measurePreviewBlockOffsets`
  // via `new Array(...).fill(0)` or `.map()`) as a dense array — `offsets[0]`
  // is always defined once the `length <= 1` guard above has passed, so the
  // `?? 0` fallback this used to have was dead code for every real caller
  // (same pattern as this file's `basenameOf`-style precedents elsewhere in
  // this package).
  const first = offsets[0] as number;
  return offsets.some((offset, index) => index > 0 && offset > first + 0.5);
}

type MarkdownEvents = ReturnType<typeof postprocess>;

function parseMarkdownEvents({ markdown }: { markdown: string }): MarkdownEvents | null {
  try {
    return postprocess(
      parse({ extensions: [gfm()] })
        .document()
        .write(preprocess()(markdown, undefined, true)),
    );
  } catch {
    return null;
  }
}

// Nesting depth after a container token's enter/exit event.
function nextContainerDepth({ phase, depth }: { phase: string; depth: number }): number {
  return phase === 'enter' ? depth + 1 : Math.max(0, depth - 1);
}

function collectTopLevelBlockLines({ events }: { events: MarkdownEvents }): number[] {
  const lines: number[] = [];
  let depth = 0;
  for (const [phase, token] of events) {
    const isContainer = CONTAINER_TOKENS.has(token.type);
    const isTopLevelStart = phase === 'enter' && depth === 0;
    if (isTopLevelStart && (isContainer || FLOW_BLOCK_TOKENS.has(token.type))) lines.push(token.start.line);
    if (isContainer) depth = nextContainerDepth({ phase, depth });
  }
  return lines;
}

/**
 * 1-based source start line of every top-level markdown block, in document
 * order. Nested blocks (list items, blockquote contents) collapse into their
 * top-level container so the result lines up 1:1 with the preview article's
 * direct element children.
 */
export function extractMarkdownBlockLines(markdown: string): number[] {
  if (!markdown) return [];
  const events = parseMarkdownEvents({ markdown });
  return events ? collectTopLevelBlockLines({ events }) : [];
}

function escapeMirrorText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// A hidden off-screen div styled to wrap text exactly like `textarea`.
function createMirror({ textarea }: { textarea: HTMLTextAreaElement }): HTMLDivElement {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  const style = mirror.style;
  for (const prop of MIRROR_COPIED_STYLES) {
    style.setProperty(prop, computed.getPropertyValue(prop));
  }
  // Reproduce the textarea content-box width regardless of its box model.
  style.boxSizing = 'border-box';
  style.borderWidth = '0';
  style.margin = '0';
  style.position = 'absolute';
  style.top = '0';
  style.left = '-9999px';
  style.height = 'auto';
  style.overflow = 'hidden';
  style.visibility = 'hidden';
  style.pointerEvents = 'none';
  style.width = `${textarea.clientWidth}px`;
  if (style.whiteSpace === 'normal' || !style.whiteSpace) style.whiteSpace = 'pre-wrap';
  return mirror;
}

// Block indices grouped by the (clamped, 0-based) source line they start on.
function groupBlocksByLine({ blockLines, lineCount }: { blockLines: number[]; lineCount: number }): Map<number, number[]> {
  const markersByLine = new Map<number, number[]>();
  blockLines.forEach((line, blockIndex) => {
    const lineIndex = Math.max(0, Math.min(lineCount - 1, line - 1));
    const existing = markersByLine.get(lineIndex);
    if (existing) existing.push(blockIndex);
    else markersByLine.set(lineIndex, [blockIndex]);
  });
  return markersByLine;
}

// The escaped `text` with an empty `data-md-block` marker span in front of
// every block's start line.
function buildMirrorMarkup({ blockLines, text }: { blockLines: number[]; text: string }): string {
  const lines = text.split('\n');
  const markersByLine = groupBlocksByLine({ blockLines, lineCount: lines.length });
  let buffer = '';
  for (let i = 0; i < lines.length; i += 1) {
    for (const blockIndex of markersByLine.get(i) ?? []) buffer += `<span data-md-block="${blockIndex}"></span>`;
    // `text.split('\n')` always yields a dense array (never a hole), so
    // `lines[i]` for `i` in `[0, lines.length)` is always a defined string
    // (possibly `''`) — the `?? ''` fallback this used to have was dead
    // code for every real string input, removed rather than tested around
    // (same pattern as `utils/auto-open-file.ts`'s `basenameOf`).
    buffer += escapeMirrorText(lines[i] as string);
    if (i < lines.length - 1) buffer += '\n';
  }
  return buffer;
}

// Lay the mirror out in the document just long enough to read each marker's
// offsetTop. Every marker span comes from `buildMirrorMarkup` (the text itself
// is escaped, so it cannot inject one), so each index is a valid block index.
function readMarkerOffsets({ mirror, blockCount }: { mirror: HTMLDivElement; blockCount: number }): number[] {
  document.body.appendChild(mirror);
  const offsets = Array.from({ length: blockCount }, () => 0);
  try {
    for (const marker of Array.from(mirror.querySelectorAll<HTMLElement>('span[data-md-block]'))) {
      offsets[Number(marker.getAttribute('data-md-block'))] = marker.offsetTop;
    }
  } finally {
    document.body.removeChild(mirror);
  }
  return offsets;
}

/**
 * Pixel offset (within the textarea's scrollable content) of each block's
 * start line, accounting for soft-wrapping. Measured with a hidden mirror that
 * mimics the textarea's wrapping so the offsets stay accurate even when long
 * lines wrap. Returns `null` when measurement is not possible.
 */
export function measureEditorBlockOffsets(
  textarea: HTMLTextAreaElement,
  blockLines: number[],
  text: string,
): number[] | null {
  // The `typeof document === 'undefined'` half of this guard is real,
  // intentional SSR-safety API contract (documented in this function's own
  // JSDoc), but is empirically unreachable through this repo's actual call
  // graph today: its only caller (`useMarkdownScrollSync`) only ever
  // invokes it with an already browser-mounted `HTMLTextAreaElement` ref,
  // which cannot exist without `document` already existing. A real test
  // would require either reintroducing this package's own documented
  // `@vitest/coverage-v8` jsdom/node branch-merge bug (see
  // `features/html-viewer/dependencies`'s precedent in
  // packages/ui/archived provenance ledger) or hand-faking this function's full
  // `innerHTML`/`querySelectorAll`/`getComputedStyle` surface under plain
  // Node — disproportionate to a defensive guard with no reachable path.
  // See packages/ui/archived provenance ledger's 2026-07-22 dated entry.
  if (blockLines.length === 0 || typeof document === 'undefined') return null;
  const mirror = createMirror({ textarea });
  mirror.innerHTML = buildMirrorMarkup({ blockLines, text });
  const offsets = readMarkerOffsets({ mirror, blockCount: blockLines.length });
  return hasVerticalProgression(offsets) ? offsets : null;
}

/**
 * Pixel offset (within the preview pane's scrollable content) of each rendered
 * top-level block element. Returns `null` when the rendered article's direct
 * element children do not match the expected block count — the caller then
 * falls back to ratio sync rather than risk a wrong mapping.
 *
 * `previewSelector` identifies the preview article's root inside `pane`
 * (defaults to `.markdown-rendered`, matching most markdown renderers'
 * conventional root class).
 */
export function measurePreviewBlockOffsets(
  pane: HTMLElement,
  blockCount: number,
  previewSelector = '.markdown-rendered',
): number[] | null {
  if (blockCount === 0) return null;
  const article = pane.querySelector<HTMLElement>(previewSelector);
  if (!article) return null;
  const children = Array.from(article.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  if (children.length !== blockCount) return null;
  const paneRect = pane.getBoundingClientRect();
  const contentTop = paneRect.top - pane.scrollTop;
  const offsets = children.map((child) => child.getBoundingClientRect().top - contentTop);
  if (!hasVerticalProgression(offsets)) return null;
  return offsets;
}

/**
 * Build a monotonic anchor array spanning the full scrollable range: a `0`
 * anchor at the top, the per-block offsets, and the total `scrollHeight` at the
 * bottom, clamped non-decreasing so interpolation stays stable.
 */
export function buildScrollAnchors(blockOffsets: number[], scrollHeight: number): number[] {
  const anchors = [0, ...blockOffsets, Math.max(0, scrollHeight)];
  let previous = 0;
  for (let i = 0; i < anchors.length; i += 1) {
    const raw = anchors[i] ?? 0;
    let value = Math.max(0, Math.min(scrollHeight, Number.isFinite(raw) ? raw : 0));
    if (value < previous) value = previous;
    anchors[i] = value;
    previous = value;
  }
  return anchors;
}

// Anchor value at `index`, reading an array hole as 0.
function anchorAt({ anchors, index }: { anchors: number[]; index: number }): number {
  return anchors[index] ?? 0;
}

// Binary-search the lower index of the segment bracketing `value`, given
// `source[0] <= value < source[count - 1]`; the segment's upper index is
// always this plus one.
function findBracketLow({ value, source, count }: { value: number; source: number[]; count: number }): number {
  let low = 0;
  let high = count - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (anchorAt({ anchors: source, index: mid }) <= value) low = mid;
    else high = mid;
  }
  return low;
}

/**
 * Map a scroll position from the source pane to the target pane using paired
 * anchor arrays (same length, both monotonic). Linear interpolation within the
 * bracketing segment.
 */
export function mapScrollPosition(value: number, source: number[], target: number[]): number {
  const count = Math.min(source.length, target.length);
  if (count === 0) return value;
  const last = count - 1;
  if (count === 1 || value <= anchorAt({ anchors: source, index: 0 })) return anchorAt({ anchors: target, index: 0 });
  if (value >= anchorAt({ anchors: source, index: last })) return anchorAt({ anchors: target, index: last });
  const low = findBracketLow({ value, source, count });
  const sourceLow = anchorAt({ anchors: source, index: low });
  const sourceHigh = anchorAt({ anchors: source, index: low + 1 });
  const targetLow = anchorAt({ anchors: target, index: low });
  const targetHigh = anchorAt({ anchors: target, index: low + 1 });
  // `span` is provably > 0 here, for *any* input array (not just a
  // monotonic one): the early clamp checks above guarantee
  // `source[0] <= value < source[count - 1]` before the search loop ever
  // runs, and the loop's own invariant — `low` only ever advances when
  // `source[mid] <= value`, `high` only ever advances when
  // `source[mid] > value` — means `sourceLow <= value < sourceHigh` holds
  // at every exit, loop-iteration count included. So `sourceHigh >
  // sourceLow` always, and a `span > 0 ? ... : 0` guard against
  // division-by-zero was dead code for every possible call, not a real
  // defensive branch — removed rather than tested around (see
  // packages/ui/archived provenance ledger's 2026-07-22 dated entry for the full proof).
  const span = sourceHigh - sourceLow;
  const fraction = (value - sourceLow) / span;
  return targetLow + fraction * (targetHigh - targetLow);
}
