import { useInvalidate } from '@jini-ai/ui/fetch-query';
import { MEDIA_QUERY_KEYS, useMediaLibraryQuery, useMediaProvidersQuery } from './MediaQuery.hooks.js';
import type { ReactNode } from 'react';
import { createElement, createContext, useContext, useEffect, useState } from 'react';
import type { ModulePageProps } from '../../../core/react/bind-react.js';
import { useController } from '../../../core/react/use-controller.js';
import { createLibraryController } from '../../controllers/library.controller.js';
import { useMediaPorts } from './MediaPorts.hooks.js';
import type { LibraryState } from '../../controllers/library.controller.js';
import { AllIcon, ImageIcon, VideoIcon, CloudIcon } from '../components/MediaIcons.js';
import { resolveActiveTab } from '../../rules.js';
export const MediaLibraryContext = createContext<{ controller: ReturnType<typeof createLibraryController> | null; snapshot: LibraryState | null } | null>(null);
export function useSharedMediaLibrary(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  return useContext(MediaLibraryContext);
}
/** Feeds the cached library read into a controller; an absent read leaves `all` untouched. */
export function settleFromCache(
  { controller, query }: { controller: ReturnType<typeof createLibraryController> | null; query: ReturnType<typeof useMediaLibraryQuery>['query'] },
  _optional: Record<string, never> = {},
) {
  controller?.settleLibrary({ ...(query.data ? { all: query.data } : {}), error: query.error });
}
export interface MediaPageProps extends ModulePageProps { readonly headerActions?: ReactNode }
export function useMediaPage(props: MediaPageProps, _optional: Record<string, never> = {}) {
  const [localTab, setLocalTab] = useState('all');
  const { mediaApi, mediaEvents, mediaProviders } = useMediaPorts();
  const cached = useMediaLibraryQuery({ api: mediaApi }, { enabled: props.description.visible });
  const providers = useMediaProvidersQuery({ port: mediaProviders }, { enabled: props.description.visible && props.description.grants.includes('media.providers') });
  const invalidate = useInvalidate();
  const tabId = props.requestedTab ?? localTab;
  const library = useController({ create: () => createLibraryController({ api: cached.api }, { query: { filter: requestedFilter({ tabId }) } }), dependencies: [cached.api] },
    { start: ({ controller }) => { if (props.description.visible) void controller.load(); } });
  useEffect(() => props.description.visible ? mediaEvents?.subscribe({ onRefresh: () => { invalidate({ key: MEDIA_QUERY_KEYS.root }); } }) : undefined,
    [props.description.visible, mediaEvents, library.controller, invalidate]);
  useEffect(() => { settleFromCache({ controller: library.controller, query: cached.query }); }, [library.controller, cached.query.data, cached.query.error]);
  /* An unavailable read is not evidence of a zero catalogue. */
  const providerCount = providers.query.data?.length ?? null;
  const { visible, active } = visibleTabs({ description: props.description, tabId });
  const tabs = visible.map((tab) => {
    const id = shortTabId({ id: tab.id });
    return {
      ...tab,
      id,
      handle: `media-tab-${id}`,
      icon: createElement(TAB_ICONS.get(id) ?? AllIcon, {}),
      count: id === 'external-providers' ? providerCount : library.snapshot?.counts?.[id as 'all' | 'images' | 'videos'],
      selected: active?.id === tab.id,
      onPress: () => {
        setLocalTab(id);
        props.onTabChange?.({ tab: id });
      },
    };
  });
  const id = active && shortTabId({ id: active.id });
  useEffect(() => {
    const filter = libraryFilter({ id });
    if (props.description.visible && filter && library.controller?.getSnapshot().query.filter !== filter)
      void library.controller?.setQuery({ query: { ...library.controller.getSnapshot().query, filter } });
  }, [id, library.controller, props.description.visible]);
  return {
    library,
    headerActions: props.headerActions,
    activeId: id,
    tabs,
    ActiveTab: id ? props.tabs[id] : undefined,
    params: active?.params ?? {},
    permissions: props.description.grants,
    denied: !props.description.visible,
  };
}

const TAB_ICONS: ReadonlyMap<string, typeof ImageIcon> = new Map([['images', ImageIcon], ['videos', VideoIcon], ['external-providers', CloudIcon]]);
/** Module tab ids are namespaced (`media.images`); the page and its tabs use the last segment. */
function shortTabId({ id }: { id: string }, _optional: Record<string, never> = {}) {
  return id.slice(id.lastIndexOf('.') + 1);
}
function libraryFilter({ id }: { id: string | undefined }, _optional: Record<string, never> = {}) {
  return id === 'all' || id === 'images' || id === 'videos' ? id : undefined;
}
function visibleTabs({ description, tabId }: { description: MediaPageProps['description']; tabId: string }, _optional: Record<string, never> = {}) {
  const visible = description.visible
    ? description.tabs.filter((tab) => tab.visible)
    : [];
  const requested = resolveActiveTab({ tabId });
  return { visible, active: visible.find((tab) => tab.id.endsWith(`.${requested}`)) ?? visible[0] };
}
function requestedFilter({ tabId }: { tabId?: string | null | undefined }) {
  const tab = resolveActiveTab({ tabId });
  return tab === 'external-providers' ? 'all' : tab;
}
