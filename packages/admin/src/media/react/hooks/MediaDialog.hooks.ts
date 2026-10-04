import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { DialogProps } from '@jini-ai/ui-kit/react';
export interface MediaDialogProps extends Omit<DialogProps, 'ref'> {
  readonly dialogRef?: RefObject<HTMLDialogElement | null>;
}
export function useMediaDialog(props: MediaDialogProps, _optional: Record<string, never> = {}): { open: boolean; dialogProps: DialogProps } {
  const localRef = useRef<HTMLDialogElement>(null);
  const ref = props.dialogRef ?? localRef;
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!props.open || !dialog) return;
    // The kit default contributes a Close even when a feature provides its guarded,
    // agent-addressable Cancel/Close. Hide only that known default marker; custom kit
    // views keep their own structure. Retain the kit's modal/pending/focus lifecycle.
    const duplicate = dialog.querySelector<HTMLElement>('[data-jini-part="kit.dialog-close"]');
    if (duplicate) duplicate.hidden = true;
    dialog.querySelector<HTMLElement>('[data-jini-autofocus]')?.focus({ preventScroll: true });
    dialog.scrollTop = 0;
  }, [props.open, ref]);
  return { open: props.open, dialogProps: { ...props, ref } };
}
