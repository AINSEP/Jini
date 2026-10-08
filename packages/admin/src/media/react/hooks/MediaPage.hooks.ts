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
export interface MediaPageProps extends ModulePageProps { readonly headerActions?: ReactNode }
export function useMediaPage(props: MediaPageProps, _optional: Record<string, never> = {}) {
  const [localTab, setLocalTab] = useState('all');
  const { mediaApi, mediaEvents, mediaProviders } = useMediaPorts();
  const library = useController({ create: () => createLibraryController({ api: mediaApi }, { query: { filter: requestedFilter({ tabId: props.requestedTab ?? localTab }) } }), dependencies: [mediaApi] },
    { start: ({ controller }) => { if (props.description.visible) void controller.load(); } });
  useEffect(() => props.description.visible ? mediaEvents?.subscribe({ onRefresh: () => { void library.controller?.load(); } }) : undefined,
    [props.description.visible, mediaEvents, library.controller]);
  const [providerCount, setProviderCount] = useState<number | null>(null);
  useEffect(() => {
    if (!props.description.visible || !mediaProviders || !props.description.grants.includes('media.providers')) return;
    const abort = new AbortController();
    void mediaProviders.list({}, { signal: abort.signal }).then(items => {
      if (!abort.signal.aborted && items) setProviderCount(items.length);
    }).catch(() => { /* An unavailable read is not evidence of a zero catalogue. */ });
    return () => abort.abort();
  }, [mediaProviders, props.description.grants, props.description.visible]);
  const visible = props.description.visible
    ? props.description.tabs.filter((tab) => tab.visible)
    : [];
  const requested = resolveActiveTab({ tabId: props.requestedTab ?? localTab });
  const active = visible.find((tab) => tab.id.endsWith(`.${requested}`)) ?? visible[0];
  const tabs = visible.map((tab) => {
    const id = tab.id.slice(tab.id.lastIndexOf('.') + 1);
    return {
      ...tab,
      id,
      handle: `media-tab-${id}`,
      icon: createElement(id === 'images' ? ImageIcon : id === 'videos' ? VideoIcon : id === 'external-providers' ? CloudIcon : AllIcon, {}),
      count: id === 'external-providers' ? providerCount : library.snapshot?.counts?.[id as 'all' | 'images' | 'videos'],
      selected: active?.id === tab.id,
      onPress: () => {
        setLocalTab(id);
        props.onTabChange?.({ tab: id });
      },
    };
  });
  const id = active?.id.slice(active.id.lastIndexOf('.') + 1);
  useEffect(() => {
    if (props.description.visible && (id === 'all' || id === 'images' || id === 'videos') && library.controller?.getSnapshot().query.filter !== id)
      void library.controller?.setQuery({ query: { ...library.controller.getSnapshot().query, filter: id } });
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

function requestedFilter({ tabId }: { tabId?: string | null | undefined }) {
  const tab = resolveActiveTab({ tabId });
  return tab === 'external-providers' ? 'all' : tab;
}
