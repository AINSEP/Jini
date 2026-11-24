import type { PublishContentOutcomeRow, PublishContentReport, PublishContentPlanResult } from "./contract.js";
import { rowPublishesWithSelection, selectableRowKeys, toPublishReportRows, type PublishEntityTypeLabeler } from "./report-rows.js";

/** `${entityType}:${entityId}` — byte-identical to `planner.ts`'s own `entityKey()` and to
 *  `report-rows.ts`'s row `key`, which is what a ticked "Overwrite on live" checkbox is keyed by. */
function outcomeRowKey(row: Pick<PublishContentOutcomeRow, "entityType" | "entityId">): string {
  return `${row.entityType}:${row.entityId}`;
}

/** Every key this report would actually write (`created`/`applied`/`forced`), minus `exclude` — the
 *  yardstick {@link overwriteReplanIsConsistent} uses twice, once per report, to compare "everything
 *  this run writes other than what the operator is ticking or unticking". */
function writingKeysExcluding(report: PublishContentReport, exclude: ReadonlySet<string>): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const row of report.rows) {
    if (row.outcome !== "created" && row.outcome !== "applied" && row.outcome !== "forced") continue;
    const key = outcomeRowKey(row);
    if (!exclude.has(key)) keys.add(key);
  }
  return keys;
}

/**
 * Whether re-planning with `tickedKeys` (publish-overwrite-live-plan §4/S9's "Overwrite on live"
 * boxes) landed on a report consistent with `shown` — the report on screen when the operator
 * clicked, i.e. the one they actually reviewed. Comparing against the screen rather than the first
 * plan matters after a mismatch: the operator has been told to check the new list, and every later
 * tick would otherwise re-report the same old drift forever (c7n-ow-review2, 2026-09-24).
 *
 * Two things must both hold:
 * 1. every ticked key is now `forced` in `next` — a peer that can honour the overwrite always
 *    answers this way; anything else means the tick did not take (e.g. the holder moved again).
 * 2. every writing row (created/applied/forced) outside `changing` — the keys ticked or unticked by
 *    this click and any still in flight — names the exact same set in both reports: a live edit
 *    landing in between shows up here as a newly-written or newly-skipped row.
 *
 * A `false` here is not a network error: the re-plan itself succeeded, it just disagrees with what
 * was on screen, and `applyOverwriteKeys` shows the new truth plus a sentence rather than silently
 * keeping the stale one.
 *
 * @complexity O(n) in the larger report's row count.
 */
export function overwriteReplanIsConsistent(
  required: { shown: PublishContentReport; next: PublishContentReport; tickedKeys: ReadonlySet<string>; changing: ReadonlySet<string> },
  _optional: Record<string, never> = {}
): boolean {
  const { shown, next, tickedKeys, changing } = required;
  const nextByKey = new Map(next.rows.map((row) => [outcomeRowKey(row), row]));
  for (const key of tickedKeys) {
    const row = nextByKey.get(key);
    if (!row || row.outcome !== "forced") return false;
  }
  const shownOther = writingKeysExcluding(shown, changing);
  const nextOther = writingKeysExcluding(next, changing);
  if (shownOther.size !== nextOther.size) return false;
  for (const key of shownOther) if (!nextOther.has(key)) return false;
  return true;
}

/** `{ overwriteEntityKeys }` narrowed to the keys in `keep`, or `{}` when none survive — spread into
 *  a narrowing re-plan so an empty set is never sent as an explicit (and meaningless) empty array.
 *  @complexity O(n + m). */
function overwriteKeysWithin({ overwriteEntityKeys, keep }: { overwriteEntityKeys: readonly string[] | undefined; keep: readonly string[] }, _optional = {}): { overwriteEntityKeys?: readonly string[] } {
  const kept = new Set(keep);
  const within = (overwriteEntityKeys ?? []).filter((key) => kept.has(key));
  return within.length > 0 ? { overwriteEntityKeys: within } : {};
}

/** A narrowed re-plan that disagrees with the report the operator reviewed. Carries the new plan so
 *  the dialog can put the new truth on screen (the same "show it plus a sentence" answer
 *  {@link overwriteReplanIsConsistent} gets for a tick) instead of confirming rows nobody saw. */
export class PublishPlanDriftError extends Error {
  readonly plan: PublishContentPlanResult;
  constructor(plan: PublishContentPlanResult) {
    super("The live site changed while publishing was being planned. Check the list again.");
    this.name = "PublishPlanDriftError";
    this.plan = plan;
  }
}

/** Shared selection-to-confirm path. Re-stage a narrowed bundle, retaining overwrites for carried
 * dependencies. Comparing writing sets prevents selection from silently accepting live drift.
 * @throws {PublishPlanDriftError} when the narrowed plan writes a different set than was reviewed. */
export async function preparePublishConfirmation(
  required: { plan: PublishContentPlanResult; deselectedKeys: ReadonlySet<string>; entityTypeLabel: PublishEntityTypeLabeler;
    planPublish: (input: { selectedEntityKeys: readonly string[]; overwriteEntityKeys?: readonly string[] }) => Promise<PublishContentPlanResult> },
  _optional: Record<string, never> = {},
): Promise<PublishContentPlanResult> {
  const rows = toPublishReportRows({ report: required.plan.details, entityTypeLabel: required.entityTypeLabel });
  const selectable = selectableRowKeys({ rows });
  const keep = selectable.filter(key => !required.deselectedKeys.has(key));
  if (keep.length === selectable.length) return required.plan;
  const keepSet = new Set(keep);
  const carriedKept = rows.filter(row => row.includedFor.length > 0 && rowPublishesWithSelection({ row, selected: keepSet })).map(row => row.key);
  const next = await required.planPublish({ selectedEntityKeys: keep,
    ...overwriteKeysWithin({ overwriteEntityKeys: required.plan.overwriteEntityKeys, keep: [...keep, ...carriedKept] }) });
  const changing = new Set(rows.filter(row => !rowPublishesWithSelection({ row, selected: keepSet })).map(row => row.key));
  const tickedKeys = new Set((required.plan.overwriteEntityKeys ?? []).filter(key => !changing.has(key)));
  if (!overwriteReplanIsConsistent({ shown: required.plan.details, next: next.details, tickedKeys, changing })) {
    throw new PublishPlanDriftError(next);
  }
  return next;
}
