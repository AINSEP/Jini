import type { ReactNode } from "react";

import { devicePreviewFrameStyles } from "./DevicePreview.hooks.js";

/**
 * Renders `children` (the preview `<iframe>`) at a fixed device `width` and scales the whole box down
 * to fit the pane — a CSS transform on a fixed-width box, not a responsive iframe, which is the entire
 * point (see `DEVICE_PREVIEW_WIDTHS`). The child should fill the scaler (`.page-preview-iframe` sets
 * `width/height: 100%`). Shared by `PageEditor.tsx`, `ThemeExplore.tsx` and `PostEditor.tsx`.
 *
 * `frameRef`/`paneWidth` come from the caller's `usePreviewPaneWidth()` rather than being owned
 * here, so a caller can hold the measurement wherever its lifecycle needs it (`usePageEditor` keeps
 * it on the controller).
 *
 * @complexity O(1).
 */
export function DevicePreviewFrame({
  width,
  frameRef,
  paneWidth,
  expanded = false,
  children,
}: {
  width: number;
  frameRef: (node: HTMLDivElement | null) => void;
  paneWidth: number;
  /** Fullscreen panel — the frame takes its height from the panel's flex column instead. */
  expanded?: boolean;
  children: ReactNode;
}) {
  const styles = devicePreviewFrameStyles({ paneWidth, width, expanded });
  return (
    <div ref={frameRef} className="page-preview-frame" style={styles.frame}>
      <div className="page-preview-scaler" style={styles.scaler}>
        {children}
      </div>
    </div>
  );
}
