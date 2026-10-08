import { describeSeoError } from '../../models.js';
import { useRef } from 'react';
import { useController } from '../../../core/react/use-controller.js';
import { createEntryPickerController } from '../../controllers/entry-picker.controller.js';
import { initialEntryPickerState } from '../../models.js';
import type { EntryPickerController, SeoTranslator, SeoErrorFormatter } from '../../models.js';
import type { AdminSeoPort } from '../../ports.js';
import { useSeoOptions, useSeoPorts } from './SeoPorts.hooks.js';
export type { EntryPickerController } from '../../models.js';
export function useEntryPicker({ api }: { api: AdminSeoPort }, { t, describeError }: { t?: SeoTranslator | undefined; describeError?: SeoErrorFormatter | undefined } = {}): EntryPickerController {
  const translator = useRef(t);
  translator.current = t;
  const formatter = useRef(describeError);
  formatter.current = describeError;
  const { snapshot } = useController({ create: () => createEntryPickerController({ api }, { t: (key, vars) => translator.current?.(key, vars) ?? key, describeError: required => formatter.current ? formatter.current(required) : describeSeoError(required) }), dependencies: [api] }, { start: ({ controller }) => { void controller.load({}); } });
  return snapshot ?? initialEntryPickerState;
}
export function useWiredEntryPicker(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): EntryPickerController {
  const { seoApi: api } = useSeoPorts();
  const { t, describeError } = useSeoOptions();
  return useEntryPicker({ api }, { t, describeError });
}
