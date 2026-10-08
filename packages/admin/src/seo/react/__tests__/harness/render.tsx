import { createElement, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { render as renderOriginal, renderHook as renderHookOriginal, type RenderResult } from '@testing-library/react';
import { Dialog } from '@jini-ai/ui-kit/react';
import { acceptsMedia } from '../../../../media/rules.js';
import { SeoPortsContext, SeoOptionsContext } from '../../hooks/SeoPorts.hooks.js';
import { createMemorySeoApi } from '../../../adapters/memory.js';
import type { SeoReactOptions, SeoMediaPickerSlotProps } from '../../options.js';
import type { AdminMedia } from '../../../models.js';
import { api } from './api.js';
export * from '@testing-library/react';

/** Host-owned legacy picker fixture. Tests keep driving the source slot's callbacks and DOM;
 * the picker service itself has separate media conformance/render suites. */
function HostMediaPicker({ onSelect, onCancel, accept }: SeoMediaPickerSlotProps) {
  const [items, setItems] = useState<AdminMedia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.listMedia().then(({ media }) => { if (alive) setItems(media.filter(item => item.status === 'active' && acceptsMedia({ item, accept: accept ?? [] }))); }).catch(error => { if (alive) setError(error instanceof Error ? error.message : 'failed to load media'); });
    return () => { alive = false; };
  }, []);
  return <Dialog open title="Choose an image" onClose={onCancel} className="settings-dialog tovu-domain-dialog media-picker-dialog">
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
export function render(ui: Parameters<typeof renderOriginal>[0], options?: Parameters<typeof renderOriginal>[1]): RenderResult {
  return renderOriginal(createElement(Harness, { children: ui }), options);
}
export { renderHookOriginal as renderHook };
