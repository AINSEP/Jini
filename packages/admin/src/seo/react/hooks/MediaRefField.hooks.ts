import { useRef } from 'react';
import { useShareImageWarning } from './use-share-image-warning.hooks.js';
import { agentHandle } from '@jini-ai/agentic';
import { useController } from '../../../core/react/use-controller.js';
import { createMediaRefController } from '../../controllers/media-ref.controller.js';
import { describeMediaRef, isStoredMediaRef, resolveMediaRefPreviewUrl } from '../../rules.js';
import { useFetchQuery } from '@jini-ai/ui/fetch-query';
import { extensionForMimeType } from '@jini-ai/ui';
import { SEO_KEYS } from './SeoQuery.hooks.js';
import type { MediaRefFieldController, SeoTranslator } from '../../models.js';
import type { AdminSeoPort } from '../../ports.js';
import { useSeoPorts, useSeoOptions } from './SeoPorts.hooks.js';
export type { MediaRefFieldController } from '../../models.js';
export function useMediaRefField(
  { value, onChange, api }: { value: string; onChange: (value: string) => void; api: AdminSeoPort }, { t }: { t?: SeoTranslator | undefined } = {},
): MediaRefFieldController {
  const change = useRef(onChange);
  change.current = onChange;
  const { controller, snapshot } = useController({ create: () => createMediaRefController({ onChange: value => change.current(value) }), dependencies: [] });
  const previewUrl = api.mediaPreviewUrl ? api.mediaPreviewUrl({ value }) : resolveMediaRefPreviewUrl({ value, mediaOriginalUrl: id => api.mediaOriginalUrl({ id }) });
  const { naturalWidth, naturalHeight, ...diagnostics } = useShareImageWarning({ value, previewUrl, api }, { t });
  // One cached library read shared by every image field on the screen; only a library reference
  // needs it (a URL names itself), and a host without `listSeoMedia` falls back to the slug.
  const list = api.listSeoMedia;
  const media = useFetchQuery({ key: SEO_KEYS.media, fetch: () => list ? list.call(api, {}) : Promise.resolve([]) }, { enabled: Boolean(list) && isStoredMediaRef({ value }) });
  return {
    ...diagnostics,
    file: describeMediaRef({ value, media: media.data }, { width: naturalWidth, height: naturalHeight, t, extensionFor: extensionForMimeType }),
    pickerOpen: snapshot?.pickerOpen ?? false,
    openPicker: () => controller?.openPicker({}), closePicker: () => controller?.closePicker({}),
    handleSelect: item => controller?.handleSelect({ item }), clear: () => controller?.clear({}),
    previewUrl, accept: ['image/*'],
  };
}
export function useWiredMediaRefField({ value, onChange }: { value: string; onChange: (value: string) => void }, _optional: Record<string, never> = {}): MediaRefFieldController {
  const { seoApi: api } = useSeoPorts();
  const { t } = useSeoOptions();
  return useMediaRefField({ value, onChange, api }, { t });
}
/** Slot or existing promise picker; no picker implementation is forked into SEO. */
export function useMediaRefPresentation({ value }: { value: string }, _optional: Record<string, never> = {}) {
  const { slots } = useSeoOptions();
  return { Picker: slots?.MediaPickerDialog, storedReference: isStoredMediaRef({ value }) };
}
export function handleSpread({ base, suffix, label }: { base?: string; suffix: string; label: string }, _optional: Record<string, never> = {}): Record<string, unknown> {
  return base ? agentHandle({ handle: `${base}-${suffix}` }, { role: 'button', label }) : {};
}
