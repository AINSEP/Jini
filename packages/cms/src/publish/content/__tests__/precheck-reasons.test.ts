import { expect, it } from 'vitest';
import {
  addressHeldByOther, addressHeldInTrash, changedSincePlan, malformedKey, missingDependency,
  notWired, tombstonedAtDestination, trashedAtDestination,
} from '../precheck-reasons.js';

it.each([
  ['missing port', () => notWired({ entityType: 'media', id: 'asset-2', portName: 'mediaRepo' }),
    "media entity 'asset-2' cannot be prechecked — no mediaRepo wired for this deps bag"],
  ['address held by another row', () => addressHeldByOther({ entityType: 'page', field: 'slug', value: 'guide', holderId: 'page-7' }),
    "slug 'guide' is already held by a different page ('page-7')"],
  ['trashed address holder', () => addressHeldInTrash({ entityType: 'page', field: 'slug', value: 'guide', holderId: 'page-7' }),
    "page 'page-7' is in the trash at this destination and still holds slug 'guide' — restore it, or delete it permanently from the Trash, before publishing"],
  ['trashed same-identity row', () => trashedAtDestination({ entityType: 'widget', id: 'widget-9' }),
    "widget 'widget-9' is in the trash at this destination — restore it before publishing over it, or publishing would resurrect it as live content"],
  ['concurrent edit', () => changedSincePlan({ entityType: 'menu', id: 'menu-6', detail: 'the revision advanced' }),
    "menu 'menu-6' changed on the destination during apply: the revision advanced"],
  ['missing dependency', () => missingDependency({ entityType: 'entry', id: 'entry-1', depType: 'content-type', depId: 'books' }),
    "entry 'entry-1' depends on content-type 'books', which is missing at this destination"],
  ['malformed natural key', () => malformedKey({ entityType: 'redirect', id: 'bad', expectedShape: 'source:destination' }),
    "redirect entity 'bad' has a malformed natural key (expected 'source:destination')"],
  ['permanent removal', () => tombstonedAtDestination({ entityType: 'content-type', id: 'books' }),
    "content-type 'books' is permanently removed at this destination and cannot be republished over"],
] as const)('explains a %s using the stable report-row reason format', (_scenario, reason, expected) => {
  expect(reason()).toBe(expected);
});
