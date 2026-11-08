import type { ContentTypeFieldKind, IndexableFieldKind } from '@jini-ai/core/contracts/content-types';
import type { CONTENT_TYPE_FIELD_KINDS, INDEXABLE_FIELD_KINDS } from '../types.js';
type Assert<T extends true> = T;
export type KindChecks = [
  Assert<ContentTypeFieldKind extends typeof CONTENT_TYPE_FIELD_KINDS[number] ? true : false>,
  Assert<typeof CONTENT_TYPE_FIELD_KINDS[number] extends ContentTypeFieldKind ? true : false>,
  Assert<IndexableFieldKind extends typeof INDEXABLE_FIELD_KINDS[number] ? true : false>,
  Assert<typeof INDEXABLE_FIELD_KINDS[number] extends IndexableFieldKind ? true : false>,
];
