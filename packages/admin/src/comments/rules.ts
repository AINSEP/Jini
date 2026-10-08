import type { AdminComment, CommentModerationAction, CommentsSettings, CommentStatus } from '../core/ports/comments.js';
import { describeApiError } from '../core/transport/errors.js';
import { hasPermission } from '../core/permissions/rules.js';
import type { RowMenuItem } from '../react/components/RowMenu/RowMenu.js';
import { englishComments, type CommentsTranslator } from './messages.en.js';

/** Host transports retain their error class; status/body are the shared wire contract. */
function isCommentsConflict({ e }: { e: unknown }): boolean {
  return e instanceof Error && 'status' in e && e.status === 409;
}

/**
 * @file Pure logic for the `comments` feature — everything that computes a value rather than
 * rendering one. Follows the `posts/rules.ts` convention: no React import, no hooks, directly
 * testable.
 *
 * Moved here from `react/pages/CommentsPage.tsx`: `RowActionState`/`emptyRowState` and `describeModerationError`/
 * `truncate` (already module-scope free functions in the original, just not exported), the
 * moderation-queue row-menu item builder (a permission-and-status branch per action), and the
 * Comments-settings patch builder plus its validation (REQ-08/09/10).
 *
 * `KEYS` (fetch-query migration, 2026-08-12): three independent resources this feature's three
 * hooks each own — the operator's own effective permissions, the moderation queue (one cache
 * identity PER status filter, `queue(status)`), and the settings form. `queueRoot` is the
 * INVALIDATION target for a moderation action succeeding, not a read key of its own: a moderate/
 * purge action always moves a comment to a DIFFERENT status than the one currently filtered, so the
 * pre-migration `reloadFirstPage()` only ever refreshed the CURRENT filter's page — leaving a
 * previously-visited OTHER status tab's cache stale (missing the comment) until the operator
 * happened to force a reload. Invalidating the shared `["comments","queue"]` prefix instead
 * refreshes every status tab's cache at once (matching by prefix — see `@jini-ai/ui/fetch-query`'s
 * `QueryKey` doc), closing that gap; see `react/hooks/use-comment-queue.hooks.ts`'s own doc comment.
 */
export const KEYS = {
  permissions: ["comments", "permissions"] as const,
  queueRoot: ["comments", "queue"] as const,
  queue: (status: CommentStatus): readonly string[] => ["comments", "queue", status],
  settings: ["comments", "settings"] as const,
};

/** The moderation queue's name on `lib/content-refresh-bus.ts` — see `taxonomy/rules.ts`'s
 *  `TAXONOMY_RESOURCE` for why this is a plain colocated constant rather than a shared registry.
 *  Agent-writable via `comments_approve_comment`/`comments_mark_comment_spam`/
 *  `comments_trash_comment`/`comments_restore_comment` (`apps/website/src/features/comments/
 *  agent-tools.ts`), all of which move a comment between statuses this queue lists.
 *
 *  There is deliberately NO sibling `COMMENTS_SETTINGS_RESOURCE`: `react/hooks/use-comment-settings.hooks.ts`'s
 *  own header records a real, already-fixed lost-update bug (TM-TOVU-2026-08-12-A) whose fix is a
 *  ONE-SHOT seed guard that refuses to re-seed `settings` from any later successful load, including
 *  this bus's own out-of-band notification. Wiring that hook to the bus would either do nothing
 *  (the guard blocks it) or, if the guard were bypassed instead, reintroduce the exact silent
 *  revert the guard exists to prevent — so `comments_update_settings` stays unwired to this bus on
 *  purpose. See that hook's own file header for the full incident record. */
export const COMMENTS_QUEUE_RESOURCE = "comments-queue";

/** Per-row moderation-action state (Approve/Spam/Trash/Restore/Purge share one `busy` flag — only
 *  one action per row at a time). */
export interface RowActionState {
  busy: boolean;
  error: string | null;
}

export function emptyRowState(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): RowActionState {
  return { busy: false, error: null };
}

/** REQ-07: a 409 (stale `expectedVersion`) gets its own message instead of the generic fallback,
 * using the route's own `{error, currentVersion}` body when present. */
export function describeModerationError({ e }: { e: unknown }, { t = englishComments }: { t?: CommentsTranslator } = {}): string {
  if (isCommentsConflict({ e })) {
    const currentVersion = typeof (e as { body?: Record<string, unknown> }).body?.currentVersion === "number" ? (e as { body: Record<string, unknown> }).body.currentVersion : undefined;
    if (currentVersion !== undefined) {
      return t("This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.").replace("{currentVersion}", String(currentVersion));
    }
    return t("This comment changed since you loaded it — refresh and try again.");
  }
  return describeApiError({ e, fallback: t("Failed to update comment.") });
}

export function truncate({ text, max }: { text: string; max: number }, _optional: Record<string, never> = {}): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** The callbacks a row menu needs. Passed in rather than imported, so this module stays free of
 *  state (same convention as `posts/rules.ts`'s `PostRowMenuHandlers`). */
export interface CommentRowMenuHandlers {
  onModerate: (comment: AdminComment, action: CommentModerationAction) => void;
  /** Opens the confirm dialog; only offered under the trash filter for an already-trashed
   *  comment, and only with `comments.delete.force`. */
  onRequestPurge: (comment: AdminComment) => void;
}

/** Permissions resolved once per {@link commentRowMenuItems} call and threaded into each
 *  candidate-item builder below, so each builder stays a single-condition pure function. */
interface RowMenuPermissions {
  canModerate: boolean;
  canDelete: boolean;
  canForceDelete: boolean;
}

function approveItem(
  comment: AdminComment,
  perms: RowMenuPermissions,
  handlers: CommentRowMenuHandlers,
  t: CommentsTranslator,
): RowMenuItem | null {
  if (comment.status === "approved" || !perms.canModerate) return null;
  return { key: "approve", label: t("Approve"), onSelect: () => handlers.onModerate(comment, "approve") };
}

function spamItem(
  comment: AdminComment,
  perms: RowMenuPermissions,
  handlers: CommentRowMenuHandlers,
  t: CommentsTranslator,
): RowMenuItem | null {
  if (comment.status === "spam" || !perms.canModerate) return null;
  return { key: "spam", label: t("Spam"), onSelect: () => handlers.onModerate(comment, "spam") };
}

function trashItem(
  comment: AdminComment,
  perms: RowMenuPermissions,
  handlers: CommentRowMenuHandlers,
  t: CommentsTranslator,
): RowMenuItem | null {
  if (comment.status === "trash" || !perms.canDelete) return null;
  return { key: "trash", label: t("Trash"), onSelect: () => handlers.onModerate(comment, "trash") };
}

function restoreItem(
  comment: AdminComment,
  perms: RowMenuPermissions,
  handlers: CommentRowMenuHandlers,
  t: CommentsTranslator,
): RowMenuItem | null {
  const isRestorable = comment.status === "spam" || comment.status === "trash";
  if (!isRestorable || !perms.canModerate) return null;
  return { key: "restore", label: t("Restore"), onSelect: () => handlers.onModerate(comment, "restore") };
}

/** REQ-06: purge only ever surfaces from the trash filter view (`currentFilterStatus === "trash"`),
 *  not merely a trashed comment reached under a different filter. Genuinely destructive (its own
 *  confirm copy: "cannot be undone") — `destructive: true`, unlike the reversible actions above. */
function purgeItem(
  comment: AdminComment,
  currentFilterStatus: CommentStatus,
  perms: RowMenuPermissions,
  handlers: CommentRowMenuHandlers,
  t: CommentsTranslator,
): RowMenuItem | null {
  const inTrashFilter = currentFilterStatus === "trash" && comment.status === "trash";
  if (!inTrashFilter || !perms.canForceDelete) return null;
  return { key: "purge", label: t("Purge"), destructive: true, onSelect: () => handlers.onRequestPurge(comment) };
}

/** At-rest row actions for `RowMenu` — every condition here is copied verbatim from the inline
 *  buttons this replaces, so a permission/status combination that used to hide a button still
 *  omits the matching menu item rather than rendering a guaranteed-failing click. Each candidate
 *  item is its own single-condition pure function above; this just resolves permissions once and
 *  filters out the misses.
 *
 * @complexity Time: O(p) for three permission scans, p = effective grant count; output space is
 * constant, with at most five menu entries. Permission ownership stays in the core helper.
 */
export function commentRowMenuItems(
  { comment, context, handlers }: { comment: AdminComment; context: { permissions: readonly string[]; currentFilterStatus: CommentStatus }; handlers: CommentRowMenuHandlers },
  { t = englishComments }: { t?: CommentsTranslator } = {},
): RowMenuItem[] {
  const perms: RowMenuPermissions = {
    canModerate: hasPermission({ permissions: context.permissions, permission: "comments.moderate" }),
    canDelete: hasPermission({ permissions: context.permissions, permission: "comments.delete" }),
    canForceDelete: hasPermission({ permissions: context.permissions, permission: "comments.delete.force" }),
  };

  const candidates = [
    approveItem(comment, perms, handlers, t),
    spamItem(comment, perms, handlers, t),
    trashItem(comment, perms, handlers, t),
    restoreItem(comment, perms, handlers, t),
    purgeItem(comment, context.currentFilterStatus, perms, handlers, t),
  ];
  return candidates.filter((item): item is RowMenuItem => item !== null);
}

/** A blank or non-numeric raw value means "no opinion" — the field is left out of the patch
 *  rather than coerced to `0`/`NaN`. Shared by every numeric settings field except
 *  `closeAfterDays`, whose blank case means something else (see {@link parseCloseAfterDays}). */
export function parseOptionalNumber({ raw }: { raw: string }, _optional: Record<string, never> = {}): number | undefined {
  if (raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** REQ-10: blank means "never closes" -> `null` on the wire; the UI never sends the backend's own
 *  `-1` sentinel, only `null` or a positive number. A non-numeric raw value is "no opinion"
 *  (`undefined`), same as the other numeric fields. */
export function parseCloseAfterDays({ raw }: { raw: string }, _optional: Record<string, never> = {}): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

function diffCheckboxField<K extends "enabled" | "requireModeration">(
  form: FormData,
  key: K,
  current: CommentsSettings,
): Pick<CommentsSettings, K> | undefined {
  const value = form.get(key) === "on";
  return value !== current[key] ? ({ [key]: value } as Pick<CommentsSettings, K>) : undefined;
}

function diffNumberField<K extends "maxDepth" | "spamAutoRejectScore" | "maxPerIpPerHour">(
  form: FormData,
  key: K,
  current: CommentsSettings,
): Pick<CommentsSettings, K> | undefined {
  const value = parseOptionalNumber({ raw: String(form.get(key) ?? "") });
  return value !== undefined && value !== current[key] ? ({ [key]: value } as Pick<CommentsSettings, K>) : undefined;
}

function diffCloseAfterDaysField(
  form: FormData,
  current: CommentsSettings,
): Pick<CommentsSettings, "closeAfterDays"> | undefined {
  const closeAfterDays = parseCloseAfterDays({ raw: String(form.get("closeAfterDays") ?? "") });
  return closeAfterDays !== undefined && closeAfterDays !== current.closeAfterDays ? { closeAfterDays } : undefined;
}

/** REQ-08/09/10: builds a partial patch containing only the fields the operator actually changed
 * (the backend's `setCommentsSettings` is a partial-patch contract — REQ-08 asks the client to
 * mirror that instead of always sending the full object, as `Seo.tsx`'s form does). Each field's
 * diff logic is a standalone pure helper above so it can be tested (and reasoned about) on its
 * own; this function is just the merge. */
export function buildSettingsPatch(required: { form: FormData; current: CommentsSettings }, _optional: Record<string, never> = {}): Partial<CommentsSettings> {
  const { form, current } = required;
  return {
    ...diffCheckboxField(form, "enabled", current),
    ...diffCheckboxField(form, "requireModeration", current),
    ...diffNumberField(form, "maxDepth", current),
    ...diffCloseAfterDaysField(form, current),
    ...diffNumberField(form, "spamAutoRejectScore", current),
    ...diffNumberField(form, "maxPerIpPerHour", current),
  };
}

/** REQ-09: client-side validates `spamAutoRejectScore` before the network call — mirrors the
 * backend's own `validateCommentsSettingsPatch` bound (`src/comments/settings.ts`). Returns the
 * error message to show, or `null` when the patch is valid. Split out of `save`'s body (originally
 * an inline `if`) because it is the one piece of that flow that computes a value rather than
 * performing an effect. */
export function validateSettingsPatch({ patch }: { patch: Partial<CommentsSettings> }, { t = englishComments }: { t?: CommentsTranslator } = {}): string | null {
  if (patch.spamAutoRejectScore !== undefined && (patch.spamAutoRejectScore < 0 || patch.spamAutoRejectScore > 1)) {
    return t("Spam auto-reject score must be between 0 and 1.");
  }
  return null;
}

/**
 * `useCommentSettings`'s error banner, extracted out of that hook (`refactor/fetch-query`
 * complexity pass, 2026-08-12 — same reason `redirects/rules.ts`'s `visibleRedirectsError` was
 * extracted). Precedence, highest first: a client-side validation failure (the operator hasn't even
 * submitted a valid patch yet — a stale write/list error underneath it would be a confusing second
 * message), then the save write's own failure, then — only before `settings` has ever loaded — the
 * list-read failure, matching every other migrated feature's "a later background failure must not
 * blank an already-rendered screen" guard.
 *
 * @complexity Time/space: O(1) — four fixed checks, no iteration.
 */
export function visibleCommentSettingsError(params: {
  validationError: string | null;
  saveError: Error | null;
  saveFallback: string;
  listError: Error | null;
  listFallback: string;
  hasSettings: boolean;
}, _optional: Record<string, never> = {}): string | null {
  if (params.validationError) return params.validationError;
  if (params.saveError) return describeApiError({ e: params.saveError, fallback: params.saveFallback });
  if (params.hasSettings) return null;
  return params.listError ? describeApiError({ e: params.listError, fallback: params.listFallback }) : null;
}
