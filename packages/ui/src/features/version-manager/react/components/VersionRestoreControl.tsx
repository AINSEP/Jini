import { useId, useRef, useState } from 'react';
import { useDismissOnOutsideOrEscape } from '../../../../browser/index.js';
import { useT } from '../../../i18n/index.js';

export interface VersionRestoreControlProps {
  disabled: boolean;
  restoring: boolean;
  onRestore: () => void;
}

/** Restore button with a confirm-before-acting popover. Local
 *  open/close disclosure state per this package's hook-ownership
 *  discipline; the actual restore call is injected. */
export function VersionRestoreControl({ disabled, restoring, onRestore }: VersionRestoreControlProps) {
  const t = useT();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();

  useDismissOnOutsideOrEscape({ onDismiss: () => setConfirmOpen(false) }, { enabled: confirmOpen, containerRef: wrapRef });

  return (
    <div className="jini-version-restore-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`jini-viewer-action primary jini-version-restore-action${confirmOpen ? ' active' : ''}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={confirmOpen}
        aria-controls={confirmOpen ? popoverId : undefined}
        onClick={() => setConfirmOpen((value) => !value)}
      >
        {restoring ? t('Restoring…') : t('Restore this version')}
      </button>
      {confirmOpen ? (
        <div className="jini-version-restore-confirm" id={popoverId} role="dialog" aria-label={t('Restore this version?')}>
          <h3>{t('Restore this version?')}</h3>
          <p>{t('The file’s current content will be replaced with this version.')}</p>
          <div className="jini-version-restore-confirm-actions">
            <button type="button" className="jini-viewer-action" onClick={() => setConfirmOpen(false)}>
              {t('Cancel')}
            </button>
            <button
              type="button"
              className="jini-viewer-action primary"
              disabled={disabled}
              onClick={() => {
                setConfirmOpen(false);
                onRestore();
              }}
            >
              {t('Restore')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
