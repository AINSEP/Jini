import { isTrashed } from "./contracts/site/soft-delete.js";

/**
 * @file Scheduled publishing — the one rule for "is this published row live yet?".
 *
 * A scheduled post is NOT a third status. It is a `status: "published"` row whose `publishAt` is
 * still in the future: stored as published, hidden from every public read until that instant
 * passes. Render-time on purpose — there is no background job to miss, crash or lag, so a post is
 * live at the first request after its time with nothing else having to run.
 *
 * Why not a `"scheduled"` status: `PostStatus` is a two-value union matched by ~50 call sites
 * (admin editors, headless contracts, publish-to-live), and every one of them would have had to
 * learn a third value. Here they keep working unchanged and only the public read gates add this
 * check. Lives in `contracts/site` (beside `isTrashed`) so a host routing layer can apply the same
 * rule without importing the post feature — the cycle `soft-delete.ts`'s own header describes.
 *
 * `publishAt` and `nowIso` are both ISO-8601 UTC strings from `Date.prototype.toISOString()`
 * (`normalizePublishAt` in the cms `posts/post.ts` is the only writer), so a plain string compare
 * orders them correctly.
 */

export interface SchedulableRecord {
  readonly status: string;
  readonly publishAt?: string | null;
}

/** The current instant in the same ISO shape `publishAt` is stored in. */
export function currentIso(): string {
  return new Date().toISOString();
}

/** True when a published row's go-live time is still ahead of `nowIso`. A draft is never "scheduled":
 *  its `publishAt` only takes effect once it is published. @complexity O(1). */
export function isScheduledAt({ record, nowIso }: { record: SchedulableRecord; nowIso: string }, _optional = {}): boolean {
  return record.status === "published" && typeof record.publishAt === "string" && record.publishAt > nowIso;
}

/** The date a post's date line shows (owner policy): its go-live time when it has one —
 *  so a scheduled post's Preview shows the day it will go live, and the same post shows that date once
 *  live — else `updatedAt`, since `PostRecord` has no separate published-at column. @complexity O(1). */
export function postDisplayDateIso(record: { readonly publishAt?: string | null; readonly updatedAt: string }): string {
  return record.publishAt ?? record.updatedAt;
}

/** Newest display date first ({@link postDisplayDateIso}), then `id` ascending — the in-JS twin of
 *  the post repo's `ORDER BY coalesce(publish_at, updated_at) DESC, id ASC`. @complexity O(1). */
export function comparePostsByDisplayDate(
  a: { readonly id: string; readonly publishAt?: string | null; readonly updatedAt: string },
  b: { readonly id: string; readonly publishAt?: string | null; readonly updatedAt: string }
): number {
  const left = postDisplayDateIso(a);
  const right = postDisplayDateIso(b);
  if (left !== right) return left < right ? 1 : -1;
  if (a.id < b.id) return -1;
  return a.id > b.id ? 1 : 0;
}

/** Published, not trashed, and past its go-live time — the whole public-visibility rule for a post
 *  or page row. @complexity O(1). */
export function isLiveAt({ record, nowIso }: { record: SchedulableRecord & { readonly deletedAt?: string | null }; nowIso: string }, _optional = {}): boolean {
  return record.status === "published" && !isTrashed(record) && !isScheduledAt({ record, nowIso });
}
