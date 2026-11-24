import type {
  PublishContentOutcomeKindDto,
  PublishContentReferenceHolderDto,
  PublishContentReportDto,
  PublishContentRetireTargetDto,
} from "@jini-ai/core/contracts/site/cms-publish-content";
import { orFallback } from "@jini-ai/core/errors/idioms";

import type { BackstopAuditPort } from "../../publish/transfer/index.js";

/**
 * @file Response DTO helpers for the admin `publish-content` HTTP surface: the one whitelist
 * mapper from the planner's report to the client-safe wire DTO, and the advisory apply-report read
 * the manual import `execute` reply spreads in.
 *
 * HTTP-facing serialization only. The planner's own report type stays with the host that owns the
 * planner; these helpers read it through {@link PublishContentReportSource}, the fields the mapper
 * whitelists, so a host's richer domain row is accepted without this package naming it.
 */

/** One planner row as the mapper reads it: exactly the fields it whitelists onto the wire. */
export interface PublishContentReportSourceRow {
  readonly entityType: string;
  readonly entityId: string;
  readonly entityLabel: string | null;
  readonly outcome: PublishContentOutcomeKindDto;
  readonly writes: boolean;
  readonly reason: string | null;
  readonly canOverwrite: boolean;
  readonly retires: PublishContentRetireTargetDto | null;
  readonly referencedBy?: readonly PublishContentReferenceHolderDto[];
}

/** The planner's report as the mapper reads it (a host's domain report is a structural superset). */
export interface PublishContentReportSource {
  readonly refused: boolean;
  readonly refusalReason: string | null;
  readonly applyOrder: readonly string[];
  readonly rows: readonly PublishContentReportSourceRow[];
}

/** Maps the planner's domain result to the one client-safe wire DTO at the HTTP boundary.
 *  @complexity O(rows + holders). */
export function toPublishContentReportDto(
  { report }: { report: PublishContentReportSource }, _optional: Record<string, never> = {},
): PublishContentReportDto {
  return {
    refused: report.refused,
    refusalReason: report.refusalReason,
    applyOrder: [...report.applyOrder],
    rows: report.rows.map((row) => ({
      entityType: row.entityType,
      entityId: row.entityId,
      // Field-by-field on purpose (this mapper is a whitelist, not a spread), so a new planner field
      // is only ever serialized deliberately — which also means a new one is invisible to every
      // client until it is added HERE. `entityLabel` is what the report table names its rows by.
      entityLabel: row.entityLabel,
      outcome: row.outcome,
      writes: row.writes,
      reason: row.reason,
      // publish-overwrite-live-plan §4/S6 — whitelisted the same field-by-field way as every other
      // row field above (this mapper's own doc), so the admin dialog and the chat surface can offer
      // the "overwrite on live" tick without either reaching into the planner's own row shape.
      canOverwrite: row.canOverwrite,
      retires: row.retires,
      // R6 (`plan-publish-repoint-menus-2026-09-24.md` §2.2) — `referencedBy` is OPTIONAL/absent on
      // the planner's own row (never an explicit `undefined`), so this must add the key conditionally
      // rather than copy it straight across: an unconditional `referencedBy: row.referencedBy` would
      // put an explicit `referencedBy: undefined` on every row that never had one, which is a
      // different wire shape (and fails a strict deep-equal against a pre-R6 fixture that never
      // mentions the key at all).
      ...(row.referencedBy !== undefined
        ? {
            referencedBy: row.referencedBy.map((holder) => ({
              entityType: holder.entityType,
              entityId: holder.entityId,
              entityLabel: holder.entityLabel,
              referencedId: holder.referencedId,
            })),
          }
        : {}),
    })),
  };
}

/**
 * Reads the apply-time report a backstop run recorded, so the manual result names apply-time
 * skips rather than repeating the dry-run prediction. It is the extra `report` field the manual
 * import `execute` reply carries for a backstop run, read from the destination's backstop audit.
 *
 * Reading the audit after a successful mutation is advisory: a read failure must never turn an
 * already applied send into an apparent failure and invite a duplicate retry, so any audit error
 * (and a missing, not-ready or non-destination record) yields `{}`.
 *
 * @returns `{ report }` to spread into the execute reply, or `{}` when there is nothing to add.
 * @complexity O(rows) for the DTO mapping; one `ready()` and at most one `get()`.
 */
export async function readBackstopApplyReport(required: {
  audit: BackstopAuditPort | undefined;
  workspaceId: string;
  runId: string;
}, _optional: Record<string, never> = {}): Promise<{ report?: PublishContentReportDto }> {
  const { audit, workspaceId, runId } = required;
  // The normal run and its persisted audit remain authoritative.
  return orFallback({ work: async () => {
    if (!audit || !(await audit.ready())) return {};
    const log = await audit.get({ workspaceId, id: runId });
    if (log?.direction !== "destination" || !log.details.report) return {};
    return { report: toPublishContentReportDto({ report: log.details.report as PublishContentReportSource }) };
  }, fallback: {}, step: "Read advisory publish apply report" });
}
