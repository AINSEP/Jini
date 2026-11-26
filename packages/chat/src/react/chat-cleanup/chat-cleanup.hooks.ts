import { useCallback, useState, type ButtonHTMLAttributes, type ComponentProps, type ElementType } from "react";
import type { ChatCleanupDialog } from "../components/ChatCleanupDialog.js";
import type { ConversationListHooks, ConversationListItem } from "../components/ConversationList.js";


/**
 * @file The dock's chat cleanup state: optimistic pins, chats hidden after a confirmed deletion,
 * the age preview and its token-bound apply, and delete-selected behind a visible confirmation.
 * No network here: every call goes through the injected {@link ChatCleanupClient}.
 *
 * Why selection or an optimistic pin does not authorize deletion: both are browser-only guesses.
 * A ticked checkbox is a pointer gesture, not consent, so delete-selected still waits for the
 * admin's visible confirmation and then sends `confirm: true` (owner rule d). An optimistic pin is
 * not a saved pin until the server answers, so it can protect nothing; the age cleanup trusts only
 * the server's own preview (which re-reads `pinned` and names every kept chat) and applies only
 * with the token the server issued for that same confirmed preview. The token lives in React state
 * for this mounted dock and is never written to browser storage, so a reload means choosing again.
 */

/** A chat the server kept out of a cleanup, and why (`pinned`, `open`, `active`, `recoverable`, `changed`, `unknown`). */
export interface ChatCleanupKept { id: string; title: string | null; reason: string }
/** `POST cleanup/preview`'s answer: the server's own count, bytes and kept list, plus the token apply needs. */
export interface ChatCleanupPreview { count: number; bytes: number; kept: ChatCleanupKept[]; previewToken: string }
/** `cleanup/apply` and `delete-selected`; a `previewToken` means the same confirmed preview has more to delete. */
export interface ChatCleanupResult { deleted: string[]; kept: ChatCleanupKept[]; previewToken?: string }

/** Every string the cleanup panel and `ChatCleanupDialog` show. */
export interface ChatCleanupCopy {
  dialog: { preview: string; confirm: string; expired: string; choose: string; partial: string; count: (required: { count: number; bytes: number }) => string };
  open: string;
  olderThan: string;
  deleteSelected: (required: { count: number }) => string;
  deleteSelectedBody: string;
  untitled: string;
  reason: (required: { reason: string }) => string;
  errors: { notConfigured: string; invalid: string; failed: string };
}

/** The cleanup half of the admin chat client; the real one is bound in `assistant-chats-dependencies.hooks.ts`. */
export interface ChatCleanupClient {
  setPinned: (required: { id: string; pinned: boolean }) => Promise<{ id: string; pinned: boolean }>;
  preview: (required: { before: number }) => Promise<ChatCleanupPreview>;
  apply: (required: { previewToken: string }) => Promise<ChatCleanupResult>;
  deleteSelected: (required: { ids: readonly string[]; confirm: true }) => Promise<ChatCleanupResult>;
}
export type ChatCleanupKit = { Button: ElementType<ButtonHTMLAttributes<HTMLButtonElement>> };
/** The admin confirm dialog's request (`useConfirmRequest().confirm`). */
export type ChatCleanupConfirm = (required: { dialog: { title: string; body: string; confirmLabel: string; tone: "danger" } }) => Promise<boolean>;
export type ChatCleanupDialogState = ReturnType<ComponentProps<typeof ChatCleanupDialog>["useChatCleanup"]>;

/** Everything the dock header and cleanup panel need; the dock takes it from a required hook prop. */
export interface WiredChatCleanup {
  listHooks: ConversationListHooks;
  kit: ChatCleanupKit;
  copy: ChatCleanupCopy;
  open: boolean;
  setOpen: (open: boolean) => void;
  olderThanDays: number;
  setOlderThanDays: (days: number) => void;
  selectedIds: readonly string[];
  select: (required: { ids: string[] }) => void;
  togglePin: (required: { id: string; pinned: boolean }) => void;
  visibleConversations: <T extends ConversationListItem>(required: { conversations: T[] }) => T[];
  useDialog: () => ChatCleanupDialogState;
  deleteSelected: (required: { confirm: ChatCleanupConfirm }) => Promise<void>;
  error: string | null;
}

const DAY_MS = 86_400_000;
type Phase = { state: "preview" } | { state: "expired" } | { state: "confirm" | "partial"; previewToken: string; count: number; bytes: number; kept: ChatCleanupPreview["kept"] };

/** Plain words for a failed cleanup call; expiry is handled as a state, not an error. @complexity O(1). */
export function cleanupErrorText({ error, copy }: { error: unknown; copy: ChatCleanupCopy }, _optional = {}): string {
  const { status, code } = (error ?? {}) as { status?: number; code?: string };
  if (status === 503 || code === "NOT_CONFIGURED") return copy.errors.notConfigured;
  if (status === 400 || code === "VALIDATION_ERROR") return copy.errors.invalid;
  return copy.errors.failed;
}

const isExpired = (error: unknown) => (error as { code?: string } | null)?.code === "PREVIEW_EXPIRED";

/** Optimistic pins and locally hidden (deleted) chats layered over the dock's conversation list. */
export function useChatListOverlay({ client, onError }: { client: ChatCleanupClient; onError: (error: unknown) => void }, _optional = {}) {
  const [pins, setPins] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const togglePin = useCallback(({ id, pinned }: { id: string; pinned: boolean }) => {
    setPins((map) => new Map(map).set(id, pinned));
    client.setPinned({ id, pinned }).then(
      (saved) => setPins((map) => new Map(map).set(id, saved.pinned)),
      (error) => { setPins((map) => { const next = new Map(map); next.delete(id); return next; }); onError(error); },
    );
  }, [client, onError]);
  const hide = useCallback((ids: readonly string[]) => setHidden((set) => new Set([...set, ...ids])), []);
  const visibleConversations = useCallback(<T extends ConversationListItem>({ conversations }: { conversations: T[] }): T[] =>
    conversations.filter((item) => !hidden.has(item.id)).map((item) => pins.has(item.id) ? { ...item, pinned: pins.get(item.id) } : item), [pins, hidden]);
  return { togglePin, hide, visibleConversations };
}

/** The age chooser's preview → confirm → apply (→ partial continuation) cycle for `ChatCleanupDialog`. */
export function useCleanupPreview({ client, copy, clock, olderThanDays, hide, onError }: {
  client: ChatCleanupClient; copy: ChatCleanupCopy; clock: () => number; olderThanDays: number;
  hide: (ids: readonly string[]) => void; onError: (error: unknown) => void;
}, _optional = {}): () => ChatCleanupDialogState {
  const [phase, setPhase] = useState<Phase>({ state: "preview" });
  const preview = () => {
    if (!Number.isInteger(olderThanDays) || olderThanDays < 1 || olderThanDays > 365) { onError({ code: "VALIDATION_ERROR" }); return; }
    client.preview({ before: clock() - olderThanDays * DAY_MS }).then(
      ({ previewToken, count, bytes, kept }) => setPhase({ state: "confirm", previewToken, count, bytes, kept }), onError);
  };
  const apply = async ({ previewToken }: { previewToken: string; confirm: true }) => {
    // Continue only the confirmed preview this dialog is showing, never a token from elsewhere.
    if ((phase.state !== "confirm" && phase.state !== "partial") || phase.previewToken !== previewToken) return { complete: false };
    try {
      const result = await client.apply({ previewToken });
      hide(result.deleted);
      setPhase(result.previewToken ? { ...phase, state: "partial", previewToken: result.previewToken, kept: result.kept } : { state: "preview" });
      return { complete: !result.previewToken };
    } catch (error) {
      if (isExpired(error)) setPhase({ state: "expired" }); else onError(error);
      return { complete: false };
    }
  };
  const shown = phase.state === "confirm" || phase.state === "partial"
    ? { ...phase, kept: phase.kept.map((item) => ({ id: item.id, title: item.title ?? copy.untitled, reason: copy.reason({ reason: item.reason }) })) }
    : { state: phase.state, count: 0, bytes: 0, kept: [] };
  const choose = () => setPhase({ state: "preview" });
  return () => ({ ...shown, preview, choose, apply });
}

/** Ticked chats and their deletion, which waits for the admin's visible confirmation first. */
export function useSelectedDeletion({ client, copy, hide, onError, clearError }: {
  client: ChatCleanupClient; copy: ChatCleanupCopy; hide: (ids: readonly string[]) => void; onError: (error: unknown) => void; clearError: () => void;
}, _optional = {}) {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const select = useCallback(({ ids }: { ids: string[] }) => setSelectedIds(ids), []);
  const deleteSelected = async ({ confirm }: { confirm: ChatCleanupConfirm }) => {
    const ids = selectedIds;
    if (ids.length === 0) return;
    const label = copy.deleteSelected({ count: ids.length });
    if (await confirm({ dialog: { title: label, body: copy.deleteSelectedBody, confirmLabel: label, tone: "danger" } }) !== true) return;
    try {
      const result = await client.deleteSelected({ ids, confirm: true });
      hide(result.deleted);
      // The server rechecks every id; chats it kept stay ticked so the admin can see them.
      setSelectedIds(result.kept.map((item) => item.id));
      clearError();
    } catch (error) { onError(error); }
  };
  return { selectedIds, select, deleteSelected };
}
