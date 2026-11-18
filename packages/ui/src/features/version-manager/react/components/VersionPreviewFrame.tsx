import { useT } from '../../../i18n/index.js';
import type { ViewportPreset } from '../../../viewer-shell/index.js';
import {
  effectivePreviewScale,
  findViewportPreset,
  previewScaleShellStyle,
  previewViewportStyle,
} from '../../rules.js';
import { DEFAULT_PREVIEW_CANVAS_PADDING } from '../../constants.js';
import { usePreviewCanvasSize } from '../hooks/usePreviewCanvasSize.js';

export interface VersionPreviewFrameProps {
  previewDocument: string;
  frameReady: boolean;
  onFrameLoad: () => void;
  viewport: string;
  viewportPresets: ViewportPreset[];
  title: string;
  error: string | null;
  loading: boolean;
  loadingContent: boolean;
  /** Hooks the frame calls; defaults to the real ones, a test hands in fakes. */
  hooks?: VersionPreviewFrameHooks | undefined;
}

export const defaultVersionPreviewFrameHooks = { useT, usePreviewCanvasSize };
export type VersionPreviewFrameHooks = typeof defaultVersionPreviewFrameHooks;

/** Which of the empty and loading overlays the preview pane shows right now. */
function previewStatus(
  { previewDocument, frameReady, loading, loadingContent }: Pick<VersionPreviewFrameProps, 'previewDocument' | 'frameReady' | 'loading' | 'loadingContent'>,
  _options: Record<string, never> = {},
): { showEmpty: boolean; showLoading: boolean } {
  return {
    showEmpty: !previewDocument && !loading && !loadingContent,
    showLoading: Boolean(loading || loadingContent || (previewDocument && !frameReady)),
  };
}

/** The scaled, sandboxed preview iframe + its loading overlay. Measures its
 *  own container so a fixed-size viewport preset (tablet/mobile) can be
 *  scaled to fit whatever space the host actually gives this pane. */
export function VersionPreviewFrame({
  previewDocument,
  frameReady,
  onFrameLoad,
  viewport,
  viewportPresets,
  title,
  error,
  loading,
  loadingContent,
  hooks = defaultVersionPreviewFrameHooks,
}: VersionPreviewFrameProps) {
  const t = hooks.useT();
  const [frameRef, canvasSize] = hooks.usePreviewCanvasSize<HTMLDivElement>();
  const preset = findViewportPreset(viewportPresets, viewport);
  const scale = effectivePreviewScale(preset, 1, canvasSize, DEFAULT_PREVIEW_CANVAS_PADDING);

  const { showEmpty, showLoading } = previewStatus({ previewDocument, frameReady, loading, loadingContent });

  const emptyState = showEmpty ? <div className="jini-viewer-empty">{t('No preview available.')}</div> : null;

  return (
    <div className="jini-version-preview" ref={frameRef}>
      {error ? (
        <div className="jini-viewer-empty" role="alert">
          {error}
        </div>
      ) : (
        <>
          {previewDocument ? (
            <div className="jini-preview-viewport" style={previewViewportStyle(preset, scale, 1)}>
              <div className="jini-preview-frame-clip">
                <div style={previewScaleShellStyle(preset, 1)}>
                  <iframe
                    title={title}
                    sandbox="allow-scripts allow-downloads"
                    srcDoc={previewDocument}
                    onLoad={onFrameLoad}
                  />
                </div>
              </div>
            </div>
          ) : null}
          {emptyState}
          {showLoading ? (
            <div className="jini-version-preview-overlay" role="status" aria-label={t('Loading preview…')}>
              <span className="jini-version-preview-spinner" aria-hidden="true" />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
