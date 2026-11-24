import { useCallback, useRef, type MutableRefObject } from "react";
import type { HtmlEditorProps, HtmlEditorTarget } from "../../react/kit.js";

/** The editor's "Edit HTML" request for a block the canvas cannot edit visually. */
export type RequestEditHtml = NonNullable<HtmlEditorProps["onRequestEditHtml"]>;
/**
 * The host's `@jini-ai/ui/html-editor` `findEditorBlockOpening`, injected because `@jini-ai/admin`
 * has no runtime dependency on the editor package: the exact opening tag `target` stands for, or
 * `undefined` when the source has no such occurrence.
 */
export type FindEditorBlockOpening = (
  required: { html: string; target: HtmlEditorTarget }, optional: object,
) => { start: number; end: number } | undefined;

/** One-shot source navigation; content/flush ownership stays in the existing Page editor. */
export function useEditorHtmlJump(
  { html, contentRevision, flush, setView, setDraftHtml, scrollTop, findEditorBlockOpening }: {
    html: string;
    contentRevision: number;
    flush: () => Promise<string | undefined>;
    setView: (view: "html") => void;
    setDraftHtml: (html: string) => void;
    scrollTop: MutableRefObject<number>;
    findEditorBlockOpening: FindEditorBlockOpening;
  },
  { onError, measureCaretTop = measureTextareaCaretTop }: {
    onError: (error?: Error) => void;
    /** Pixel top of `index` inside the textarea's wrapped content, or `null` without layout. */
    measureCaretTop?: typeof measureTextareaCaretTop;
  },
): { requestEditHtml: RequestEditHtml; htmlTextareaRef: (node: HTMLTextAreaElement | null) => void; consumeJumpFormatting: () => boolean } {
  const current = useRef({ html, contentRevision });
  const pending = useRef<{ start: number; end: number; revision: number } | null>(null);
  const skipFormatting = useRef(false);
  if (current.current.contentRevision !== contentRevision) {
    pending.current = null;
    skipFormatting.current = false;
  }
  current.current = { html, contentRevision };

  const requestEditHtml = useCallback(async (target: HtmlEditorTarget, _options: object) => {
    const revision = current.current.contentRevision;
    try {
      const source = await flush() ?? current.current.html;
      if (revision !== current.current.contentRevision) return;
      const opening = findEditorBlockOpening({ html: source, target }, {});
      if (!opening) { onError(); return; }
      // The exact opening tag can span authored lines. A jump seeds source verbatim so selection
      // addresses that exact tag; ordinary HTML-tab entry retains its existing display formatter.
      pending.current = { start: opening.start, end: opening.end, revision };
      skipFormatting.current = true;
      setDraftHtml(source);
      setView("html");
    } catch (error) { onError(error instanceof Error ? error : undefined); }
  }, [flush, setView, setDraftHtml, onError, findEditorBlockOpening]);

  const htmlTextareaRef = useCallback((node: HTMLTextAreaElement | null) => {
    if (!node) return;
    const jump = pending.current;
    pending.current = null;
    if (!jump || jump.revision !== current.current.contentRevision) {
      node.scrollTop = scrollTop.current;
      return;
    }
    node.focus();
    node.setSelectionRange(jump.start, jump.end);
    // The HTML tab soft-wraps long lines, so a newline count lands far above the tag on real pages;
    // the measured wrapped position wins, and the line estimate only stands in without layout.
    const measured = measureCaretTop({ node, index: jump.start });
    const line = node.value.slice(0, jump.start).split("\n").length - 1;
    const metrics = node.ownerDocument.defaultView?.getComputedStyle(node);
    const lineHeight = Number.parseFloat(metrics?.lineHeight ?? "") || 20;
    node.scrollTop = Math.max(0, (measured ?? line * lineHeight) - node.clientHeight / 3);
    scrollTop.current = node.scrollTop;
  }, [scrollTop, measureCaretTop]);

  const consumeJumpFormatting = useCallback(() => {
    const skip = skipFormatting.current;
    skipFormatting.current = false;
    return skip;
  }, []);
  return { requestEditHtml, htmlTextareaRef, consumeJumpFormatting };
}

const MIRRORED_STYLES = [
  "boxSizing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontFamily", "fontSize", "fontWeight",
  "fontStyle", "letterSpacing", "lineHeight", "tabSize", "textIndent", "textTransform", "wordSpacing", "whiteSpace",
  "wordBreak", "overflowWrap",
] as const;

/**
 * Wrapped pixel top of `index` in a textarea, via an off-screen mirror with the same text box.
 * `null` when there is no layout (the mirror measures zero height, e.g. jsdom or a hidden node).
 *
 * @complexity O(index) to copy the text before the caret, plus one layout.
 */
export function measureTextareaCaretTop({ node, index }: { node: HTMLTextAreaElement; index: number }, _options = {}): number | null {
  const doc = node.ownerDocument;
  const style = doc.defaultView?.getComputedStyle(node);
  if (!style) return null;
  const mirror = doc.createElement("div");
  for (const prop of MIRRORED_STYLES) mirror.style[prop] = style[prop];
  // clientWidth is the wrap width: padding included, border and scrollbar excluded.
  Object.assign(mirror.style, {
    position: "absolute", visibility: "hidden", left: "-99999px", top: "0", overflow: "hidden",
    boxSizing: "border-box", width: `${node.clientWidth}px`, border: "0", height: "auto",
  });
  mirror.textContent = node.value.slice(0, index);
  const marker = doc.createElement("span");
  marker.textContent = "\u200b";
  mirror.append(marker);
  doc.body.append(mirror);
  const top = mirror.offsetHeight > 0 ? marker.offsetTop : null;
  mirror.remove();
  return top;
}
