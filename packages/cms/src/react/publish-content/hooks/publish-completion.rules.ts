import type { Translate } from "@jini-ai/core/text";
import { summarizePublishReport, type PublishContentPhase, type PublishContentExecuteResult } from "../../../publish/content/ui/index.js";
import type { PublishContentConfirmView } from "./publish-confirm-view.js";
import type { usePublishContentConfirm } from "./use-publish-content-confirm.hooks.js";

/**
 * The confirmation banner shown once a publish executes: how many entities changed, plus how many
 * live menu links were repointed to follow them (`plan-publish-repoint-menus-2026-09-24.md` §2.7/R6).
 * `doneMessage` is `null` outside the `done` phase, same as the field this replaces.
 *
 * Counted copy is assembled from `t()`-resolved fragments for the same reason `primaryLabelFor` above
 * is: this app's translator has no interpolation. The menu-links clause is appended only when
 * `menuLinksUpdated` is greater than 0 — a run that repointed nothing says nothing about menus at
 * all, rather than a confusing "Menu links updated: 0." `?? 0` covers a peer built before R5, whose
 * `PublishContentExecuteResult` carries no `menuLinksUpdated` at all.
 *
 * @complexity O(n) in actual report rows, with no additional requests.
 */
export function completionMessagesFor(
  { deps, phase, t }: { deps: Parameters<typeof usePublishContentConfirm>[0]["deps"]; phase: PublishContentPhase; t: Translate },
  _options: Record<string, never> = {}
): Pick<PublishContentConfirmView, "doneMessage" | "doneNotices" | "doneProblems"> {

  if (phase.kind !== "done") return { doneMessage: null, doneNotices: [], doneProblems: [] };
  const base = completionOutcomeMessage({ result: phase.result, t, deps });
  const menuLinksUpdated = phase.result.menuLinksUpdated ?? 0;
  return {
    doneMessage: menuLinksUpdated <= 0 ? base : `${base} ${t("Menu links updated:")} ${menuLinksUpdated}.`,
    // De-duplicated: a grant that doesn't cover menus refuses every menu with the same line.
    doneNotices: [...new Set(phase.result.menuLinksNotUpdated ?? [])],
    doneProblems: [...new Set(phase.result.verificationProblems ?? [])],
  };
}

/** Count actual row outcomes, retaining the count-only reply from older peers.
 * @complexity O(n) actual report rows; no I/O. */
function completionOutcomeMessage({ deps, result, t }: { deps: Parameters<typeof usePublishContentConfirm>[0]["deps"]; result: PublishContentExecuteResult; t: Translate }, _options = {}): string {
  const { toPublishReportRows } = deps;
  const actual = result.report ? summarizePublishReport({ rows: toPublishReportRows({ report: result.report }) }) : null;
  const changeCount = actual?.publishing ?? result.changeSetIds.length;
  const published = publishedCountMessage({ count: changeCount, t });
  const skipped = actual?.skipped ?? 0;
  if (skipped === 0) return published;
  return `${published} ${skipped} ${skipped === 1 ? t("item skipped.") : t("items skipped.")}`;
}

/** Word a completed count, including a run in which every proposed write was refused.
 * @complexity O(1), pure translation. */
function publishedCountMessage({ count, t }: { count: number; t: Translate }, _options = {}): string {
  if (count === 0) return t("Nothing published.");
  return `${t("Published")} ${count} ${count === 1 ? t("change") : t("changes")}.`;
}

