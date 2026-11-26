import type { PublishContentPeerView } from "@jini-ai/core/contracts/site/cms-publish-content";
import type { PublishContentPhase, PublishReportRow, PublishReportSummary } from "../../../publish/content/ui/index.js";

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
