/** @module note-upsert
 * Pure decisions behind `NoteStore.upsertEntry` (input validity, id resolution, change-event shape), testable
 * without the filesystem-backed store. Split out of `note-store.ts` to keep that file under the size limit.
 */
import type { NoteChangeEvent, NoteEntrySummary } from './note-store.js';

/**
 * True when an `upsertEntry` input has a non-empty `name` and a `type` the
 * host taxonomy recognizes. `isType` is the store's own `isValidType` check,
 * passed in explicitly (per the two-object dependency convention) since
 * "valid type" is bound to a specific store's `validTypes` set.
 */
export function isValidUpsertInput(
  { name, type, isType }: { name: string; type: string; isType: (required: { type: unknown }) => boolean }, _optional: Record<string, never> = {},
): boolean {
  return Boolean(name) && isType({ type });
}

/**
 * Resolves the id an upsert should write to: the caller-supplied id when
 * present and well-formed, otherwise one derived from `type`/`name`.
 * `isId`/`deriveId` are passed in explicitly rather than closed over, so the
 * decision is testable independent of the filesystem-backed store.
 */
export function resolveUpsertEntryId(
  { id, type, name, isId, deriveId: deriveIdFn }: {
    id?: string | undefined; type: string; name: string;
    isId: (required: { id: string }) => boolean;
    deriveId: (required: { type: string; name: string }) => string;
  }, _optional: Record<string, never> = {},
): string {
  return id && isId({ id }) ? id : deriveIdFn({ type, name });
}

/**
 * Builds the `change` event payload for a successful upsert. `source` is
 * only included when the caller actually supplied one, matching the
 * store's existing "omit rather than send `undefined`" event shape.
 */
export function buildUpsertChangeEvent(
  { entry }: { entry: NoteEntrySummary },
  { source }: { source?: string | undefined } = {},
): Omit<NoteChangeEvent, 'at'> {
  return {
    kind: 'upsert',
    id: entry.id,
    name: entry.name,
    description: entry.description,
    type: entry.type,
    ...(source !== undefined ? { source } : {}),
  };
}
