/**
 * @file The neutral public surface of the Publish dialog's semantics (K5): which rows a run writes,
 * what each outcome is called, and when the plan -> confirm -> execute ceremony may advance.
 *
 * Everything here is **pure TypeScript with no runtime dependency** beyond the report contract in
 * `@jini-ai/core` — no React, no `node:*`, no repo, no planner — so a browser bundle can import it. A
 * product's own wording and tables (reason rewrites, section table, entity-type aliases, query limits,
 * capability copy) are INJECTED by the host (see `PublishReportPolicy`, `PublishCriteriaLimits`,
 * `definePublishSection`); this module names none of them.
 */
export type {
  PublishContentConfirmResult,
  PublishContentExecuteResult,
  PublishContentOutcomeKind,
  PublishContentOutcomeRow,
  PublishContentPeerSummary,
  PublishContentNotSupportedByLive,
  PublishContentPlanResult,
  PublishContentReport,
  PublishScope,
} from "./contract.js";

export type {
  PublishNamedFileRewrite,
  PublishReasonPolicy,
  PublishReasonRewrite,
  PublishReportCopy,
  PublishReportPolicy,
  PublishReportRow,
  PublishReportRowCore,
  PublishReportSummary,
  PublishRowDisposition,
} from "./report-rows.js";
export {
  countSelectedPublishing,
  friendlyPublishReason,
  publishRowDisposition,
  rowPublishesWithSelection,
  selectableRowKeys,
  summarizePublishReport,
  toPublishReportRowCores,
  toPublishReportRows,
} from "./report-rows.js";

export type { PublishOrderGroup, PublishOrderKey } from "./publish-order.js";
export { publishOrderComparator, sortPublishReportRows } from "./publish-order.js";

export type { CriteriaSelection, PublishCriteria, PublishCriteriaLimits, PublishRequestResult } from "./criteria.js";
export {
  applyPublishCriteria,
  decodePublishCriteriaFromQuery,
  encodePublishCriteriaToQuery,
  parsePublishContentToolInput,
} from "./criteria.js";

export type { PublishSection } from "./sections.js";
export {
  definePublishSection,
  publishEntityTypeLabel,
  publishEntityTypePluralLabel,
  publishSectionById,
  publishSectionForEntityTypes,
} from "./sections.js";

export type { PublishContentPhase } from "./phase.js";
export { canConfirmPlan, canRequestPlan, confirmationTokenFor, planOnScreen, reportOnScreen } from "./phase.js";

export { overwriteReplanIsConsistent, preparePublishConfirmation, PublishPlanDriftError } from "./replan.js";
