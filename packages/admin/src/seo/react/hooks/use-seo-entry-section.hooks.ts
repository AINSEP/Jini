import { useSeoController } from './SeoPorts.hooks.js';
import { createSeoEntrySectionController } from '../../controllers/entry-section.controller.js';
import type { SeoEntrySectionController } from '../../models.js';
export type { SeoEntrySectionController } from '../../models.js';
export function useSeoEntrySection(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): SeoEntrySectionController {
  const { controller, snapshot } = useSeoController({ create: () => createSeoEntrySectionController({}), dependencies: [] });
  return { entryId: snapshot?.entryId ?? '', setEntryId: entryId => controller?.setEntryId({ entryId }) };
}
