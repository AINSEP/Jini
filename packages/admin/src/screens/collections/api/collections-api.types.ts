/**
 * Collections (ADR-022/ADR-043) — mirrors `Jini packages/cms/src/content-types/types.ts` +
 * `Jini packages/cms/src/entries/types.ts`. The 18 routes these types back were wired in the
 * "Session 5" backend-gap-closure pass (`progress-ledger.md`); see this file's own
 * per-method comments for exact response envelope shapes.
 */
/**
 * Hand-copied on purpose, not imported: `@jini-ai/cms/content-types` (the source of truth below)
 * is a barrel that also pulls in `write-service`/`lifecycle`/`repo.memory` — server-only code with
 * no place in this app's browser bundle. A plain hand-copy is exactly what drifted silently once
 * already, so this one is guarded by a runtime test instead of another silent copy:
 * the host admin's content-type field-kind sync test imports Jini's own
 * `CONTENT_TYPE_FIELD_KINDS` (a test file never ships in the browser bundle, so the barrel's
 * server-only weight is harmless there) and fails loudly the moment this array and Jini's stop
 * being the same set.
 *
 * Mirrors `@jini-ai/cms`'s `packages/cms/src/content-types/types.ts` `CONTENT_TYPE_FIELD_KINDS`
 * (`ContentTypeFieldKind`, re-exported from `@jini-ai/cms/content-types`). Widened 2026-09-05 to
 * add `relation`/`json` (Jini `df1be096`) after the FIRST drift: this array had silently stayed at
 * the original 5 while Jini widened its enum, and `CollectionEntryEditor.tsx`'s `FIELD_CONTROLS`
 * lookup — keyed on this same union — returned `undefined` for either new kind and crashed on
 * render. See that file's `FIELD_CONTROLS` for the fix on that side.
 */
export const CONTENT_TYPE_FIELD_KINDS = ["text", "integer", "real", "boolean", "datetime", "relation", "json"] as const;
export type ContentTypeFieldKind = (typeof CONTENT_TYPE_FIELD_KINDS)[number];

export interface ContentTypeFieldDef {
  name: string;
  kind: ContentTypeFieldKind;
  required: boolean;
  queryable: boolean;
}

export type ContentTypeStatus = "active" | "deprecated" | "tombstone";

/** A content type's lifecycle transition (`POST /content-types/:key/lifecycle`). */
export type ContentTypeLifecycleOp = "deprecate" | "reactivate" | "tombstone";

export interface AdminContentType {
  workspaceId: string;
  key: string;
  label: string;
  fields: ContentTypeFieldDef[];
  status: ContentTypeStatus;
  version: number;
  tombstonedAt?: string | null;
}

export type EntryStatus = "draft" | "published" | "unpublished";

export interface AdminEntry {
  id: string;
  workspaceId: string;
  type: string;
  slug: string;
  status: EntryStatus;
  title: string;
  bodyJson: unknown | null;
  fieldsJson: unknown;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}
