import { createControllerStore } from '../../core/module/controller-store.js';
import { buildMediaRef } from '../rules.js';
import type { SeoMediaSelection } from '../models.js';
/** The parent owns the controlled value; this controller owns only picker visibility. */
export function createMediaRefController({ onChange }: { onChange: (value: string) => void }, _optional: Record<string, never> = {}) {
  const store = createControllerStore({ initial: { pickerOpen: false } });
  return {
    ...store,
    openPicker(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { store.set({ patch: { pickerOpen: true } }); },
    closePicker(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { store.set({ patch: { pickerOpen: false } }); },
    handleSelect({ item }: { item: SeoMediaSelection }, _optional: Record<string, never> = {}) { onChange(buildMediaRef({ item })); store.set({ patch: { pickerOpen: false } }); },
    clear(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { onChange(''); },
  };
}
