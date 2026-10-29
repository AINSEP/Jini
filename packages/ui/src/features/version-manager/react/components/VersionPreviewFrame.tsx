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
}: VersionPreviewFrameProps) {
  const t = useT();
  const [frameRef, canvasSize] = usePreviewCanvasSize<HTMLDivElement>();
  const preset = findViewportPreset(viewportPresets, viewport);
  const scale = effectivePreviewScale(preset, 1, canvasSize, DEFAULT_PREVIEW_CANVAS_PADDING);

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
          {!previewDocument && !loading && !loadingContent ? (
            <div className="jini-viewer-empty">{t('No preview available.')}</div>
          ) : null}
          {loading || loadingContent || (previewDocument && !frameReady) ? (
            <div className="jini-version-preview-overlay" role="status" aria-label={t('Loading preview…')}>
              <span className="jini-version-preview-spinner" aria-hidden="true" />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
