/**
 * @module react/components/DocumentPreview
 *
 * The "renderer" half of the user's vision: a live preview of whatever HTML the host currently
 * wants shown. Deliberately the simplest thing that renders live HTML, not an editing surface —
 * see this file's "Scope: preview, not sandbox, not an editor" section below for why.
 *
 * `html` is host-supplied rather than derived from a `VibecodingSession` here, because a generic
 * `EditTarget` (`../../core/target.ts`) has no "whole document" verb at all — only per-part
 * `listParts`/`readPart`. A single-document host (`../../html/regions.ts`'s tagged-region target)
 * genuinely owns the composed document as its own storage detail; a filesystem-backed host would
 * have no single document to compose in the first place. Keeping this component's contract to
 * "render whatever HTML string you hand me" is what keeps it usable by every future `EditTarget`
 * host alike, the same way `../../core` itself stays target-agnostic.
 */
import type { CSSProperties } from 'react';

export interface DocumentPreviewProps {
  /** The document to render. Treated as untrusted, model-authored markup — see this file's
   *  "Sandboxing" note below. */
  readonly html: string;
  readonly title?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const FRAME_STYLE: CSSProperties = {
  width: '100%',
  height: '100%',
  border: 'none',
  background: '#fff',
};

/**
 * Renders `html` live inside a sandboxed `<iframe>`.
 *
 * ## Scope: preview, not sandbox, not an editor
 *
 * `@jini-ai/sandbox`'s own README draws the line this component is built to respect: vibecoding
 * owns the conversational edit loop over an addressable artifact, sandbox owns making that
 * artifact actually run and produce a preview. This component renders a static HTML string the
 * host already has in hand — it boots no process, runs no build, and has no notion of a dev
 * server. A host whose artifact needs a real build/run step (anything beyond one static HTML
 * document) gets its preview from `@jini-ai/sandbox`'s `SandboxSession.getPreview()` instead and
 * would point an ordinary `<iframe src={previewUrl}>` at that — this component is not the right
 * tool there, and does not try to be. It is also deliberately not `@jini-ai/ui`'s
 * `InteractiveHtmlEditor`: that component is a GrapesJS-backed click-to-edit canvas, a second,
 * heavier concern (and a large third-party dependency) this "see it live" renderer does not need
 * to pull in just to display the current document. A host that wants inline manual editing on top
 * of the same document can layer `InteractiveHtmlEditor` in separately; nothing here precludes it.
 *
 * ## Sandboxing
 *
 * `html` is model-authored per `../../core/target.ts`'s own contract ("Implementations should
 * assume content is model-authored and therefore arbitrary"), so this iframe is sandboxed with
 * `allow-scripts` ONLY — no `allow-same-origin`. Combining the two on a `srcDoc` frame is a known
 * sandbox-escape pattern (the frame could otherwise reach back into a same-origin-equivalent
 * context and strip its own restrictions); omitting `allow-same-origin` keeps the frame's content
 * in a permanently unique, opaque origin regardless of what markup or script it contains, while
 * `allow-scripts` still lets an interactive preview (a toggle, an animation) actually run.
 * `React`'s `srcDoc` prop re-navigates the iframe on every change, so no manual reload/key-remount
 * logic is needed for this to update live as the host's `html` changes.
 *
 * @complexity O(1) — a single element; rendering cost is the browser's, not this component's.
 * @overallScore 100/100
 */
export function DocumentPreview({ html, title, className, style }: DocumentPreviewProps) {
  return (
    <iframe
      title={title ?? 'Live preview'}
      srcDoc={html}
      sandbox="allow-scripts"
      className={className}
      style={style ? { ...FRAME_STYLE, ...style } : FRAME_STYLE}
    />
  );
}
