import { describeSeoError } from '../../models.js';
import { useRef } from 'react';
import { useController } from '../../../core/react/use-controller.js';
import { createSeoEntryController } from '../../controllers/seo-entry.controller.js';
import { initialSeoEntryState } from '../../models.js';
import type { SeoEntryPanelController, SeoTranslator, SeoErrorFormatter } from '../../models.js';
import type { AdminSeoPort } from '../../ports.js';
import { useSeoOptions, useSeoPorts } from './SeoPorts.hooks.js';
export type { SeoEntryPanelController, SeoEntryPanelOptions } from '../../models.js';
export function useSeoEntryPanel({ api, entryId }: { api: AdminSeoPort; entryId: string }, { t, describeError }: { t?: SeoTranslator | undefined; describeError?: SeoErrorFormatter | undefined } = {}): SeoEntryPanelController {
  const translator = useRef(t);
  translator.current = t;
  const formatter = useRef(describeError);
  formatter.current = describeError;
  const { controller, snapshot } = useController({ create: () => createSeoEntryController({ api, entryId }, { t: (key, vars) => translator.current?.(key, vars) ?? key, describeError: required => formatter.current ? formatter.current(required) : describeSeoError(required) }), dependencies: [api, entryId] }, { start: ({ controller }) => { void controller.load({}); } });
  const state = snapshot ?? initialSeoEntryState;
  return {
    ...state,
    fieldValue: (key, resolvedValue) => controller ? controller.fieldValue({ key, resolvedValue }) : resolvedValue,
    setField: (key, value) => controller?.setField({ key, value }),
    save: async () => { await controller?.save({}); },
  };
}
export function useWiredSeoEntryPanel({ entryId }: { entryId: string }, _optional: Record<string, never> = {}): SeoEntryPanelController {
  const { seoApi: api } = useSeoPorts();
  const { t, describeError } = useSeoOptions();
  return useSeoEntryPanel({ api, entryId }, { t, describeError });
}
