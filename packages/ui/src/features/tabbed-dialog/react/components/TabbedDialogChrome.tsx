import type { ReactNode } from 'react';
import { Icon } from '../../../../react/components/Icon.js';
import type { ResolvedTabbedDialogLabels } from './tabbedDialogView.js';

export interface TabbedDialogChromeProps {
  /** Host-owned extra chrome, rendered as-is ahead of the built-in buttons. */
  chromeExtra?: ReactNode;
  fullscreenEnabled: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Omit to render no close button. */
  onClose?: (() => void) | undefined;
  labels: ResolvedTabbedDialogLabels;
}

/** The top-right strip: host extras, the fullscreen toggle, and the close button. */
export function TabbedDialogChrome({
  chromeExtra,
  fullscreenEnabled,
  fullscreen,
  onToggleFullscreen,
  onClose,
  labels,
}: TabbedDialogChromeProps) {
  const fullscreenToggleLabel = fullscreen ? labels.exitFullscreenLabel : labels.fullscreenLabel;
  return (
    <div className="jini-tabbed-dialog-chrome">
      {chromeExtra}
      {fullscreenEnabled ? (
        <button
          type="button"
          className="jini-tabbed-dialog-chrome-btn jini-tabbed-dialog-fullscreen-toggle"
          onClick={onToggleFullscreen}
          aria-label={fullscreenToggleLabel}
          aria-pressed={fullscreen}
          title={fullscreenToggleLabel}
        >
          <Icon name={fullscreen ? 'minimize' : 'maximize'} size={15} strokeWidth={2} />
        </button>
      ) : null}
      {onClose ? (
        <button
          type="button"
          className="jini-tabbed-dialog-chrome-btn jini-tabbed-dialog-close"
          onClick={onClose}
          aria-label={labels.closeLabel}
          title={labels.closeLabel}
        >
          <Icon name="close" size={16} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}
