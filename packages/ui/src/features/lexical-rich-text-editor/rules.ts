/**
 * Pure Lexical-selection/caret logic — no React. Two families:
 *
 * 1. Trigger detection + deletion: origin hardcoded exactly two triggers
 *    (`@mention`, inline anchor; `/command`, line-start anchor) as literal
 *    regexes in `TriggerPlugin`/`deleteActiveTrigger`. Generalized here to
 *    accept any `RichTextTriggerConfig[]` (see `types.ts`), building the
 *    equivalent regex per trigger.
 * 2. Atomic-mention-node navigation + caret-rect reading: ported verbatim
 *    from `LexicalComposerInput.tsx` (no OD-specific surface there at all).
 */
import {
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  type LexicalNode,
  type RangeSelection,
  type TextNode,
} from 'lexical';
import { $isMentionNode, type MentionNode } from './mention-node.js';
import type { CaretRect, RichTextTriggerConfig, RichTextTriggerMatch } from './types.js';

// ---------------------------------------------------------------------------
// Trigger detection
// ---------------------------------------------------------------------------

/** Escapes a single character for safe use inside a regex (both as a literal
 *  and inside a `[...]` character class — every regex metacharacter that
 *  would otherwise need class-specific handling is escaped identically). */
function escapeRegExpChar(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

function buildTriggerDetectionRegex(trigger: RichTextTriggerConfig): RegExp {
  const c = escapeRegExpChar(trigger.character);
  return trigger.anchor === 'inline'
    ? new RegExp(`(^|\\s)${c}([^\\s${c}]*)$`)
    : new RegExp(`^${c}([^\\s${c}]*)$`);
}

/** Walk back from the caret across the current line (stopping at the
 *  previous LineBreakNode) to reconstruct the text trigger regexes need.
 *  Mentions are token nodes, so their text is included verbatim, which keeps
 *  the trailing-space "already inserted" suppression working. */
export function textBeforeCaretOnLine(node: TextNode, offset: number): string {
  let acc = node.getTextContent().slice(0, offset);
  let prev: LexicalNode | null = node.getPreviousSibling();
  while (prev && !$isLineBreakNode(prev)) {
    acc = prev.getTextContent() + acc;
    prev = prev.getPreviousSibling();
  }
  return acc;
}

/** Tests `beforeText` against every configured trigger (in order) and
 *  returns the first match, or `null` when none are active. Only one trigger
 *  can realistically match at once since each ends in a distinct character,
 *  but config order breaks a hypothetical tie deterministically. */
export function detectActiveTrigger(
  beforeText: string,
  triggers: readonly RichTextTriggerConfig[],
): { id: string; query: string } | null {
  for (const trigger of triggers) {
    const match = buildTriggerDetectionRegex(trigger).exec(beforeText);
    if (match) {
      // Both regex shapes' one capturing group (`([^\s<c>]*)`) is
      // unconditional, not `?`-quantified — it always participates in a
      // successful match (possibly capturing an empty string), so it's
      // never `undefined`. The `!` documents that instead of an
      // unreachable `?? ''` fallback.
      const query = trigger.anchor === 'inline' ? match[2]! : match[1]!;
      return { id: trigger.id, query };
    }
  }
  return null;
}

/** Drops the in-flight trigger token (e.g. `"@quer"`) from the anchor text
 *  node. The trigger always lives in plain text because mentions are token
 *  nodes you can't type into. */
export function deleteActiveTrigger(sel: RangeSelection, re: RegExp): void {
  const node = sel.anchor.getNode();
  if (!$isTextNode(node) || $isMentionNode(node)) return;
  const offset = sel.anchor.offset;
  const head = node.getTextContent().slice(0, offset);
  const match = re.exec(head);
  if (!match) return;
  // Strip a leading whitespace capture (the `(^|\s)` group of an inline
  // trigger) so only the literal token is removed, not the space before it.
  const tok = match[0].replace(/^\s+/, '');
  // `match[0]` is always a substring of `head` (that's what `.exec()`
  // matched it against), and `head.length === offset` by construction
  // above, so `tok.length <= match[0].length <= offset` always — `start`
  // can never go negative. No test can force a regex match to exceed the
  // string it matched against, so this isn't padded with a contrived one.
  const start = offset - tok.length;
  node.spliceText(start, tok.length, '', true);
}

/** Regex matching one specific trigger's live token at the end of a string —
 *  used to drop the query text a just-picked mention is replacing. */
export function buildTriggerDeletionRegex(trigger: RichTextTriggerConfig): RegExp {
  const c = escapeRegExpChar(trigger.character);
  return new RegExp(`(^|\\s)${c}[^\\s${c}]*$`);
}

/** Regex matching ANY configured trigger's live token at the end of a
 *  string — used when replacing whichever trigger is currently active
 *  without needing to know which one it was. */
export function buildAnyTriggerDeletionRegex(
  triggers: readonly RichTextTriggerConfig[],
): RegExp {
  const chars = triggers.map((t) => escapeRegExpChar(t.character));
  const cls = chars.join('');
  return new RegExp(`(^|\\s)[${cls}][^\\s${cls}]*$`);
}

// ---------------------------------------------------------------------------
// Atomic mention-node navigation
// ---------------------------------------------------------------------------

export function hasPlainNavigationIntent(event: KeyboardEvent): boolean {
  return !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
}

// Lexical's `Point.set()` only ever permits a `'text'`-type point to
// reference a TextNode or an `'element'`-type point to reference an
// ElementNode — it throws otherwise (verified directly: Lexical itself
// rejects constructing a point at a LineBreakNode or any other node
// shape). Since `RangeSelection` points are only ever mutated through
// `.set()`, `point.getNode()` for `selection.anchor` is therefore always
// either a TextNode or an ElementNode — never a third kind. TypeScript
// can't see that invariant through the wider `LexicalNode` return type, so
// the two functions below narrow with `$isTextNode`/`$isElementNode` and
// stop there instead of carrying a trailing `return null` that no real
// selection (and so no test) could ever reach.

export function mentionBeforeCaret(selection: RangeSelection): MentionNode | null {
  const point = selection.anchor;
  const node = point.getNode();
  if ($isMentionNode(node)) {
    return point.offset > 0 ? node : null;
  }
  if ($isTextNode(node)) {
    if (point.offset !== 0) return null;
    const previous = node.getPreviousSibling();
    return $isMentionNode(previous) ? previous : null;
  }
  if (point.offset <= 0) return null;
  const previous = node.getChildAtIndex(point.offset - 1);
  return $isMentionNode(previous) ? previous : null;
}

export function mentionAfterCaret(selection: RangeSelection): MentionNode | null {
  const point = selection.anchor;
  const node = point.getNode();
  if ($isMentionNode(node)) {
    return point.offset < node.getTextContentSize() ? node : null;
  }
  if ($isTextNode(node)) {
    if (point.offset !== node.getTextContentSize()) return null;
    const next = node.getNextSibling();
    return $isMentionNode(next) ? next : null;
  }
  const next = node.getChildAtIndex(point.offset);
  return $isMentionNode(next) ? next : null;
}

export function selectBeforeMention(node: MentionNode): void {
  const parent = node.getParent();
  if (parent) {
    const index = node.getIndexWithinParent();
    parent.select(index, index);
  }
}

export function selectAfterMention(node: MentionNode): void {
  const parent = node.getParent();
  if (parent) {
    const index = node.getIndexWithinParent() + 1;
    parent.select(index, index);
  }
}

export function removeMentionAtCaret(selection: RangeSelection, isBackward: boolean): boolean {
  const mention = isBackward ? mentionBeforeCaret(selection) : mentionAfterCaret(selection);
  if (!mention) return false;
  const parent = mention.getParent();
  const index = mention.getIndexWithinParent();
  mention.remove();
  if (parent?.isAttached()) {
    const offset = Math.min(index, parent.getChildrenSize());
    parent.select(offset, offset);
  }
  return true;
}

/** Depth-first collects the node key of every mention node currently in the
 *  tree. Must run inside an `editor.getEditorState().read()`/`update()`
 *  callback (like every other `$`-prefixed Lexical accessor). Used to give a
 *  freshly (re)supplied `resolveMentionColor` an initial restamp pass over
 *  nodes that mounted before it took effect — see
 *  `react/hooks/useMentionColorStamping.ts`. */
export function $collectMentionNodeKeys(): string[] {
  const keys: string[] = [];
  const walk = (node: LexicalNode): void => {
    if ($isMentionNode(node)) {
      keys.push(node.getKey());
      return;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) walk(child);
    }
  };
  for (const child of $getRoot().getChildren()) walk(child);
  return keys;
}

// ---------------------------------------------------------------------------
// Caret-rect reading (drives the caret-floating-layer's anchor position)
// ---------------------------------------------------------------------------

/** Real caret = zero width, non-zero height. Rejects the all-zero rect
 *  browsers return when there is "no geometry yet" (line start, right after
 *  inserting an atomic mention node, empty line). */
function isUsableRect(r: DOMRect): boolean {
  return r.height > 0 && (r.top !== 0 || r.left !== 0 || r.bottom !== 0);
}

function toCaretRect(r: DOMRect): CaretRect {
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
}

/** Reads the caret's viewport rect via the native selection, with ordered
 *  fallbacks for the collapsed-caret 0×0 case: (1) range bounding rect,
 *  (2) range client-rects list, (3) a zero-width probe range cloned at the
 *  anchor text offset, (4) the anchor element box, then the editor root. */
export function readCaretRect(rootEl: HTMLElement | null): CaretRect | null {
  if (typeof window === 'undefined') return null;
  const winSel = window.getSelection();
  if (winSel && winSel.rangeCount > 0) {
    const range = winSel.getRangeAt(0);

    // jsdom does not implement Range geometry — guard every native call so a
    // missing method falls through to the element/root box instead of
    // throwing.
    if (typeof range.getBoundingClientRect === 'function') {
      const r = range.getBoundingClientRect();
      if (isUsableRect(r)) return toCaretRect(r);
    }
    if (typeof range.getClientRects === 'function') {
      const rects = range.getClientRects();
      if (rects.length > 0 && isUsableRect(rects[0]!)) return toCaretRect(rects[0]!);
    }

    const anchorNode = range.startContainer;
    if (anchorNode.nodeType === Node.TEXT_NODE) {
      try {
        const probe = document.createRange();
        const len = (anchorNode as Text).length;
        const off = Math.min(range.startOffset, len);
        probe.setStart(anchorNode, off);
        probe.setEnd(anchorNode, off);
        if (typeof probe.getBoundingClientRect === 'function') {
          const pr = probe.getBoundingClientRect();
          if (isUsableRect(pr)) return toCaretRect(pr);
        }
        if (typeof probe.getClientRects === 'function') {
          const prList = probe.getClientRects();
          if (prList.length > 0 && isUsableRect(prList[0]!)) return toCaretRect(prList[0]!);
        }
      } catch {
        /* fall through */
      }
    }
    const el =
      anchorNode.nodeType === Node.ELEMENT_NODE
        ? (anchorNode as HTMLElement)
        : anchorNode.parentElement;
    if (el) {
      const er = el.getBoundingClientRect();
      if (isUsableRect(er)) {
        return { top: er.top, bottom: er.bottom, left: er.left, right: er.left };
      }
    }
  }
  if (rootEl) {
    const rr = rootEl.getBoundingClientRect();
    return { top: rr.top, bottom: rr.bottom, left: rr.left, right: rr.left };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Caret-floating-layer positioning
// ---------------------------------------------------------------------------

export interface CaretFloatingLayerPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: 'above' | 'below';
}

/** Default ABOVE the caret (a composer typically sits at a panel's bottom,
 *  so above never occludes the input line); flip BELOW only when above lacks
 *  room. Clamp horizontally into the viewport (or `boundary`, when given).
 *  Caps height; the caller's popover scrolls internally. */
export function computeCaretFloatingLayerPosition(
  caret: CaretRect,
  size: { width: number; height: number } | null,
  boundary: DOMRect | null,
  config: {
    gap: number;
    margin: number;
    hardMaxHeight: number;
    preferredWidth: number;
  },
): CaretFloatingLayerPosition {
  const { gap, margin, hardMaxHeight, preferredWidth } = config;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const viewportAvailableWidth = vw - margin * 2;
  const boundaryAvailableWidth = boundary ? boundary.width - margin * 2 : viewportAvailableWidth;
  const availableWidth = Math.max(240, Math.min(viewportAvailableWidth, boundaryAvailableWidth));
  const width = Math.min(preferredWidth, availableWidth);

  const spaceAbove = caret.top - gap - margin;
  const spaceBelow = vh - caret.bottom - gap - margin;

  const wantedH = size?.height ?? hardMaxHeight;
  const aboveFits = spaceAbove >= Math.min(wantedH, 160);
  const placement: 'above' | 'below' = aboveFits || spaceAbove >= spaceBelow ? 'above' : 'below';

  const space = placement === 'above' ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(120, Math.min(hardMaxHeight, space));

  let top: number;
  if (placement === 'above') {
    const h = Math.min(wantedH, maxHeight);
    top = caret.top - gap - h;
    if (top < margin) top = margin;
  } else {
    top = caret.bottom + gap;
  }

  const minLeft = boundary ? Math.max(margin, boundary.left + margin) : margin;
  const maxLeft = boundary
    ? Math.max(minLeft, Math.min(vw - margin - width, boundary.right - margin - width))
    : vw - margin - width;
  let left = caret.left;
  if (left > maxLeft) left = maxLeft;
  if (left < minLeft) left = minLeft;

  return { left, top, width, maxHeight, placement };
}

/** Combines detection + caret-rect reading into the shape `RichTextInput`
 *  reports upward on every editor update. */
export function buildTriggerMatch(
  detected: { id: string; query: string } | null,
  rootEl: HTMLElement | null,
): RichTextTriggerMatch | null {
  if (!detected) return null;
  return { id: detected.id, query: detected.query, anchorRect: readCaretRect(rootEl) };
}
