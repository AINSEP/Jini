import { useInvalidate } from '@jini-ai/ui/fetch-query';
import { MEDIA_QUERY_KEYS, useMediaLibraryQuery } from './MediaQuery.hooks.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { TabViewProps } from '../../../core/react/bind-react.js';
import { useController } from '../../../core/react/use-controller.js';
import { createLibraryController } from '../../controllers/library.controller.js';
import { settleFromCache, useSharedMediaLibrary } from './MediaPage.hooks.js';
import { useMediaPorts } from './MediaPorts.hooks.js';
import { mediaMessagesEn } from '../../messages.en.js';
import { canRestoreMedia } from '../../rules.js';
import type { MediaAsset, MediaContentTabId } from '../../models.js';
import type { LibraryState } from '../../controllers/library.controller.js';
import type { MediaApiPort } from '../../ports.js';
type LibraryController = ReturnType<typeof createLibraryController>;
type Announce = (required: { message: string; focus: { id: string; index: number } }) => void;
const EMPTY_LABELS: Readonly<Record<MediaContentTabId, string>> = {
  images: 'No images yet. Upload an image to see it here.',
  videos: 'No videos yet. Upload a video to see it here.',
  all: 'No media found',
};
function contentFilter({ params }: { params: TabViewProps['params'] }, _optional: Record<string, never> = {}): MediaContentTabId {
  return params.filter === 'images' || params.filter === 'videos' ? params.filter : 'all';
}
function libraryPermissions({ permissions, api }: { permissions: readonly string[]; api: MediaApiPort }, _optional: Record<string, never> = {}) {
  return {
    canUpload: permissions.includes('media.upload'),
    canEdit: permissions.includes('media.update'),
    canTrash: permissions.includes('media.trash'),
    canRestore: permissions.includes('media.restore') && canRestoreMedia({ api }),
    canPurge: permissions.includes('media.delete.force'),
  };
}
/** Focuses the card with `id`, else whichever card now sits at `index`, else the grid itself. */
function focusCard({ grid, index }: { grid: HTMLDivElement | null; index: number }, { id }: { id?: string } = {}) {
  const cards = Array.from(grid?.querySelectorAll<HTMLElement>('[data-jini-part="media.card"]') ?? []);
  const byId = id === undefined ? undefined : cards.find(card => card.dataset.mediaId === id);
  const target = byId ?? cards[Math.min(index, cards.length - 1)] ?? grid;
  target?.focus({ preventScroll: true });
}
function queryView({ snapshot }: { snapshot: LibraryState | null }, _optional: Record<string, never> = {}) {
  return {
    statusFilter: snapshot?.query.status ?? 'all',
    orderBy: snapshot?.query.orderBy ?? 'created',
    search: snapshot?.query.search ?? '',
  };
}
function progressView({ snapshot, filter }: { snapshot: LibraryState | null; filter: MediaContentTabId }, _optional: Record<string, never> = {}) {
  return {
    loading: !snapshot || (snapshot.items === null && snapshot.loading && !snapshot.error),
    busy: snapshot?.busy ?? false,
    untyped: filter !== 'all' && snapshot?.hasUntyped === true,
  };
}
function purgeDialogView({ snapshot }: { snapshot: LibraryState | null }, _optional: Record<string, never> = {}) {
  const pending = snapshot?.pendingPurge;
  return { open: !!pending, pending: snapshot?.busy ?? false, ...(pending ? { filename: pending.title } : {}) };
}
function queryHandlers({ controller }: { controller: LibraryController | null }, _optional: Record<string, never> = {}) {
  return {
    onStatus: ({ value }: { value: string }) => {
      const { status: _status, ...query } = controller?.getSnapshot().query ?? {};
      void controller?.setQuery({ query: { ...query, ...(value === 'active' || value === 'trashed' ? { status: value } : {}) } });
    },
    onSearch: ({ value: search }: { value: string }) => {
      void controller?.setQuery({ query: { ...controller.getSnapshot().query, search } });
    },
    onOrder: ({ value }: { value: string }) => {
      void controller?.setQuery({ query: { ...controller.getSnapshot().query, orderBy: value === 'alphabetical' ? 'alphabetical' : 'created' } });
    },
  };
}
function cardActions(
  { items, pendingIds, can, controller, announce, onEdit, onPreview }: {
    items: readonly MediaAsset[]; pendingIds: readonly string[];
    can: ReturnType<typeof libraryPermissions>; controller: LibraryController | null; announce: Announce;
    onEdit: (item: MediaAsset) => void; onPreview: (index: number) => void;
  },
  _optional: Record<string, never> = {},
) {
  return items.map((item, index) => {
    const write = (run: Promise<boolean> | undefined, verb: string) => {
      void run?.then(saved => { if (saved) announce({ message: `${verb} ${item.title}`, focus: { id: item.id, index } }); });
    };
    return {
      item,
      busy: pendingIds.includes(item.id),
      ...(can.canEdit ? { onEdit: () => onEdit(item) } : {}),
      onPreview: () => onPreview(index),
      ...(can.canTrash ? { onTrash: () => write(controller?.trash({ id: item.id }), 'Trashed') } : {}),
      ...(can.canRestore ? { onRestore: () => write(controller?.restore({ id: item.id }), 'Restored') } : {}),
      ...(can.canPurge ? { onPurge: () => controller?.requestPurge({ item }) } : {}),
    };
  });
}
/** Once a write has settled and the grid re-rendered, return focus to the affected card. */
function useFocusAfterWrites(
  { gridRef, snapshot }: { gridRef: RefObject<HTMLDivElement | null>; snapshot: LibraryState | null },
  _optional: Record<string, never> = {},
) {
  const [focusAfterAction, setFocusAfterAction] = useState<{ id: string; index: number } | null>(null);
  useLayoutEffect(() => {
    if (!focusAfterAction || snapshot?.busy || snapshot?.loading) return;
    focusCard({ grid: gridRef.current, index: focusAfterAction.index }, { id: focusAfterAction.id }); setFocusAfterAction(null);
  }, [focusAfterAction, snapshot?.busy, snapshot?.loading, snapshot?.items]);
  const [focusAfterPurge, setFocusAfterPurge] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (focusAfterPurge === null || snapshot?.pendingPurge || snapshot?.busy) return;
    focusCard({ grid: gridRef.current, index: focusAfterPurge }); setFocusAfterPurge(null);
  }, [focusAfterPurge, snapshot?.pendingPurge, snapshot?.busy, snapshot?.items]);
  return { setFocusAfterAction, setFocusAfterPurge };
}
export function useLibraryTab(
  { params, permissions = [] }: TabViewProps,
  _optional: Record<string, never> = {},
) {
  const { mediaApi, mediaEvents } = useMediaPorts();
  const filter = contentFilter({ params });
  const shared = useSharedMediaLibrary();
  const cached = useMediaLibraryQuery({ api: mediaApi }, { enabled: !shared });
  const invalidate = useInvalidate();
  const local = useController(
    {
      create: () => createLibraryController({ api: cached.api }, { query: { filter } }),
      dependencies: [cached.api, filter],
    },
    {
      start: ({ controller }) => {
        if (!shared) void controller.load();
      },
    },
  );
  const { controller, snapshot } = shared ?? local;
  useEffect(() => !shared ? mediaEvents?.subscribe({ onRefresh: () => invalidate({ key: MEDIA_QUERY_KEYS.root }) }) : undefined, [mediaEvents, controller, shared, invalidate]);
  useEffect(() => { if (!shared) settleFromCache({ controller: local.controller, query: cached.query }); }, [shared, local.controller, cached.query.data, cached.query.error]);
  const gridRef = useRef<HTMLDivElement>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { setFocusAfterAction, setFocusAfterPurge } = useFocusAfterWrites({ gridRef, snapshot });
  useEffect(() => {
    // A shared page controller survives tab unmounts. Re-entering after an error must
    // be a recovery opportunity even when its cached filter already matches this tab.
    if (controller?.getSnapshot().error && !controller.getSnapshot().loading) void controller.load();
  }, [controller]);
  const [editing, setEditing] = useState<MediaAsset | null>(null);
  // Lightbox — an index into the list, not the item itself, so arrow-key/navigation
  // buttons move the number without re-deriving "what's next" from an item reference.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const items = snapshot?.items ?? [], pendingIds = snapshot?.pendingIds ?? [];
  const can = libraryPermissions({ permissions, api: mediaApi });
  const announce: Announce = ({ message, focus }) => { setSuccess(message); setFocusAfterAction(focus); };
  const actions = cardActions({ items, pendingIds, can, controller, announce, onEdit: setEditing, onPreview: setLightboxIndex });
  function closeEdit() {
    setEditing(null);
  }
  async function saved({ message }: { message?: string } = {}) {
    const item = editing;
    closeEdit();
    // Reread the authoritative version after replacement before announcing completion;
    // both card and lightbox obtain their versioned byte URL from the refreshed rows.
    await controller?.load();
    if (message) setSuccess(message);
    if (item) setFocusAfterAction({ id: item.id, index: Math.max(0, items.findIndex(row => row.id === item.id)) });
  }
  return {
    emptyLabel: EMPTY_LABELS[filter],
    canUpload: can.canUpload,
    success,
    gridRef,
    onRetry: () => { void controller?.load(); },
    canPurge: can.canPurge,
    controller,
    snapshot,
    actions,
    items,
    mediaApi,
    editing,
    closeEdit,
    saved,
    lightboxIndex,
    onNavigate: setLightboxIndex,
    closeLightbox: () => setLightboxIndex(null),
    ...queryHandlers({ controller }),
    ...queryView({ snapshot }),
    ...progressView({ snapshot, filter }),
    purgeDialog: purgeDialogView({ snapshot }),
    async upload({ input, alt }: Parameters<LibraryController['upload']>[0]) {
      if (!can.canUpload) return false;
      const result = await controller?.upload({ input, ...(alt === undefined ? {} : { alt }) }) ?? false;
      if (result) gridRef.current?.focus({ preventScroll: true });
      return result;
    },
    cancelPurge: () => controller?.cancelPurge(),
    confirmPurge: () => {
      const item = controller?.getSnapshot().pendingPurge;
      // The controller refuses to purge without a pending item, so there is nothing to announce.
      if (!can.canPurge || !controller || !item) return;
      const index = items.findIndex(row => row.id === item.id);
      return controller.confirmPurge({ confirmed: true }).then(saved => {
        if (saved) {
          setSuccess(`Deleted permanently ${item.title}`);
          setFocusAfterPurge(Math.max(0, index));
        }
      });
    },
    t: mediaMessagesEn,
  };
}
