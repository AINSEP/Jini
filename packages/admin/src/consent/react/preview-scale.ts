/** The page width the Desktop preview lays out at. The consent banner switches to its phone layout
 * (a full-width sheet) at 480px and below, so a preview drawn at a narrow pane's own width would show
 * that phone sheet under a "Desktop" label instead of the corner card visitors see. */
export const CONSENT_PREVIEW_DESKTOP_WIDTH = 1024;

/** How far the desktop-width page is scaled down to fit the preview pane; never enlarged.
 * An unmeasured (0) pane keeps 1. @complexity O(1). */
export function consentPreviewScale({ paneWidth }: { paneWidth: number }, _optional: Record<string, never> = {}): number {
  return paneWidth > 0 ? Math.min(1, paneWidth / CONSENT_PREVIEW_DESKTOP_WIDTH) : 1;
}
