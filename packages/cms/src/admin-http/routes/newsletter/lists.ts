import type { NewsletterList } from "../../http/newsletter.js";

/**
 * @file The list collaborators the list route specs share. Each is the host's own `lists.ts`
 * function with its deps already bound, so a spec only supplies the request's input — the same
 * input object the hand-written route passed.
 */

/** A list write's result: the list as it now stands. */
export interface NewsletterListResult { list: NewsletterList }

/** The host's `saveList`: create a list (these routes never pass an `id`, so it never overwrites). */
export type NewsletterSaveListFn = (
  required: { workspaceId: string; name: string; slug: string },
  optional?: Record<string, never>,
) => Promise<NewsletterListResult>;

/** The host's `archiveList`: it refuses the default list and answers the archived row. */
export type NewsletterArchiveListFn = (
  required: { workspaceId: string; id: string },
  optional?: Record<string, never>,
) => Promise<NewsletterListResult>;
