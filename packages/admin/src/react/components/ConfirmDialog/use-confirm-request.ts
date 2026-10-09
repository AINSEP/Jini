import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConfirmDialogProps } from './ConfirmDialog.js';

/** Host copy and consequence styling; ConfirmDialog remains the owner of focus and dismissal. */
export type ConfirmRequestPresentation = Pick<ConfirmDialogProps, 'title' | 'body' | 'confirmLabel' | 'cancelLabel' | 'tone'>;

export interface ConfirmRequestController {
  confirm: (required: { dialog: ConfirmRequestPresentation }, optional?: Record<string, never>) => Promise<boolean>;
  /** Keep the shared dialog mounted, including while closed. */
  dialog: ConfirmDialogProps;
}

interface PendingConfirmation {
  presentation: ConfirmRequestPresentation;
  resolve: (accepted: boolean) => void;
}

/**
 * Adapts an async confirmation callback to the shared controlled ConfirmDialog.
 * Replacing a request or unmounting denies the outstanding action; stale answers cannot accept
 * a newer request. No destructive effect runs here: the caller acts only after receiving true.
 * @param _required - No required host dependencies.
 * @param _optional - Reserved options.
 * @returns Promise confirmer and props for one always-mounted ConfirmDialog.
 * @example const approval = useConfirmRequest({}); // <ConfirmDialog {...approval.dialog} />
 * @complexity O(1) time and space per request; at most one unresolved request.
 */
export function useConfirmRequest(
  _required: Record<string, never>,
  _optional: Record<string, never> = {},
): ConfirmRequestController {
  const [request, setRequest] = useState<PendingConfirmation | null>(null);
  const pending = useRef<PendingConfirmation | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.resolve(false);
      pending.current = null;
    };
  }, []);

  /** Opens one request, denying any replaced request; retained callbacks fail closed after unmount. */
  const confirm = useCallback(({ dialog }: { dialog: ConfirmRequestPresentation }, _options: Record<string, never> = {}): Promise<boolean> => {
    if (!mounted.current) return Promise.resolve(false);
    pending.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { presentation: dialog, resolve };
      pending.current = next;
      setRequest(next);
    });
  }, []);

  /** Only the dialog that opened this request may settle it, once; delayed older clicks are ignored. */
  function settle(accepted: boolean): void {
    if (!request || pending.current !== request) return;
    pending.current = null;
    setRequest(null);
    request.resolve(accepted);
  }

  return {
    confirm,
    dialog: {
      ...(request?.presentation ?? { title: '', body: '', confirmLabel: '' }),
      open: request !== null,
      onConfirm: () => settle(true),
      onCancel: () => settle(false),
    },
  };
}
