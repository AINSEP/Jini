import type { HeadlessThemeTier } from "@jini-ai/core/contracts/headless/contracts";
export interface PostFormState {
  title: string;
  slug: string;
  status: "draft" | "published";
  bodyJson: unknown;
  templateChoice: string | null;
  /** Tri-state (2026-08-15) — see {@link PostEditorController.overridesThemePage}'s own doc. */
  overridesThemePage: boolean | null;
  /** Scheduled publishing (2026-10-05) — ISO UTC, or `null` for "live as soon as published". */
  publishAt: string | null;
  /** Featured image (2026-10-05) — media asset id, or `null`. */
  featuredMediaId: string | null;
  author: string;
  showAuthor: boolean;
  hideCoverImageInBody: boolean;
}

/**
 * @file Pure state derivations `usePostEditor` (`use-post-editor.hooks.ts`) reads on load and on
 * every render — split out of the hook (complexity pass, 2026-10-20) so each `??`/`?.` default
 * scores on its own small function instead of on the hook's load callback. No React, no I/O: every
 * function here maps a loaded row (or `null`) to plain values the hook then puts into state.
 */

/** What `port.getPresentation()` resolves with. */
type PostPresentation = { settings: { activeThemeId: string | null }; availableThemes: { id: string; tier: HeadlessThemeTier; apiVersion?: 2 }[] };

/** The theme fields the "View Template" button needs — see `PostEditorController.activeThemeTier`/
 *  `activeThemeApiVersion`'s own docs for why an absent theme is `null`/`undefined`, not a guess. */
export interface ActivePostTheme {
  activeThemeId: string | null;
  activeThemeTier: HeadlessThemeTier | null;
  activeThemeApiVersion: 2 | undefined;
}

/**
 * Looks the active theme up by id in the presentation response's `availableThemes`.
 *
 * @complexity O(t) in the number of available themes.
 */
export function resolveActivePostTheme({ presentation }: { presentation: Pick<PostPresentation, "settings" | "availableThemes"> }, _optional: Record<string, never> = {}): ActivePostTheme {
  const matchedTheme = presentation.availableThemes.find((theme) => theme.id === presentation.settings.activeThemeId);
  return {
    activeThemeId: presentation.settings.activeThemeId,
    activeThemeTier: matchedTheme?.tier ?? null,
    activeThemeApiVersion: matchedTheme?.apiVersion,
  };
}

/**
 * Whether the body hides the cover image — on unless the row explicitly stored `false`, so a post
 * saved before the setting existed keeps the default. Read the same way on load and after a save.
 *
 * @complexity O(1).
 */
export function savedHideCoverImageInBody({ post }: { post: { ext?: Record<string, Record<string, unknown>> } }, _optional: Record<string, never> = {}): boolean {
  return post.ext?.["post-presentation"]?.hideCoverImageInBody !== false;
}

/**
 * The working copy a freshly loaded row opens with, minus `bodyJson` (which only exists once the
 * editor has applied the content — see the load effect in `use-post-editor.hooks.ts`).
 *
 * @complexity O(1).
 */
export function loadedPostForm(required: { post: { title: string; slug: string; status: "draft" | "published"; templateChoice?: string | null; overridesThemePage?: boolean | null; publishAt?: string | null; featuredMediaId?: string | null; author?: string | null; showAuthor?: boolean; ext?: Record<string, Record<string, unknown>> }; activeThemeTemplates: string[];
  isoToLocalDateTimeInput(required: { iso: string | null | undefined }): string;
  localDateTimeInputToIso(required: { value: string }): string | null;
}): Omit<PostFormState, "bodyJson"> {
  const { post, activeThemeTemplates, isoToLocalDateTimeInput, localDateTimeInputToIso } = required;
  return {
    title: post.title,
    slug: post.slug,
    status: post.status,
    // Defaults to the theme's own first-listed template — never to "no template chosen" — unless
    // this post already has an explicit choice saved. Only reachable when the theme actually
    // offers templates; otherwise `post.templateChoice ?? null` (unset stays unset, same as
    // before this change) since there is nothing to default TO.
    templateChoice: post.templateChoice ?? (activeThemeTemplates.length > 0 ? activeThemeTemplates[0] as string : null),
    // Tri-state (2026-08-15) — `?? null`, not `?? false`: a fetched post that never had an
    // opinion set must load into the editor as "undecided", not as a silently-manufactured
    // "theme page wins" choice the author never made. `post.overridesThemePage` is already
    // `boolean | null` off the wire (see `AdminPost`'s own doc) — this `??` only exists to
    // normalize the one remaining `undefined` case: a pre-feature test fixture that predates
    // this field entirely.
    overridesThemePage: post.overridesThemePage ?? null,
    // Through the same input round-trip the field itself uses, so the minute-precision
    // `datetime-local` value never reads as a change against a seconds-precision stored time.
    publishAt: localDateTimeInputToIso({ value: isoToLocalDateTimeInput({ iso: post.publishAt }) }),
    featuredMediaId: post.featuredMediaId ?? null,
    author: post.author ?? "",
    showAuthor: post.showAuthor ?? false,
    hideCoverImageInBody: savedHideCoverImageInBody({ post }),
  };
}

/**
 * Rebuilds a {@link PostFormState} in its declared key order. `useDirtyGuard` compares the whole
 * object through `JSON.stringify`, so key order is part of the comparison: a baseline built in a
 * different order than the hook's `current` would read as dirty on an untouched post.
 *
 * @complexity O(1).
 */
export function postFormSnapshot(required: { fields: Omit<PostFormState, "bodyJson">; bodyJson: unknown }): PostFormState {
  const { fields, bodyJson } = required;
  return {
    title: fields.title,
    slug: fields.slug,
    status: fields.status,
    bodyJson,
    templateChoice: fields.templateChoice,
    overridesThemePage: fields.overridesThemePage,
    publishAt: fields.publishAt,
    featuredMediaId: fields.featuredMediaId,
    author: fields.author,
    showAuthor: fields.showAuthor,
    hideCoverImageInBody: fields.hideCoverImageInBody,
  };
}

/**
 * The slug the editor shows and whether it still follows the title (`postSlugFollowsTitle`,
 * `../rules.ts`): while it follows, the shown slug is derived from the typed title instead of the
 * stored one, and a save asks the server to derive it (`slugFromTitle`).
 *
 * @complexity O(n) in the title length (slug derivation).
 */
export function resolveEditorSlug(required: {
  post: { id: string; kind: "post" | "page"; status: "draft" | "published"; title: string; slug: string; everPublished?: boolean } | null;
  postSlugForTitle(required: { title: string }): string;
  postSlugFollowsTitle(required: { post: { kind: "post" | "page"; status: "draft" | "published"; title: string; slug: string; everPublished?: boolean }; manuallyEdited?: boolean }): boolean;
  title: string;
  storedSlug: string;
  slugEdited: boolean;
}): { followsTitle: boolean; slug: string } {
  const { post, title, storedSlug, slugEdited, postSlugForTitle, postSlugFollowsTitle } = required;
  if (post && !post.id && !slugEdited) return { followsTitle: true, slug: title.trim() ? postSlugForTitle({ title }) : "" };
  if (post === null || !postSlugFollowsTitle({ post, manuallyEdited: slugEdited })) return { followsTitle: false, slug: storedSlug };
  return { followsTitle: true, slug: title !== post.title ? postSlugForTitle({ title }) : storedSlug };
}

/** The per-row handles `usePostEditor` derives from the loaded row — see {@link loadedPostHandles}. */
export interface LoadedPostHandles {
  /** What every write after load targets. */
  entryId: string;
  /** The persisted row id, or `null` before load/first Save — the standing-draft key and preview dependency. */
  loadedId: string | null;
  /** The SAVED row is published but its go-live time is still ahead. */
  scheduled: boolean;
  /** The hidden preview form's `target`. */
  previewFormTarget: string;
}

/**
 * `entryId`: what every write after load targets. `postId` resolves the row once, on load (the
 * server accepts id or slug); after that the real id is the only handle that survives a slug rename.
 * Before this, the second save after a rename — and every overwrite, autosave, and delete — 404'd on
 * the old slug.
 *
 * `previewFormTarget`: a plain per-render string suffices since `post.id` is stable once loaded,
 * unlike the original's "stable per mount" ref, which existed only because `PostPreview` itself
 * remounts on every tab switch. `""` before `post` loads — `PostPreview` never renders that early.
 *
 * @complexity O(1).
 */
export function loadedPostHandles(required: { post: { id: string; status: "draft" | "published"; publishAt?: string | null } | null; postId: string; nowMs: number; isScheduledPost(required: { input: { status: "draft" | "published"; publishAt: string | null }; nowMs: number }): boolean }): LoadedPostHandles {
  const { post, postId, nowMs, isScheduledPost } = required;
  if (!post?.id) return { entryId: postId, loadedId: null, scheduled: false, previewFormTarget: "" };
  return {
    entryId: post.id,
    loadedId: post.id,
    scheduled: isScheduledPost({ input: { status: post.status, publishAt: post.publishAt ?? null }, nowMs: nowMs }),
    previewFormTarget: `post-preview-pending-${post.id}`,
  };
}
