/**
 * @file Task 11 — the public surface of the publish dialog's semantics (`@jini-ai/cms/publish/content/dialog`),
 * imported by the host's admin dialog and by the server-side publish chat tool alike. The section
 * table (button labels, type names) is host copy and stays in the host; it reaches this code only as
 * an injected {@link PublishEntityTypeLabeler}.
 *
 * ## What belongs in this folder, and what does not
 *
 * Everything here is **pure TypeScript with no runtime dependency at all** — no React, no `node:*`,
 * no repo, no planner. It holds the publish dialog's *semantics*: which rows a run writes, what
 * each outcome is called, and when the ceremony may advance. It is ONE shared module for both the
 * browser dialog and the server-side publish tool because a second copy of those rules could drift
 * from the planner's real behaviour without anything going red.
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
  PublishContentPeerSummary,
  PublishContentNotSupportedByLive,
  PublishContentPlanResult,
  PublishContentReport,
  PublishScope,
} from "./contract.js";

export type { PublishEntityTypeLabeler, PublishReportRow, PublishReportSummary, PublishRowDisposition } from "./report-rows.js";
export {
  countSelectedPublishing,
  publishRowDisposition,
  rowPublishesWithSelection,
  selectableRowKeys,
  summarizePublishReport,
  toPublishReportRows,
} from "./report-rows.js";

export type { PublishOrderGroup, PublishOrderKey } from "./publish-order.js";
export { publishOrderComparator, sortPublishReportRows } from "./publish-order.js";

export type { CriteriaSelection, PublishCriteria, PublishRequestResult } from "./criteria.js";
export {
  applyPublishCriteria,
  decodePublishCriteriaFromQuery,
  encodePublishCriteriaToQuery,
  parsePublishContentToolInput,
  PUBLISH_CONTENT_CAPABILITY,
  PUBLISH_CRITERIA_QUERY_PARAM,
} from "./criteria.js";

export type { PublishContentPhase } from "./phase.js";
export { canConfirmPlan, canRequestPlan, confirmationTokenFor, planOnScreen, reportOnScreen } from "./phase.js";

export { overwriteReplanIsConsistent, preparePublishConfirmation, PublishPlanDriftError } from "./replan.js";
