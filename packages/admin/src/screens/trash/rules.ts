import type { QueryKey } from "@jini-ai/core/fetch";
import type { AdminTrashItemDto, AdminTrashPurgeOutcome, AdminTrashRestoreOutcome } from "@jini-ai/core/contracts/site/cms-trash";
import { interpolate, type Translate } from "@jini-ai/core/text";

/**
 * @file Pure decisions for the Trash screen — cache keys, the coverage sentence, selection
 * arithmetic and the per-outcome copy. No React, no `lib/api` call, no state.
 */

/** One resource: the page. Paged rows are accumulated locally, same as the comments queue. */
export const KEYS = {
  listRoot: ["trash", "list"] as QueryKey,
  list: (): QueryKey => ["trash", "list", "page-1"],
  /**
   * The client-side username resolution table `actorLabel` falls back to when the server omits
   * `actorUsername` entirely (an older server build — see `actorLabel`'s own doc). Deliberately NOT
   * nested under `listRoot`: a row write invalidates `listRoot`, but the workspace's user roster does
   * not change on every delete, so it must not be refetched on that same invalidation.
   */
  actorUsernames: (): QueryKey => ["trash", "actor-usernames"],
};

/**
 * The Trash's name on the host's content-refresh bus.
 *
 * Agent-writable: `content_post_delete`, `comments_trash_comment`, `media_trash_asset` and
 * `redirects_tombstone` all write an index row, and `trash_restore_item` removes one. Without this
 * subscription an operator who asks the assistant to delete a post watches the Trash keep saying it
 * is empty.
 */
export const TRASH_RESOURCE = "trash";

/**
 * The line the screen must show, per design §4.2, and NOT behind a disclosure.
 *
 * Collection entries are not retained here; theme files are restorable from each theme's own
 * trash through the assistant. A user who deletes something and does not find it here, and is told
 * nothing, would otherwise conclude it is unrecoverable; naming both destinations is cheaper than
 * that mistake.
 * Owner update (2026-10-07): the title InfoTip now carries this explanation instead of a second
 * subtitle; the original always-visible requirement above is superseded, but the exceptions remain.
 */
export function coverageLine({ translate }: { translate: Translate }, _optional: Record<string, never> = {}): string {
  // Leads with what Trash is for: a tip that only listed exceptions never said what the page holds.
  return translate("Deleted items wait here so you can restore them until their days run out. Collection entries aren't kept in Trash. Deleted theme files go to the theme's own trash — ask the assistant to restore them.");
}

/**
 * The header's window sentence, interpolated from the server-reported retention so it never drifts
 * from the host's policy. `null` (first page not settled) states no window rather than guessing one.
 */
export function retentionLine({ translate, retentionDays }: { translate: Translate; retentionDays: number | null }, _optional: Record<string, never> = {}): string | null {
  if (retentionDays === null) return null;
  return interpolate({ template: translate("Items are permanently deleted {days} days after they are moved to Trash."), vars: { days: String(retentionDays) } });
}

/** A human label for a row's kind. Unknown kinds print as themselves rather than being hidden —
 *  the server already dropped the rows this operator may not see. @complexity O(1). */
export function entityTypeLabel({ translate, entity }: { translate: Translate; entity: string | Pick<AdminTrashItemDto, "entityType" | "displayKind"> }, _optional: Record<string, never> = {}): string {
  const entityType = typeof entity === "string" ? entity : entity.entityType;
  const displayKind = typeof entity === "string" ? undefined : entity.displayKind;
  const known: Record<string, string> = {
    "email-template": "Email template",
    post: "Post",
    page: "Page",
    comment: "Comment",
    media: "Media",
    redirect: "Redirect",
    form: "Form",
    form_submission: "Form submission",
    widget: "Widget",
    menu: "Menu",
    term: "Term",
    taxonomy: "Taxonomy",
    plugin: "Plugin",
    user: "User",
    member: "Member",
    theme: "Theme",
  };
  // Pages share the post trash lifecycle; only their presentation uses the subtype.
  const kind = entityType === "post" && displayKind === "page" ? "page" : entityType;
  const label = known[kind];
  return label ? translate(label) : entityType;
}

export function itemSubtitle({ translate, item }: { translate: Translate; item: { entityType: string; subtitle: string | null } }, _optional: Record<string, never> = {}): string | null {
  if (item.entityType !== "plugin") return item.subtitle;
  const shared = translate("Shared across all workspaces on this site.");
  return item.subtitle ? `${item.subtitle} · ${shared}` : shared;
}

/** Empty default for {@link actorLabel}'s `knownUsernames` parameter — a module-level constant so
 *  callers that never fetched a users list don't need to pass anything. */
const NO_KNOWN_USERNAMES: ReadonlyMap<string, string> = new Map();

/** `actorLabel`'s rendered text plus an optional tooltip. See {@link actorLabel}. */
export interface ActorLabel {
  label: string;
  /** The raw plugin/agent id, when one acted — meant for a `title` attribute, not the visible text
   *  (2026-09-21: the id alone used to BE the visible text; see {@link actorLabel}'s doc). */
  title?: string;
}

/**
 * Who deleted it, in words an operator can read — never the raw principal id.
 *
 * Priority, before an AI actor is layered on top (see below):
 * 1. the username the server resolved for `actorPrincipalId` (`actorUsername`, a defined string);
 * 2. failing that, the username THIS CLIENT resolves for `actorPrincipalId` from `knownUsernames`
 *    (2026-09-21) — but only when `actorUsername` is absent from the response entirely, i.e. an
 *    older server build that predates username resolution and never sent the field at all. Against
 *    such a server every row, including the owner's own account, used to read "Unknown" even for the
 *    owner's own deletions, because nothing server-side had ever resolved `actorPrincipalId` to a
 *    name. `knownUsernames` is `use-trash.hooks.ts`'s own `listUsers()` call, keyed by principal id —
 *    resolving against it client-side needs no server change and degrades to "Unknown" if that call
 *    itself failed (an operator without `user.manage`/`member.manage` gets an empty map, not an
 *    error — see that hook's doc);
 * 3. `"System"`, when `actorIsSystem` says so, OR — for an old server that also predates
 *    `actorIsSystem` — when `actorPrincipalId` is literally `"system"` (`features/widgets/
 *    write-service.ts`'s `ADOPTION_ACTOR`, the 11 legacy widgets adopted into the Trash at boot);
 * 4. `"Deleted user"` when the server explicitly resolved no account (`actorUsername: null` — it
 *    looked the id up and found no user record: account removed, or a non-user system principal),
 *    else `"Unknown"` when the server never told us anything at all AND neither this list nor
 *    `knownUsernames` could explain the id either.
 *
 * Two different server answers must not collapse into one label — `null` means "the server checked
 * and there is no account", absence means "the server never checked" — conflating them showed every
 * row as "Deleted user", including the owner's own account, against a server that simply hadn't
 * picked up the `actorUsername` field yet (2026-09-21).
 *
 * On top of that human label: `actorPluginId` being set means an agent/plugin acted (already a
 * readable slug, e.g. `"forms"`), but it never acted AS NOBODY — some principal's grant let it run.
 * The label becomes `"<human label> + AI"` so the operator sees WHO's automation did it, not just
 * that automation did it; the raw plugin id moves to `title`, a tooltip, rather than replacing the
 * human label outright the way it used to (2026-09-21).
 *
 * @complexity O(1) — `knownUsernames` is looked up by key, not scanned.
 */
export function actorLabel(
  { translate, item }: { translate: Translate; item: AdminTrashItemDto },
  { knownUsernames = NO_KNOWN_USERNAMES }: { knownUsernames?: ReadonlyMap<string, string> } = {}
): ActorLabel {
  const human = humanActorLabel(translate, item, knownUsernames);
  if (item.actorPluginId != null) {
    return { label: `${human} + ${translate("AI")}`, title: item.actorPluginId };
  }
  return { label: human };
}

/** The human-facing part of {@link actorLabel}, before any AI-actor suffix. @complexity O(1). */
function humanActorLabel(translate: Translate, item: AdminTrashItemDto, knownUsernames: ReadonlyMap<string, string>): string {
  if (item.actorUsername !== undefined) {
    if (item.actorUsername != null) return item.actorUsername;
    // Explicit null: the server checked and found no account. Still let a real "system" actor win
    // over "Deleted user" — same reasoning the old single-function version documented.
    return item.actorIsSystem ? translate("System") : translate("Deleted user");
  }
  // The server never sent actorUsername at all (an older build) — try resolving it ourselves before
  // giving up.
  const resolved = knownUsernames.get(item.actorPrincipalId);
  if (resolved) return resolved;
  if (item.actorIsSystem || item.actorPrincipalId === "system") return translate("System");
  return translate("Unknown");
}

/**
 * Toggles one row in the selection.
 *
 * Returns a new Set rather than mutating, so React sees a changed identity.
 *
 * @complexity O(n) in the selection's size.
 */
export function toggleSelection({ current, id }: { current: ReadonlySet<string>; id: string }, _optional: Record<string, never> = {}): Set<string> {
  const next = new Set(current);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * Select-all / select-none over the rows currently on screen.
 *
 * Deliberately scoped to the visible rows: "select all" cannot reach rows the operator has not
 * loaded, because permanently deleting something you never saw listed is not a thing this screen
 * should make one click away.
 *
 * @complexity O(n) in the row count.
 */
export function selectionAfterSelectAll({ items, allSelected }: { items: readonly AdminTrashItemDto[]; allSelected: boolean }, _optional: Record<string, never> = {}): Set<string> {
  return allSelected ? new Set<string>() : new Set(items.map((item) => item.id));
}

/** @complexity O(n). */
export function allVisibleSelected({ items, selected }: { items: readonly AdminTrashItemDto[]; selected: ReadonlySet<string> }, _optional: Record<string, never> = {}): boolean {
  return items.length > 0 && items.every((item) => selected.has(item.id));
}

/**
 * What to tell the operator after a per-item batch.
 *
 * Both endpoints answer 200 with per-item outcomes even when every item failed — the request WAS
 * understood, and the reasons are the answer — so a screen that only looked at the status code
 * would report a silent success. This turns the report into one sentence.
 *
 * @complexity O(n) in the result count.
 */
export function describeRestoreReport(
  { translate, report }: { translate: Translate; report: { restored: number; results: readonly { outcome: AdminTrashRestoreOutcome }[] } },
  _optional: Record<string, never> = {}
): string {
  return describeBatch(translate, report.restored, report.results.length, "restored");
}

/** @complexity O(n) in the result count. */
export function describePurgeReport(
  { translate, report }: { translate: Translate; report: { purged: number; results: readonly { outcome: AdminTrashPurgeOutcome }[] } },
  _optional: Record<string, never> = {}
): string {
  const summary = describeBatch(translate, report.purged, report.results.length, "deleted");
  return report.results.some(result => result.outcome === "still-referenced")
    ? `${summary} ${translate("Items still in use were not deleted.")}`
    : summary;
}

/**
 * The shared sentence: how many of how many, and a named reason when none succeeded.
 *
 * @complexity O(1).
 */
function describeBatch(translate: Translate, succeeded: number, total: number, verb: "restored" | "deleted"): string {
  if (succeeded === total) {
    return verb === "restored" ? translate("Restored.") : translate("Deleted permanently.");
  }
  if (succeeded === 0) {
    return verb === "restored" ? translate("Nothing was restored.") : translate("Nothing was deleted.");
  }
  return verb === "restored"
    ? `${translate("Restored.")} ${succeeded}/${total}`
    : `${translate("Deleted permanently.")} ${succeeded}/${total}`;
}

/**
 * Why one item did not move, in the operator's words.
 *
 * `forbidden` gets a distinct sentence on purpose: "it failed" and "you are not allowed to do that"
 * ask for different next steps.
 *
 * @complexity O(1).
 */
