import type { PublishContentOutcomeRow, PublishContentReport } from "./contract.js";
import { publishEntityTypeLabel, type PublishSection } from "./sections.js";

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
   *  (`sections.ts`), or {@link entityType} itself for one this file has not seen yet
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

/** The policy-free part of a {@link PublishReportRow}: everything derived from the planner's own
 *  outcome fields, nothing that reads host wording (every label, reason and note is left out).
 *  Selection, counting and re-plan consistency need only this, so they take no policy. */
export type PublishReportRowCore = Omit<
  PublishReportRow,
  "entityTypeLabel" | "entityLabel" | "dispositionLabel" | "reason" | "retiresLabel" | "referencedByLabels" | "usedByNote"
>;

/** What the counts under the table add up to. */
export interface PublishReportSummary {
  readonly total: number;
  readonly publishing: number;
  readonly unchanged: number;
  readonly skipped: number;
}

/** K5 — one raw-reason pattern and the sentence it becomes. The host supplies the table. */
/**
 * One raw-reason pattern this dialog is known to receive, and the owner-facing sentence it becomes.
 * Order matters: {@link friendlyPublishReason} returns the first match, so a narrower pattern (e.g.
 * the two conflict wordings) is listed before anything broader it could also satisfy.
 */
export interface PublishReasonRewrite {
  readonly pattern: RegExp;
  readonly friendly: string;
}

/**
 * Owner decision 2026-09-25 — a tree refusal that is about ONE file names that file, the way
 * `file-tree-policy.ts`'s already-final video reason does, instead of the generic "one of its files
 * isn't allowed". Each pattern matches a `wrapTreePolicyReason`-wrapped `checkTreeFiles`/
 * `checkTreePath` detail, quoted from that module, and captures the offending path; only the file's
 * own name is shown. The secret scan's pattern name (and so anything about what matched) is dropped.
 */
export interface PublishNamedFileRewrite {
  readonly pattern: RegExp;
  readonly friendly: (required: { name: string }, optional?: Record<string, never>) => string;
}

/** Everything {@link friendlyPublishReason} reads from the host: which prefix is already final copy, the
 *  closed rewrite table, the named-file rewrites, and the generic tree-wrapper fallback. */
export interface PublishReasonPolicy {
  readonly alreadyFinalPrefix: string;
  readonly rewrites: readonly PublishReasonRewrite[];
  readonly namedFileRewrites: readonly PublishNamedFileRewrite[];
  readonly genericWrapPattern: RegExp;
  readonly genericWrapFriendly: (required: { title: string }, optional?: Record<string, never>) => string;
}

/** Host product copy for a row's disposition column and its stand-ins (K3). */
export interface PublishReportCopy {
  /** Stand-in for a `skipped` row whose planner reason is `null`. */
  readonly missingReason: string;
  readonly plannedLabelByOutcome: Readonly<Record<PublishContentOutcomeRow["outcome"], string>>;
  readonly completedLabelByOutcome: Readonly<Record<PublishContentOutcomeRow["outcome"], string>>;
  /** Label for a row whose update trashes the item on live, planned / already done. */
  readonly trashPlannedLabel: string;
  readonly trashCompletedLabel: string;
  /** How much of an id to show when an entity has no human identifier at all. */
  readonly shortIdLength: number;
}

/** The host's whole policy for turning a report into rows: type names (`sections`), reason wording,
 *  disposition copy, and the carried-along note (which names the host's own entity types). */
export interface PublishReportPolicy {
  readonly sections: readonly PublishSection[];
  readonly reasons: PublishReasonPolicy;
  readonly copy: PublishReportCopy;
  readonly usedByNote: (required: { types: ReadonlySet<string> }, optional?: Record<string, never>) => string;
}

/**
 * Rewrites one raw planner/handler reason into the sentence the dialog shows an owner — terse, free
 * of ids and sync-protocol terms ("baseline", "peer", "entity"), and naming the action when the
 * matched cause has one. `file-tree-policy.ts`'s own `"Can't publish: ..."` sentinel is already
 * exactly this (that module's header explains why it alone gets to skip the title wrapper) and is
 * returned unchanged rather than double-translated.
 *
 * Anything matching none of the policy's rewrite tables or generic wrap pattern — a future
 * handler's wording this file has not seen yet, or a test fixture that is not real handler text —
 * passes through unchanged rather than being mangled by a guess.
 *
 * @complexity O(1) — a fixed, small number of regex tests against one string.
 */
export function friendlyPublishReason({ reason, policy }: { reason: string; policy: PublishReasonPolicy }, _optional = {}): string {
  if (reason.startsWith(policy.alreadyFinalPrefix)) return reason;
  for (const { pattern, friendly } of policy.rewrites) {
    if (pattern.test(reason)) return friendly;
  }
  for (const { pattern, friendly } of policy.namedFileRewrites) {
    const path = reason.match(pattern)?.[1];
    if (path !== undefined) return friendly({ name: path.slice(path.lastIndexOf("/") + 1) });
  }
  const wrapped = reason.match(policy.genericWrapPattern);
  if (wrapped) return policy.genericWrapFriendly({ title: wrapped[1] ?? "" });
  return reason;
}

/**
 * The shared fallback behind both {@link displayLabelFor} and {@link retiresLabelFor}: prefer a real
 * label, fall back to a short id prefix, never the full uuid.
 *
 * @complexity O(1).
 */
function labelOrShortId({ label, id, shortIdLength }: { label: string | null | undefined; id: string; shortIdLength: number }, _optional = {}): string {
  if (label !== null && label !== undefined && label.trim().length > 0) return label;
  return id.slice(0, shortIdLength);
}

/**
 * What to print in the entity column. Prefers the planner's own label; falls back to a short id
 * prefix, never the full uuid (`?? null` covers an older peer whose report predates the field).
 *
 * @complexity O(1).
 */
function displayLabelFor(row: PublishContentOutcomeRow, shortIdLength: number): string {
  return labelOrShortId({ label: row.entityLabel, id: row.entityId, shortIdLength });
}

/**
 * What the dialog names the live row an overwrite would retire, or `null` when this row retires
 * nothing. Same fallback as {@link displayLabelFor} — a `RetireTarget` carries its own
 * `entityLabel`/`entityId` pair, not the row's.
 *
 * @complexity O(1).
 */
function retiresLabelFor(row: PublishContentOutcomeRow, shortIdLength: number): string | null {
  const target = row.retires ?? null;
  if (target === null) return null;
  return labelOrShortId({ label: target.entityLabel, id: target.entityId, shortIdLength });
}

/**
 * What the dialog names every live holder still linking to this row's retire target — empty when the
 * row retires nothing, or when nothing live references it. Same fallback as {@link displayLabelFor}
 * and {@link retiresLabelFor}, applied per holder.
 *
 * @complexity O(h) in the row's holder count.
 */
function referencedByLabelsFor(row: PublishContentOutcomeRow, shortIdLength: number): readonly string[] {
  const holders = row.referencedBy ?? [];
  return holders.map((holder) => labelOrShortId({ label: holder.entityLabel, id: holder.entityId, shortIdLength }));
}

/**
 * The note a carried-along row shows — the host words it ({@link PublishReportPolicy.usedByNote}),
 * given the set of entity types of the rows that use it.
 *
 * @complexity O(k) in the referrer count.
 */
function usedByNoteFor({ includedFor, policy }: { includedFor: readonly string[]; policy: PublishReportPolicy }, _optional = {}): string | null {
  if (includedFor.length === 0) return null;
  const types = new Set(includedFor.map((key) => key.slice(0, key.indexOf(":"))));
  return policy.usedByNote({ types });
}

/** The registered `PublishContentHandler.entityType` ids, named for an owner rather than a
 *  developer (`"theme-files"` reads "Theme"), from the host's one section table (`sections.ts`)
 *  the section buttons also read. An unlisted type falls back to its raw id — degraded, never wrong.
 *  @complexity O(sections). */
function entityTypeLabelFor({ entityType, sections }: { entityType: string; sections: readonly PublishSection[] }, _optional = {}): string {
  return publishEntityTypeLabel({ entityType, sections });
}

const DISPOSITION_BY_OUTCOME: Readonly<Record<PublishContentOutcomeRow["outcome"], PublishRowDisposition>> = {
  created: "publish",
  applied: "publish",
  forced: "publish",
  unchanged: "unchanged",
  conflict: "skipped",
  blocked: "skipped",
};

/** Pick planned or completed wording without changing the server's actual outcome.
 * @complexity O(1); no effects. */
function reportDispositionLabel({ row, completed, copy }: { row: PublishContentOutcomeRow; completed: boolean; copy: PublishReportCopy }, _options = {}): string {
  if (row.trashes === true && row.writes) return completed ? copy.trashCompletedLabel : copy.trashPlannedLabel;
  return (completed ? copy.completedLabelByOutcome : copy.plannedLabelByOutcome)[row.outcome];
}

/**
 * Whether the run writes this row, stated as a disposition rather than a boolean so the table can
 * distinguish "nothing to do" from "deliberately not done".
 *
 * @complexity O(1).
 */
export function publishRowDisposition(row: PublishContentOutcomeRow): PublishRowDisposition {
  return DISPOSITION_BY_OUTCOME[row.outcome];
}

/** The policy-free fields of one row — see {@link PublishReportRowCore}. @complexity O(k) in the
 *  row's referrer count. */
function coreRowFor({ row, completed }: { row: PublishContentOutcomeRow; completed: boolean }, _optional = {}): PublishReportRowCore {
  const disposition = publishRowDisposition(row);
  const includedFor = row.includedFor ?? [];
  return {
    key: `${row.entityType}:${row.entityId}`,
    entityType: row.entityType,
    entityId: row.entityId,
    selectable: !completed && disposition === "publish" && includedFor.length === 0,
    outcome: row.outcome,
    disposition,
    appliesOnExecute: row.writes,
    overwritable: !completed && disposition === "skipped" && row.canOverwrite === true,
    includedFor,
    trashes: row.trashes === true,
  };
}

/**
 * The policy-free rows of a report. Selection and re-plan consistency read these; the dialog's table
 * reads {@link toPublishReportRows}, which adds the host's wording on top of the same fields.
 *
 * @complexity O(n) in the report's row count, single pass, no sorting.
 */
export function toPublishReportRowCores({ report }: { report: PublishContentReport }, { completed = false }: { completed?: boolean } = {}): readonly PublishReportRowCore[] {
  if (report.refused) return [];
  return report.rows.map((row) => coreRowFor({ row, completed }));
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
export function toPublishReportRows({ report, policy }: { report: PublishContentReport; policy: PublishReportPolicy }, { completed = false }: { completed?: boolean } = {}): readonly PublishReportRow[] {
  if (report.refused) return [];
  const { copy } = policy;
  return report.rows.map((row) => {
    const core = coreRowFor({ row, completed });
    const rawReason = core.disposition === "skipped" ? (row.reason ?? copy.missingReason) : row.reason;
    return {
      ...core,
      entityTypeLabel: entityTypeLabelFor({ entityType: row.entityType, sections: policy.sections }),
      entityLabel: displayLabelFor(row, copy.shortIdLength),
      dispositionLabel: reportDispositionLabel({ row, completed, copy }),
      reason: rawReason === null ? null : friendlyPublishReason({ reason: rawReason, policy: policy.reasons }),
      retiresLabel: retiresLabelFor(row, copy.shortIdLength),
      referencedByLabels: referencedByLabelsFor(row, copy.shortIdLength),
      usedByNote: usedByNoteFor({ includedFor: core.includedFor, policy }),
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
export function summarizePublishReport({ rows }: { rows: readonly PublishReportRowCore[] }, _optional: Record<string, never> = {}): PublishReportSummary {
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
export function selectableRowKeys({ rows }: { rows: readonly PublishReportRowCore[] }, _optional: Record<string, never> = {}): readonly string[] {
  return rows.filter((row) => row.selectable).map((row) => row.key);
}

/**
 * Whether this row publishes given the operator's current selection: a selectable row when it is
 * ticked, a carried-along row ({@link PublishReportRow.includedFor}) while any page/post that uses it
 * is ticked — the same rule `push/plan`'s narrowed re-plan applies when it re-derives what to carry.
 *
 * @complexity O(k) in the row's referrer count.
 */
export function rowPublishesWithSelection({ row, selected }: { row: PublishReportRowCore; selected: ReadonlySet<string> }, _optional: Record<string, never> = {}): boolean {
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
export function countSelectedPublishing({ rows, selected }: { rows: readonly PublishReportRowCore[]; selected: ReadonlySet<string> }, _optional: Record<string, never> = {}): number {
  let count = 0;
  for (const row of rows) if (rowPublishesWithSelection({ row, selected })) count += 1;
  return count;
}
