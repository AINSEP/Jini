/**
 * @file A card grid's delete-confirm flow. The delete action and the failure copy are the host's
 * (injected); the document its Escape listener goes on is an injected port defaulting to `document`.
 */
import { useEffect, useState } from 'react';

/** The slice of `document` {@link useDeleteConfirmation} listens on for Escape. */
export type EscapeTarget = Pick<Document, 'addEventListener' | 'removeEventListener'>;

/** Host display policy: the line shown under a card whose delete failed. */
export type DescribeDeleteError = (input: { error: unknown }) => string;

export interface DeleteConfirmationState {
  pendingId: string | null;
  deletingId: string | null;
  deleteError: string | null;
  requestDelete: (input: { id: string }) => void;
  cancelDelete: () => void;
  confirmDelete: (input: { id: string }) => Promise<void>;
}

/**
 * Escape dismisses — but not mid-IME-composition (that Escape belongs to the input method), and
 * not while the delete is already running (the card must stay until the outcome is known).
 */
export function dismissOnEscape(
  { event, dismiss, busy = false }: { event: { key: string; isComposing?: boolean }; dismiss: () => void; busy?: boolean }, _optional = {},
): void {
  if (event.key === 'Escape' && !event.isComposing && !busy) dismiss();
}

/**
 * Which card (if any) is asking to be confirmed, which one is mid-delete, and the error from the
 * last failed attempt.
 *
 * Confirmation lives on the card rather than in a `window.confirm`: a native modal dialog blocks
 * the whole renderer, and in Electron that also freezes the IPC this window answers on.
 *
 * @param input.onDelete the host's delete action; a rejection keeps the card pending for a retry.
 * @param input.describeError the host's copy for a failed delete (its own fallback included).
 * @param options.doc where the Escape listener goes while a card is pending; `document` by default.
 */
export function useDeleteConfirmation(
  { onDelete, describeError }: { onDelete: (id: string) => Promise<void>; describeError: DescribeDeleteError },
  { doc = document }: { doc?: EscapeTarget } = {},
): DeleteConfirmationState {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const requestDelete = ({ id }: { id: string }, _options: Record<string, never> = {}) => {
    setDeleteError(null);
    setPendingId(id);
  };

  const cancelDelete = () => setPendingId(null);
  useEffect(() => {
    if (!pendingId) return undefined;
    const onEscape = (event: KeyboardEvent) => dismissOnEscape({ event, dismiss: cancelDelete, busy: deletingId !== null });
    doc.addEventListener('keydown', onEscape, true);
    return () => doc.removeEventListener('keydown', onEscape, true);
  }, [pendingId, deletingId, doc]);

  const confirmDelete = async ({ id }: { id: string }, _options: Record<string, never> = {}) => {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await onDelete(id);
      setPendingId(null);
    } catch (err) {
      setDeleteError(describeError({ error: err }));
    } finally {
      setDeletingId(null);
    }
  };

  return { pendingId, deletingId, deleteError, requestDelete, cancelDelete, confirmDelete };
}
