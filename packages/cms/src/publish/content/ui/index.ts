/**
 * @file The neutral public surface of the Publish dialog's semantics (K5): which rows a run writes,
 * what each outcome is called, and when the plan -> confirm -> execute ceremony may advance.
 *
 * Everything here is **pure TypeScript with no runtime dependency** beyond the report contract in
 * `@jini-ai/core` — no React, no `node:*`, no repo, no planner — so a browser bundle can import it. A
 * product's own wording and tables (reason rewrites, section table, entity-type aliases, query limits,
 * capability copy) are INJECTED by the host (see `PublishReportPolicy`, `PublishCriteriaLimits`,
 * `definePublishSection`); this module names none of them.
 *
 * ## What belongs in this folder, and what does not
 *
 * It holds the publish dialog's *semantics*: which rows a run writes, what each outcome is called,
 * and when the ceremony may advance. It is ONE shared module for both the browser dialog and the
 * server-side publish tool because a second copy of those rules could drift from the planner's real
 * behaviour without anything going red.
 *
 * The React component and the hook that calls the API stay with the host's admin app: a component
 * here would drag React into every server-side importer of these rules, and a host bundler that
 * dedupes React across packages must never meet a second React dependency from this folder.
 *
 * The host keeps a boundary test that these files take no value import on server code.
 */
export type {
  PublishContentConfirmResult,
  PublishContentExecuteResult,
  PublishContentOutcomeKind,
  PublishContentOutcomeRow,
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
