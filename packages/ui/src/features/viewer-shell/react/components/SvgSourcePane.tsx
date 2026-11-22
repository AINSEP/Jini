export type SvgViewerMode = 'preview' | 'source';

export interface SvgSourcePaneProps {
  mode: SvgViewerMode;
  /** Rendered `<img>` src, shown when `mode === 'preview'`. */
  previewSrc: string;
  previewAlt: string;
  /** Raw source text, shown when `mode === 'source'`. `null` while
   *  loading, per the loading/error props below. */
  source: string | null;
  loading?: boolean;
  loadingLabel?: string;
  error?: boolean;
  errorLabel?: string;
}

/**
 * The SVG viewer's body content: an `<img>` preview, or the raw source text
 * in a `<pre>` — generalizes the source component's `SvgViewer` body once
 * its daemon fetch/reload/download-link toolbar wiring is stripped out (a
 * host wires those with `ViewerShell`'s `toolbarActions` slot, a
 * `SegmentedToggle` for the mode switch, and `ViewerFileActions`).
 */
export function SvgSourcePane({ mode, previewSrc, previewAlt, source, loading, loadingLabel, error, errorLabel }: SvgSourcePaneProps) {
  if (mode === 'preview') return <img alt={previewAlt} src={previewSrc} />;
  if (loading) return <div className="viewer-empty">{loadingLabel}</div>;
  if (error) return <div className="viewer-empty">{errorLabel}</div>;
  return <pre className="jini-viewer-source">{source ?? ''}</pre>;
}
