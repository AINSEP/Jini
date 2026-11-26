import { useCallback, useRef, useState, type Dispatch, type SetStateAction, type RefObject } from "react";
import type { AdminMedia, MediaGridPage, MediaGridTab } from "@jini-ai/core/contracts/site/cms-admin-media";
import type { MediaConversionNotice, MediaUploadResult } from "@jini-ai/core/contracts/site/cms-media";
import type { FetchQueryAdapter, MutationResult, QueryKey } from "@jini-ai/core/fetch";
import { KEYS, MEDIA_RESOURCE, findEditingItem, visibleMediaError, type MediaOrderBy } from "../rules.js";
import type { MediaPort } from "./media-port.hooks.js";

/**
 * @file Everything the top-level Media grid screen does, so `Media()` in `Media.tsx` is only
 * markup.
 *
 * Extracted verbatim — same state, same order, same effect, same error handling. The doc comments
 * below moved WITH the state and functions they describe — several are decision records (why
 * trashing has no confirm step but purge does, why the lightbox tracks an index rather than an
 * item) and a comment separated from its code stops being read.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local
 * because nothing outside `features/media` needs it.
 *
 * `port`/`locale` are injected (see `media-port.hooks.ts` and the `useWiredX` convention doc at
 * `development/docs/architecture/wired-hooks-convention.md`) rather than reaching for `lib/api`'s
 * `api` and `useAdminLocale()` directly, so a test can describe list/write outcomes against
 * `createFakeMediaPort` instead of stubbing global `fetch`. `media-i18n.ts`'s own `t(locale, key)`
 * — aliased `translate` here to avoid colliding with this file's own bound `(key) => string`
 * closure — stays a direct import for this hook's OWN error strings: a pure `DICT[locale]?.[key]
 * ?? key` lookup with no host boundary, same category as `describeApiError` (unlike
 * `mediaOriginalUrl`, which DID move onto `MediaPort` on 2026-08-14 — see `media-port.hooks.ts`'s
 * header; a lookup with no external route to fake is a different case from a URL builder whose
 * whole point is to prove which client produced the string). `useWiredMedia` below is the
 * zero-argument pair `Media.tsx` actually mounts.
 *
 * `t`/`locale` are ALSO returned from {@link useMedia} (standing i18n rule, 2026-08-11 — a
 * component with a hook gets a BOUND `t` from that hook, not its own `useAdminLocale()`/dictionary
 * import, same shape `use-pages.hooks.ts` established) purely so `Media.tsx` — and the
 * `MediaPreview`/`EditMediaPanel`/`MediaLightbox`/`MediaToolbar`/`MediaPurgeDialog` sub-components
 * it threads `t` into as a prop — have somewhere to source their UI copy. `locale` itself is
 * exposed too, not just `t`: `Media.tsx` passes the raw string on to `mediaRowMenuItems`
 * (`../rules.ts`), which keeps its own independent `MEDIA_DICT[locale]?.[key] ?? key` closure
 * unchanged — same "row-menu builder is a different, out-of-scope thing" precedent
 * `use-pages.hooks.ts` cites for `pageRowMenuItems`.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the list read is `useFetchQuery({ key: KEYS.list, ...
 * })`; `upload`/`trash`/`purge` are three independent `useFetchMutation`s that each `invalidates:
 * [KEYS.list]` instead of calling `load()` by hand. `rules.ts`'s `KEYS` doc explains why there is no
 * separate "detail" key for `EditMediaPanel` to trip over the sibling-vs-nested trap
 * `forms`/`collections` both hit — it has no read of its own. `clearOtherWriteErrors` mirrors
 * `Jini redirects/SOURCE-RATIONALE.md`'s identical-purpose helper: three independent mutations each keep their OWN
 * error until reset, so starting one must clear the other two or a stale failure could survive past
 * a later, unrelated success. `pendingPurge`/`rowSavingId` stay local `useState` per this migration's
 * own dispatch brief (`media` has per-row action state — a shared mutation object cannot carry
 * "which row" on its own).
 *
 * `useContentRefreshSubscription` (staleness-bug generalization pass — see that hook's own header):
 * re-invalidates `KEYS.list` on an out-of-band content-refresh notification, the same one-line
 * adoption `use-taxonomy.hooks.ts` hand-wrote before this shared hook existed to wrap it.
 */

export interface MediaDependencies {
  port: MediaPort & {
    listMediaGrid: (required: { tab: MediaGridTab; orderBy: MediaOrderBy }, optional?: { limit?: number; cursor?: string; itemId?: string }) => Promise<MediaGridPage>;
  };
  tab: MediaGridTab; itemId?: string | null | undefined; locale: string; t: (key: string) => string;
  hooks: Pick<FetchQueryAdapter, "useFetchQuery" | "useFetchMutation" | "useInvalidate"> & {
    useContentRefreshSubscription: (required: { resource: string; onRefresh: () => void }) => void;
    useGridPages: (required: { port: MediaDependencies["port"]; tab: MediaGridTab; orderBy: MediaOrderBy; useFetchQuery: FetchQueryAdapter["useFetchQuery"]; listKey: QueryKey; useCallback: typeof useCallback; useState: typeof useState }, optional?: { itemId?: string | null | undefined }) => {
      items: AdminMedia[] | null; exactItem: AdminMedia | null; counts: MediaGridPage["counts"] | null; retentionDays: number | null;
      hasUntypedActive: boolean; error: Error | null; hasMore: boolean; loadingMore: boolean;
      loadMoreError: Error | null; loadMore: () => Promise<void>; retryLoadMore: () => Promise<void>;
    };
    useMediaWrites: (required: { port: MediaDependencies["port"]; locale: string; useFetchMutation: FetchQueryAdapter["useFetchMutation"]; useState: typeof useState; deps: { KEYS: { list: QueryKey }; translate: MediaDependencies["deps"]["translate"] } }, optional?: Record<string, never>) => {
      uploadMutation: MutationResult<{ filename: string; contentType: string; dataBase64: string; alt?: string | undefined }, MediaUploadResult<AdminMedia>>;
      trashMutation: MutationResult<string, { media: AdminMedia }>;
      purgeMutation: MutationResult<string, { purged: boolean }>;
      restoreMutation: MutationResult<string, void>;
      restoreFallback: string; clearOtherWriteErrors: (active: { reset: () => void }) => void;
      trash: (item: AdminMedia) => Promise<void>; restore: (item: AdminMedia) => Promise<void>;
      pendingPurge: AdminMedia | null; setPendingPurge: (item: AdminMedia | null) => void;
      rowSavingId: string | null; purge: () => Promise<void>;
    };
  };
  deps: {
    maxJsonUploadBytes: number;
    readFileAsBase64: (required: { file: File }) => Promise<string>;
    translate: (required: { locale: string; key: string }) => string;
    describeApiError: (required: { e: unknown; fallback: string }) => string;
    sizeRefusalFromError: (required: { t: (key: string) => string; error: unknown }) => string | null;
  };
}

export interface MediaController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  media: AdminMedia[] | null;
  error: string | null;
  uploading: boolean;
  // Upload dialog (owner item #9, 2026-10-13): the page shows one "Upload image" button; the file,
  // alt text and submit live in a dialog that closes only after a successful upload, so a failure
  // stays next to the file the operator can retry. Upload failures (including a file that could
  // not be read) show there, not in the page banner `error`.
  uploadOpen: boolean;
  openUpload: (event: Pick<React.MouseEvent<HTMLButtonElement>, "currentTarget">) => void;
  closeUpload: () => void;
  uploadError: string | null;
  /** The fixed code the last accepted upload answered with when its playable copy could not be made, or
   *  `null`. The upload itself succeeded, so this is a status beside the grid, never an error. */
  conversionNotice: MediaConversionNotice | null;
  /** A file is chosen and no upload is running; alt text is optional and never blocks. */
  canUpload: boolean;
  altDraft: string;
  setAltDraft: (value: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  selectedFileName: string;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  upload: (event?: Pick<React.FormEvent, "preventDefault">) => Promise<void>;
  /** The id of the media item whose `EditMediaPanel` is expanded, or `null` when none is. */
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  /** The loaded rows plus the deep-link asset when it came from an exact lookup (it is not a grid row). */
  lookupMedia: AdminMedia[] | null;
  /** Workspace-wide tab counts from the server; `null` until the first page settles. */
  counts: MediaGridPage["counts"] | null;
  retentionDays: number | null;
  /** Some untrashed asset has no recorded content type (server-counted over the whole workspace). */
  hasUntypedActive: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  /** The failure of the last "Load more", kept next to the button so Retry stays in place. */
  loadMoreError: string | null;
  loadMore: () => Promise<void>;
  /** `findEditingItem(media, editingId)`, resolved here so the view never searches `media`
   *  itself. */
  editingItem: AdminMedia | null;
  /** Opens `EditMediaPanel` for `item`, or closes it if it is already the one expanded. */
  toggleEditing: (item: AdminMedia) => void;
  /** Closes the edit panel and reloads — the `EditMediaPanel`'s `onSaved` callback. */
  onMetadataSaved: () => void;
  trash: (item: AdminMedia) => Promise<void>;
  /** Puts a trashed item back in the library (the Trash tab's Restore button). */
  restore: (item: AdminMedia) => Promise<void>;
  // Purge (permanent delete) confirmation — mirrors `Posts.tsx`'s `pendingDelete`/`rowSavingId`
  // pair exactly. Trashing (the reversible first rung of the ladder) has no confirm step, matching
  // the original `window.confirm` call's own scope: it only ever guarded the permanent-delete path.
  pendingPurge: AdminMedia | null;
  setPendingPurge: (item: AdminMedia | null) => void;
  /** In-flight row action (Trash, or the confirmed permanent delete) — one at a time. */
  rowSavingId: string | null;
  purge: () => Promise<void>;
  // Lightbox — an index into `media`, not the item itself, so `MediaLightbox`'s own arrow-key/nav-
  // button navigation can move this number directly without this component re-deriving "what's
  // next" from an item reference. `null` is closed, mirroring `pendingPurge`'s own null-is-closed
  // convention for the other dialog already driven from this component.
  lightboxIndex: number | null;
  setLightboxIndex: (index: number | null) => void;
  // "Order by" control (owner-directed, 2026-09-11) — plain `useState`, not URL-deep-linked like
  // `activeTab` (`use-media-tabs.hooks.ts`'s `?tab=`): the owner asked for a visible, changeable
  // control, not a bookmarkable view, and `Media.tsx`'s own `sortMediaByOrder` (`rules.ts`) does
  // the actual reordering of the already-fetched `media` array — this hook only owns which choice
  // is currently selected.
  orderBy: MediaOrderBy;
  setOrderBy: (value: MediaOrderBy) => void;
  /** Bound translator — see this file's own header for why it arrives via the hook rather than
   *  `Media.tsx` calling `useAdminLocale()`/`MEDIA_DICT` directly. */
  t: (key: string) => string;
  /** The raw resolved locale — exposed only because `mediaRowMenuItems` (`../rules.ts`) genuinely
   *  needs it, not `t`. */
  locale: string;
}

const SIZE_REFUSAL = Symbol("media-json-upload-size-refusal");

/**
 * The operator-facing text for a failed upload, or `null` when there is no failure. A typed size
 * refusal gets the owner copy; every other failure keeps the generic description. @complexity O(1).
 */
function describeUploadFailure({ failure, locale, deps }: { failure: unknown; locale: string; deps: MediaDependencies["deps"] }, _optional: Record<string, never> = {}): string | null {
  if (!failure) return null;
  if (failure === SIZE_REFUSAL) return deps.translate({ locale, key: "This file is too large to upload here. The limit is {limit} MiB." })
    .replace("{limit}", String(deps.maxJsonUploadBytes / (1024 * 1024)));
  return deps.sizeRefusalFromError({ t: (key) => deps.translate({ locale, key }), error: failure })
    ?? deps.translate({ locale, key: deps.describeApiError({ e: failure, fallback: "upload failed" }) });
}

  async function upload({ event, uploadInFlight, fileInputRef, setUploading, setReadError, setConversionNotice, clearOtherWriteErrors, uploadMutation, altDraft, setAltDraft, setSelectedFileName, setUploadOpen, deps }: {
    event: Pick<React.FormEvent, "preventDefault"> | undefined; uploadInFlight: RefObject<boolean>; fileInputRef: RefObject<HTMLInputElement | null>;
    setUploading: Dispatch<SetStateAction<boolean>>; setReadError: Dispatch<SetStateAction<unknown>>;
    setConversionNotice: Dispatch<SetStateAction<MediaConversionNotice | null>>;
    clearOtherWriteErrors: (active: { reset: () => void }) => void;
    uploadMutation: ReturnType<MediaDependencies["hooks"]["useMediaWrites"]>["uploadMutation"];
    altDraft: string; setAltDraft: Dispatch<SetStateAction<string>>; setSelectedFileName: Dispatch<SetStateAction<string>>;
    setUploadOpen: Dispatch<SetStateAction<boolean>>; deps: MediaDependencies["deps"];
  }, _optional = {}) {
    event?.preventDefault();
    if (uploadInFlight.current) return;
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    // FileReader runs before the mutation. Take the guard synchronously so a second click
    // (including one before React renders the disabled button) cannot start another upload.
    uploadInFlight.current = true;
    setUploading(true);
    setReadError(null);
    setConversionNotice(null);
    clearOtherWriteErrors(uploadMutation);
    try {
      if (file.size > deps.maxJsonUploadBytes) {
        setReadError(SIZE_REFUSAL);
        return;
      }
      const dataBase64 = await deps.readFileAsBase64({ file }).catch((readFailure: unknown) => {
        setReadError(readFailure);
        throw readFailure;
      });
      const result = await uploadMutation.mutate({ input: { filename: file.name, contentType: file.type, dataBase64, alt: altDraft.trim() || undefined } });
      setConversionNotice(result.conversionNotice ?? null);
      setAltDraft("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSelectedFileName("");
      setUploadOpen(false);
    } catch {
      // already surfaced through readError/uploadMutation.error -> uploadError below
    } finally {
      uploadInFlight.current = false;
      setUploading(false);
    }
  }

  function openUpload({ event, setReadError, uploadMutation, setUploadOpen }: {
    event: Pick<React.MouseEvent<HTMLButtonElement>, "currentTarget">; setReadError: Dispatch<SetStateAction<unknown>>;
    uploadMutation: { reset: () => void }; setUploadOpen: Dispatch<SetStateAction<boolean>>;
  }, _optional = {}) {
    // Pointer clicks do not focus buttons in every browser; the dialog restores focus to the opener.
    event.currentTarget.focus({ preventScroll: true });
    // A reopened dialog starts without the last attempt's failure; the chosen file and alt stay.
    setReadError(null);
    uploadMutation.reset();
    setUploadOpen(true);
  }

  // Newest-first, matching `SqliteMediaRepo.list()`'s own default — an operator who never touches
  // the new control sees exactly today's order, unchanged. The SERVER orders; see `use-grid-pages.hooks.ts`.
  // Stable identity (not an inline arrow) so `useContentRefreshSubscription`'s own effect does not
  // unsubscribe/resubscribe on every render — `KEYS.list` is a module-level constant, so the only
  // thing this closure ever needs is `invalidate`, itself already stable per `useInvalidate`'s doc.
  // FileReader runs before the mutation, so its failure never reaches `uploadMutation.error`.
  // Per-request outcome of the upload that stored the original; a new accepted upload replaces it.

export function useMedia({ port, locale, t, tab, itemId, hooks, deps }: MediaDependencies, _optional = {}): MediaController {
  const [orderBy, setOrderBy] = useState<MediaOrderBy>("created");
  const list = hooks.useGridPages({ port, tab, orderBy, useFetchQuery: hooks.useFetchQuery, listKey: KEYS.list, useCallback, useState }, { itemId });
  const invalidate = hooks.useInvalidate();
  const invalidateList = useCallback(() => invalidate({ key: KEYS.list }), [invalidate]);
  hooks.useContentRefreshSubscription({ resource: MEDIA_RESOURCE, onRefresh: invalidateList });
  const [altDraft, setAltDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadInFlight = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [readError, setReadError] = useState<unknown>(null);
  const [conversionNotice, setConversionNotice] = useState<MediaConversionNotice | null>(null);
  const onFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFileName(event.currentTarget.files?.[0]?.name ?? "");
  }, []);
  const { uploadMutation, trashMutation, purgeMutation, restoreMutation, restoreFallback, clearOtherWriteErrors, trash, restore, pendingPurge, setPendingPurge, rowSavingId, purge } =
    hooks.useMediaWrites({ port, locale, useFetchMutation: hooks.useFetchMutation, useState, deps: { KEYS, translate: deps.translate } });
  const media = list.items;
  const lookupMedia = media && list.exactItem ? [...media, list.exactItem] : media;
  // Local FileReader errors bypass the mutation; translate known copy while retaining diagnostics.
  const uploadError = describeUploadFailure({ failure: readError ?? uploadMutation.error, locale, deps });
  const error = visibleMediaError({ trashError: trashMutation.error, purgeError: purgeMutation.error,
    deleteFallback: deps.translate({ locale: locale, key: "delete failed" }), restoreError: restoreMutation.error,
    restoreFallback, listError: list.error, listFallback: deps.translate({ locale: locale, key: "failed to load media" }),
    hasMedia: media !== null, describeApiError: deps.describeApiError });
  return {
    media, error, uploading, uploadOpen,
    openUpload: event => openUpload({ event, setReadError, uploadMutation, setUploadOpen }), closeUpload: () => setUploadOpen(false),
    uploadError, conversionNotice, canUpload: selectedFileName !== "" && !uploading, altDraft, setAltDraft, fileInputRef, selectedFileName, onFileChange,
    upload: event => upload({ event, uploadInFlight, fileInputRef, setUploading, setReadError, setConversionNotice, clearOtherWriteErrors, uploadMutation, altDraft, setAltDraft, setSelectedFileName, setUploadOpen, deps }),
    editingId, setEditingId, lookupMedia, counts: list.counts, retentionDays: list.retentionDays, hasUntypedActive: list.hasUntypedActive,
    hasMore: list.hasMore, loadingMore: list.loadingMore, loadMoreError: list.loadMoreError ? deps.translate({ locale, key: "more media could not be loaded" }) : null,
    loadMore: list.loadMore, editingItem: findEditingItem({ media: lookupMedia, editingId }),
    toggleEditing: item => setEditingId((id) => (id === item.id ? null : item.id)), onMetadataSaved: () => setEditingId(null),
    trash, restore, pendingPurge, setPendingPurge, rowSavingId, purge, lightboxIndex, setLightboxIndex, orderBy, setOrderBy, t, locale,
  };
}

export function bindMedia({ hooks, deps }: {
  hooks: MediaDependencies["hooks"] & { useLocaleHook: () => string };
  deps: MediaDependencies["deps"] & { port: MediaDependencies["port"] };
}, _optional = {}) {
  return function useBoundMedia({ tab, itemId }: Pick<MediaDependencies, "tab" | "itemId">, _optional = {}): MediaController {
    const locale = hooks.useLocaleHook();
    const t = (key: string): string => deps.translate({ locale: locale, key: key });
    return useMedia({ port: deps.port, tab, itemId, locale, t, hooks, deps });
  };
}
