// @vitest-environment jsdom
import { useState, type FormEvent, type ReactElement } from "react";
import { cleanup, fireEvent, render as baseRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Database } from "../Database.js";
import type { TimelineSectionController } from "../hooks/use-timeline-section.hooks.js";
import type { MigrateForwardSectionController } from "../hooks/use-migrate-forward-section.hooks.js";
import type { SchemaStateSectionController } from "../hooks/use-schema-state-section.hooks.js";
import { navigate } from "../../../shell/lib/router.js";
import type { AdminLedgerRow } from "../../../core/index.js";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";

/**
 * @file `Database` — the `/admin/database` screen (design-spec.md §3, ADR-041). Markup only for
 * both sections; the two underlying hooks (`useTimelineSection`, `useMigrateForwardSection`)
 * already have their own dedicated, 100%-covered test files. This file's job is only the render
 * layer, which was bare (3.12%) before the original tabs pass.
 *
 * NO RESTORE-POINTS SECTION (2026-09-10): this file used to also cover a third section,
 * the former Database hook, mounted on a `restore-points` tab. That whole
 * capability moved to the host's Recovery screen (the product's todo list's "Recovery vs
 * Database's Restore Points tab" entry, owner, 2026-09-10) — see `Recovery.unit.test.tsx`'s own
 * "create restore point" describe block for its coverage now. The old hook and its dedicated tests were deleted after confirming it had no production
 * importer; the mixed request-volume suite retained its live sections.
 *
 * `Database` threads the three section hooks and the host parts (`ServerLabel`, `useAdminLocaleHook`)
 * through REQUIRED props, so each test drives every section's state directly: each controller below
 * is held in a `vi.hoisted` ref that tests mutate before rendering, with no real `fetch`.
 *
 * `t`/`locale` (2026-08-11, standing i18n rule): each controller fixture below defaults `t` to the
 * identity function (and `locale` to `"en"`, where the controller carries one) — matching
 * `wired-hooks-convention.md`'s own `t: (k) => k` example — so every existing assertion above stays
 * matched against the raw English key with no behavior change.
 *
 * TABS: `Database` renders one section at a time behind a `TabBar` (Timeline/Migrate forward — see
 * `Database.tsx`'s own header comment for the grouping rationale), instead of mounting both at
 * once. `renderDatabase` below resolves a default `?tab=` from WHICH override key a test passed —
 * `migrateForward` opens on "migrate-forward", anything else (including no override at all) opens
 * on the default "timeline" tab — so every pre-existing test call below still lands on the section
 * it was already asserting against with no change to the call itself. A test that needs a specific
 * tab regardless of that inference (or needs to assert on the tab bar itself) passes `tabId`
 * explicitly, which always wins.
 */

vi.mock("../../../shell/lib/router.js", () => ({ navigate: vi.fn() }));

const { timelineRef, migrateForwardRef, schemaStateRef } = vi.hoisted(() => ({
  timelineRef: { current: null as unknown },
  migrateForwardRef: { current: null as unknown },
  schemaStateRef: { current: null as unknown },
}));

const kit = fakeAdminKit();
const render = (ui: ReactElement) => baseRender(<AdminKitProvider kit={kit}>{ui}</AdminKitProvider>);

/** The host-supplied parts `Database` requires: a status label and a locale hook. */
const ServerLabel = ({ value }: { value: string }) => <span>{value}</span>;
const useAdminLocaleHook = () => "en";
const hostProps = {
  ServerLabel,
  useAdminLocaleHook,
  useTimelineSectionHook: () => timelineRef.current as TimelineSectionController,
  useMigrateForwardSectionHook: () => migrateForwardRef.current as MigrateForwardSectionController,
  useSchemaStateSectionHook: () => schemaStateRef.current as SchemaStateSectionController,
};

const ROW: AdminLedgerRow = {
  id: "row1",
  kind: "core.migration",
  createdAt: "2026-08-01T12:34:00.000Z",
  restorePointId: "rp1",
  outcome: "success",
};
const ROW_NO_RESTORE_POINT: AdminLedgerRow = { ...ROW, id: "row2", restorePointId: null };

function timelineController(overrides: Partial<TimelineSectionController> = {}): TimelineSectionController {
  return {
    rows: [ROW],
    nextCursor: null,
    error: null,
    kind: "",
    setKind: vi.fn(),
    outcome: "",
    setOutcome: vi.fn(),
    fromDate: "",
    setFromDate: vi.fn(),
    toDate: "",
    setToDate: vi.fn(),
    loadingMore: false,
    applyFilters: vi.fn((e: FormEvent) => e.preventDefault()),
    loadMore: vi.fn(),
    t: (key: string) => key,
    locale: "en",
    ...overrides,
  };
}

function migrateForwardController(overrides: Partial<MigrateForwardSectionController> = {}): MigrateForwardSectionController {
  return {
    step: "idle",
    busy: false,
    error: null,
    plan: null,
    confirmationToken: null,
    done: false,
    reset: vi.fn(),
    startPlan: vi.fn(async () => {}),
    doConfirm: vi.fn(async () => {}),
    doExecute: vi.fn(async () => {}),
    t: (key: string) => key,
    locale: "en",
    ...overrides,
  };
}

/** Defaults to the SETTLED-AND-CLEAN state (`warning: null`, `settled: true`) so every pre-existing
 *  test in this file renders no drift banner and keeps asserting exactly what it always did. */
function schemaStateController(overrides: Partial<SchemaStateSectionController> = {}): SchemaStateSectionController {
  return { warning: null, settled: true, t: (k: string) => k, ...overrides };
}

/** See the "TABS" file-header note above for why this infers a default tab from which override
 *  key a test passed, rather than requiring every existing call site to name one. */
function resolveDefaultTabId(overrides: { migrateForward?: unknown; tabId?: string | null }): string | null | undefined {
  if (overrides.tabId !== undefined) return overrides.tabId;
  if (overrides.migrateForward) return "migrate-forward";
  return "timeline";
}

function renderDatabase(overrides: {
  timeline?: Partial<TimelineSectionController>;
  migrateForward?: Partial<MigrateForwardSectionController>;
  schemaState?: Partial<SchemaStateSectionController>;
  tabId?: string | null;
} = {}) {
  const t = timelineController(overrides.timeline);
  const m = migrateForwardController(overrides.migrateForward);
  const s = schemaStateController(overrides.schemaState);
  timelineRef.current = t;
  migrateForwardRef.current = m;
  schemaStateRef.current = s;
  render(<Database tabId={resolveDefaultTabId(overrides)} {...hostProps} />);
  return { timeline: t, migrateForward: m, schemaState: s };
}

beforeEach(() => {
  timelineRef.current = timelineController();
  migrateForwardRef.current = migrateForwardController();
  schemaStateRef.current = schemaStateController();
});

describe("page shell", () => {
  it("renders the page header and the two-tab tab bar", () => {
    renderDatabase();
    expect(screen.getByRole("heading", { name: "Database", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Database" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Timeline" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Migrate forward" })).toBeInTheDocument();
    // Restore points moved to Recovery (2026-09-10, the product's todo list) — Database no longer
    // has a tab for it at all.
    expect(screen.queryByRole("tab", { name: "Restore points" })).not.toBeInTheDocument();
  });
});

describe("tab bar", () => {
  it("defaults to the Timeline tab and shows only its content when no tabId is given", () => {
    renderDatabase();
    expect(screen.getByRole("tab", { name: "Timeline" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Migrate forward" })).toHaveAttribute("aria-selected", "false");
    // Only Timeline's section is mounted — the other section's own heading is absent.
    expect(screen.queryByRole("heading", { name: "Migrate forward" })).not.toBeInTheDocument();
  });

  it("opens on the tab named by tabId, showing only that section", () => {
    renderDatabase({ tabId: "migrate-forward" });
    expect(screen.getByRole("tab", { name: "Migrate forward" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Migrate forward" })).toBeInTheDocument();
    expect(screen.queryAllByRole("table")).toHaveLength(0);
  });

  it("falls back to Timeline for an unrecognized tabId", () => {
    renderDatabase({ tabId: "bogus" });
    expect(screen.getByRole("tab", { name: "Timeline" })).toHaveAttribute("aria-selected", "true");
  });

  it("clicking a tab calls navigate with the new ?tab= query, replacing history", async () => {
    const user = userEvent.setup();
    renderDatabase();
    await user.click(screen.getByRole("tab", { name: "Migrate forward" }));
    expect(navigate).toHaveBeenCalledWith({ routePath: "/database?tab=migrate-forward" }, { replace: true });
  });

  it("keeps the drift banner visible above the tab bar regardless of which tab is active", () => {
    renderDatabase({
      tabId: "migrate-forward",
      schemaState: { warning: { tone: "error", title: "Something is wrong", body: "Details here." } },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Something is wrong");
  });
});

describe("TimelineSection — loading/error/loaded", () => {
  it("shows only the error notice (no filter form) when rows is null and error is set", () => {
    renderDatabase({ timeline: { rows: null, error: "failed to load the Database Timeline" } });
    expect(screen.getByText("failed to load the Database Timeline")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("shows a loading notice while rows is null and there is no error", () => {
    renderDatabase({ timeline: { rows: null, error: null } });
    expect(screen.getByText("Loading timeline…")).toBeInTheDocument();
  });

  it("shows the empty state when rows is an empty array, with no table on the active (Timeline) tab", () => {
    renderDatabase({ timeline: { rows: [] } });
    expect(screen.getByText("No database activity recorded yet.")).toBeInTheDocument();
    // Only the Timeline tab is mounted (see the "tab bar" describe block) — its own empty-state
    // card renders instead of a table, and the other two sections aren't in the tree at all.
    expect(screen.queryAllByRole("table")).toHaveLength(0);
  });

  it("renders kind, outcome, restore-point link, and formatted time columns for a loaded row", () => {
    renderDatabase({ timeline: { rows: [ROW] } });
    const table = screen.getAllByRole("table")[0];
    expect(table).toHaveTextContent("core.migration");
    expect(table).toHaveTextContent("success");
    expect(table).toHaveTextContent("2026-08-01 12:34");
    // Accessible name, not just visible text: `viewInRecoveryAccessibleName` (rules.ts) appends
    // this row's own kind/timestamp after the visible "View in Recovery →" label so this control's
    // accessible name is distinct per row — see the multi-row test below.
    expect(screen.getByRole("button", { name: "View in Recovery → — core.migration, 2026-08-01 12:34" })).toBeInTheDocument();
  });

  it("gives each row's 'View in Recovery →' link a DISTINCT accessible name, not a repeated bare one", () => {
    // Two ledger rows differing only by kind/timestamp — every row's button is on screen at once
    // (unlike a per-row menu item), so identical accessible names would make
    // `getByRole("button", { name: "View in Recovery →" })` — or any accessibility-tree-driven
    // agent — unable to tell which row's restore point it would open.
    const otherRow: AdminLedgerRow = { ...ROW, id: "row3", kind: "index.provision", createdAt: "2026-08-02T09:00:00.000Z" };
    renderDatabase({ timeline: { rows: [ROW, otherRow] } });
    expect(screen.getByRole("button", { name: "View in Recovery → — core.migration, 2026-08-01 12:34" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View in Recovery → — index.provision, 2026-08-02 09:00" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^View in Recovery →/ })).toHaveLength(2);
  });

  it("renders '—' instead of a link when the row has no restorePointId", () => {
    renderDatabase({ timeline: { rows: [ROW_NO_RESTORE_POINT] } });
    expect(screen.queryByRole("button", { name: /^View in Recovery →/ })).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows an inline error banner ABOVE the table once rows have loaded and a later error occurs", () => {
    renderDatabase({ timeline: { rows: [ROW], error: "stale filter" } });
    expect(screen.getByText("stale filter")).toBeInTheDocument();
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
    expect(screen.getByText("stale filter").compareDocumentPosition(screen.getByRole("table")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("clicking 'View in Recovery →' calls the real navigateToRecoveryWithDeepLink (stashes envelope + navigates)", async () => {
    const user = userEvent.setup();
    sessionStorage.removeItem("recovery-deep-link-envelope");
    renderDatabase({ timeline: { rows: [ROW] } });
    await user.click(screen.getByRole("button", { name: "View in Recovery → — core.migration, 2026-08-01 12:34" }));
    const stashed = sessionStorage.getItem("recovery-deep-link-envelope");
    expect(stashed).not.toBeNull();
    expect(JSON.parse(stashed!)).toMatchObject({ restorePointId: "rp1", ledgerEventId: "row1" });
    expect(navigate).toHaveBeenCalledWith({ routePath: "/recovery" });
    sessionStorage.removeItem("recovery-deep-link-envelope");
  });
});

describe("TimelineSection — filter form", () => {
  it("submitting the filter form calls applyFilters", async () => {
    const user = userEvent.setup();
    const c = renderDatabase({ timeline: { rows: [ROW] } });
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(c.timeline.applyFilters).toHaveBeenCalledTimes(1);
  });

  it("typing in the outcome filter calls setOutcome", async () => {
    const user = userEvent.setup();
    const c = renderDatabase({ timeline: { rows: [ROW] } });
    await user.type(screen.getByLabelText("Outcome"), "x");
    expect(c.timeline.setOutcome).toHaveBeenCalled();
    expect(c.timeline.setOutcome).toHaveBeenLastCalledWith("x");
  });

  it("keeps a multi-character outcome value as the controlled input changes", async () => {
    const user = userEvent.setup();
    const setOutcome = vi.fn();
    function StatefulDatabase() {
      const [outcome, setOutcomeState] = useState("");
      timelineRef.current = timelineController({ outcome, setOutcome: (value) => {
        setOutcome(value);
        setOutcomeState(value);
      } });
      return <Database tabId="timeline" {...hostProps} />;
    }
    render(<StatefulDatabase />);
    const input = screen.getByLabelText("Outcome");
    await user.type(input, "success");
    expect(setOutcome).toHaveBeenLastCalledWith("success");
    expect(input).toHaveValue("success");
  });

  it("changing the kind select calls setKind", async () => {
    const user = userEvent.setup();
    const c = renderDatabase({ timeline: { rows: [ROW] } });
    await user.selectOptions(screen.getByLabelText("Kind"), "plugin.ddl");
    expect(c.timeline.setKind).toHaveBeenCalledWith("plugin.ddl");
  });

  it("changing the From date calls setFromDate", () => {
    const c = renderDatabase({ timeline: { rows: [ROW] } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    expect(c.timeline.setFromDate).toHaveBeenCalledWith("2026-01-01");
  });

  it("changing the To date calls setToDate", () => {
    const c = renderDatabase({ timeline: { rows: [ROW] } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-12-31" } });
    expect(c.timeline.setToDate).toHaveBeenCalledWith("2026-12-31");
  });
});

describe("TimelineSection — pagination", () => {
  it("shows 'Load more' when nextCursor is set", () => {
    renderDatabase({ timeline: { rows: [ROW], nextCursor: "cursor1" } });
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("omits 'Load more' when nextCursor is null", () => {
    renderDatabase({ timeline: { rows: [ROW], nextCursor: null } });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("clicking an enabled 'Load more' calls loadMore", async () => {
    const user = userEvent.setup();
    const c = renderDatabase({ timeline: { rows: [ROW], nextCursor: "cursor1" } });
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(c.timeline.loadMore).toHaveBeenCalledTimes(1);
    expect(c.timeline.applyFilters).not.toHaveBeenCalled();
  });

  it("shows 'Loading…' and disables the pager while loadingMore", () => {
    renderDatabase({ timeline: { rows: [ROW], nextCursor: "cursor1", loadingMore: true } });
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
  });
});

describe("MigrateForwardSection — idle/planned/confirmed/done", () => {
  it("idle: shows 'Plan migration' and no Reset button", () => {
    renderDatabase({ migrateForward: { step: "idle" } });
    expect(screen.getByRole("button", { name: "Plan migration" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  });

  it("idle: shows 'Planning…' and disables the button while busy", () => {
    renderDatabase({ migrateForward: { step: "idle", busy: true } });
    expect(screen.getByRole("button", { name: "Planning…" })).toBeDisabled();
  });

  it("clicking 'Plan migration' calls startPlan", async () => {
    const user = userEvent.setup();
    const c = renderDatabase({ migrateForward: { step: "idle" } });
    await user.click(screen.getByRole("button", { name: "Plan migration" }));
    expect(c.migrateForward.startPlan).toHaveBeenCalledTimes(1);
  });

  it("planned: shows the plan id and 'Confirm migration', plus a Reset button", () => {
    renderDatabase({ migrateForward: { step: "planned", plan: { planId: "plan1", planHash: "hash1" } } });
    expect(screen.getByText("plan1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm migration" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });

  it("planned: omits the plan block entirely if plan is null even though step is 'planned' (defensive AND)", () => {
    renderDatabase({ migrateForward: { step: "planned", plan: null } });
    expect(screen.queryByRole("button", { name: "Confirm migration" })).not.toBeInTheDocument();
  });

  it("clicking 'Confirm migration' calls doConfirm", async () => {
    const user = userEvent.setup();
    const c = renderDatabase({ migrateForward: { step: "planned", plan: { planId: "plan1", planHash: "hash1" } } });
    await user.click(screen.getByRole("button", { name: "Confirm migration" }));
    expect(c.migrateForward.doConfirm).toHaveBeenCalledTimes(1);
  });

  it("confirmed: shows 'Execute migration' (btn-warning) once confirmationToken is set", () => {
    renderDatabase({ migrateForward: { step: "confirmed", confirmationToken: "tok1" } });
    expect(screen.getByRole("button", { name: "Execute migration" })).toBeInTheDocument();
  });

  it("confirmed: shows 'Migrating…' and disables the button while busy", () => {
    renderDatabase({ migrateForward: { step: "confirmed", confirmationToken: "tok1", busy: true } });
    expect(screen.getByRole("button", { name: "Migrating…" })).toBeDisabled();
  });

  it("confirmed: omits the execute block if confirmationToken is null even though step is 'confirmed'", () => {
    renderDatabase({ migrateForward: { step: "confirmed", confirmationToken: null } });
    expect(screen.queryByRole("button", { name: "Execute migration" })).not.toBeInTheDocument();
  });

  it("clicking 'Execute migration' calls doExecute", async () => {
    const user = userEvent.setup();
    const c = renderDatabase({ migrateForward: { step: "confirmed", confirmationToken: "tok1" } });
    await user.click(screen.getByRole("button", { name: "Execute migration" }));
    expect(c.migrateForward.doExecute).toHaveBeenCalledTimes(1);
  });

  it("the Execute migration button carries its agent handle", () => {
    renderDatabase({ migrateForward: { step: "confirmed", confirmationToken: "tok1" } });
    const executeButton = screen.getByRole("button", { name: "Execute migration" });
    expect(executeButton).toHaveAttribute("data-agent-element", "database-migrate-execute");
  });

  it("done: shows the success status message only when done is also true", () => {
    renderDatabase({ migrateForward: { step: "done", done: true } });
    expect(screen.getByRole("status")).toHaveTextContent("Migration executed successfully.");
  });

  it("done: omits the success message if done is false even though step is 'done' (defensive AND)", () => {
    renderDatabase({ migrateForward: { step: "done", done: false } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the ceremony error inline at any step", () => {
    renderDatabase({ migrateForward: { step: "idle", error: "Failed to plan the forward migration" } });
    expect(screen.getByText("Failed to plan the forward migration")).toBeInTheDocument();
  });

  it("clicking Reset (visible once step !== idle) calls reset", async () => {
    const user = userEvent.setup();
    const c = renderDatabase({ migrateForward: { step: "planned", plan: { planId: "plan1", planHash: "hash1" } } });
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(c.migrateForward.reset).toHaveBeenCalledTimes(1);
  });

  it("disables Reset while busy", () => {
    renderDatabase({ migrateForward: { step: "planned", plan: { planId: "plan1", planHash: "hash1" }, busy: true } });
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
  });
});

describe("drift warning", () => {
  /**
   * The gap this section closes: `src/platform/db/drift.ts` could classify a database as diverged, and
   * nothing anywhere ever showed that to a person. These assertions are about VISIBILITY — that
   * the banner reaches the accessibility tree with an alert role, ahead of the screen's content,
   * and that silence is reserved for a confirmed-clean read.
   */
  it("renders nothing at all when the check came back clean", () => {
    renderDatabase({ schemaState: { warning: null, settled: true } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders nothing before the first check settles, rather than a premature verdict", () => {
    renderDatabase({ schemaState: { warning: null, settled: false } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces a diverged database as an alert carrying both the headline and the explanation", () => {
    renderDatabase({
      schemaState: {
        warning: {
          tone: "error",
          title: "Your database does not match the software running this site",
          body: "This site's data was set up by a different version of the software than the one running now. Saving changes may not work correctly. Check with whoever manages this site before making further changes.",
        },
      },
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Your database does not match the software running this site");
    expect(alert).toHaveTextContent("Saving changes may not work correctly.");
  });

  it("carries the error tone's class for a diverged database and the warning tone's class otherwise", () => {
    renderDatabase({ schemaState: { warning: { tone: "error", title: "T", body: "B" } } });
    expect(screen.getByRole("alert").className).toContain("error");

    cleanup();
    renderDatabase({ schemaState: { warning: { tone: "warning", title: "T", body: "B" } } });
    expect(screen.getByRole("alert").className).toContain("warning");
  });

  it("shows the could-not-check warning too — an unanswered check is never silent", () => {
    renderDatabase({
      schemaState: {
        warning: {
          tone: "warning",
          title: "We could not check your database",
          body: "This check did not finish, so we cannot tell whether your database is up to date. Try reloading the page.",
        },
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("We could not check your database");
  });

  it("puts the banner before the tab bar, so it is read before the content it is a warning about", () => {
    renderDatabase({ schemaState: { warning: { tone: "error", title: "Something is wrong", body: "Details here." } } });

    const alert = screen.getByRole("alert");
    const tabBar = screen.getByRole("tablist", { name: "Database" });
    expect(alert.compareDocumentPosition(tabBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("routes its copy through the section's own bound translator", () => {
    const translate = vi.fn((key: string) => (key === "Shout" ? "TRANSLATED" : key));
    renderDatabase({
      schemaState: { warning: { tone: "warning", title: "Shout", body: "Body" }, t: translate },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("TRANSLATED");
    expect(translate).toHaveBeenCalledWith("Shout");
  });
});
