import type { PostEditorPort } from "@jini-ai/core/contracts/site/content-editor-ports";
import { savedHideCoverImageInBody } from "./post-editor-state.rules.js";
import type { PostFormState } from "./post-editor-state.rules.js";

/**
 * @file Pure pieces of `usePostEditor`'s `runSave` (`use-post-editor.hooks.ts`) — the PUT patch it
 * sends and how the response folds back into the working copy. Split out of the hook (complexity
 * pass, 2026-10-20) so `runSave` keeps only the request, the stale-settlement guard and the state
 * writes. No React, no I/O.
 */

/** The patch `port.updatePost` takes. */
export type PostUpdatePatch = Parameters<PostEditorPort<
  Omit<PostFormState, "bodyJson" | "author"> & { bodyJson: Record<string, unknown>; author: string | null },
  never, never, never, never
>["updatePost"]>[0]["patch"];

/**
 * Scheduled publishing / featured image (2026-10-05) — only the fields the operator actually changed
 * since load or the last save go into the PUT, so a save that never touched them sends neither key
 * (the server keeps the stored values for an absent key). `null` is sent explicitly to clear one.
 *
 * @complexity O(1).
 */
export function scheduleFieldsPatch({ original, current }: {
  original: PostFormState | null,
  current: { publishAt: string | null; featuredMediaId: string | null },
}, _optional = {}): { publishAt?: string | null; featuredMediaId?: string | null } {
  return {
    ...(current.publishAt !== (original?.publishAt ?? null) ? { publishAt: current.publishAt } : {}),
    ...(current.featuredMediaId !== (original?.featuredMediaId ?? null) ? { featuredMediaId: current.featuredMediaId } : {}),
  };
}

/** Save only byline edits so a body save cannot overwrite an untouched credit. */
export function authorFieldsPatch(required: { original: PostFormState | null; author: string; showAuthor: boolean }): {
  author?: string | null;
  showAuthor?: boolean;
} {
  const { original, author, showAuthor } = required;
  return {
    ...(author !== (original?.author ?? "") ? { author: author.trim() || null } : {}),
    ...(showAuthor !== (original?.showAuthor ?? false) ? { showAuthor } : {}),
  };
}

/** The working copy a save sends — `PostFormState` plus whether the slug still follows the title. */
export interface PostSaveWorkingCopy extends Omit<PostFormState, "bodyJson"> {
  bodyJson: Record<string, unknown>;
  followsTitle: boolean;
}

/**
 * The PUT body for one save. A slug that still follows the title is sent as `slugFromTitle` so the
 * server derives it; the cover toggle, schedule, featured image and byline go only when changed.
 *
 * @complexity O(1).
 */
export function buildPostUpdatePatch(required: {
  working: PostSaveWorkingCopy;
  original: PostFormState | null;
  expectedVersion: number | undefined;
}): PostUpdatePatch {
  const { working, original, expectedVersion } = required;
  const { title, slug, status, bodyJson, templateChoice, overridesThemePage, hideCoverImageInBody } = working;
  return {
    title, ...(working.followsTitle ? { slugFromTitle: true } : { slug }), status, bodyJson, templateChoice, overridesThemePage, expectedVersion,
    ...(hideCoverImageInBody !== original?.hideCoverImageInBody ? { hideCoverImageInBody } : {}),
    ...scheduleFieldsPatch({ original, current: { publishAt: working.publishAt, featuredMediaId: working.featuredMediaId } }),
    ...authorFieldsPatch({ original, author: working.author, showAuthor: working.showAuthor }),
  };
}

/** The saved row's values a successful save folds back into the working copy and the baseline. */
export interface SavedPostFields {
  slug: string;
  author: string;
  showAuthor: boolean;
  hideCoverImageInBody: boolean;
}

/** Normalizes the saved row's byline/cover fields the same way the load does. @complexity O(1). */
export function savedPostFields({ saved }: { saved: { slug: string; author?: string | null; showAuthor?: boolean; ext?: Record<string, Record<string, unknown>> } }, _optional: Record<string, never> = {}): SavedPostFields {
  return {
    slug: saved.slug,
    author: saved.author ?? "",
    showAuthor: saved.showAuthor ?? false,
    hideCoverImageInBody: savedHideCoverImageInBody({ post: saved }),
  };
}

/**
 * The saved row as the editor keeps it: `everPublished` stays true once this row was published by
 * the loaded copy or by this save, whatever the response itself says.
 *
 * @complexity O(1).
 */
export function withEverPublished<Row extends { everPublished?: boolean; status: "draft" | "published" }>(required: { previous: Row | null; saved: Row }): Row {
  const { previous, saved } = required;
  return { ...saved, everPublished: previous?.everPublished || previous?.status === "published" || saved.status === "published" };
}

/**
 * A state updater that adopts the server's value only while the field still holds what was sent —
 * a field the operator changed again while the save was in flight keeps the newer edit.
 *
 * @complexity O(1).
 */
export function keepNewerEdit<T>({ sent, fromSaved }: { sent: T; fromSaved: T }, _optional: Record<string, never> = {}): (current: T) => T {
  return (current) => (current === sent ? fromSaved : current);
}
