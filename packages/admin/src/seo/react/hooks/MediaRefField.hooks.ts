import { useRef } from 'react';
import { agentHandle } from '@jini-ai/agentic';
import { useController } from '../../../core/react/use-controller.js';
import { createMediaRefController } from '../../controllers/media-ref.controller.js';
import { isStoredMediaRef, resolveMediaRefPreviewUrl } from '../../rules.js';
import type { MediaRefFieldController } from '../../models.js';
import type { AdminSeoPort } from '../../ports.js';
import { useSeoPorts, useSeoOptions } from './SeoPorts.hooks.js';
export type { MediaRefFieldController } from '../../models.js';
export function useMediaRefField(
  { value, onChange, api }: { value: string; onChange: (value: string) => void; api: AdminSeoPort }, _optional: Record<string, never> = {},
): MediaRefFieldController {
  const change = useRef(onChange);
  change.current = onChange;
  const { controller, snapshot } = useController({ create: () => createMediaRefController({ onChange: value => change.current(value) }), dependencies: [] });
  return {
    pickerOpen: snapshot?.pickerOpen ?? false,
    openPicker: () => controller?.openPicker({}), closePicker: () => controller?.closePicker({}),
    handleSelect: item => controller?.handleSelect({ item }), clear: () => controller?.clear({}),
    previewUrl: resolveMediaRefPreviewUrl({ value, mediaOriginalUrl: id => api.mediaOriginalUrl({ id }) }), accept: ['image/*'],
  };
}
export function useWiredMediaRefField({ value, onChange }: { value: string; onChange: (value: string) => void }, _optional: Record<string, never> = {}): MediaRefFieldController {
  const { seoApi: api } = useSeoPorts();
  return useMediaRefField({ value, onChange, api });
}
/** Slot or existing promise picker; no picker implementation is forked into SEO. */
export function useMediaRefPresentation({ value }: { value: string }, _optional: Record<string, never> = {}) {
  const { slots } = useSeoOptions();
  return { Picker: slots?.MediaPickerDialog, storedReference: isStoredMediaRef({ value }) };
}
export function handleSpread({ base, suffix, label }: { base?: string; suffix: string; label: string }, _optional: Record<string, never> = {}): Record<string, unknown> {
  return base ? agentHandle({ handle: `${base}-${suffix}` }, { role: 'button', label }) : {};
}
