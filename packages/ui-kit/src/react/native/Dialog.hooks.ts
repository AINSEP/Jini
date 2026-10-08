import { useId, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { MouseEvent, SyntheticEvent } from 'react';
import type { DialogProps, ConfirmViewProps } from '../types.js';
import { Button } from '../facade.js';
import { NativeButton } from './Controls.js';
/** Native modal lifecycle shared by kit views and compatibility adapters; DOM effects are O(1).
 * The document port preserves hosts' focus injection seam without introducing another lifecycle.
 * @example useNativeDialog({ open, title, onClose }, { initialFocus: () => cancelRef.current?.focus() })
 */
export function useNativeDialog(required: DialogProps, optional: {
  initialFocus?: () => void;
  document?: Pick<Document, 'activeElement'>;
} = {}) {
  const dialogRef = useRef<HTMLDialogElement>(null), opener = useRef<Element | null>(null), titleId = useId();
  useImperativeHandle(required.ref, () => dialogRef.current!, []);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!required.open) {
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus({ preventScroll: true });
      return;
    }
    opener.current = (optional.document ?? document).activeElement;
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
    if (optional.initialFocus) optional.initialFocus();
    else (dialog.querySelector<HTMLElement>('[data-jini-autofocus]') ?? dialog.querySelector<HTMLElement>('[data-jini-part="kit.dialog-close"]') ?? dialog).focus({ preventScroll: true });
    dialog.scrollTop = 0;
    return () => {
      if (typeof dialog.close === 'function') { if (dialog.open) dialog.close(); }
      else dialog.removeAttribute('open');
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus({ preventScroll: true });
    };
    // Open is the transition boundary: editing content must not recapture the original trigger.
  }, [required.open]);
  return { title: required.title, children: required.children, titleId, closeLabel: required.closeLabel ?? 'Close',
    closeProps: { className: 'jini-dialog-close', variant: 'secondary' as const, attrs: { 'data-jini-part': 'kit.dialog-close' }, disabled: !!required.pending, onPress: () => { if (!required.pending) required.onClose({}); } },
    props: { 'aria-labelledby': titleId, 'data-jini-part': 'kit.dialog', ...required.attrs, className: `jini-dialog ${required.className ?? ''}`.trim(), ref: dialogRef, tabIndex: -1,
      'aria-busy': required.pending,
      onCancel: (event: SyntheticEvent<HTMLDialogElement>) => { event.preventDefault(); if (!required.pending) required.onClose({}); },
      onClick: (event: MouseEvent<HTMLDialogElement>) => { if (event.target === event.currentTarget && !required.pending) required.onClose({}); } } };
}
export function useNativeConfirm(required: ConfirmViewProps, _optional: Record<string, never> = {}) {
  const c = required.controller;
  const vm = useNativeDialog({ open: c.open, title: c.title, pending: c.pending, onClose: () => c.requestDismiss({ reason: 'close' }) },
    { initialFocus: () => c.focusInitial({}) });
  return { ...vm, controller: c, Button: c.nativeActions ? NativeButton : Button,
    props: { ...vm.props, ...c.frameAttrs, className: `jini-dialog jini-confirm-dialog ${c.className ?? ''}`.trim(), role: 'alertdialog' } };
}
