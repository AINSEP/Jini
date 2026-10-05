import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TabViewProps } from '../../../react/bind-react.js';
import { useController } from '../../../react/use-controller.js';
import { createLibraryController } from '../../controllers/library.controller.js';
import { useSharedMediaLibrary } from './MediaPage.hooks.js';
import { useMediaPorts } from './MediaPorts.hooks.js';
import { mediaMessagesEn } from '../../messages.en.js';
import { canRestoreMedia } from '../../rules.js';
import type { MediaAsset, MediaContentTabId } from '../../models.js';
export function useLibraryTab(
  { params, permissions = [] }: TabViewProps,
  _optional: Record<string, never> = {},
) {
  const { mediaApi, mediaEvents } = useMediaPorts();
  const filter: MediaContentTabId =
    params.filter === 'images' || params.filter === 'videos' ? params.filter : 'all';
  const shared = useSharedMediaLibrary();
  const local = useController(
    {
      create: () => createLibraryController({ api: mediaApi }, { query: { filter } }),
      dependencies: [mediaApi, filter],
    },
    {
      start: ({ controller }) => {
        if (!shared) void controller.load();
      },
    },
  );
  const { controller, snapshot } = shared ?? local;
  useEffect(() => !shared ? mediaEvents?.subscribe({ onRefresh: () => { void controller?.load(); } }) : undefined, [mediaEvents, controller, shared]);
  const gridRef = useRef<HTMLDivElement>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [focusAfterAction, setFocusAfterAction] = useState<{ id: string; index: number } | null>(null);
  useLayoutEffect(() => {
    if (!focusAfterAction || snapshot?.busy || snapshot?.loading) return;
    const cards = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-jini-part="media.card"]') ?? []);
    const target = cards.find(card => card.dataset.mediaId === focusAfterAction.id) ?? cards[Math.min(focusAfterAction.index, cards.length - 1)] ?? gridRef.current;
    target?.focus({ preventScroll: true }); setFocusAfterAction(null);
  }, [focusAfterAction, snapshot?.busy, snapshot?.loading, snapshot?.items]);
  const [focusAfterPurge, setFocusAfterPurge] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (focusAfterPurge === null || snapshot?.pendingPurge || snapshot?.busy) return;
    const grid = gridRef.current;
    const cards = grid?.querySelectorAll<HTMLElement>('[data-jini-part="media.card"]');
    const target = cards?.[Math.min(focusAfterPurge, cards.length - 1)] ?? grid;
    target?.focus({ preventScroll: true }); setFocusAfterPurge(null);
  }, [focusAfterPurge, snapshot?.pendingPurge, snapshot?.busy, snapshot?.items]);
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
  const canUpload = permissions.includes('media.upload');
  const canEdit = permissions.includes('media.update');
  const canTrash = permissions.includes('media.trash');
  const canRestore = permissions.includes('media.restore') && canRestoreMedia({ api: mediaApi });
  const canPurge = permissions.includes('media.delete.force');
  const actions = items.map((item, index) => ({
    item,
    busy: pendingIds.includes(item.id),
    ...(canEdit ? { onEdit: () => setEditing(item) } : {}),
    onPreview: () => setLightboxIndex(index),
    ...(canTrash
      ? {
          onTrash: () => {
            void controller?.trash({ id: item.id }).then(saved => { if (saved) { setSuccess(`Trashed ${item.title}`); setFocusAfterAction({ id: item.id, index }); } });
          },
        }
      : {}),
    ...(canRestore ? { onRestore: () => { void controller?.restore({ id: item.id }).then(saved => { if (saved) { setSuccess(`Restored ${item.title}`); setFocusAfterAction({ id: item.id, index }); } }); } } : {}),
    ...(canPurge ? { onPurge: () => controller?.requestPurge({ item }) } : {}),
  }));
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
    emptyLabel: filter === 'images' ? 'No images yet. Upload an image to see it here.'
      : filter === 'videos' ? 'No videos yet. Upload a video to see it here.' : 'No media found',
    canUpload,
    success,
    gridRef,
    onRetry: () => { void controller?.load(); },
    statusFilter: snapshot?.query.status ?? 'all',
    onStatus: ({ value }: { value: string }) => {
      const { status: _status, ...query } = controller?.getSnapshot().query ?? {};
      void controller?.setQuery({ query: { ...query, ...(value === 'active' || value === 'trashed' ? { status: value } : {}) } });
    },
    canPurge,
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
    onSearch: ({ value: search }: { value: string }) => {
      void controller?.setQuery({ query: { ...controller.getSnapshot().query, search } });
    },
    orderBy: snapshot?.query.orderBy ?? 'created',
    onOrder: ({ value }: { value: string }) => {
      void controller?.setQuery({ query: { ...controller.getSnapshot().query, orderBy: value === 'alphabetical' ? 'alphabetical' : 'created' } });
    },
    search: snapshot?.query.search ?? '',
    loading: !snapshot || (snapshot.items === null && snapshot.loading && !snapshot.error),
    busy: snapshot?.busy ?? false,
    untyped: filter !== 'all' && snapshot?.hasUntyped === true,
    async upload({ input, alt }: Parameters<ReturnType<typeof createLibraryController>['upload']>[0]) {
      if (!canUpload) return false;
      const result = await controller?.upload({ input, ...(alt === undefined ? {} : { alt }) }) ?? false;
      if (result) gridRef.current?.focus({ preventScroll: true });
      return result;
    },
    cancelPurge: () => controller?.cancelPurge(),
    confirmPurge: () => {
      const item = controller?.getSnapshot().pendingPurge;
      // The controller refuses to purge without a pending item, so there is nothing to announce.
      if (!canPurge || !controller || !item) return;
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
