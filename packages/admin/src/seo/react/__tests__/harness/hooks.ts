import { useEntryPicker as useEntryPickerCore } from '../../hooks/use-entry-picker.hooks.js';
import { useSeo as useSeoCore } from '../../hooks/use-seo.hooks.js';
import { useSeoEntryPanel as useSeoEntryPanelCore } from '../../hooks/use-seo-entry-panel.hooks.js';
import { useSitemapModal as useSitemapModalCore } from '../../hooks/use-sitemap-modal.hooks.js';
import { useMediaRefField as useMediaRefFieldCore } from '../../hooks/MediaRefField.hooks.js';
import { coreSeoApi, coreSitemapApi } from './api.js';
import type { SeoPort, SitemapPort } from './api.js';
import { createMemorySeoApi } from '../../../adapters/memory.js';
import type { AdminSeoPort } from '../../../ports.js';
import type { SitemapModalInputs } from '../../../models.js';
export function useSeo(port: SeoPort, _locale: string) { return useSeoCore({ api: coreSeoApi(port) }); }
export function useEntryPicker(port: SeoPort, _locale: string) { return useEntryPickerCore({ api: coreSeoApi(port) }); }
export function useSeoEntryPanel({ entryId }: { entryId: string }, port: SeoPort, _locale: string) { return useSeoEntryPanelCore({ entryId, api: coreSeoApi(port) }); }
export function useSitemapModal(port: SitemapPort, inputs: SitemapModalInputs) { return useSitemapModalCore({ ...inputs, api: coreSitemapApi(port) }); }
const mediaAdapters = new WeakMap<object, AdminSeoPort>();
export function useMediaRefField(value: string, onChange: (value: string) => void, { port }: { port: { mediaOriginalUrl(id: string): string } }) {
  let api = mediaAdapters.get(port);
  if (!api) { api = createMemorySeoApi({ mediaOriginalUrl: ({ id }) => port.mediaOriginalUrl(id) }); mediaAdapters.set(port, api); }
  return useMediaRefFieldCore({ value, onChange, api });
}
