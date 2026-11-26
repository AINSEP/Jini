import type { PublishContentPeerView } from "@jini-ai/core/contracts/site/cms-publish-content";
import type { PublishContentPhase, PublishReportRow, PublishReportSummary } from "../../../publish/content/ui/index.js";
import type { Translate } from "@jini-ai/core/text";
import { canRequestPlan, countSelectedPublishing, planOnScreen, reportOnScreen, publishOrderComparator, rowPublishesWithSelection, selectableRowKeys, sortPublishReportRows, summarizePublishReport, type PublishContentNotSupportedByLive, type PublishContentPlanResult, type PublishScope } from "../../../publish/content/ui/index.js";
import type { usePublishContentConfirm } from "./use-publish-content-confirm.hooks.js";
import type { usePublishPeers, usePublishConnect } from "./publish-peers.hooks.js";
import type { usePublishLifecycle, usePublishReport, usePublishSelection } from "./publish-lifecycle.hooks.js";
import type { usePublishConfirmFailure, usePublishPreparedPlan, usePublishConfirmPlan, usePublishPrimary } from "./publish-execution.hooks.js";
import type { usePublishPlanState, usePublishPlan, usePublishOverwrite } from "./publish-plan.hooks.js";
import { canConfirmSelection, isChosenPeerId } from "./publish-plan.hooks.js";
import { completionMessagesFor } from "./publish-execution.hooks.js";

/** The empty state's offer to connect — what replaces the old "configure a peer in Settings" dead
 *  end (`destination.ts`'s header: the connect action lives here, behind Publish, rather than on a
 *  settings screen the owner has to already know to visit). `message` is the server's own sentence
 *  (`AdminPublishDestinationView.message`) verbatim, never rewritten here. */
export interface PublishContentConnectOffer {
  readonly message: string;
  /** `null` on a fresh install with nothing deployed yet — the primary button stays disabled until
   *  there is a candidate to connect to. */
  readonly candidateUrl: string | null;
}

/** Everything `PublishContentDialog.tsx` renders. Nothing here is a raw port or a setter — the
 *  component gets finished strings and booleans, not state to interpret. */
export interface PublishContentConfirmView {
  readonly phase: PublishContentPhase;
  readonly peers: readonly PublishContentPeerView[];
  readonly selectedPeerId: string | null;
  /** Choosing a different site discards any plan on screen — a plan belongs to the site that made
   *  it — and is ignored while {@link peerSelectionEnabled} is `false`. */
  readonly onSelectPeer: (input: { peerId: string }, options?: Record<string, never>) => void;
  /** `false` while a plan is being worked out and from the moment the operator commits: there the
   *  site is part of what is already in flight, and changing it could only misdescribe it. */
  readonly peerSelectionEnabled: boolean;
  /** `false` from confirm until the publish has an outcome on screen. The run cannot be aborted
   *  once confirm is sent, so closing then would cancel nothing and only hide whether it worked. */
  readonly dismissible: boolean;
  /** Closes the dialog — the one handler behind Cancel and the backdrop. A no-op while
   *  {@link dismissible} is `false`; Escape follows the same rule. */
  readonly onDismiss: () => void;
  readonly rows: readonly PublishReportRow[];
  /** {@link rows} minus the up-to-date ones, in the same order — what the table always lists. */
  readonly listedRows: readonly PublishReportRow[];
  /** The up-to-date rows, A–Z (owner 2026-09-26): folded behind one {@link upToDateLabel} row and
   *  listed after it only while {@link upToDateExpanded}. */
  readonly upToDateRows: readonly PublishReportRow[];
  /** "N already up to date", or `null` when no row is — then there is no fold row at all. */
  readonly upToDateLabel: string | null;
  readonly upToDateExpanded: boolean;
  readonly onToggleUpToDate: () => void;
  /** How many columns the table has, for a row that spans all of them. */
  readonly columnCount: number;
  readonly summary: PublishReportSummary | null;
  /** The keys of the rows this run would publish — every {@link PublishReportRow.selectable} row the
   *  operator has not unchecked. Rows that are not selectable are never in here. */
  readonly selectedKeys: ReadonlySet<string>;
  /** Owner decision 2026-09-25 — the carried-along media rows ({@link PublishReportRow.includedFor})
   *  that currently publish, because a page/post that uses them is still ticked. Their checkbox is
   *  shown ticked (and never clickable) exactly when the row is in here. */
  readonly carriedAlongKeys: ReadonlySet<string>;
  readonly onToggleRow: (input: { key: string }, options?: Record<string, never>) => void;
  /** Checks every selectable row, or unchecks every one of them when any is currently checked. */
  readonly onToggleAll: () => void;
  /** `false` once the operator has committed (confirming/executing/done) — the report stays on
   *  screen through those phases, but its checkboxes stop being an offer at that point. */
  readonly selectionEnabled: boolean;
  /** Header-checkbox state. `someSelected` is the indeterminate case and is never true at the same
   *  time as `allSelected`. */
  readonly allSelected: boolean;
  readonly someSelected: boolean;
  /**
   * publish-overwrite-live-plan §4/S9. Whether the plan on screen came from a peer that can honour a
   * forced overwrite at all (`plan.liveCanOverwrite`). `true` while there is no plan on screen —
   * harmless, since {@link PublishReportRow.overwritable} rows don't exist yet either.
   */
  readonly liveCanOverwrite: boolean;
  /** The keys currently ticked "Overwrite on live" — a strict subset of every row's own key, never
   *  read for anything but rendering `checked`. */
  readonly overwriteKeys: ReadonlySet<string>;
  /** The rows that carry an "Overwrite on live" box: every {@link PublishReportRow.overwritable} row,
   *  plus every ticked one — a tick turns its row `forced`, and the box must stay to be unticked. */
  readonly overwriteOfferKeys: ReadonlySet<string>;
  /** Whether the overwrite column renders at all: the peer can honour it and some row offers a box. */
  readonly showOverwriteColumn: boolean;
  /** Ticks or unticks one row's "Overwrite on live" box, then immediately re-plans against it (see
   *  this file's `applyOverwriteKeys`) — the report on screen updates to show the tick actually
   *  taking effect (the row turns `forced`) rather than promising something a later Confirm might
   *  refuse. */
  readonly onToggleOverwrite: (key: string) => void;
  /** Ticks every {@link overwriteOfferKeys} row at once, or clears them all when every one already
   *  is — the overwrite column's own header control, independent of {@link onToggleAll}. */
  readonly onToggleAllOverwrite: () => void;
  readonly allOverwriteTicked: boolean;
  readonly someOverwriteTicked: boolean;
  /** Set while at least one box is ticked — the aggregate "this will replace things on the live site"
   *  notice, shown independent of {@link errorMessage}. `null` otherwise. */
  readonly overwriteWarning: string | null;
  /** Set when a ticking re-plan disagrees with what the operator already reviewed (see
   *  `overwriteReplanIsConsistent`) — the live site moved between the first plan and this tick. The
   *  report on screen already shows the new truth; this is the sentence explaining why it changed.
   *  Cleared the moment the ticked set changes again. */
  readonly overwriteMismatch: string | null;
  /** Set when at least one row could be overwritten in principle (`row.overwritable` on an
   *  untouched, unticked report) but the peer this plan targets cannot honour it
   *  (`!liveCanOverwrite`) — the dialog shows this sentence instead of any checkbox. */
  readonly overwriteUnavailable: string | null;
  /** `plan-publish-sections-2026-09-25.md` §2 S2 — the dialog's own `<h2>`, an English copy key the
   *  screen's `t()` resolves the same way it resolves every other string here. Always
   *  `publishScopeTitleKey(props.scope)`; unlike `primaryLabel`, it never changes once a plan lands. */
  readonly title: string;
  /** Owner decision 2026-09-25 — the description line under the title, an English copy key naming
   *  what this dialog sends: `publishScopeDescriptionKey(props.scope)`. */
  readonly description: string;
  /** Which control the forward button is: `start` connects or plans, `confirm` publishes. They
   *  render as two different buttons, never one relabelled in place — see {@link CONFIRM_ARM_DELAY_MS}. */
  readonly primaryKind: PublishPrimaryKind;
  readonly primaryLabel: string;
  readonly primaryDisabled: boolean;
  /** Ignored for {@link CONFIRM_ARM_DELAY_MS} after the confirm control becomes clickable. */
  readonly onPrimary: () => void;
  /** A failed plan/confirm/execute, or a failed peer read. `null` when nothing has gone wrong. */
  readonly errorMessage: string | null;
  /** Set when the whole run refused (a content-hash version mismatch) — a different thing from an
   *  error, and it gets its own sentence rather than being flattened into one. */
  readonly refusalReason: string | null;
  readonly doneMessage: string | null;
  /** The server's own lines for each live menu the run could not repoint (plan §2.7) — reported,
   *  never silent. Empty outside the `done` phase and for a live built before the repoint pass. */
  readonly doneNotices: readonly string[];
  /** The live site's post-publish safety check: one line per published item that landed but won't
   *  show correctly there (e.g. a video whose type is unknown, a missing poster). Empty outside the
   *  `done` phase and for a live built before the check. */
  readonly doneProblems: readonly string[];
  /** One line per type the live site can't take yet (`plan.notSupportedByLive`) — those rows never
   *  reach the report, so this is the only place they show. Empty when the live took everything. */
  readonly liveGapNotices: readonly string[];
  /** Set once peers have loaded empty and the destination check has resolved. `null` while peers
   *  exist, are still loading, or the destination check hasn't resolved yet — see this file's
   *  connect-offer effect. */
  readonly connectOffer: PublishContentConnectOffer | null;
}

export type PublishPrimaryKind = "start" | "confirm";


const EMPTY_ROWS: readonly PublishReportRow[] = [];
/**
 * How long the confirm control ignores activation after it becomes clickable (owner report
 * 2026-09-26). The button used to turn from a disabled "Planning…" into "Publish N items" in place,
 * so a click aimed at "Planning…" that waited for the button to enable — an automated click does
 * exactly that — published to live. Confirm is now its own control, and a click this soon after it
 * appears can't have been aimed at it. It stays enabled meanwhile: a disabled window would only make
 * a waiting click wait for it.
 */
export const CONFIRM_ARM_DELAY_MS = 400;
/** `start` until a plan is on screen (or the run is done), `confirm` from then on. @complexity O(1). */
export function primaryKindFor({ phase, connectOffer }: { phase: PublishContentPhase; connectOffer: PublishContentConnectOffer | null }, _options: Record<string, never> = {}
): PublishPrimaryKind {
  if (connectOffer || canRequestPlan(phase) || phase.kind === "planning") return "start";
  return "confirm";
}

/**
 * Builds the primary button's label. Counted copy is assembled from `t()`-resolved fragments rather
 * than one interpolated key, because this app's translator is a key lookup with no interpolation
 * (`Jini packages/ui/src/features/i18n/dictionary-translator.ts`) — the alternative is a key per possible count.
 *
 * The connect offer takes priority over every phase check below it: while it is present, the same
 * button IS the connect action (see this file's header note on why one control is reused rather
 * than adding a second button next to a disabled "Publish").
 *
 * @complexity O(1).
 */
function primaryLabelFor(
  { deps, phase, selectedPublishing, connectOffer, connecting, t, scope, onlyLiveGaps }: { deps: Parameters<typeof usePublishContentConfirm>[0]["deps"];
    phase: PublishContentPhase;
    selectedPublishing: number;
    connectOffer: PublishContentConnectOffer | null;
    connecting: boolean;
    t: Translate;
    scope: PublishScope | undefined;
    onlyLiveGaps: boolean;
  },
  _options: Record<string, never> = {},
): string {
  const { publishScopeTitleKey, publishSectionForEntityTypes } = deps;
  if (connectOffer) return connecting ? t("Connecting…") : t("Connect");
  if (phase.kind === "planning") return t("Planning…");
  if (phase.kind === "confirming" || phase.kind === "executing") return t("Publishing…");
  if (phase.kind === "done") return t("Published");
  // plan-publish-sections-2026-09-25.md §2 S2 — before a plan lands, the idle button promises what
  // this dialog is scoped to, same label as its own title (`publishScopeTitleKey`).
  if (phase.kind !== "planned") return t(publishScopeTitleKey({ scope: scope, sectionForEntityTypes: publishSectionForEntityTypes }));
  return plannedPrimaryLabel({ selectedPublishing, onlyLiveGaps, t });
}

function plannedPrimaryLabel(
  { selectedPublishing, onlyLiveGaps, t }: { selectedPublishing: number; onlyLiveGaps: boolean; t: Translate },
  _options: Record<string, never> = {}
): string {
  // The SELECTED count, not the plan's own: the button must promise what this click will actually
  // do. A plan of 59 writable rows with 56 unchecked says "Publish 3 items".
  // An empty report whose types the live site simply can't take yet is not "nothing to publish" —
  // the content is there, the live is behind (see `liveGapLinesFor`).
  if (selectedPublishing === 0) return onlyLiveGaps ? t("Update the live site first") : t("Nothing to publish");
  return `${t("Publish")} ${selectedPublishing} ${selectedPublishing === 1 ? t("item") : t("items")}`;
}

/**
 * One line per type the live site can't take yet, e.g. "Forms (7) can't publish yet: the live site
 * needs an update first." The plural type name comes from `PUBLISH_SECTIONS` (`ui/sections.ts`);
 * the count sits in brackets so the sentence reads the same for 1 and for 7 in every locale (this
 * app's translator has no plurals or interpolation — see `primaryLabelFor`).
 *
 * Lines are A–Z by the translated type name — the shared publish-list order (`publish-order.ts`).
 *
 * @complexity O(n log n) in `entries.length`.
 */
export function liveGapLinesFor({ entries, t, deps }: { deps: Pick<Parameters<typeof usePublishContentConfirm>[0]["deps"], "publishEntityTypePluralLabel">; entries: readonly PublishContentNotSupportedByLive[] | undefined; t: Translate }, { locale }: { locale?: string } = {}
): readonly string[] {
  const { publishEntityTypePluralLabel } = deps;
  return (entries ?? [])
    .filter((entry) => entry.count > 0)
    .map((entry) => ({ label: t(publishEntityTypePluralLabel({ entityType: entry.entityType })), count: entry.count }))
    .sort(publishOrderComparator({ locale, keyOf: (line) => ({ group: "blocked", label: line.label }) }))
    .map((line) => `${line.label} (${line.count}) ${t("can't publish yet: the live site needs an update first.")}`);
}

/**
 * Whether the operator may change which site this dialog publishes to. Only where no request is in
 * flight and nothing is committed: `idle`, a `planned` report still being reviewed, or `failed`.
 * `done` is closed for the same reason `canRequestPlan` excludes it — close and reopen to go again.
 *
 * @complexity O(1).
 */
export function peerSelectionOpen(phase: PublishContentPhase): boolean {
  return phase.kind === "idle" || phase.kind === "planned" || phase.kind === "failed";
}

/** Derive the report and checked selection from the existing publish UI rules. */
export function publishReportSelection(
  { deps, phase, locale, t, deselectedKeys }: { deps: Parameters<typeof usePublishContentConfirm>[0]["deps"]; phase: PublishContentPhase; locale: string; t: Translate; deselectedKeys: ReadonlySet<string> },
  _options: Record<string, never> = {}
) {
  const { toPublishReportRows } = deps;
  // The report stays on screen through confirm and execute — `planOnScreen` owns which phases have
  // one, so this file never has to re-enumerate them (and cannot get `planning`, which has no plan
  // yet, wrong).
  const visiblePlan = planOnScreen(phase);
  const report = reportOnScreen({ phase });
  // Display order only (owner rule 2026-09-26, `publish-order.ts`): to publish, then skipped, then up
  // to date, A–Z in each. Selection and re-plans go by row key, so the order never reaches the plan.
  const rows =
    report === null ? EMPTY_ROWS : sortPublishReportRows({ rows: toPublishReportRows({ report: report }, { completed: phase.kind === "done" }), locale });
  const summary = report === null || phase.kind === "done" ? null : summarizePublishReport({ rows });
  // Owner 2026-09-26 — up-to-date rows fold into one row. They already sort last (`publish-order.ts`),
  // so splitting them off keeps both halves in the shared order.
  const listedRows = rows.filter((row) => row.disposition !== "unchanged");
  const upToDateRows = rows.filter((row) => row.disposition === "unchanged");
  const liveGapNotices = liveGapLinesFor({ entries: visiblePlan?.notSupportedByLive, t: t, deps }, { locale: locale });

  // Derived every render rather than stored: `deselectedKeys` is the only state, so these can never
  // disagree with it or with the rows currently on screen.
  const selectableKeys = selectableRowKeys({ rows });
  const selectedKeys: ReadonlySet<string> = new Set(selectableKeys.filter((key) => !deselectedKeys.has(key)));
  const selectedPublishing = countSelectedPublishing({ rows, selected: selectedKeys });
  const carriedAlongKeys: ReadonlySet<string> = new Set(
    rows
      .filter((row) => row.includedFor.length > 0 && rowPublishesWithSelection({ row, selected: selectedKeys }))
      .map((row) => row.key)
  );
  const allSelected = selectableKeys.length > 0 && selectedKeys.size === selectableKeys.length;
  const someSelected = selectedKeys.size > 0 && !allSelected;

  return {
    visiblePlan,
    rows,
    summary,
    listedRows,
    upToDateRows,
    liveGapNotices,
    selectableKeys,
    selectedKeys,
    selectedPublishing,
    carriedAlongKeys,
    allSelected,
    someSelected,
  };
}

/** Keep overwrite affordances visible after their rows become forced. */
export function publishOverwriteSelection(
  {
    visiblePlan,
    rows,
    overwriteKeys,
  }: {
    visiblePlan: PublishContentPlanResult | null;
    rows: readonly PublishReportRow[];
    overwriteKeys: ReadonlySet<string>;
  },
  _options: Record<string, never> = {}
) {
  // publish-overwrite-live-plan §4/S9. `true` with no plan on screen is harmless: `overwritableRows`
  // is empty then too, so nothing reads this as "go ahead and offer a box".
  const liveCanOverwrite = visiblePlan?.liveCanOverwrite ?? true;
  const overwritableRows = rows.filter((row) => row.overwritable);
  // A ticked row keeps its box: once its re-plan lands it is `forced`, no longer `overwritable`, and
  // dropping the box then would leave a tick the operator can neither see nor undo — and, for the
  // only such row, take the whole column (and its header box) with it.
  const overwriteOfferKeys: ReadonlySet<string> = new Set(
    rows.filter((row) => row.overwritable || overwriteKeys.has(row.key)).map((row) => row.key)
  );
  const showOverwriteColumn = visiblePlan !== null && liveCanOverwrite && overwriteOfferKeys.size > 0;
  const allOverwriteTicked =
    overwriteOfferKeys.size > 0 && [...overwriteOfferKeys].every((key) => overwriteKeys.has(key));
  const someOverwriteTicked = overwriteKeys.size > 0 && !allOverwriteTicked;

  return {
    liveCanOverwrite,
    overwritableRows,
    overwriteOfferKeys,
    showOverwriteColumn,
    allOverwriteTicked,
    someOverwriteTicked,
  };
}

export function publishOverwriteNotices(
  { deps,
    liveCanOverwrite,
    overwriteKeys,
    overwritableRows,
    currentPeerLabel,
    t,
  }: { deps: Parameters<typeof usePublishContentConfirm>[0]["deps"];
    liveCanOverwrite: boolean;
    overwriteKeys: ReadonlySet<string>;
    overwritableRows: readonly PublishReportRow[];
    currentPeerLabel: string;
    t: Translate;
  },
  _options: Record<string, never> = {}
) {

  const overwriteWarning =
    liveCanOverwrite && overwriteKeys.size > 0
      ? t("Ticked items will replace what's on the live site, and stay recoverable in its Trash or history.")
      : null;

  // Shown only when the peer itself can't honour the overwrite AND there is something it would
  // otherwise have offered — an older live with a plain unchanged/created/applied report says nothing
  // extra here.
  const overwriteUnavailable =
    !liveCanOverwrite && overwritableRows.length > 0
      ? `${currentPeerLabel} ${t(deps.overwriteUnavailableKey)}`
      : null;

  return { overwriteWarning, overwriteUnavailable };
}

export function publishPhaseMessages(
  { deps,
    phase,
    peersError,
    destinationError,
    t,
  }: { deps: Parameters<typeof usePublishContentConfirm>[0]["deps"]; phase: PublishContentPhase; peersError: string | null; destinationError: string | null; t: Translate },
  _options: Record<string, never> = {}
) {

  return {
    errorMessage: peersError ?? destinationError ?? (phase.kind === "failed" ? phase.message : null),
    refusalReason: phase.kind === "planned" && phase.plan.details.refused ? phase.plan.details.refusalReason : null,
    ...completionMessagesFor({ phase, t, deps }),
  };
}

export function publishPrimaryDisabled(
  {
    phase,
    selectedPeerId,
    connectOffer,
    connecting,
    selectedPublishing,
    overwriteReplanPending,
  }: {
    phase: PublishContentPhase;
    selectedPeerId: string | null;
    connectOffer: PublishContentConnectOffer | null;
    connecting: boolean;
    selectedPublishing: number;
    overwriteReplanPending: boolean;
  },
  _options: Record<string, never> = {}
): boolean {
  const canStart = canRequestPlan(phase) && isChosenPeerId(selectedPeerId);
  return connectOffer
    ? connecting || connectOffer.candidateUrl === null
    : // `selectedPublishing` is ANDed with the plan-level rule, never a replacement for it: a plan
      // that may not be confirmed at all stays disabled whatever is checked, and a confirmable
      // plan with everything unchecked is disabled too — the button never promises a run that
      // would write nothing.
      !(canStart || canConfirmSelection({ phase, selectedPublishing, overwriteReplanPending }));
}

/** The sentence shown when live answered differently from the report on screen. Names the site
 *  from the loaded list, or a generic "the live site" when that list does not name `peerId`
 *  (`onSelectPeer` accepts any id). @complexity O(peers). */
export function publishMismatchMessage(
  { peers, peerId, t }: { peers: readonly PublishContentPeerView[]; peerId: string; t: Translate },
  _options: Record<string, never> = {}
): string {
  const peerLabel = peers.find((peer) => peer.id === peerId)?.label ?? t("the live site");
  return `${peerLabel} ${t("changed while you were deciding. Check the list again.")}`;
}

export function publishConfirmView(required: ReturnType<typeof usePublishLifecycle> & ReturnType<typeof usePublishPeers> & ReturnType<typeof usePublishPlanState> & ReturnType<typeof usePublishPlan> & ReturnType<typeof usePublishOverwrite> & ReturnType<typeof usePublishConnect> & ReturnType<typeof usePublishConfirmFailure> & ReturnType<typeof usePublishPreparedPlan> & ReturnType<typeof usePublishConfirmPlan> & ReturnType<typeof usePublishReport> & ReturnType<typeof usePublishSelection> & ReturnType<typeof usePublishPrimary>, _optional = {}): PublishContentConfirmView {
  const { phase, rows, props, t, selectedPublishing, connectOffer, connecting, liveGapNotices, primaryKind, primaryDisabled, onPrimary, peersError, destinationError, deps } = required;
  const { publishScopeTitleKey, publishScopeDescriptionKey, publishSectionForEntityTypes } = deps;
  return {
    ...publishReportView(required),
    title: publishScopeTitleKey({ scope: props.scope, sectionForEntityTypes: publishSectionForEntityTypes }),
    description: publishScopeDescriptionKey({ scope: props.scope, sectionForEntityTypes: publishSectionForEntityTypes }),
    primaryLabel: primaryLabelFor(
      { phase: phase,
      selectedPublishing: selectedPublishing,
      connectOffer: connectOffer,
      connecting: connecting,
      t: t,
      scope: props.scope,
      onlyLiveGaps: rows.length === 0 && liveGapNotices.length > 0, deps }
    ),
    primaryKind,
    primaryDisabled,
    onPrimary,
    ...publishPhaseMessages({ phase, peersError, destinationError, t, deps }),
    liveGapNotices,
    connectOffer,
  };
}
function publishReportView(required: ReturnType<typeof usePublishLifecycle> & ReturnType<typeof usePublishPeers> & ReturnType<typeof usePublishPlanState> & ReturnType<typeof usePublishPlan> & ReturnType<typeof usePublishOverwrite> & ReturnType<typeof usePublishConnect> & ReturnType<typeof usePublishConfirmFailure> & ReturnType<typeof usePublishPreparedPlan> & ReturnType<typeof usePublishConfirmPlan> & ReturnType<typeof usePublishReport> & ReturnType<typeof usePublishSelection> & ReturnType<typeof usePublishPrimary>, _optional = {}) {
  const { phase, peers, selectedPeerId, onSelectPeer, peerSelectionEnabled, dismissible, onDismiss, rows, listedRows, upToDateRows, upToDateExpanded, onToggleUpToDate, showOverwriteColumn, summary, selectedKeys, carriedAlongKeys, onToggleRow, onToggleAll, selectionEnabled, allSelected, someSelected, liveCanOverwrite, overwriteKeys, overwriteOfferKeys, onToggleOverwrite, onToggleAllOverwrite, allOverwriteTicked, someOverwriteTicked, overwriteWarning, overwriteMismatch, overwriteUnavailable, t } = required;

  return {
    phase,
    peers,
    selectedPeerId,
    onSelectPeer,
    peerSelectionEnabled,
    dismissible,
    onDismiss,
    rows,
    listedRows,
    upToDateRows,
    upToDateLabel: upToDateRows.length > 0 ? `${upToDateRows.length} ${t("already up to date")}` : null,
    upToDateExpanded,
    onToggleUpToDate,
    // Select, Type, Item, What happens — plus Overwrite on live while it shows.
    columnCount: showOverwriteColumn ? 5 : 4,
    summary,
    selectedKeys,
    carriedAlongKeys,
    onToggleRow,
    onToggleAll,
    selectionEnabled,
    allSelected,
    someSelected,
    liveCanOverwrite,
    overwriteKeys,
    overwriteOfferKeys,
    showOverwriteColumn,
    onToggleOverwrite,
    onToggleAllOverwrite,
    allOverwriteTicked,
    someOverwriteTicked,
    overwriteWarning,
    overwriteMismatch,
    overwriteUnavailable,
  };
}






