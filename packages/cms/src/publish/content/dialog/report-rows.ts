import type { PublishContentOutcomeRow, PublishContentReport } from "./contract.js";
import { friendlyPublishReason } from "./report-reasons.js";

/**
 * @file Task 11 — turning a `PublishContentReport` into the rows the Publish Content dialog
 * renders, and the counts its primary button is labelled with.
 *
 * ## The one property this file is responsible for
 *
 * Plan §4 task 11: *a conflict row renders its reason and is not selectable for silent apply.*
 *
 * **2026-09-19 (owner-directed): rows a run WOULD write are now selectable; rows it would not are
 * still not.** {@link PublishReportRow.selectable} is derived from the disposition map below and
 * from nothing else, so only `publish` rows can ever carry a checkbox — an `unchanged` or `skipped`
 * row renders no control at all (not a disabled one), which keeps the original property exactly as
 * stated: there is no affordance anywhere in the dialog that could move a skipped row into the set
 * the run writes.
 *
 * Deselection is still **exclusion by construction**, not an apply-time flag: deselecting rows makes
 * the dialog re-plan against a bundle containing only the selected entities (`export-bundle.ts`'s
 * `selectBundleEntities`, reached through `push/plan`'s `selectedEntityKeys`), so a deselected entity
 * is never staged on the destination at all and no code path downstream has to remember to skip it.
 * `forced` (plan §4's seventh outcome, the operator explicitly choosing a conflicted row) is a
 * different feature and still unbuilt; when it lands it lands here, next to `publishRowDisposition`,
 * not as a second copy in the host admin app.
 *
 * `appliesOnExecute` is read straight off the planner's own `writes` flag rather than re-derived
 * from `outcome`, so this file cannot disagree with `planner.ts` about what a run does.
 */

/**
 * What the dialog says will happen to one entity.
 *
 * - `publish` — the run writes this row.
 * - `unchanged` — the destination already matches; nothing happens, and that is the expected case.
 * - `skipped` — the run deliberately does not touch this row, and owes the operator a reason.
 */
export type PublishRowDisposition = "publish" | "unchanged" | "skipped";

/** One rendered report row. `key` is stable across re-plans, so React can keep row identity, and it
 *  is byte-identical to `planner.ts`'s own `entityKey(type, id)` — the string a selection is sent
 *  back to the server as. */
export interface PublishReportRow {
  /** Source titles/slugs used by server-side named selection, when available. */
  readonly names?: readonly string[];
  readonly key: string;
  readonly entityType: string;
  /** What the TYPE column reads — a short plain word for every registered handler
   *  (the host's {@link PublishEntityTypeLabeler}), or {@link entityType} itself for one this file has not seen yet
   *  (degraded, never blank, same fallback shape as {@link entityLabel}'s own short-id floor). */
  readonly entityTypeLabel: string;
  readonly entityId: string;
  /** Always renderable, never blank: the planner's `entityLabel` when the entity had one, otherwise
   *  a {@link SHORT_ID_LENGTH}-character prefix of the id. A full uuid is never a display value —
   *  the whole column was unreadable while it was one. */
  readonly entityLabel: string;
  /** Whether this row may be deselected before publishing. True for `publish` rows ONLY — an
   *  `unchanged` or `skipped` row is a statement, not an action, and gets no control at all. */
  readonly selectable: boolean;
  readonly outcome: PublishContentOutcomeRow["outcome"];
  readonly disposition: PublishRowDisposition;
  readonly dispositionLabel: string;
  /** Never `null` for a `skipped` row — see {@link MISSING_REASON}. Rewritten for a non-technical
   *  owner by {@link friendlyPublishReason} before it ever reaches this shape; the planner's own raw
   *  wording (ids, "peer", "baseline") never renders. */
  readonly reason: string | null;
  /** The planner's own `writes` flag, carried through unmodified. */
  readonly appliesOnExecute: boolean;
  /**
   * publish-overwrite-live-plan §4/S9 — whether this row may render the "Overwrite on live"
   * checkbox. `true` only for a `skipped` row whose planner `canOverwrite` is `true`: a row the run
   * already writes (an ordinary `publish` disposition, including an already-forced conflict) never
   * gets a SECOND control offering to do the same thing again, and an `unchanged` row has nothing to
   * overwrite. Ticking one re-plans with `overwriteEntityKeys` (`use-publish-content-confirm.hooks.ts`),
   * which is what turns this same row `forced` and moves it out of `skipped` on the next render — the
   * checkbox is never itself what publishes anything.
   */
  readonly overwritable: boolean;
  /** The live row an overwrite of this entity would retire, named for the dialog — the planner's own
   *  `retires.entityLabel`, falling back to a short id the same way {@link entityLabel} does. `null`
   *  when this row retires nothing (every outcome but a resolvable slug clash). */
  readonly retiresLabel: string | null;
  /**
   * `plan-publish-repoint-menus-2026-09-24.md` §2.2/R6 — the live entities (e.g. menus) that still
   * link to this row's {@link retires} holder, named for the dialog the same way {@link retiresLabel}
   * is — the planner's own `referencedBy[].entityLabel`, falling back to a short id. Empty for every
   * row that retires nothing, and for a retire target with no live references at all.
   */
  readonly referencedByLabels: readonly string[];
  /**
   * Owner decision 2026-09-25 — the `entityKey`s of the in-scope pages/posts a carried-along media
   * row was brought along for (`PublishContentOutcomeRowDto.includedFor`). Empty for every other row.
   * A non-empty list makes the row pre-ticked and untickable: never {@link selectable}, but counted as
   * publishing while any of these keys is still ticked ({@link countSelectedPublishing}).
   */
  readonly includedFor: readonly string[];
  /** The dialog's note for a carried-along row — see {@link usedByNoteFor}. `null` on every other
   *  row. English source text; the dialog translates it. */
  readonly usedByNote: string | null;
  /** This update trashes the item on live (`PublishContentOutcomeRowDto.trashes`): labelled
   *  {@link TRASH_ON_LIVE_LABEL} and styled apart from an ordinary publish. */
  readonly trashes: boolean;
}

/**
 * Names a registered `PublishContentHandler.entityType` id for an owner rather than a developer
 * (`"theme-files"` reads "Theme"). The host supplies it from the one section table its section
 * buttons also read, so the TYPE column and the buttons can never disagree. An unlisted type falls
 * back to its raw id — degraded, never wrong. Injected because the section table is host copy.
 */
export type PublishEntityTypeLabeler = (args: { entityType: string }) => string;

/** What the counts under the table add up to. */
export interface PublishReportSummary {
  readonly total: number;
  readonly publishing: number;
  readonly unchanged: number;
  readonly skipped: number;
}

/**
 * Stand-in for a `skipped` row whose planner reason is `null`. A skip with a blank cell reads as a
 * rendering bug and leaves the operator with no way to act; a sentence that says the reason is
 * missing is at least honest about which of the two it is.
 */
const MISSING_REASON = "No reason recorded.";


/** How much of an id to show when an entity has no human identifier at all. Eight hex characters is
 *  the git-short-sha convention and stays unique enough to tell two rows apart on one screen, which
 *  is the only job left for an id once the label column is doing the naming. */
const SHORT_ID_LENGTH = 8;

/**
 * The shared fallback behind both {@link displayLabelFor} and {@link retiresLabelFor}: prefer a real
 * label, fall back to a short id prefix, never the full uuid.
 *
 * @complexity O(1).
 */
function labelOrShortId({ label, id }: { label: string | null | undefined; id: string }, _optional = {}): string {
  if (label !== null && label !== undefined && label.trim().length > 0) return label;
  return id.slice(0, SHORT_ID_LENGTH);
}

/**
 * What to print in the entity column. Prefers the planner's own label; falls back to a short id
 * prefix, never the full uuid (`?? null` covers an older peer whose report predates the field).
 *
 * @complexity O(1).
 */
function displayLabelFor(row: PublishContentOutcomeRow): string {
  return labelOrShortId({ label: row.entityLabel, id: row.entityId });
}

/**
 * What the dialog names the live row an overwrite would retire, or `null` when this row retires
 * nothing. Same fallback as {@link displayLabelFor} — a `RetireTarget` carries its own
 * `entityLabel`/`entityId` pair, not the row's.
 *
 * @complexity O(1).
 */
function retiresLabelFor(row: PublishContentOutcomeRow): string | null {
  const target = row.retires ?? null;
  if (target === null) return null;
  return labelOrShortId({ label: target.entityLabel, id: target.entityId });
}

/**
 * What the dialog names every live holder still linking to this row's retire target — empty when the
 * row retires nothing, or when nothing live references it. Same fallback as {@link displayLabelFor}
 * and {@link retiresLabelFor}, applied per holder.
 *
 * @complexity O(h) in the row's holder count.
 */
function referencedByLabelsFor(row: PublishContentOutcomeRow): readonly string[] {
  const holders = row.referencedBy ?? [];
  return holders.map((holder) => labelOrShortId({ label: holder.entityLabel, id: holder.entityId }));
}

/**
 * The note a carried-along row shows, named by the types of the rows that use it: pages and/or
 * posts by name, any other mix (a widget region, an entry, ...) generically.
 *
 * @complexity O(k) in the referrer count.
 */
function usedByNoteFor(includedFor: readonly string[]): string | null {
  if (includedFor.length === 0) return null;
  const types = new Set(includedFor.map((key) => key.slice(0, key.indexOf(":"))));
  if ([...types].some((type) => type !== "page" && type !== "post")) return "Used by items you're publishing";
  if (types.has("page") && types.has("post")) return "Used by these pages and posts";
  return types.has("post") ? "Used by these posts" : "Used by these pages";
}


const DISPOSITION_BY_OUTCOME: Readonly<Record<PublishContentOutcomeRow["outcome"], PublishRowDisposition>> = {
  created: "publish",
  applied: "publish",
  forced: "publish",
  unchanged: "unchanged",
  conflict: "skipped",
  blocked: "skipped",
};

/** Terse, operator-facing, and specific about *why* — "Skipped" alone sends someone hunting. */
const LABEL_BY_OUTCOME: Readonly<Record<PublishContentOutcomeRow["outcome"], string>> = {
  created: "Will publish — new",
  applied: "Will publish — update",
  forced: "Will publish — overwrite",
  unchanged: "Already up to date",
  conflict: "Skipped",
  blocked: "Skipped",
};

const COMPLETED_LABEL_BY_OUTCOME: Readonly<Record<PublishContentOutcomeRow["outcome"], string>> = {
  created: "Published — new",
  applied: "Published — update",
  forced: "Published — overwrite",
  unchanged: "Already up to date",
  conflict: "Skipped",
  blocked: "Skipped",
};

/** Pick planned or completed wording without changing the server's actual outcome.
 * @complexity O(1); no effects. */
function reportDispositionLabel({ row, completed }: { row: PublishContentOutcomeRow; completed: boolean }, _options = {}): string {
  if (row.trashes === true && row.writes) return completed ? "Trashed on live" : TRASH_ON_LIVE_LABEL;
  return (completed ? COMPLETED_LABEL_BY_OUTCOME : LABEL_BY_OUTCOME)[row.outcome];
}

/** The label for a row whose update trashes the item on live. */
const TRASH_ON_LIVE_LABEL = "Will trash on live";

/**
 * Whether the run writes this row, stated as a disposition rather than a boolean so the table can
 * distinguish "nothing to do" from "deliberately not done".
 *
 * @complexity O(1).
 */
export function publishRowDisposition(row: PublishContentOutcomeRow): PublishRowDisposition {
  return DISPOSITION_BY_OUTCOME[row.outcome];
}

/**
 * Shapes a report for rendering. A refused report has no rows by construction (`planner.ts`), so
 * this returns an empty list for one rather than inventing a placeholder — the dialog renders the
 * refusal reason on its own.
 *
 * @complexity O(n) in the report's row count, single pass, no sorting: the planner already emits
 * rows in `dependsOn` apply order and this keeps it. The dialog shows a sorted copy instead
 * (`publish-order.ts`, owner rule 2026-09-26: to publish first, A–Z).
 */
export function toPublishReportRows(
  { report, entityTypeLabel }: { report: PublishContentReport; entityTypeLabel: PublishEntityTypeLabeler },
  { completed = false }: { completed?: boolean } = {},
): readonly PublishReportRow[] {
  if (report.refused) return [];
  return report.rows.map((row) => {
    const disposition = publishRowDisposition(row);
    const rawReason = disposition === "skipped" ? (row.reason ?? MISSING_REASON) : row.reason;
    const includedFor = row.includedFor ?? [];
    return {
      key: `${row.entityType}:${row.entityId}`,
      entityType: row.entityType,
      entityTypeLabel: entityTypeLabel({ entityType: row.entityType }),
      entityId: row.entityId,
      entityLabel: displayLabelFor(row),
      selectable: !completed && disposition === "publish" && includedFor.length === 0,
      outcome: row.outcome,
      disposition,
      dispositionLabel: reportDispositionLabel({ row, completed }),
      reason: rawReason === null ? null : friendlyPublishReason({ reason: rawReason }),
      appliesOnExecute: row.writes,
      overwritable: !completed && disposition === "skipped" && row.canOverwrite === true,
      retiresLabel: retiresLabelFor(row),
      referencedByLabels: referencedByLabelsFor(row),
      includedFor,
      usedByNote: usedByNoteFor(includedFor),
      trashes: row.trashes === true,
    };
  });
}

/**
 * The counts the dialog's primary button and summary line read from.
 *
 * `publishing` counts rows by disposition, not by `appliesOnExecute`: the two agree for every
 * outcome the planner produces, and disagreeing would mean the table said one thing and the button
 * said another. `report-rows.test.ts` pins them together.
 *
 * @complexity O(n), single pass.
 */
export function summarizePublishReport({ rows }: { rows: readonly PublishReportRow[] }, _optional: Record<string, never> = {}): PublishReportSummary {
  let publishing = 0;
  let unchanged = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.disposition === "publish") publishing += 1;
    else if (row.disposition === "unchanged") unchanged += 1;
    else skipped += 1;
  }
  return { total: rows.length, publishing, unchanged, skipped };
}

/**
 * Every row key the operator is allowed to deselect — the dialog's initial "everything is checked"
 * state, its header checkbox's whole reach, and the yardstick for "is this a strict subset?".
 *
 * Exported rather than left as a filter at the call site so all three of those reads apply the same
 * {@link PublishReportRow.selectable} rule; a fourth that spelled it `disposition === "publish"`
 * itself would silently disagree the day a new outcome lands.
 *
 * @complexity O(n), single pass.
 */
export function selectableRowKeys({ rows }: { rows: readonly PublishReportRow[] }, _optional: Record<string, never> = {}): readonly string[] {
  return rows.filter((row) => row.selectable).map((row) => row.key);
}

/**
 * Whether this row publishes given the operator's current selection: a selectable row when it is
 * ticked, a carried-along row ({@link PublishReportRow.includedFor}) while any page/post that uses it
 * is ticked — the same rule `push/plan`'s narrowed re-plan applies when it re-derives what to carry.
 *
 * @complexity O(k) in the row's referrer count.
 */
export function rowPublishesWithSelection({ row, selected }: { row: PublishReportRow; selected: ReadonlySet<string> }, _optional: Record<string, never> = {}): boolean {
  if (row.selectable) return selected.has(row.key);
  return row.disposition === "publish" && row.includedFor.some((key) => selected.has(key));
}

/**
 * How many rows this run would actually write given the operator's current selection — the number
 * the primary button commits to out loud.
 *
 * Counts the INTERSECTION rather than `selected.size`: a key left over from a previous plan, or one
 * naming a row that is no longer selectable, must not inflate the promise on the button. A
 * carried-along row counts through {@link rowPublishesWithSelection}.
 *
 * @complexity O(n·k), single pass; `k` is a carried-along row's referrer count.
 */
export function countSelectedPublishing({ rows, selected }: { rows: readonly PublishReportRow[]; selected: ReadonlySet<string> }, _optional: Record<string, never> = {}): number {
  let count = 0;
  for (const row of rows) if (rowPublishesWithSelection({ row, selected })) count += 1;
  return count;
}
