import type { Component, CssRule, Editor } from 'grapesjs';
import { prettifyCss } from './css.js';
import { indexElementSourceRanges, pathKey, spliceElementInner, type ElementPath } from './source-splice.js';
import type { PreparedEditorSource } from './editor-blocks.js';
import { assertProtectedSourceMetadata, EditorSourceError } from './protected-elements.js';

/** One accumulated text edit, keyed by `pathKey(path)` in the caller's `dirty` map: the element-only
 *  path and tag name `spliceElementInner` needs to locate and verify the target, plus the edited
 *  component itself. Its inner HTML is read at serialize time, not recorded here: GrapesJS fires
 *  `rte:disable` BEFORE `syncContent` writes the edited text into the model, so a snapshot taken at
 *  that event is the OLD text. See `serializeWithSplice`'s own doc for why the map accumulates across
 *  the whole mount rather than resetting per edit. */

export interface DirtyTextEdit {
  readonly path: ElementPath;
  readonly tagName: string;
  readonly component: Component;
}

/** Dev-only, so a fallback is never silent — see `serializeWithSplice` for each trigger this names. */
function warnFallback(reason: string): void {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[useInteractiveHtmlEditor] falling back to full re-serialization: ${reason}`);
  }
}

/**
 * Fallback whole-document serialization for when the lossless splice (see `serializeWithSplice`)
 * cannot be trusted. This is the "cleaned" formula from this repo's `pages-redo` plan ("Bug C"), and
 * differs from the whole-document serialization this hook used before the splice existed:
 * `avoidProtected: true` on `getCss()` drops GrapesJS's own `* { box-sizing: border-box; } body
 * {margin: 0;}` block, which GrapesJS otherwise prepends even to a page with no CSS of its own; and
 * `getWrapper().getInnerHTML()` — the wrapper's INNER content — omits the `<body>` tag `editor.
 * getHtml()` serializes the wrapper component itself as. `avoidInlineStyle: false` and
 * `forceClass: false` keep authored styles inline; `keepEmptyTextNodes: true` keeps whitespace gaps
 * in the model (see `initInteractiveHtmlEditor`). JSON CSS export returns composed rule models,
 * excluding the synthetic `#iXXXX` rules string export derives from those inline styles. Native
 * `rule.toCSS()` retains composed rules' at-rule wrappers. Still not a byte-
 * identical round trip — this is a full re-serialization from GrapesJS's component model, which
 * cannot recover the original string's entities or authored formatting — just the least-lossy shape
 * available when a true splice is not possible.
 *
 * `keepUnusedStyles: true` carries over unchanged from the serialization this replaces: real
 * documents commonly carry `@media` blocks and `::before`/`::after` rules that don't correspond to
 * any single "matched" component in the tree, which GrapesJS's default CSS export can otherwise drop.
 * @complexity O(h + c) time and space for exported HTML h and composed CSS c.
 */
function serializeCleaned(editor: Editor): string {
  // GrapesJS's getCss typing omits its JSON return type; successful init supplies a wrapper.
  const rules = editor.getCss({ json: true, avoidProtected: true, keepUnusedStyles: true }) as unknown as CssRule[];
  const css = rules.map(rule => rule.toCSS()).join('');
  // `getWrapper()` is undefined only before/without a successful init, which cannot be true once this
  // hook's `editor` has fired `update` — and `serializeEditorSource` has already walked the wrapper
  // (`assertProtectedSourceMetadata`) before reaching here. The old `: editor.getHtml()` fallback for a
  // missing wrapper was therefore unreachable and is gone.
  const html = editor.getWrapper()!.getInnerHTML();
  return css ? `<style>${prettifyCss(css)}</style>${html}` : html;
}

/**
 * Builds this edit cycle's exported HTML. The default path splices every accumulated dirty text edit
 * (see `recordDirtyTextEdit`) back into the ORIGINAL source string via `spliceElementInner` (see
 * `source-splice.ts`), so every other byte — entities, attribute quoting, an untouched embed marker,
 * unrelated formatting — passes through unchanged instead of being rebuilt from GrapesJS's component
 * model. Falls back to `serializeCleaned` (and warns via `warnFallback`, so it is never silent)
 * whenever that guarantee cannot be trusted:
 *  - `structuralChange` — a block was added or removed since mount (a block move, clone, or delete;
 *    a move fires a remove then an add). Its value names the first such event, for the warning. The
 *    child churn inside a text component that every RTE close causes does not count (see
 *    `isInsideTextComponent`); that is a text edit, which the splice covers. Every dirty path's offset was computed against the
 *    pristine `original` string; once the LIVE tree's shape has diverged from it, those offsets (and
 *    even the paths themselves) can silently address the wrong element instead of failing loudly, so
 *    this is checked first and unconditionally, regardless of what is or isn't in `dirty`. There is no
 *    path back to `false` once this flips — a later purely-textual edit still cannot trust offsets
 *    computed before the structural change, so the whole rest of the mount stays on the cleaned path.
 *  - `dirty` is empty — `update` fired (a real content/style/attribute mutation happened) but no
 *    text-component edit was ever recorded for it. Nothing addressable means nothing spliceable.
 *  - any individual `spliceElementInner` call returns `null` — that path's element is no longer where
 *    it was, or its tag no longer matches what the live component believes.
 *
 * Dirty edits are applied in descending original-offset order (highest first): a splice at a later
 * offset never shifts the byte positions of anything before it, so replaying strictly back-to-front
 * lets every subsequent `spliceElementInner` call re-locate its own (still-untouched-until-its-turn)
 * range correctly without this function tracking running offset deltas itself.
 *
 * @complexity O(n·k) where n = size of `original` (each of up to k dirty splices re-indexes the
 * current string internally) and k = number of dirty edits accumulated this mount — small in
 * practice (an operator edits a handful of elements per session), never a hot loop here.
 */
function serializeWithSplice(
  editor: Editor,
  original: string,
  dirty: Map<string, DirtyTextEdit>,
  structuralChange: string | undefined,
  sourcePlan: PreparedEditorSource,
): string {
  if (structuralChange) {
    warnFallback(`a block was added, moved, copied or deleted since mount (first: ${structuralChange})`);
    return serializeCleaned(editor);
  }
  if (dirty.size === 0) {
    warnFallback('no text edit was recorded for this change');
    return serializeCleaned(editor);
  }

  const originalIndex = indexElementSourceRanges(original);
  const ordered = [...dirty.values()].sort((a, b) => {
    const aStart = originalIndex.get(pathKey(a.path))?.start ?? -1;
    const bStart = originalIndex.get(pathKey(b.path))?.start ?? -1;
    return bStart - aStart;
  });

  let result = original;
  for (const edit of ordered) {
    const range = originalIndex.get(pathKey(edit.path));
    if (range && sourcePlan.instances.some(raw => range.start < raw.outerEnd && range.end > raw.outerStart)) {
      warnFallback('text edit overlaps a protected source region');
      return serializeCleaned(editor);
    }
    const spliced = spliceElementInner(result, edit.path, edit.tagName, edit.component.getInnerHTML());
    if (spliced === null) {
      warnFallback(`element at path "${pathKey(edit.path)}" could not be spliced (removed, or its tag drifted)`);
      return serializeCleaned(editor);
    }
    result = spliced;
  }
  return result;
}

/** Existing text-splice/full-export owner, also usable without a rendered canvas in contract tests. */
export function serializeEditorSource(
  { editor, html, edits, sourcePlan }: { editor: Editor; html: string; edits: Map<string, DirtyTextEdit>; sourcePlan: PreparedEditorSource },
  { structuralChange }: { structuralChange?: string | undefined } = {},
): string {
  assertProtectedSourceMetadata({ editor }, {});
  const result = serializeWithSplice(editor, html, edits, structuralChange, sourcePlan);
  if (result.includes(sourcePlan.markerAttribute)) throw new EditorSourceError();
  return result;
}
