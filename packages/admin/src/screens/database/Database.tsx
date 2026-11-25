import type { ComponentType, FormEvent, ReactNode } from "react";
import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import { formatTimestamp, resolveActiveTabId } from "@jini-ai/core/text";
import type { AdminLedgerRow } from "../../core/index.js";
import { DataTable } from "../../react/components/DataTable.js";
import { Icon, TabBar, type TabBarTab } from "../../react/kit.js";
import { navigate } from "../../shell/lib/router.js";
import { VIEWER_TIME_ZONE } from "../../shell/lib/viewer-time-zone.js";
import { navigateDatabaseTab } from "./Database.hooks.js";
import { t, planReadyMessage } from "./database-i18n.js";
import type { MigrateForwardSectionController } from "./hooks/use-migrate-forward-section.hooks.js";
import type { SchemaStateSectionController } from "./hooks/use-schema-state-section.hooks.js";
import { navigateToRecoveryWithDeepLink, type TimelineSectionController } from "./hooks/use-timeline-section.hooks.js";
import { viewInRecoveryAccessibleName } from "./rules.js";

/**
 * @file Database screen (design-spec.md §3, ADR-041) — the `/admin/database` route: the
 * read-first Timeline and the migrate-forward ceremony, behind a `TabBar` (`@jini-ai/ui/tab-strip`)
 * with two tabs — Timeline, Migrate forward. Markup only.
 *
 * State and API calls live in the package's `use-timeline-section.hooks.ts` and
 * `use-migrate-forward-section.hooks.ts` (`@jini-ai/admin/screens/database/hooks/`, bound in `hooks/*-dependencies.hooks.ts`) — one per section, matching the two independent
 * pieces of screen state. Structural reference: `Analytics.tsx`'s "raw ingest, said so explicitly"
 * pattern (design-spec.md §0.3).
 *
 * The migrate-forward plan/confirm/execute ceremony (ADR-041 §3, SPEC-017 C-103/C-105) is now
 * wired to the real `core/gated-mutations`-backed routes (Session 5-6 backend gap closure).
 *
 * The DRIFT BANNER (`SchemaStateWarningBanner` below), backed by the
 * `GET /api/admin/v1/database/schema-state` route, stays ABOVE the `TabBar` and renders regardless
 * of which tab is active — it is the screen's only always-on health statement (see its own doc
 * comment), and a person on the Migrate forward tab needs to see "your database doesn't match this
 * software" just as much as someone on Timeline. Read-only — it reports, and offers no repair
 * action of its own; migrate-forward remains the only write path.
 *
 * Still disclosed, still omitted (per design-spec.md §3.8/§5 and progress-ledger.md "Session 5"):
 * the `PENDING_MIGRATION` boot banner and the Tier-3 browser have no route yet — this screen omits
 * them rather than rendering dead affordances.
 *
 * NO RESTORE-POINTS TAB (2026-09-10): this screen used to carry a third tab — Restore points
 * (list + create, the former Database hook) — between Timeline and Migrate
 * forward. `development/todos.md`'s "Recovery vs Database's Restore Points tab" entry (owner,
 * 2026-09-10, superseded same morning) moved that whole capability into `features/recovery/
 * Recovery.tsx`, now tabbed itself, alongside the restore ceremony it already owned — restore
 * points were never a "database" concern per the owner's own call. `Database.tsx` keeps only the
 * two tabs below; anything about a restore point's own list/create lives in Recovery now, not here.
 *
 * TAB GROUPING (this pass): two tabs, one per section, in read → change order — **Timeline** (the
 * read-first ledger, so it's what a returning operator sees first), **Migrate forward** (the one
 * ceremony that actually writes). `?tab=` deep-linking follows `Deployment.tsx`/`SettingsUi.tsx`'s
 * own pattern: `panels.tsx` passes `ctx.query.get("tab")` in as `tabId`, an unrecognized or absent
 * value falls back to the first tab ("timeline") rather than rendering nothing, and switching tabs
 * calls `navigate(..., { replace: true })` so the URL stays a correct deep link without growing the
 * back-button history one entry per click.
 *
 * `Database` itself still has no hook of its own (no single fetch/state this top-level shell owns
 * — the tab-id resolution below is pure, not stateful), so it keeps calling
 * `useAdminLocale()`/`database-i18n`'s `t` directly for its own header and tab-bar text — per the
 * standing i18n rule's carve-out for components with no hook file. Each SECTION below
 * (`useTimelineSection`, `useMigrateForwardSection`) already independently resolves
 * `useAdminLocale()` for its own internal error-string translations (unrelated to this file), so
 * `t`/`locale` are sourced from each section's own hook rather than threaded down from `Database`
 * as a prop — that prop was redundant with a resolution each hook was already doing.
 */
// In `@jini-ai/admin` the section hooks, the admin locale hook and `ServerLabel` arrive as REQUIRED props
// (`DatabaseProps`); the host binds its wired hooks in its own `Database.tsx`.

const DATABASE_TAB_IDS = ["timeline", "migrate-forward"] as const;
type DatabaseTabId = (typeof DATABASE_TAB_IDS)[number];

/** Falls back to the first tab for an absent or unrecognized `?tab=` value. Delegates to the
 *  shared `../../lib/resolve-active-tab-id` guard — same "don't trust a raw query value" reason
 *  `Deployment.tsx`/`Security.tsx`/`SourceControl.tsx`/`Themes.tsx` and `SettingsUi.tsx`'s own
 *  `requestedTabId` all apply (a stale link or a typo must not blank the panel). */
function resolveDatabaseTabId({ tabId }: { tabId: string | null | undefined }, _options = {}): DatabaseTabId {
  return resolveActiveTabId({ tabId: tabId, validIds: DATABASE_TAB_IDS, defaultId: "timeline" });
}

const KIND_OPTIONS = [
  "core.migration",
  "plugin.ddl",
  "index.provision",
  "index.drop",
  "template.upgrade",
  "restore_point.created",
  "restore.executed",
  "migration.interrupted",
] as const;

/** The host-supplied locale hook and status label every section here needs. REQUIRED: the host owns
 *  the locale source and the server-status vocabulary, so there is no package default to fall back
 *  on. */
export interface DatabaseHostParts {
  useAdminLocaleHook: () => string;
  ServerLabel: ComponentType<{ value: string }>;
}

export interface TimelineSectionProps {
  /** Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   *  for `useCustomSelect`. Mirrored below (`MigrateForwardSectionProps`) since each section owns
   *  independent state. Defaulted to the WIRED hook (2026-08-14, Orc-BASH pass) — see
   *  `timeline-section-dependencies.hooks.ts`'s own `useWiredTimelineSection`. */
  // Package form: REQUIRED — the host binds its WIRED hook (live port, locale, error wording).
  useTimelineSectionHook: () => TimelineSectionController;
  ServerLabel: ComponentType<{ value: string }>;
}

/** The Timeline's filter bar. Pure presentation, no branching of its own beyond the
 *  `KIND_OPTIONS` map (its own function scope). Top-level rather than inline in `TimelineSection`'s
 *  body, per the complexity-ceiling pass's extraction rule. */
function TimelineFilterForm(props: {
  locale: string;
  onSubmit: (e: FormEvent) => void;
  kind: string;
  onKindChange: (kind: string) => void;
  outcome: string;
  onOutcomeChange: (outcome: string) => void;
  fromDate: string;
  onFromDateChange: (fromDate: string) => void;
  toDate: string;
  onToDateChange: (toDate: string) => void;
}) {
  const { locale } = props;
  return (
    <form className="jini-notice jini-database-filter-bar jini-toolbar" onSubmit={props.onSubmit}>
      <div className="jini-field">
        <label className="jini-field-label" htmlFor="database-filter-kind">{t({ locale: locale, key: "Kind" })}</label>
        <select
          id="database-filter-kind"
          value={props.kind}
          onChange={(e) => props.onKindChange(e.target.value)}
          {...agentHandle({ handle: "database-filter-kind" }, { role: "field", label: "Filter the timeline by event kind" })}
        >
          <option value="">{t({ locale: locale, key: "(any)" })}</option>
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div className="jini-field">
        <label className="jini-field-label" htmlFor="database-filter-outcome">{t({ locale: locale, key: "Outcome" })}</label>
        <input
          id="database-filter-outcome"
          value={props.outcome}
          onChange={(e) => props.onOutcomeChange(e.target.value)}
          placeholder={t({ locale: locale, key: "e.g. success" })}
          {...agentHandle({ handle: "database-filter-outcome" }, { role: "field", label: "Filter the timeline by outcome text" })}
        />
      </div>
      <div className="jini-field">
        <label className="jini-field-label" htmlFor="database-filter-from">{t({ locale: locale, key: "From" })}</label>
        <input
          id="database-filter-from"
          type="date"
          value={props.fromDate}
          onChange={(e) => props.onFromDateChange(e.target.value)}
          {...agentHandle({ handle: "database-filter-from" }, { role: "field", label: "Filter the timeline to entries on or after this date" })}
        />
      </div>
      <div className="jini-field">
        <label className="jini-field-label" htmlFor="database-filter-to">{t({ locale: locale, key: "To" })}</label>
        <input
          id="database-filter-to"
          type="date"
          value={props.toDate}
          onChange={(e) => props.onToDateChange(e.target.value)}
          {...agentHandle({ handle: "database-filter-to" }, { role: "field", label: "Filter the timeline to entries on or before this date" })}
        />
      </div>
      <button
        type="submit"
        className="jini-btn-secondary"
        {...agentHandle({ handle: "database-filter-apply" }, { role: "button", label: "Apply the timeline filters" })}
      >
        {t({ locale: locale, key: "Apply filters" })}
      </button>
    </form>
  );
}

/** Builds the Timeline `DataTable`'s column descriptors. A plain function rather than a closure
 *  declared inside `TimelineBody`'s body — it closes over nothing but module-scope values, so it
 *  takes `locale` and the row-handle resolver explicitly. */
/** Timeline rows page in over "Load more", so handles are derived fresh each render from
 *  whichever rows are currently on screen — same per-row-id derivation every other list on this
 *  workstream uses (`buildAgentListHandles`), keyed by a lookup rather than row position because
 *  `DataTable`'s `cell` callback only receives the row, not its index. */
function timelineColumns(
  { locale, handleForRestorePointCell, ServerLabel }: { locale: string; handleForRestorePointCell: (rowId: string) => string; ServerLabel: ComponentType<{ value: string }> },
  _options = {},
): Array<{
  key: string;
  header: string;
  cell: (row: AdminLedgerRow) => ReactNode;
}> {
  return [
    { key: "kind", header: t({ locale: locale, key: "Kind" }), cell: (row) => row.kind },
    {
      key: "outcome",
      header: t({ locale: locale, key: "Outcome" }),
      cell: (row) => <span className={`jini-status jini-status-${row.outcome}`}><ServerLabel value={row.outcome} /></span>,
    },
    {
      key: "restore-point",
      header: t({ locale: locale, key: "Restore point" }),
      cell: (row: AdminLedgerRow) =>
        row.restorePointId ? (
          <button
            type="button"
            className="jini-database-restore-point-link"
            onClick={() => navigateToRecoveryWithDeepLink({ row, navigate })}
            // Every row's visible text is the identical "View in Recovery →", and every row's
            // button is on screen at once (not a per-row menu item) — see `rules.ts`'s
            // `viewInRecoveryAccessibleName` doc comment for why that is ambiguous to anything
            // resolving elements by accessible name rather than table position.
            aria-label={viewInRecoveryAccessibleName({ locale, row, viewerTimeZone: VIEWER_TIME_ZONE })}
            {...agentHandle({ handle: handleForRestorePointCell(row.id) }, {
              role: "button",
              label: "Open this ledger entry's restore point in Recovery",
            })}
          >
            {t({ locale: locale, key: "View in Recovery →" })}
          </button>
        ) : (
          "—"
        ),
    },
    { key: "time", header: t({ locale: locale, key: "Time" }), cell: (row) => formatTimestamp({ iso: row.createdAt }, { viewerTimeZone: VIEWER_TIME_ZONE }) },
  ];
}

/** The Timeline's own row-activity body — empty state or the table + pager. Split out from
 *  `TimelineSection` (which still owns the loading/error early returns) so each state is a flat
 *  if-return rather than a nested ternary. */
function TimelineBody(props: { locale: string; rows: AdminLedgerRow[]; nextCursor: string | null; loadingMore: boolean; loadMore: () => void; ServerLabel: ComponentType<{ value: string }> }) {
  const { locale } = props;
  if (props.rows.length === 0) {
    return (
      <div className="jini-card">
        <div className="jini-empty-state">
          <p>{t({ locale: locale, key: "No database activity recorded yet." })}</p>
        </div>
      </div>
    );
  }
  const restorePointHandles = buildAgentListHandles({ prefix: "database-timeline-restore-point", ids: props.rows.map((row) => row.id) }
  );
  const restorePointHandleById = new Map(props.rows.map((row, index) => [row.id, restorePointHandles[index]]));

  return (
    <>
      <DataTable
        rows={props.rows}
        rowKey={(row) => row.id}
        columns={timelineColumns({ locale, ServerLabel: props.ServerLabel, handleForRestorePointCell: (rowId) => {
          const handle = restorePointHandleById.get(rowId);
          if (handle === undefined) throw new Error(`database restore point ${rowId} has no row handle`);
          return handle;
        } })}
      />
      {props.nextCursor ? (
        <button
          type="button"
          className="jini-btn-secondary"
          onClick={props.loadMore}
          disabled={props.loadingMore}
          {...agentHandle({ handle: "database-timeline-load-more" }, { role: "button", label: "Load more timeline rows" })}
        >
          {props.loadingMore ? t({ locale: locale, key: "Loading…" }) : t({ locale: locale, key: "Load more" })}
        </button>
      ) : null}
    </>
  );
}

function TimelineSection({ useTimelineSectionHook, ServerLabel }: TimelineSectionProps) {
  const {
    rows,
    nextCursor,
    error,
    kind,
    setKind,
    outcome,
    setOutcome,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    loadingMore,
    applyFilters,
    loadMore,
    t,
    locale,
  } = useTimelineSectionHook();

  if (error && !rows) return <div className="jini-notice jini-notice-error">{error}</div>;
  if (!rows) return <div className="jini-notice">{t("Loading timeline…")}</div>;

  return (
    <div>
      <TimelineFilterForm
        locale={locale}
        onSubmit={applyFilters}
        kind={kind}
        onKindChange={setKind}
        outcome={outcome}
        onOutcomeChange={setOutcome}
        fromDate={fromDate}
        onFromDateChange={setFromDate}
        toDate={toDate}
        onToDateChange={setToDate}
      />

      {error ? <div className="jini-notice jini-notice-error">{error}</div> : null}

      <TimelineBody locale={locale} rows={rows} nextCursor={nextCursor} loadingMore={loadingMore} loadMore={loadMore} ServerLabel={ServerLabel} />
    </div>
  );
}

export interface MigrateForwardSectionProps {
  /** Defaulted to the WIRED hook (2026-08-14, Orc-BASH pass) — see `use-migrate-forward-
   *  section-dependencies.hooks.ts`'s own `useWiredMigrateForwardSection`. */
  // Package form: REQUIRED — the host binds its WIRED hook (live port, locale, error wording).
  useMigrateForwardSectionHook: () => MigrateForwardSectionController;
}

/** step === "idle": the entry point into the ceremony. */
function PlanMigrationStep(props: { locale: string; busy: boolean; onStartPlan: () => void }) {
  return (
    <button
      type="button"
      className="jini-btn-ghost"
      onClick={props.onStartPlan}
      disabled={props.busy}
      {...agentHandle({ handle: "database-migrate-plan" }, { role: "button", label: "Plan the forward migration" })}
    >
      {props.busy ? t({ locale: props.locale, key: "Planning…" }) : t({ locale: props.locale, key: "Plan migration" })}
    </button>
  );
}

/** step === "planned": nothing is migrated yet — confirming only issues a one-time execution
 *  token. `plan` is checked by the caller ({@link migrateForwardStep}), not here — the "defensive
 *  AND" (render nothing if the step/data pair is inconsistent) is the dispatch's job, not this
 *  component's. */
function PlannedStep(props: { locale: string; plan: { planId: string }; busy: boolean; onConfirm: () => void }) {
  return (
    <div className="jini-notice">
      <p>{planReadyMessage({ locale: props.locale, planId: props.plan.planId })}</p>
      <button
        type="button"
        className="jini-btn-secondary"
        onClick={props.onConfirm}
        disabled={props.busy}
        {...agentHandle({ handle: "database-migrate-confirm" }, { role: "button", label: "Confirm the planned migration, issuing a one-time execution token" })}
      >
        {props.busy ? t({ locale: props.locale, key: "Confirming…" }) : t({ locale: props.locale, key: "Confirm migration" })}
      </button>
    </div>
  );
}

/** step === "confirmed": the token from `PlannedStep` is in hand; executing now actually runs the
 *  migration. */
function ConfirmedStep(props: { locale: string; busy: boolean; onExecute: () => void }) {
  return (
    <div className="jini-notice">
      <p>{t({ locale: props.locale, key: "Confirmed. Executing runs the migration now." })}</p>
      <button
        type="button"
        className="jini-btn-warning"
        onClick={props.onExecute}
        disabled={props.busy}
        {...agentHandle({ handle: "database-migrate-execute" }, { role: "button", label: "Execute the confirmed migration now" })}
      >
        {props.busy ? t({ locale: props.locale, key: "Migrating…" }) : t({ locale: props.locale, key: "Execute migration" })}
      </button>
    </div>
  );
}

/** step === "done": terminal state. */
function DoneStep(props: { locale: string }) {
  return (
    <div className="jini-notice">
      <p role="status">{t({ locale: props.locale, key: "Migration executed successfully." })}</p>
    </div>
  );
}

/** Dispatches the ceremony's one active step as a flat if-chain — the four steps were previously
 *  four independent `step === X && data` JSX ternaries in `MigrateForwardSection`'s own body,
 *  which is what pushed its cognitive score past the ceiling (each guard reads as "is this the
 *  active step AND is its data actually present", four times over). Each `&& data` pairing is
 *  preserved exactly: a step whose expected payload is unexpectedly null renders nothing, same as
 *  before (see the "defensive AND" tests in `Database.unit.test.tsx`). */
function migrateForwardStep(props: {
  locale: string;
  step: MigrateForwardSectionController["step"];
  plan: MigrateForwardSectionController["plan"];
  confirmationToken: MigrateForwardSectionController["confirmationToken"];
  done: boolean;
  busy: boolean;
  onStartPlan: () => void;
  onConfirm: () => void;
  onExecute: () => void;
}) {
  if (props.step === "idle") return <PlanMigrationStep locale={props.locale} busy={props.busy} onStartPlan={props.onStartPlan} />;
  if (props.step === "planned" && props.plan) {
    return <PlannedStep locale={props.locale} plan={props.plan} busy={props.busy} onConfirm={props.onConfirm} />;
  }
  if (props.step === "confirmed" && props.confirmationToken) {
    return <ConfirmedStep locale={props.locale} busy={props.busy} onExecute={props.onExecute} />;
  }
  if (props.step === "done" && props.done) return <DoneStep locale={props.locale} />;
  return null;
}

function MigrateForwardSection({ useMigrateForwardSectionHook }: MigrateForwardSectionProps) {
  const { step, busy, error, plan, confirmationToken, done, reset, startPlan, doConfirm, doExecute, t, locale } = useMigrateForwardSectionHook();

  return (
    <div>
      <div className="jini-editor-header">
        <h2>{t("Migrate forward")}</h2>
        {step !== "idle" ? (
          <button
            type="button"
            className="jini-btn-ghost"
            onClick={reset}
            disabled={busy}
            {...agentHandle({ handle: "database-migrate-reset" }, { role: "button", label: "Reset the migrate-forward ceremony back to idle" })}
          >
            {t("Reset")}
          </button>
        ) : null}
      </div>
      <p className="jini-muted-cell">
        {t("Brings this site's schema up to the latest migration, capturing a restore point first when the site's restore-point mechanism allows it.")}
      </p>
      {error ? <div className="jini-notice jini-notice-error">{error}</div> : null}

      {migrateForwardStep({
        locale,
        step,
        plan,
        confirmationToken,
        done,
        busy,
        onStartPlan: startPlan,
        onConfirm: doConfirm,
        onExecute: doExecute,
      })}
    </div>
  );
}

export interface SchemaStateWarningBannerProps {
  /** Same dependency-injection seam as the three sections above. */
  useSchemaStateSectionHook: () => SchemaStateSectionController;
}

/**
 * The drift warning — the screen's only always-on health statement, so it renders ABOVE the
 * Timeline rather than inside any section.
 *
 * Renders nothing at all when {@link useWiredSchemaStateSection} reports no warning. That silence
 * is load-bearing and narrow: `rules.ts`'s `resolveSchemaStateWarning` only yields `null` for a
 * confirmed-clean read or a check that has not finished yet. Every other outcome — including "the
 * check failed" and "the comparison was incomplete" — arrives here as a real warning, because an
 * absent banner on this screen reads as "your database is fine".
 *
 * `role="alert"` rather than a plain `div`: this is unsolicited, it appears after load, and it can
 * change the meaning of everything below it, which is exactly the case the role exists for.
 * `warning.tone` selects between `.notice.error` and `.notice.warning`, both already in
 * `styles.css` — no new CSS.
 */
function SchemaStateWarningBanner({ useSchemaStateSectionHook }: SchemaStateWarningBannerProps) {
  const { warning, t } = useSchemaStateSectionHook();
  if (!warning) return null;

  return (
    <div className={`jini-notice jini-notice-${warning.tone} jini-database-drift-banner`} role="alert">
      <strong>{t(warning.title)}</strong>
      <p>{t(warning.body)}</p>
    </div>
  );
}

/** Dispatches the one active tab's panel as a flat if-chain — same shape `Deployment.tsx`'s
 *  `deploymentTabPanel`/`ThemeExplore.tsx`'s `ThemeExploreMainPane`/this file's own
 *  `migrateForwardStep` use for the identical complexity-gate reason: a component's OWN
 *  cyclomatic/cognitive score counts a ternary or `&&` written directly in its JSX, not one
 *  delegated to a plain function like this.
 *  @complexity O(1) — two mutually exclusive branches, no iteration. */
function databaseTabPanel(activeTabId: DatabaseTabId, props: DatabaseSectionHooks & Pick<DatabaseHostParts, "ServerLabel">) {
  if (activeTabId === "migrate-forward") return <MigrateForwardSection useMigrateForwardSectionHook={props.useMigrateForwardSectionHook} />;
  return <TimelineSection useTimelineSectionHook={props.useTimelineSectionHook} ServerLabel={props.ServerLabel} />;
}

/** The three section hooks the host wires — one per independent piece of screen state. */
export interface DatabaseSectionHooks {
  useTimelineSectionHook: () => TimelineSectionController;
  useMigrateForwardSectionHook: () => MigrateForwardSectionController;
  useSchemaStateSectionHook: () => SchemaStateSectionController;
}

export interface DatabaseProps extends DatabaseHostParts, DatabaseSectionHooks {
  /** The `?tab=` query value from the host's `database` route (`URLSearchParams.get` returns
   *  `null` when the param is absent). See {@link resolveDatabaseTabId}. */
  tabId?: string | null | undefined;
}

export function Database(props: DatabaseProps) {
  const locale = props.useAdminLocaleHook();
  const activeTabId = resolveDatabaseTabId({ tabId: props.tabId });

  // Icons (2026-09-06): the same icon-beside-label idiom every other `TabBar` row in this admin
  // carries — this was one of two rows still bare after the Media pass.
  const tabs: TabBarTab[] = [
    { id: "timeline", label: t({ locale: locale, key: "Timeline" }), icon: <Icon name="timeline" size={16} strokeWidth={1.5} /> },
    { id: "migrate-forward", label: t({ locale: locale, key: "Migrate forward" }), icon: <Icon name="migrate-forward" size={16} strokeWidth={1.5} /> },
  ];

  return (
    <div className="jini-page">
      <div className="jini-page-header">
        <div className="jini-page-header-text">
          <p className="jini-page-kicker">{t({ locale: locale, key: "Operations" })}</p>
          <h1 className="jini-page-title">{t({ locale: locale, key: "Database" })}</h1>
          <p className="jini-page-description">
            {t({ locale: locale, key: "A read-first record of every migration, snapshot, index change, and template upgrade on this site." })}
          </p>
        </div>
      </div>
      <SchemaStateWarningBanner useSchemaStateSectionHook={props.useSchemaStateSectionHook} />
      <TabBar
        ariaLabel={t({ locale: locale, key: "Database" })}
        tabs={tabs}
        activeId={activeTabId}
        onChange={(nextTabId) => navigateDatabaseTab({ nextTabId })}
        containerHandle="database-tab-bar"
      />
      {databaseTabPanel(activeTabId, props)}
    </div>
  );
}
