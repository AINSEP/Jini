import { useEffect, useId, useRef } from 'react';
import { useT } from '../../../i18n/index.js';
import { useDismissOnOutsideOrEscape } from '../../../../browser/index.js';

export interface DeleteConfirmDialogProps {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Generic bulk-delete confirmation dialog. Keeps its own body-scroll-lock
 * behavior inline (a standard modal a11y idiom) — matching the same
 * disclosed deviation `ConnectorDetailDrawer` documents in
 * `packages/ui/source-map.md`. Escape-to-close is shared plumbing (see
 * `useDismissOnOutsideOrEscape` below); the backdrop's own `onMouseDown`
 * already handles outside-click, so no `containerRef` is passed.
 */
export function DeleteConfirmDialog({ count, onCancel, onConfirm }: DeleteConfirmDialogProps) {
  const t = useT();
  const titleId = useId();
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  useDismissOnOutsideOrEscape({ onDismiss: onCancel });

  useEffect(() => {
    confirmBtnRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      className="asset-grid-confirm-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="asset-grid-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="asset-grid-confirm-title">
          {count === 1 ? t('Delete 1 asset?') : t('Delete {count} assets?', { count })}
        </h2>
        <p className="asset-grid-confirm-description">
          {count === 1
            ? t('This permanently removes it. This can’t be undone.')
            : t('This permanently removes them. This can’t be undone.')}
        </p>
        <div className="asset-grid-confirm-footer">
          <button type="button" onClick={onCancel}>
            {t('Cancel')}
          </button>
          <button ref={confirmBtnRef} type="button" className="asset-grid-confirm-danger" onClick={onConfirm}>
            {t('Delete {count}', { count })}
          </button>
        </div>
      </div>
    </div>
  );
}
