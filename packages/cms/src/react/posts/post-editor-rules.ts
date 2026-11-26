import { derivePostSlugBase, isAutomaticPostSlug } from "../../posts/slug.js";
import type { AdminPost } from "@jini-ai/admin/posts/api/posts-api.types";
import { VERSION_CONFLICT_CODE } from "@jini-ai/core/optimistic-concurrency";
import type { SaveConflict } from "@jini-ai/admin/shell/lib/version-conflict";
import type { StandingDraftAutosaveInput, StandingDraftStaleBasis } from "@jini-ai/ui/panel-kit";


/**
 * Standing-draft autosave (2026-09-06) — what to send `putAutosave` for the current working copy.
 * Unlike `features/pages`' `buildPageAutosaveDraft`, there is no doc-vs-html split here: `PostEditor`
 * is reached only via `/admin/posts/{id}` for `kind: "post"` rows (`panels.tsx`), and a Post can
 * never carry `bodyFormat: "html"` (`post.ts`'s own `resolveBodyFields`/CIC-3) — every draft this
 * editor ever sends is `bodyFormat: "doc"`.
 *
 * @complexity Time/space: O(1).
 */
export function buildPostAutosaveDraft(
  post: { version: number },
  form: { title: string; slug: string; bodyJson: Record<string, unknown>; author?: string; showAuthor?: boolean }
): StandingDraftAutosaveInput & { author?: string; showAuthor?: boolean } {
  return { bodyFormat: "doc", bodyJson: form.bodyJson, title: form.title, slug: form.slug, baseVersion: post.version,
    ...(form.author !== undefined ? { author: form.author } : {}),
    ...(form.showAuthor !== undefined ? { showAuthor: form.showAuthor } : {}),
  };
}

/**
 * The server's machine-readable `code` for "the version you were editing has been superseded"
 * (`server/inbound/admin-http/routes/posts/update.ts`'s `sendPostUpdateError`). Named here rather
 * than string-matched at the call site because this route returns TWO different 409s from the same
 * `PostConflictError` hierarchy: a slug-uniqueness collision (fix the slug and resend) and this one
 * (do NOT resend — resending is what erases the other operator's work). Only this one carries a
 * `code`, which is exactly what makes them tellable apart.
 */
export const POST_VERSION_CONFLICT_CODE = VERSION_CONFLICT_CODE;

/** A rejected save whose basis version had already been superseded — {@link readVersionConflict}'s
 *  output, and the editor's own conflict state. */
export type PostSaveConflict = SaveConflict;

/**
 * The conflict banner's own message is not run through `t()`; like the former feature-local
 * recovery message, it is a computed, interpolated sentence rather than a static dictionary key.
 *
 * States the two things an operator has to know and cannot infer: that their work was NOT saved but
 * is still in front of them, and that saving again overwrites the other person rather than merging.
 * Deliberately does not promise a merge, a diff, or a way to see what changed — none of those exist
 * here, and the recovery this screen genuinely offers is "your text is still in the editor".
 */
export function postVersionConflictMessage(conflict: PostSaveConflict): string {
  const basis = conflict.expectedVersion === null ? "the version you loaded" : `version ${conflict.expectedVersion}`;
  const current = conflict.currentVersion === null ? "a newer version" : `version ${conflict.currentVersion}`;
  return (
    `Someone else saved this while you were editing — you were working from ${basis}, and ${current} is now stored. ` +
    "Your changes were NOT saved, and are still here in the editor."
  );
}

/**
 * The stale-basis notice's own message — the BACKGROUND-autosave sibling of
 * {@link postVersionConflictMessage} just above, and the reason `staleBasis` exists on the shared
 * autosave hook at all. NOT run through `t()`, for the same reason neither of the two messages above
 * is: it interpolates.
 *
 * Says the four things an operator cannot infer from a screen that otherwise looks completely
 * normal: that someone else saved, that autosaving has consequently STOPPED (a running editor that
 * silently persists nothing is the entire defect), that their work is unsaved but still in front of
 * them, and what actually resumes autosaving.
 *
 * Deliberately does NOT promise that the text is recoverable after a reload. The hook does mirror a
 * refused draft into browser storage (`lib/shell-collaborators.ts`'s `standingDraftLocalBackup`), but that mirror is
 * best-effort — `localStorage` throws outright in some privacy modes — and it is offered back only
 * when the server has nothing of its own parked for the entry. "Copy anything you want to keep
 * first" is advice that is never wrong; a promise of recovery would be one this code cannot keep.
 *
 * @complexity Time/space: O(1).
 */
export function postAutosaveStaleBasisMessage(staleBasis: StandingDraftStaleBasis): string {
  return (
    `Someone else saved this while you were editing — you were working from version ${staleBasis.baseVersion}, ` +
    "so autosaving has paused and nothing you type now is being stored. Your changes were NOT saved, and are " +
    "still here in the editor. Reload to pick up their version and resume autosaving; copy anything you want " +
    "to keep first."
  );
}

/** The Preview tab's three mutually exclusive surfaces — see {@link resolvePostPreviewBranches}. */
export interface PostPreviewBranches {
  canShowLiveSite: boolean;
  canShowTemplatePreview: boolean;
  canShowPendingContentPreview: boolean;
}

/**
 * Which Preview-tab surface a post gets (`PostEditor.tsx`'s `PostPreview` doc describes all three).
 * The one shared copy of this decision: `PostPreview` reads it to pick what to draw, and
 * `usePostEditor` reads it to decide whether the pending-content form auto-submits. Those two used
 * to hold hand-copied conditions that drifted on 2026-09-11 — the component drew the pending-content
 * iframe for a clean draft while the hook never submitted into it, so it sat at `about:blank`.
 *
 * The pending-content preview is the plain negation of the other two, so every draft, clean or
 * dirty, previews through the real template — there is no raw editor-buffer fallback any more.
 *
 * @param input.status - The post's saved status.
 * @param input.scheduled - A published row still waiting for its go-live time
 *   ({@link isScheduledPost}). It has no public URL yet (it 404s until then), so it previews exactly
 *   like a draft.
 * @param input.dirty - Any unsaved change, a pending template choice included.
 * @param input.contentDirty - An unsaved change to what renders (a strict subset of `dirty`).
 * @returns Exactly one `true` flag, for every combination of inputs.
 * @complexity O(1).
 */
export function resolvePostPreviewBranches(input: {
  status: "draft" | "published";
  scheduled?: boolean;
  dirty: boolean;
  contentDirty: boolean;
}): PostPreviewBranches {
  const live = input.status === "published" && !input.scheduled;
  const canShowLiveSite = live && !input.dirty;
  const canShowTemplatePreview = live && !input.contentDirty && !canShowLiveSite;
  return { canShowLiveSite, canShowTemplatePreview, canShowPendingContentPreview: !canShowLiveSite && !canShowTemplatePreview };
}

/**
 * Scheduled publishing (2026-10-05) — the stored `publishAt` (ISO UTC, `AdminPost.publishAt`) as the
 * `YYYY-MM-DDTHH:mm` value a `<input type="datetime-local">` shows, in the BROWSER's timezone (the
 * operator thinks in their own clock; the server only ever sees UTC). `""` for none or unparseable.
 *
 * @complexity O(1).
 */
export function isoToLocalDateTimeInput({ iso }: { iso: string | null | undefined }, _options: Record<string, never> = {}): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = ({ n }: { n: number }, _options: Record<string, never> = {}) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad({ n: date.getMonth() + 1 })}-${pad({ n: date.getDate() })}T${pad({ n: date.getHours() })}:${pad({ n: date.getMinutes() })}`;
}

/**
 * The inverse of {@link isoToLocalDateTimeInput}: a `datetime-local` value (no offset, browser-local
 * by definition) to the offset-qualified ISO string the server's `normalizePublishAt` requires, or
 * `null` ("no schedule") for an empty or unparseable value.
 *
 * @complexity O(1).
 */
export function localDateTimeInputToIso({ value }: { value: string }, _options: Record<string, never> = {}): string | null {
  if (value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Whether a published row is still waiting for its go-live time — the admin mirror of the server's
 *  `isScheduledAt` (`@jini-ai/core/scheduled-publish`). @complexity O(1). */
export function isScheduledPost({ input, nowMs }: { input: { status: "draft" | "published"; publishAt: string | null }; nowMs: number }, _options: Record<string, never> = {}): boolean {
  return input.status === "published" && input.publishAt !== null && Date.parse(input.publishAt) > nowMs;
}

/** A persisted manual slug or any publication history freezes title following. */
export function postSlugFollowsTitle(
  { post, manuallyEdited = false }: { post: Pick<AdminPost, "kind" | "status" | "title" | "slug" | "everPublished">; manuallyEdited?: boolean },
  _optional: Record<string, never> = {},
): boolean {
  const neverPublished = post.status !== "published" && !post.everPublished;
  return post.kind === "post" && neverPublished && !manuallyEdited && isAutomaticPostSlug(post);
}

/** Preview the same bounded base the server derives; the server chooses the available suffix. */
export function postSlugForTitle({ title }: { title: string }, _optional: Record<string, never> = {}): string {
  return derivePostSlugBase({ title });
}
