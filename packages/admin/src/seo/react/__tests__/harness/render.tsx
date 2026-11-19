import { createElement, useEffect, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { render as renderOriginal, renderHook as renderHookOriginal, type RenderOptions } from '@testing-library/react';
import { FetchQueryProvider, useCachedLoader, useFetchMutation, useFetchQuery, useFetchQueryScope, useInvalidate } from '@jini-ai/ui/fetch-query';
import { Select } from '@jini-ai/ui/admin-widgets';
import { UiKitProvider, type UiKit } from '@jini-ai/ui/react-kit';
import { SecretInput, useOverlayContainer, useSecretReveal } from '@jini-ai/ui-kit/react';
import { nativeKit } from '@jini-ai/ui-kit/react/native';
import { AdminKitProvider } from '../../../../react/kit.js';
import { fakeAdminKit } from '@jini-ai/admin/react/testing-kit';
import { useController } from '@jini-ai/admin/core/react';
import type { UseAdminController } from '@jini-ai/core/contracts/admin-module';
import { SeoPortsContext, SeoOptionsContext, SeoControllerContext } from '../../hooks/SeoPorts.hooks.js';
import { createMemorySeoApi } from '../../../adapters/memory.js';
import type { SeoReactOptions, SeoMediaPickerSlotProps } from '../../options.js';
import type { AdminMedia } from '../../../models.js';
import { api } from './api.js';
export * from '@testing-library/react';
export const Dialog = nativeKit.Dialog;
const controllerHook: UseAdminController = useController;
const uiKit = { components: { SecretInput }, hooks: { useOverlayContainer, useSecretReveal } } satisfies UiKit;
const seoKit = fakeAdminKit({
  components: { Dialog, WidgetSelect: Select },
  query: { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate, useFetchQueryScope },
});

function scope(wrapper?: ComponentType<{ children: ReactNode }>) {
  return function SeoScope({ children }: { children: ReactNode }) {
    const inner = wrapper ? createElement(wrapper, { children }) : children;
    return <UiKitProvider kit={uiKit}><AdminKitProvider kit={seoKit}><FetchQueryProvider><SeoControllerContext.Provider value={controllerHook}>{inner}</SeoControllerContext.Provider></FetchQueryProvider></AdminKitProvider></UiKitProvider>;
  };
}
export const renderScoped = ((ui: ReactNode, options?: RenderOptions) => renderOriginal(ui, { ...options, wrapper: scope(options?.wrapper) })) as typeof renderOriginal;
export const renderHook: typeof renderHookOriginal = (callback, options) => renderHookOriginal(callback, { ...options, wrapper: scope(options?.wrapper) });

/** Host-owned legacy picker fixture. Tests keep driving the source slot's callbacks and DOM;
 * the picker service itself has separate media conformance/render suites. */
function HostMediaPicker({ onSelect, onCancel, accept }: SeoMediaPickerSlotProps) {
  const [items, setItems] = useState<AdminMedia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.listMedia().then(({ media }) => { if (alive) setItems(media.filter(item => item.status === 'active' && (!accept?.length || accept.some(type => type === item.contentType || (type.endsWith('/*') && item.contentType?.startsWith(type.slice(0, -1))))))); }).catch(error => { if (alive) setError(error instanceof Error ? error.message : 'failed to load media'); });
    return () => { alive = false; };
  }, []);
  return <Dialog open title="Choose an image" onClose={onCancel} className="settings-dialog jini-domain-dialog media-picker-dialog">
    <div className="media-picker-body">
      {error && <div className="notice error">{error}</div>}
      {items === null ? <p className="notice">Loading media…</p> : <div className="media-picker-grid">{items.map(item => <button key={item.id} type="button" className="media-picker-item" title={item.title} onClick={() => onSelect(item)}><img src={api.mediaOriginalUrl(item.id)} alt={item.alt || item.title} loading="lazy" /><span className="media-picker-item-title">{item.title}</span></button>)}</div>}
    </div>
    <div className="widget-picker-footer"><span className="editor-actions"><button data-jini-autofocus="" type="button" className="btn-secondary" onClick={onCancel}>Cancel</button></span></div>
  </Dialog>;
}
const seoApi = createMemorySeoApi({ mediaOriginalUrl: ({ id }) => api.mediaOriginalUrl(id) });
const options: SeoReactOptions = { siteUrl: () => '', t: key => key, slots: { MediaPickerDialog: HostMediaPicker } };
export function Harness({ children }: { children: ReactNode }) {
  return <SeoPortsContext.Provider value={{ seoApi }}><SeoOptionsContext.Provider value={options}>{children}</SeoOptionsContext.Provider></SeoPortsContext.Provider>;
}
export function render(ui: Parameters<typeof renderOriginal>[0], options?: Parameters<typeof renderOriginal>[1]): ReturnType<typeof renderOriginal> {
  return renderScoped(createElement(Harness, { children: ui }), options);
}
