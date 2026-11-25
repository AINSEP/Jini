import type { ComponentProps, ComponentType, ReactNode } from "react";
import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import type { AdminRecoveryStatusEnvelope as AdminRecoveryStatus } from "@jini-ai/core/contracts/site/cms-recovery";
import { formatTimestamp, type Translate } from "@jini-ai/core/text";
import { RestoreFlowBody } from "./Recovery.restore-steps.js";

type Empty = Record<string, never>;

interface AdminRestorePoint {
  readonly id: string;
  /** What caused this point to be captured (e.g. `"manual"`, `"pre-migration"`) — host-defined. */
  readonly trigger: string;
  readonly costClass: string;
  readonly kind: string;
  /** Null when the host has no watermark concept or none was available at capture time. */
  readonly watermarkAtCapture: number | null;
  readonly createdAt: string;
}

interface AdminDisclosureResult {
  readonly partial: true;
  /** `false` means the disclosure could not establish a watermark baseline to diff against — the
   *  `counts` below may be less trustworthy than usual, and a panel should say so rather than
   *  present them with the same confidence as a normal disclosure. */
  readonly watermarkBaselineAvailable: boolean;
  readonly counts: Readonly<Record<string, number | "unknown">>;
}

interface RecoveryController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  status: AdminRecoveryStatus | null;
  points: AdminRestorePoint[] | null;
  error: string | null;
  /** `creating` reflects the in-flight no-argument restore-point creation request. */
  creating: boolean;
  createRestorePoint: () => Promise<void>;
  /** The restore point a "Restore…" row action selected, or the one a resolved deep link matched —
   *  `null` shows the plain list, non-null swaps in `RestoreFlow` (design-spec.md §0.1: a full
   *  inline swap, never a modal-over-list). */
  selected: AdminRestorePoint | null;
  setSelected: (point: AdminRestorePoint | null) => void;
  /** Bound translator — `key` already resolved against the caller's locale, so `Recovery.tsx` never
   *  imports `useAdminLocale`/`recovery-i18n` for the top-level screen. See this file's header. */
  t: Translate;
  /** Raw resolved locale — `Recovery.tsx`'s local `DegradedBannerView`/`RestorePointsList`
   *  subcomponents take `locale` directly rather than a bound translator. See this file's header. */
  locale: string;
}

interface RestoreFlowController {
  disclosure: AdminDisclosureResult | null;
  error: string | null;
  acknowledged: boolean;
  setAcknowledged: (checked: boolean) => void;
  step: CeremonyStep;
  busy: boolean;
  ceremonyError: string | null;
  plan: { planId: string; planHash: string } | null;
  confirmationToken: string | null;
  result: { restoreRunId: string; state: string; restartRequired?: boolean | undefined } | null;
  startPlan: () => Promise<void>;
  doConfirm: () => Promise<void>;
  doExecute: () => Promise<void>;
  /** Bound translator — `key` already resolved against the caller's locale, so `RestoreFlow` never
   *  imports `useAdminLocale`/`recovery-i18n` itself. See this file's header. */
  t: Translate;
  /** Raw resolved locale — `RestoreFlow`'s own local step subcomponents and several
   *  `recovery-i18n.tsx` helpers take `locale` directly rather than a bound translator. See this
   *  file's header. */
  locale: string;
}

type CeremonyStep = "idle" | "planned" | "confirmed" | "done";

export interface RecoveryProps {
  /** The `?tab=` query value from `panels.tsx`'s `recovery` route (`URLSearchParams.get` returns
   *  `null` when the param is absent). Validated by `useRecoveryNavigation`. */
  tabId?: string | null;
  /**
   * Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   * for `useCustomSelect`. The host supplies its wired hook. See `PostsProps.usePostsHook` for the full rationale.
   */
  useRecoveryHook: () => RecoveryController;
  useRestoreFlowHook: (required: { point: AdminRestorePoint }, options?: Empty) => RestoreFlowController;
  useRecoveryNavigationHook: (required: {
    tabId?: string | null | undefined;
    setSelected: (point: AdminRestorePoint | null) => void;
    port: RecoveryProps["navigationPort"];
  }, options?: Empty) => {
    activeTabId: string;
    onTabChange: (nextTabId: string) => void;
    onSelectPoint: (point: AdminRestorePoint) => void;
    onBackFromFlow: () => void;
  };
  navigationPort: { navigate: (required: { routePath: string }, options: { replace?: boolean }) => void };
  kit: {
    DataTable: ComponentType<{
      rows: readonly AdminRestorePoint[];
      rowKey: (row: AdminRestorePoint, index: number) => string;
      empty: ReactNode;
      columns: readonly { key: string; header?: ReactNode; headerLabel?: string; cell: (row: AdminRestorePoint, index: number) => ReactNode }[];
    }>;
    I18nProvider: ComponentType<{
      initialLocale: string; dictionaries: RecoveryProps["dictionaries"]; fallbackLocale: "en";
      syncDocumentAttributes: false; children: ReactNode;
    }>;
    SettingsDialogShell: ComponentType<{
      tabs: readonly { id: string; label: string; title: string; panel: ReactNode }[];
      activeTabId: string; onActiveTabIdChange: (tabId: string) => void;
      presentation: "inline"; className: string; fullscreenEnabled: false; dialogAriaLabelledBy: string;
      labels: { kicker: string; sidebarAriaLabel: string };
    }>;
  };
  ServerLabel: ComponentType<{ value: string }>;
  dictionaries: Partial<Record<string, Record<string, string>>>;
  viewerTimeZone: string;
  copy: {
    t: (required: { locale: string; key: string }, options?: Empty) => string;
    sinceDiscardMessage: (required: { locale: string; createdAt: string }, options?: Empty) => ReactNode;
    discardCountLine: (required: { locale: string; count: number | "unknown"; categoryLabelText: string; classNames: { row: string; quantity: string; category: string } }, options?: Empty) => ReactNode;
    baselineUnavailableMessage: (required: { locale: string }, options?: Empty) => ReactNode;
    restorePlanReadyMessage: (required: { locale: string; planId: string }, options?: Empty) => ReactNode;
    restoreDoneMessage: (required: { locale: string; restoreRunId: string; stateNode: ReactNode }, options?: Empty) => ReactNode;
    categoryLabel: (required: { category: string; locale: string }, options?: Empty) => string;
    costClassLabel: (required: { costClass: string; locale: string }, options?: Empty) => string;
    isAssertiveRecoveryBanner: (banner: NonNullable<AdminRecoveryStatus["banner"]>) => boolean;
    recoveryBannerTone: (banner: NonNullable<AdminRecoveryStatus["banner"]>) => "error" | "warning" | "";
    restoreButtonAccessibleName: (required: { locale: string; point: Pick<AdminRestorePoint, "createdAt">; viewerTimeZone: string }, options?: Empty) => string;
  };
}

export interface RestoreFlowProps {
  point: AdminRestorePoint;
  onBack: () => void;
  /** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention.
   *  The host supplies its wired restore hook. */
  useRestoreFlowHook: RecoveryProps["useRestoreFlowHook"];
  copy: RecoveryProps["copy"];
  ServerLabel: RecoveryProps["ServerLabel"];
  viewerTimeZone: string;
}

/**
 * @file Recovery screen (design-spec.md §4, ADR-045) — the `/admin/recovery` route.
 *
 * Per design-spec.md §0.1: one screen, holding every restore-point capability — never a separate
 * "Backups" route (ADR-045 explicitly rejects that shape). `development/todos.md`'s "Recovery vs
 * Database's Restore Points tab" entry (owner, 2026-09-10, superseded same morning) is the reason
 * this now has two tabs rather than Database's old three: Database's `RestorePointsSection`
 * (list + create, no restore action) moved here in full, and Database's own `restore-points` tab
 * was removed — restore points were never a "database" concern per the owner's own call. This
 * still applies §6's own recommendation (a full swap, not a modal-over-list) — the swap is now
 * between the two tabs below instead of an untabbed inline ternary.
 *
 * ## Tabs (2026-09-10)
 *
 * The initial implementation chose `TabBar` because this is a list-plus-ceremony operational
 * surface, the same shape as Database, rather than a settings form. The owner's explicit
 * `SettingsDialogShell` requirement takes precedence (2026-10-04 cleanup): the inline shell now
 * matches Agent Plugins, while retaining `?tab=` deep-linking and replace-history navigation.
 * Two tabs: **Restore points** (`RestorePointsPanel` — the list, the create action, and
 * the entry point into a restore) and **Restore** (`RestoreTabPanel` — `RestoreFlow` for whichever
 * point is selected, or a prompt back to the list when nothing is selected yet). Selecting a row
 * and confirming/cancelling the ceremony both navigate between the two tabs explicitly (see
 * `use-recovery-navigation.hooks.ts`) rather than deriving the active tab from `selected` — both
 * sections stay independently reachable either way, same as Database's URL-owned tabs.
 *
 * The restore ceremony (`plan`/`confirm`/`execute`, SPEC-019 C-301/C-302/C-303) is wired to the
 * real `core/gated-mutations`-backed routes (Session 5-6 backend gap closure). `executeRestore`
 * now physically swaps `content.db` (2026-07-16, `DbOpsPort.restoreFromArtifact` — an atomic
 * same-filesystem rename, closing the previously-disclosed "ledger-only" gap). Restart-based, by
 * design, not a live hot-swap: the already-running process keeps its own open file handle to the
 * pre-restore data until an operator restarts it — `restartRequired: true` on the response is
 * that signal, surfaced below rather than silently implied.
 *
 * ## Markup only
 *
 * `Recovery`'s own list/status/create state lives in `hooks/use-recovery.hooks.ts`; `RestoreFlow`'s
 * ceremony state lives in `hooks/use-restore-flow.hooks.ts` — independent state with its own
 * lifecycle, keyed to whichever restore point is selected. `DegradedBannerView`,
 * `RestorePointsList`, `RestorePointsPanel`, and `DisclosurePanel` hold no state of their own and
 * stay as plain, props-driven presentation with no hook. Pure logic (category labels, cost-class
 * badge text/tone, the banner urgency check and severity, the deep-link envelope parse) lives in
 * `rules.ts`.
 *
 * `src/__tests__/unit/admin-nav-recovery-acs.unit.test.ts` reads this file's source directly
 * (`readFileSync`) to assert AC-32 against the `page-description` copy below — keep that
 * `className="page-description">...</p>` line intact if editing the header copy.
 *
 * `locale`/`t`: `Recovery` and `RestoreFlow` each have their own hook (`useRecovery`,
 * `useRestoreFlow`), and each hook already independently calls `useAdminLocale()` for its own
 * error-string translations — so each component now gets `t`/`locale` from its OWN hook rather than
 * `Recovery` threading a single resolved `locale` down as a prop, per the standing i18n rule. This
 * adds no new fetch (see each hook's own file header). `DegradedBannerView`/`RestorePointsList`/
 * `RestorePointsPanel` have no hook of their own, so they keep receiving `locale` as a prop from
 * `Recovery` and receive the unbound translator from the host.
 */

function DegradedBannerView(props: { locale: string; status: AdminRecoveryStatus; copy: RecoveryProps["copy"] }) {
  const { locale, status, copy: { t, isAssertiveRecoveryBanner, recoveryBannerTone } } = props;
  const banner = status.banner;
  if (!banner) return null;

  // AC-27/EC-06/INV-07: `pending-migration`'s action always deep-links to Database's own
  // migration ceremony, never a Recovery restore action — restoring to an older snapshot does not
  // resolve schema drift against the current runtime.
  const assertive = isAssertiveRecoveryBanner(banner);
  // Not every degraded state is equally bad — see `recoveryBannerTone`'s own doc comment.
  const tone = recoveryBannerTone(banner);

  return (
    <div
      className={`notice ${tone} recovery-degraded-banner recovery-plain-notice`}
      role={assertive ? "alert" : undefined}
      aria-live={assertive ? "assertive" : "polite"}
    >
      <span>{banner.accessibleText}</span>
      {banner.actionKind === "deep-link-to-database-migration" ? (
        <a
          className="btn-secondary"
          href="/admin/database"
          {...agentHandle({ handle: "recovery-banner-go-to-database" }, { role: "link", label: "Go to Database to resolve the pending migration" })}
        >
          {t({ locale: locale, key: "Go to Database" })}
        </a>
      ) : null}
      {banner.actionKind === "unblock-interrupted-migration" ? (
        <button
          type="button"
          disabled
          title={t({ locale: locale, key: "No unblock route exists yet — see this screen's file header." })}
          {...agentHandle({ handle: "recovery-banner-unblock" }, { role: "button", label: "Unblock an interrupted migration (not yet available)" })}
        >
          {t({ locale: locale, key: "Unblock (not yet available)" })}
        </button>
      ) : null}
    </div>
  );
}

function RestorePointsList(props: {
  locale: string;
  points: AdminRestorePoint[];
  onSelect: (point: AdminRestorePoint) => void;
  kit: RecoveryProps["kit"];
  copy: RecoveryProps["copy"];
  viewerTimeZone: string;
}) {
  const { locale, kit: { DataTable }, copy: { t, costClassLabel, restoreButtonAccessibleName }, viewerTimeZone: VIEWER_TIME_ZONE } = props;
  // Restore-point ids are stable and unique, same per-row-handle derivation every other list on
  // this workstream uses (`buildAgentListHandles`) — needed because `DataTable`'s `cell` callback
  // only receives the row, not its index.
  const rowHandles = buildAgentListHandles({ prefix: "recovery-row", ids: props.points.map((p) => p.id) }
  );
  const rowHandleById = new Map(props.points.map((p, index) => [p.id, rowHandles[index]]));
  return (
    <DataTable
      rows={props.points}
      rowKey={(p) => p.id}
      empty={
        <div className="card">
          <div className="empty-state">
            <p>{t({ locale: locale, key: "No restore points yet." })}</p>
          </div>
        </div>
      }
      columns={[
        { key: "timestamp", header: t({ locale: locale, key: "Timestamp" }), cell: (p) => formatTimestamp({ iso: p.createdAt }, { viewerTimeZone: VIEWER_TIME_ZONE }) },
        { key: "trigger", header: t({ locale: locale, key: "Trigger" }), cell: (p) => p.trigger },
        {
          key: "cost-class",
          header: t({ locale: locale, key: "Cost class" }),
          cell: (p) => <span className={`status status-${p.costClass}`}>{costClassLabel({ costClass: p.costClass, locale: locale })}</span>,
        },
        {
          key: "restore",
          cell: (p) =>
            p.costClass === "unavailable" ? (
              <span className="muted-cell">{t({ locale: locale, key: "No restore-point mechanism available — see the runbook." })}</span>
            ) : (
              <button
                type="button"
                onClick={() => props.onSelect(p)}
                // Every row's visible text is the identical "Restore…" — see
                // `rules.ts`'s `restoreButtonAccessibleName` doc comment for why that is ambiguous
                // to anything resolving elements by accessible name rather than table position, and
                // why this is the one screen where that ambiguity matters most.
                aria-label={restoreButtonAccessibleName({ locale: locale, point: p, viewerTimeZone: VIEWER_TIME_ZONE })}
                {...agentHandle({ handle: `${rowHandleById.get(p.id)}-restore` }, { role: "button", label: "Begin the restore ceremony for this restore point" })}
              >
                {t({ locale: locale, key: "Restore…" })}
              </button>
            ),
        },
      ]}
    />
  );
}

/** The "Restore points" tab's full panel — `RestorePointsList` (unchanged from before the tabs
 *  pass) plus the create action Database's own `RestorePointsSection` used to own
 *  (`development/todos.md`'s "Recovery vs Database's Restore Points tab" entry, 2026-09-10). Split
 *  out from `RestorePointsList` itself, rather than folding the header/button into it, so the bare
 *  list stays reusable exactly as it already is for anything that only needs the table (there is no
 *  such caller today, but the split cost nothing and matches how `Database.tsx`'s own
 *  `RestorePointsSection` kept its header separate from its `DataTable` call). */
function RestorePointsPanel(props: {
  locale: string;
  points: AdminRestorePoint[];
  creating: boolean;
  onCreate: () => void;
  onSelect: (point: AdminRestorePoint) => void;
  kit: RecoveryProps["kit"];
  copy: RecoveryProps["copy"];
  viewerTimeZone: string;
}) {
  const { locale, kit, copy, viewerTimeZone, copy: { t } } = props;
  return (
    <div>
      <div className="editor-header">
        <h2>{t({ locale: locale, key: "Restore points" })}</h2>
        <button
          type="button"
          onClick={props.onCreate}
          disabled={props.creating}
          {...agentHandle({ handle: "recovery-create-restore-point" }, { role: "button", label: "Create a new restore point now" })}
        >
          {props.creating ? t({ locale: locale, key: "Creating…" }) : t({ locale: locale, key: "Create restore point" })}
        </button>
      </div>
      <RestorePointsList locale={locale} points={props.points} onSelect={props.onSelect} kit={kit} copy={copy} viewerTimeZone={viewerTimeZone} />
    </div>
  );
}

function RestoreFlow({ point, onBack, useRestoreFlowHook, copy, ServerLabel, viewerTimeZone }: RestoreFlowProps) {
  const controller = useRestoreFlowHook({ point });
  return <RestoreFlowBody point={point} onBack={onBack} controller={controller} copy={copy} ServerLabel={ServerLabel} viewerTimeZone={viewerTimeZone} />;
}

/** The "Restore" tab's own panel — `RestoreFlow` for whichever point is selected, or a prompt back
 *  to the "Restore points" tab when nothing is selected yet (a direct `?tab=restore` visit, or the
 *  ceremony was already backed out of via `onBack`). Originally split out so `recoveryTabPanel`
 *  stayed a flat dispatch (Database's same complexity-gate reason). The shared shell now owns
 *  that dispatch; this component keeps the selected-point guard out of the page's markup. */
function RestoreTabPanel(props: { locale: string; selected: AdminRestorePoint | null; onBack: () => void } & Pick<RecoveryProps, "useRestoreFlowHook" | "copy" | "ServerLabel" | "viewerTimeZone">) {
  if (!props.selected) {
    return (
      <div className="notice">
        <p>{props.copy.t({ locale: props.locale, key: "Select a restore point from the Restore points tab to begin." })}</p>
      </div>
    );
  }
  return <RestoreFlow point={props.selected} onBack={props.onBack} useRestoreFlowHook={props.useRestoreFlowHook} copy={props.copy} ServerLabel={props.ServerLabel} viewerTimeZone={props.viewerTimeZone} />;
}

export function Recovery({ useRecoveryHook, tabId, useRecoveryNavigationHook, useRestoreFlowHook, navigationPort,
  kit: { I18nProvider, SettingsDialogShell }, kit, ServerLabel, dictionaries, copy, viewerTimeZone }: RecoveryProps) {
  const { status, points, error, creating, createRestorePoint, selected, setSelected, t, locale } = useRecoveryHook();
  const { activeTabId, onTabChange, onSelectPoint, onBackFromFlow } = useRecoveryNavigationHook({ tabId, setSelected, port: navigationPort });

  if (error && !points) return <div className="notice error">{error}</div>;
  if (!points || !status) return <div className="notice">{t("Loading restore points…")}</div>;

  // The former recoveryTabPanel used a flat dispatch to avoid nested JSX branch complexity.
  // The shell now owns that dispatch: each tab supplies one presentation-only panel.
  const tabs: ComponentProps<RecoveryProps["kit"]["SettingsDialogShell"]>["tabs"] = [
    {
      id: "restore-points", label: t("Restore points"), title: t("Recovery"),
      panel: <RestorePointsPanel kit={kit} copy={copy} viewerTimeZone={viewerTimeZone} locale={locale} points={points} creating={creating} onCreate={createRestorePoint} onSelect={onSelectPoint} />,
    },
    {
      id: "restore", label: t("Restore"), title: t("Recovery"),
      panel: <RestoreTabPanel useRestoreFlowHook={useRestoreFlowHook} copy={copy} ServerLabel={ServerLabel} viewerTimeZone={viewerTimeZone} locale={locale} selected={selected} onBack={onBackFromFlow} />,
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{t("Operations")}</p>
          <h1 className="page-title">{t("Recovery")}</h1>
          <p className="page-description">{t("Restore this site to a previous point in time using a captured restore point.")}</p>
        </div>
      </div>
      {error ? <div className="notice error">{error}</div> : null}
      <DegradedBannerView locale={locale} status={status} copy={copy} />

      <I18nProvider initialLocale={locale} dictionaries={dictionaries} fallbackLocale="en" syncDocumentAttributes={false}>
        <div
          className="settings-ui-section settings-ui-section--page-flow recovery-section"
          {...agentHandle({ handle: "recovery-tab-bar" }, { role: "region", label: t("Recovery") })}
        >
          <SettingsDialogShell
            tabs={tabs}
            activeTabId={activeTabId}
            onActiveTabIdChange={onTabChange}
            presentation="inline"
            className="jini-tabbed-dialog--inline"
            fullscreenEnabled={false}
            dialogAriaLabelledBy="recovery-shell-title"
            labels={{ kicker: "", sidebarAriaLabel: t("Recovery") }}
          />
        </div>
      </I18nProvider>
    </div>
  );
}
