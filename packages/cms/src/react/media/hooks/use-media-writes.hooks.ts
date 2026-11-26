import { useState } from "react";

import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import type { FetchQueryAdapter, QueryKey } from "@jini-ai/core/fetch";
import type { MediaUploadResult } from "@jini-ai/core/contracts/site/cms-media";

/**
 * @file The Media grid's writes: upload, trash, restore and the confirmed permanent delete, plus the
 * row-action state they share. Moved out of `use-media.hooks.ts` with their decision-record comments.
 * Why-comment — every write invalidates `KEYS.list`, the prefix of every grid key, so the server
 * re-reads page one (and its counts) after the write rather than this screen patching rows it holds:
 * a paged grid cannot know where a changed row now sorts, or whether its tab still contains it.
 */

/** What {@link useMediaWrites} needs; the mutation hook is injected like every other hook. */
export interface MediaWritesDeps {
  port: {
    uploadMedia: (input: { filename: string; contentType: string; dataBase64: string }, options?: { alt?: string | undefined }) => Promise<MediaUploadResult<AdminMedia>>;
    trashMedia: (id: string) => Promise<{ media: AdminMedia }>;
    deleteMedia: (id: string) => Promise<{ purged: boolean }>;
    restoreMedia: (id: string) => Promise<{ restored: boolean }>;
  };
  deps: { KEYS: { list: QueryKey }; translate: (required: { locale: string; key: string }) => string };
  locale: string;
  useFetchMutation: FetchQueryAdapter["useFetchMutation"];
}

type UploadInput = { filename: string; contentType: string; dataBase64: string; alt?: string | undefined };

/** Everything the screen reads from its writes: the four mutations (their `error`s feed the screen's
 *  banner and the upload dialog), the restore fallback copy, and the row actions. */
export interface MediaWrites extends ReturnType<typeof useWriteMutations> {
  /** Resets every write's failure except `active`'s — see {@link useMediaWrites}. */
  clearOtherWriteErrors: (active: { reset: () => void }) => void;
  trash: (item: AdminMedia) => Promise<void>;
  restore: (item: AdminMedia) => Promise<void>;
  pendingPurge: AdminMedia | null;
  setPendingPurge: (item: AdminMedia | null) => void;
  rowSavingId: string | null;
  purge: () => Promise<void>;
}

/** The four independent writes, each invalidating the grid. @complexity O(1). */
function useWriteMutations({ port, locale, useFetchMutation, deps }: MediaWritesDeps, _optional: Record<string, never> = {}) {
  const { KEYS, translate } = deps;
  const uploadMutation = useFetchMutation({
    run: ({ input }: { input: UploadInput }) =>
      port.uploadMedia({ filename: input.filename, contentType: input.contentType, dataBase64: input.dataBase64 }, { alt: input.alt }),
  }, {
    invalidates: [KEYS.list],
  });
  const trashMutation = useFetchMutation({ run: ({ input: id }: { input: string }) => port.trashMedia(id) }, { invalidates: [KEYS.list] });
  const purgeMutation = useFetchMutation({ run: ({ input: id }: { input: string }) => port.deleteMedia(id) }, { invalidates: [KEYS.list] });
  const restoreFallback = translate({ locale: locale, key: "failed to restore" });
  const restoreMutation = useFetchMutation({
    run: async ({ input: id }: { input: string }) => {
      // The Trash answers a refused restore (changed or gone row) with 200 + `restored: false`.
      const { restored } = await port.restoreMedia(id);
      if (!restored) throw new Error(restoreFallback);
    },
  }, { invalidates: [KEYS.list] });
  return { uploadMutation, trashMutation, purgeMutation, restoreMutation, restoreFallback };
}

/**
 * The writes plus the per-row action state (`pendingPurge`/`rowSavingId` stay local `useState`: a
 * shared mutation object cannot carry "which row" on its own).
 * @complexity O(1) per call; each write is one request plus one grid re-read.
 */
export function useMediaWrites(required: MediaWritesDeps, _optional: Record<string, never> = {}): MediaWrites {
  const mutations = useWriteMutations(required);
  const { uploadMutation, trashMutation, purgeMutation, restoreMutation } = mutations;
  const [pendingPurge, setPendingPurge] = useState<AdminMedia | null>(null);
  const [rowSavingId, setRowSavingId] = useState<string | null>(null);

  const writes = [uploadMutation, trashMutation, purgeMutation, restoreMutation];
  /** Clears the OTHER writes' failures before starting one — same shape/reasoning as
   *  `Jini redirects/SOURCE-RATIONALE.md`'s `clearOtherWriteErrors` (see `Jini redirects/SOURCE-RATIONALE.md`'s own copy): three
   *  independent mutations each keep their own error until reset, so a stale failure from one must
   *  not survive past the start of an unrelated one. */
  function clearOtherWriteErrors(active: { reset: () => void }) {
    for (const write of writes) if (write !== active) write.reset();
  }

  async function trash(item: AdminMedia) {
    clearOtherWriteErrors(trashMutation);
    setRowSavingId(item.id);
    try {
      await trashMutation.mutate({ input: item.id });
    } catch {
      // already surfaced through trashMutation.error -> error below
    } finally {
      // Self-referential: only clear THIS call's own id. `trash` has no confirm step, so it can
      // start on a different row at any time — including while a `purge` confirmation (see below)
      // is genuinely still in flight on ANOTHER item. `rowSavingId` is the ONE field both actions
      // share; an unconditional reset here would clobber that unrelated purge's busy signal the
      // instant this trash happens to settle, flipping `MediaPurgeDialog`'s `pending` prop to
      // `false` mid-request and re-enabling Confirm/Escape/backdrop dismissal for a destructive
      // delete that has not actually finished. Same shape as `use-widgets-library.hooks.ts`'s
      // `purge`'s `pendingForcePurge` reset.
      setRowSavingId((current) => (current === item.id ? null : current));
    }
  }

  async function restore(item: AdminMedia) {
    clearOtherWriteErrors(restoreMutation);
    setRowSavingId(item.id);
    try {
      await restoreMutation.mutate({ input: item.id });
    } catch {
      // already surfaced through restoreMutation.error -> error below
    } finally {
      // Self-referential for the same reason `trash`'s own finally is — see its comment above.
      setRowSavingId((current) => (current === item.id ? null : current));
    }
  }

  async function purge() {
    if (!pendingPurge) return;
    const item = pendingPurge;
    clearOtherWriteErrors(purgeMutation);
    setRowSavingId(item.id);
    try {
      await purgeMutation.mutate({ input: item.id });
    } catch {
      // already surfaced through purgeMutation.error -> error below
    } finally {
      // Self-referential for the same reason `trash`'s own finally now is — see its comment above.
      // `pendingPurge` itself cannot be reassigned to a different item while THIS purge is in
      // flight (opening a new purge confirmation requires the native `<dialog>`'s modal focus trap
      // to release first, and `pending` blocks Escape/backdrop dismissal), so its own reset stays
      // guarded here purely for symmetry with `rowSavingId` and to stay correct if that invariant
      // ever changes.
      setRowSavingId((current) => (current === item.id ? null : current));
      setPendingPurge((current) => (current?.id === item.id ? null : current));
    }
  }

  return { ...mutations, clearOtherWriteErrors, trash, restore, pendingPurge, setPendingPurge, rowSavingId, purge };
}
