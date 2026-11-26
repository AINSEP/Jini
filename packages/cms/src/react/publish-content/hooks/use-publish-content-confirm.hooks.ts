import type { Translate } from "@jini-ai/core/text";
import { type CriteriaSelection, type PublishContentPlanResult, type PublishContentReport, type PublishCriteria, type PublishReportRow, type PublishRequestResult, type PublishScope } from "../../../publish/content/ui/index.js";
import type { PublishContentPort } from "./publish-content-port.hooks.js";
import type { PublishContentConfirmView, PublishContentConnectOffer, PublishPrimaryKind } from "./publish-confirm-view.js";
import { usePublishPeers, usePublishConnect } from "./publish-peers.hooks.js";
import { usePublishLifecycle, usePublishReport, usePublishCriteria, usePublishSelection } from "./publish-lifecycle.hooks.js";
import { usePublishConfirmFailure, usePublishPreparedPlan, usePublishConfirmPlan, usePublishExecution, usePublishPrimary } from "./publish-execution.hooks.js";
import { usePublishPlanState, usePublishPlan, usePublishOverwrite } from "./publish-plan.hooks.js";
import { publishConfirmView } from "./publish-confirm-view.js";
export type { PublishContentConfirmView, PublishContentConnectOffer, PublishPrimaryKind } from "./publish-confirm-view.js";
export { CONFIRM_ARM_DELAY_MS, liveGapLinesFor, publishMismatchMessage } from "./publish-confirm-view.js";
/**
 * Operator-facing copy for a failed call, via the shared `describeApiError` base case rather than a
 * local `error.message` read (the 2026-08-01 adversarial-UX audit's cross-cutting finding #2: every
 * screen that rebuilt this chain itself, and every screen whose author forgot, showed a raw
 * developer string or a blank).
 *
 * The verbatim pass-through matters here specifically. A peer whose host resolves to a private
 * address answers 502 `EGRESS_REFUSED` with a message naming `devHostAllowlist` and the env var to
 * set — that sentence is the operator's only instruction for fixing it, so it must reach the screen
 * unrewritten. `request()` throws it as an `ApiError` whose `message` IS `body.error`, and
 * `describeApiError` returns that untouched; the fallback only covers an empty message or a thrown
 * non-Error.
 *
 */
/**
 * @file The colocated `PublishContentDialog` behaviour — Escape-to-cancel, plus plan -> confirm ->
 * execute ceremony (`ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4
 * task 11). The component renders what this returns and decides nothing itself, per the standing
 * rule that component logic belongs in a hook.
 *
 * ## What is NOT here
 *
 * The ceremony's *rules* — which rows a run writes, what each outcome is called, and when a plan may
 * be confirmed or executed — live in `host publish policy` (`apps/website/src/features/
 * publish-content/ui/`), next to the planner whose behaviour they restate. This file is the React
 * shell around them: state, effects, and the three port calls. A rule that could drift from
 * `planner.ts` does not belong in this package.
 *
 * ## Why execute is fired from an effect rather than inline after confirm
 *
 * Plan §4 task 11's acceptance criterion is that the dialog *cannot* fire execute without a
 * confirmed plan. Executing inline at the end of `confirmAndPublish` would make that a property of
 * one function's control flow — true today, and one early-return away from not being true. Instead
 * the token only exists inside a `confirmed` phase, {@link confirmationTokenFor} is the only reader,
 * and the execute effect keys off that reader's result. There is no code path in this file that can
 * call `port.executePublish` with anything else.
 *
 * The server enforces the same property independently — `gateway.execute()` re-runs `computePlan()`
 * and hash-compares it against the confirmed token before any write (`features/publish-content/
 * gated-hooks.ts`). This half exists so the operator never sees a button that would 409.
 */

/**
 * @param props.onCancel Called when the dialog should close (Escape, Cancel, the backdrop) — never
 *   while a committed publish has no outcome yet; see `publishInFlight`.
 * @param props.t The screen's own bound translator, threaded down rather than resolved again here.
 * @param props.port Dependency injection seam for tests — see `publish-content-port.hooks.ts`.
 * @param props.criteria `publish-criteria-tool-webmcp-plan-2026-09-24.md` §4 S2 — a caller with no
 *   button of its own (chat, WebMCP, or the admin's own `?publish=` deep link) names what it asked
 *   for here. Applied exactly once, against the first plan that lands: it becomes the dialog's
 *   STARTING `deselectedKeys`/overwrite ticks, never a second selection mechanism of its own — see
 *   this file's "S2 — applying criteria" block below, and plan §2's own header for why this can never
 *   itself write anything (planning is read-only; only a person's own click reaches confirm/execute).
 * @param props.scope `plan-publish-sections-2026-09-25.md` §2 S2 — what this dialog is about (a
 *   section button's "Publish pages", say), sent unchanged on every `port.planPublish` call via this
 *   hook's own `planInScope` helper. `undefined` for the Dashboard's own "Publish all content" and
 *   for every criteria-only (chat/WebMCP) open — see `ui/contract.ts`'s `PublishScope` header for why
 *   this is kept separate from `props.criteria`.
 * @param props.onPlanned Fires once, with what the (possibly criteria-narrowed) plan actually shows —
 *   after any overwrite re-plan the criteria triggered has settled, never before. `undefined` for the
 *   Dashboard's own ordinary open (plan §0's caller 1), which has no one waiting on an answer.
 * @param props.confirmArmDelayMs Defaults to {@link CONFIRM_ARM_DELAY_MS}; tests pass 0.
 * @complexity Time: O(n) per re-render in the plan's row count (row shaping + the summary counts);
 * space: O(n) for the shaped rows. Native dialog dismissal is owned by Jini.
 */
export function usePublishContentConfirm(props: {
  onCancel: () => void;
  t: Translate;
  port: PublishContentPort;
  criteria?: PublishCriteria | undefined;
  scope?: PublishScope | undefined;
  onPlanned?: ((result: PublishRequestResult) => void) | undefined;
  confirmArmDelayMs?: number | undefined;
  hooks: { useLocaleHook: () => string };
  deps: {
    describeApiError: (required: { e: unknown; fallback: string }) => string;
    now: () => number;
    toPublishReportRows: (required: { report: PublishContentReport }, optional?: { completed?: boolean }) => readonly PublishReportRow[];
    applyPublishCriteria: (required: { rows: readonly PublishReportRow[]; criteria: PublishCriteria }) => CriteriaSelection;
    preparePublishConfirmation: (required: { plan: PublishContentPlanResult; deselectedKeys: ReadonlySet<string>;
      planPublish: (input: { selectedEntityKeys: readonly string[]; overwriteEntityKeys?: readonly string[] }) => Promise<PublishContentPlanResult> }) => Promise<PublishContentPlanResult>;
    publishEntityTypePluralLabel: (required: { entityType: string }) => string;
    publishSectionForEntityTypes: (required: { entityTypes: readonly string[] }) => { labelKey: string; descriptionKey: string } | undefined;
    publishScopeTitleKey: (required: { scope: PublishScope | undefined; sectionForEntityTypes: Parameters<typeof usePublishContentConfirm>[0]["deps"]["publishSectionForEntityTypes"] }) => string;
    publishScopeDescriptionKey: (required: { scope: PublishScope | undefined; sectionForEntityTypes: Parameters<typeof usePublishContentConfirm>[0]["deps"]["publishSectionForEntityTypes"] }) => string;
    overwriteUnavailableKey: string;
  };
}, _optional = {}): PublishContentConfirmView {
  const lifecycle = usePublishLifecycle(props);
  const peers = usePublishPeers(lifecycle);
  const state = usePublishPlanState(lifecycle);
  const base = { ...lifecycle, ...peers, ...state };
  const plan = usePublishPlan(base);
  const overwrite = usePublishOverwrite(base);
  const connect = usePublishConnect({ ...base, ...plan });
  const failure = usePublishConfirmFailure(base);
  const prepared = usePublishPreparedPlan(base);
  const confirm = usePublishConfirmPlan({ ...base, ...failure, ...prepared });
  usePublishExecution(base);
  const report = usePublishReport({ ...base, ...overwrite });
  usePublishCriteria({ ...base, ...plan, ...overwrite, ...report });
  const selection = usePublishSelection({ ...base, ...report });
  const primary = usePublishPrimary({ ...base, ...connect, ...confirm, ...plan, ...report });
  return publishConfirmView({ ...base, ...overwrite, ...report, ...selection, ...primary, ...connect, ...confirm, ...plan, ...failure, ...prepared });
}

export function bindPublishContentConfirm({ port, hooks, deps }: Pick<Parameters<typeof usePublishContentConfirm>[0], "port" | "hooks" | "deps">, _optional = {}) {
  return function useBoundPublishContentConfirm(props: Omit<Parameters<typeof usePublishContentConfirm>[0], "port" | "hooks" | "deps"> & { port?: PublishContentPort | undefined }, _optional = {}): PublishContentConfirmView {
    return usePublishContentConfirm({ ...props, port: props.port ?? port, hooks, deps });
  };
}
