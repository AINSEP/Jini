import { WIDGET_AREA_CONTENT_TYPE, WIDGET_AREA_FIELD_NAMESPACE, WIDGET_CONTENT_TYPE, WIDGET_FIELD_NAMESPACE } from "../index.js";

/**
 * @file The envelope owner (`fieldsJson.ext.<owner>`) of every content type whose owner is not the
 * default `"site"`, keyed by content-type key.
 *
 * Why this exists: `@jini-ai/cms`'s entries chokepoint reads the envelope namespace off the owning
 * content type (`ContentTypeRecord.owner`), never off the caller (2026-10-04; before, the generic
 * entries route passed no owner, so a `widget` payload validated under `ext.site` and minted rows
 * the widgets reader can never parse). `content_types` has no owner column, and adding one would
 * mean a migration plus a backfill of every existing widget type row. It does not need one: the
 * only non-`site` owners are code-registered types whose owner is a code fact, so the repo
 * restores it on read from this table (`repo.rows.ts`), and refuses to save any owner not listed
 * here rather than drop it silently.
 *
 * The values are the widgets feature's own constants, so the namespace widgets writes with and the
 * one the chokepoint validates against cannot drift apart. A new code-owned type adds a row here.
 */
export const DECLARED_CONTENT_TYPE_OWNERS: Readonly<Record<string, string>> = Object.freeze({
  [WIDGET_CONTENT_TYPE]: WIDGET_FIELD_NAMESPACE,
  [WIDGET_AREA_CONTENT_TYPE]: WIDGET_AREA_FIELD_NAMESPACE,
});

/** The declared envelope owner of `key`, or `undefined` for a `"site"`-owned type. */
export function declaredOwnerFor(required: { key: string }, _optional: Record<string, never> = {}): string | undefined {
  return Object.prototype.hasOwnProperty.call(DECLARED_CONTENT_TYPE_OWNERS, required.key) ? DECLARED_CONTENT_TYPE_OWNERS[required.key] : undefined;
}
