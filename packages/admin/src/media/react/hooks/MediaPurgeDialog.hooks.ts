/** Confirmation safety moved to ui-kit's framework-free controller. Cancel-first focus,
 * pending dismissal/activation and trigger restoration remain enforced for every view. */
export interface MediaPurgeDialogProps {
  readonly filename?: string;
  readonly open: boolean;
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void | Promise<void>;
}

export function useMediaPurgeDialog(props: MediaPurgeDialogProps, _optional: Record<string, never> = {}) {
  return { ...props, actionAccessibleNames: { cancel: 'Cancel', confirm: 'Delete permanently' }, consequence: props.filename
    ? `Permanently delete "${props.filename}"? This cannot be undone.`
    : 'This permanently deletes the file. This cannot be undone.' };
}
