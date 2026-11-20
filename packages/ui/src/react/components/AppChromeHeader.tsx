import type { ReactNode } from 'react';
import { RemixIcon } from './RemixIcon.js';

interface Props {
  actions?: ReactNode;
  children?: ReactNode;
  fileActionsBefore?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  showTrafficSpace?: boolean;
}

export const APP_CHROME_FILE_ACTIONS_ID = 'app-chrome-file-actions';
export const APP_CHROME_FILE_ACTIONS_SELECTOR = '[data-app-chrome-file-actions="true"]';

export function AppChromeHeader({
  actions,
  children,
  fileActionsBefore,
  onBack,
  backLabel = 'Back',
  showTrafficSpace = true,
}: Props) {
  return (
    <header className="jini-app-chrome-header">
      {showTrafficSpace ? <div className="jini-app-chrome-traffic-space" aria-hidden /> : null}
      {onBack ? (
        <button
          type="button"
          className="jini-app-chrome-back jini-tooltip"
          onClick={onBack}
          title={backLabel}
          data-tooltip={backLabel}
          data-tooltip-placement="bottom"
          aria-label={backLabel}
        >
          <RemixIcon name="arrow-left-line" size={16} />
        </button>
      ) : null}
      {children ? <div className="jini-app-chrome-content">{children}</div> : null}
      <div className="jini-app-chrome-drag" aria-hidden />
      {fileActionsBefore ? <div className="jini-app-chrome-file-actions-before">{fileActionsBefore}</div> : null}
      <div
        id={APP_CHROME_FILE_ACTIONS_ID}
        className="jini-app-chrome-file-actions"
        data-app-chrome-file-actions="true"
      />
      {actions ? <div className="jini-app-chrome-actions">{actions}</div> : null}
    </header>
  );
}

export function SettingsIconButton({
  onClick,
  title,
  ariaLabel,
}: {
  onClick: () => void;
  title: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      className="jini-settings-icon-btn jini-tooltip"
      onClick={onClick}
      title={title}
      data-tooltip={title}
      data-tooltip-placement="bottom"
      aria-label={ariaLabel}
    >
      <RemixIcon name="settings-line" size={18} />
    </button>
  );
}
