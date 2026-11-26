import type { ComponentType, ReactNode } from "react";
import type { PublishCriteria, PublishRequestResult, PublishScope } from "../../publish/content/ui/index.js";
import type { PublishContentPort } from "./hooks/publish-content-port.hooks.js";
import type { PublishContentConfirmView } from "./hooks/publish-confirm-view.js";
import type { Translate } from "@jini-ai/core/text";
import { renderPublishPeerPicker, renderPublishContentActions } from "./PublishContentActions.js";
import { PublishContentNotices, PublishContentReport } from "./PublishContentReport.js";

/**
 * @file The publish-content slice's dialog, opened from the Dashboard's header button, and the whole
 * plan -> report -> confirm -> execute ceremony behind it
 * (`ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4 task 11).
 *
 * Its job is educational, not just a yes/no gate: the owner's stated worry is operators deploying
 * the site, seeing no change, and not understanding that a deploy ships CODE while this dialog's
 * action ships CONTENT — two different things this app has never distinguished for anyone before.
 * The body copy says that explicitly rather than assuming it's obvious.
 *
 * ## The report table is the safety feature, not a progress indicator
 *
 * A publish never overwrites something edited on the far side; it reports it and moves on
 * (`features/publish-content/planner.ts`'s seven outcomes). That promise is only worth anything if
 * the operator can SEE which entities were skipped and why before committing — so the plan step runs
 * first, renders one row per entity with its reason, and only then offers a button that writes. A
 * skipped row carries no control that could publish it — not even a disabled checkbox: exclusion is
 * by construction, not by an unchecked box.
 *
 * Rows the run WOULD write are checked by default and can be unchecked (owner-directed, 2026-09-19).
 * That stays consistent with the paragraph above rather than contradicting it: unchecking is how an
 * operator publishes LESS, never more, and it is honoured by re-planning against a bundle narrowed to
 * the checked rows (see `hooks/use-publish-content-confirm.hooks.ts`'s `confirmPlan`), so a
 * deselected entity never reaches the live site at all. `@tovu/publish-content-ui`'s `report-rows.ts`
 * owns which rows may carry a checkbox; this file only renders the answer.
 *
 * Every decision this file renders comes from `hooks/use-publish-content-confirm.hooks.ts`, and
 * every rule the hook applies comes from `@tovu/publish-content-ui` — the same module the server's
 * own planner semantics are pinned against. This component contains no publish logic at all.
 *
 * Domain markup and actions retain the `settings-dialog`/`btn-secondary`/`btn-primary` styling.
 * Jini owns native cancellation and initial Cancel focus; the original action hierarchy followed
 * `features/plugins/AgentPluginDisableConfirmDialog.tsx` as the then-current precedent. Confirm is `.btn-primary` here, not `.btn-danger`: publishing isn't
 * destructive the way removing a plugin or an OAuth connection is, it's the app's one deliberate
 * primary action, so it gets the same burnt-orange fill `.btn-primary` already renders everywhere
 * else. Cancel stays the default-focused control anyway: publishing touches the live site and can
 * skip content without the operator noticing, so the interrupting action is still never the one
 * Enter fires by accident, matching every other confirm dialog's own reasoning even though this one
 * isn't destructive.
 *
 * ## "Overwrite on live" (publish-overwrite-live-plan-2026-09-24.md §4/S9)
 *
 * A skipped row whose planner said it COULD be resolved by overwriting live (`row.overwritable`,
 * `@tovu/publish-content-ui`'s `report-rows.ts`) gets its own checkbox in a column this file adds
 * only while there is at least one such row AND the peer this plan targets can actually honour it
 * (`view.liveCanOverwrite`). Ticking one is not itself what overwrites anything — it re-plans through
 * `hooks/use-publish-content-confirm.hooks.ts`'s `onToggleOverwrite`, and the row only leaves
 * `skipped` once that re-plan comes back `forced`. An older live gets one sentence under the table
 * instead of any checkbox at all (`view.overwriteUnavailable`); a live that moved between the first
 * plan and a later tick gets `view.overwriteMismatch` alongside the freshly re-planned rows, never a
 * silently stale table.
 *
 * ## The empty state is the connect action, not a dead end
 *
 * When `view.connectOffer` is set (no peer configured yet), the SAME primary button below becomes
 * the connect action rather than a second button appearing next to a disabled "Publish" — one
 * visible control, whatever the dialog's current job is. `view.connectOffer.message` is the
 * server's own sentence (`routes/publish-content/destination.ts`), rendered verbatim: it already
 * names the pre-filled candidate site, so this file adds no copy of its own about what connecting
 * means. See that route's header for why this dialog is where the action lives at all.
 */

export interface PublishContentDialogProps {
  onCancel: () => void;
  /** The screen's own bound translator, threaded down rather than resolved again here — same
   *  convention `AgentPluginDisableConfirmDialog` uses for its own `t`. */
  t: Translate;
  /** Dependency injection seam for tests — see `hooks/publish-content-port.hooks.ts`. */
  port?: PublishContentPort | undefined;
  /** `publish-criteria-tool-webmcp-plan-2026-09-24.md` §4 S2 — threaded straight through to
   *  `usePublishContentConfirm`; see that hook's own `props.criteria` doc for what it does. */
  criteria?: PublishCriteria | undefined;
  /** `plan-publish-sections-2026-09-25.md` §2 S2 — threaded straight through to
   *  `usePublishContentConfirm`; see that hook's own `props.scope` doc for what it does. */
  scope?: PublishScope | undefined;
  /** Threaded straight through to `usePublishContentConfirm`; see that hook's own `props.onPlanned`
   *  doc for when it fires. */
  onPlanned?: ((result: PublishRequestResult) => void) | undefined;
  /** Threaded straight through to `usePublishContentConfirm` — tests pass 0 to skip the arming delay. */
  confirmArmDelayMs?: number | undefined;
  hooks: {
    usePublishContentConfirmHook: (required: Pick<PublishContentDialogProps, "onCancel" | "t" | "port" | "criteria" | "scope" | "onPlanned" | "confirmArmDelayMs">, optional?: Record<string, never>) => PublishContentConfirmView;
  };
  kit: {
    Dialog: ComponentType<{ open: boolean; title: string; onClose: () => void; pending: boolean; className: string; children: ReactNode }>;
  };
  deps: { formRecipientNotice: string };
}

export function PublishContentDialog({
  onCancel,
  t,
  port,
  criteria,
  scope,
  onPlanned, confirmArmDelayMs,
  hooks: { usePublishContentConfirmHook }, kit: { Dialog }, deps,
}: PublishContentDialogProps, _optional = {}) {
  const view = usePublishContentConfirmHook({ onCancel, t, port, criteria, scope, onPlanned, confirmArmDelayMs });
  return (
    <Dialog
      open
      title={t(view.title)}
      onClose={() => view.onDismiss()}
      pending={!view.dismissible}
      className={`settings-dialog jini-domain-dialog${view.rows.length > 0 ? " publish-content-dialog" : ""}`}
    >
      <p>{t(view.description)}</p>
      <p>{t("Anything edited on the live site is skipped unless you tick Overwrite on live.")}</p>
      {view.rows.some(row => row.entityType === "form") && <p>{t(deps.formRecipientNotice)}</p>}

      {renderPublishPeerPicker({ view, t })}
      {view.peers.length === 1 && (
        <p className="muted publish-content-target">
          {t("Publishing to")} <strong>{view.peers[0].label}</strong>
        </p>
      )}

      <PublishContentNotices view={view} t={t} />

      <PublishContentReport view={view} t={t} />

      {renderPublishContentActions({ view, t })}
    </Dialog>
  );
}

export function bindPublishContentDialog({ kit, hooks, deps }: Pick<PublishContentDialogProps, "kit" | "hooks" | "deps">, _optional = {}) {
  return function BoundPublishContentDialog({ usePublishContentConfirmHook = hooks.usePublishContentConfirmHook, ...props }: Omit<PublishContentDialogProps, "kit" | "hooks" | "deps"> & {
    usePublishContentConfirmHook?: PublishContentDialogProps["hooks"]["usePublishContentConfirmHook"];
  }, _optional = {}) {
    return <PublishContentDialog {...props} kit={kit} deps={deps} hooks={{ usePublishContentConfirmHook }} />;
  };
}
