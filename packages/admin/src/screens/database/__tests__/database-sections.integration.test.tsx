// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchQueryEnvironmentPort } from "@jini-ai/core/fetch";
import {
  FetchQueryProvider, useCachedLoader, useCursorPages, useFetchMutation, useFetchQuery, useInvalidate,
} from "@jini-ai/ui/fetch-query";

import type { AdminLedgerRow, AdminSchemaState } from "../../../core/index.js";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { Database } from "../Database.js";
import type { MigrateForwardSectionPort } from "../hooks/migrate-forward-section-port.hooks.js";
import type { TimelineSectionPort } from "../hooks/timeline-section-port.hooks.js";
import { useMigrateForwardSection } from "../hooks/use-migrate-forward-section.hooks.js";
import { useSchemaStateSection } from "../hooks/use-schema-state-section.hooks.js";
import { navigateToRecoveryWithDeepLink, useTimelineSection } from "../hooks/use-timeline-section.hooks.js";

const environment: FetchQueryEnvironmentPort = {
  isOnline: () => true,
  subscribeOnline: () => () => {},
  subscribeFocus: () => () => {},
};
const kit = fakeAdminKit({ query: { useFetchQuery, useFetchMutation, useInvalidate, useCachedLoader } });
function Providers({ children }: { children: ReactNode }) {
  return (
    <FetchQueryProvider environment={environment}>
      <AdminKitProvider kit={kit}>{children}</AdminKitProvider>
    </FetchQueryProvider>
  );
}

const host = { useLocale: () => "es", describeError: ({ fallback }: { fallback: string }) => fallback, useCursorPages };
const enHost = { ...host, useLocale: () => "en" };
const clean: AdminSchemaState = { status: "in-sync", siteMeta: { version: 2, tag: "v2" }, runtime: { version: 2, tag: "v2" } };
const behind: AdminSchemaState = { ...clean, status: "behind", siteMeta: { version: 1, tag: "v1" } };
const first: AdminLedgerRow = { id: "ddl-1", kind: "plugin.ddl", outcome: "queued", createdAt: "2026-08-05T06:00:00Z", restorePointId: null };
const filtered: AdminLedgerRow = { ...first, id: "migration-1", kind: "core.migration", outcome: "checked" };
const next: AdminLedgerRow = { ...filtered, id: "migration-2", outcome: "committed" };
const criteria = { kind: "core.migration", outcome: "checked", fromDate: "2026-08-01", toDate: "2026-08-05" };
const noFilters = { kind: undefined, outcome: undefined, fromDate: undefined, toDate: undefined, cursor: undefined };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function migrationPort() {
  return {
    planMigrateForward: vi.fn<MigrateForwardSectionPort["planMigrateForward"]>().mockResolvedValue({
      planId: "plan-3", planHash: "digest-8", details: { migration: "v2" },
    }),
    confirmMigrateForward: vi.fn<MigrateForwardSectionPort["confirmMigrateForward"]>().mockResolvedValue({ confirmationToken: "execute-43" }),
    executeMigrateForward: vi.fn<MigrateForwardSectionPort["executeMigrateForward"]>().mockResolvedValue({ migrated: true }),
  };
}

function renderMigration(port = migrationPort()) {
  const getDatabaseSchemaState = vi.fn<() => Promise<AdminSchemaState>>().mockResolvedValueOnce(behind).mockResolvedValue(clean);
  const getDatabaseTimeline = vi.fn<TimelineSectionPort["getDatabaseTimeline"]>()
    .mockResolvedValueOnce({ items: [first], nextCursor: null })
    .mockResolvedValue({ items: [next], nextCursor: null });
  const { result } = renderHook(() => ({
    migration: useMigrateForwardSection({ port, host }),
    schema: useSchemaStateSection({ port: { getDatabaseSchemaState }, host }),
    timeline: useTimelineSection({ port: { getDatabaseTimeline }, host }),
  }), { wrapper: Providers });
  return { result, port, getDatabaseSchemaState, getDatabaseTimeline };
}

const noWarning = "We could not check your database";
const envelopeKey = "recovery-deep-link-envelope";

afterEach(() => {
  cleanup();
  sessionStorage.removeItem(envelopeKey);
});

describe("database migration ceremony", () => {
  it("does not confirm or execute before credentials exist, then refreshes both reads only after execute", async () => {
    const { result, port, getDatabaseSchemaState, getDatabaseTimeline } = renderMigration();
    await waitFor(() => {
      expect(result.current.timeline.rows).toStrictEqual([first]);
      expect(result.current.schema.warning?.title).toBe("Your database is out of date");
    });
    expect(result.current.migration).toMatchObject({ step: "idle", plan: null, confirmationToken: null, busy: false, done: false, error: null });
    expect(result.current.migration.t("Plan migration")).toBe("Planificar migración");
    await act(async () => {
      await result.current.migration.doConfirm();
      await result.current.migration.doExecute();
    });
    expect(port.confirmMigrateForward).not.toHaveBeenCalled();
    expect(port.executeMigrateForward).not.toHaveBeenCalled();

    const plan = deferred<Awaited<ReturnType<MigrateForwardSectionPort["planMigrateForward"]>>>();
    port.planMigrateForward.mockReturnValueOnce(plan.promise);
    act(() => { void result.current.migration.startPlan(); });
    expect(result.current.migration).toMatchObject({ step: "idle", busy: true, plan: null });
    await act(async () => { plan.resolve({ planId: "plan-3", planHash: "digest-8", details: null }); });
    expect(result.current.migration).toMatchObject({ step: "planned", busy: false, plan: { planId: "plan-3", planHash: "digest-8" } });
    await act(async () => { await result.current.migration.doExecute(); });
    expect(port.executeMigrateForward).not.toHaveBeenCalled();

    const confirm = deferred<{ confirmationToken: string }>();
    port.confirmMigrateForward.mockReturnValueOnce(confirm.promise);
    act(() => { void result.current.migration.doConfirm(); });
    expect(result.current.migration).toMatchObject({ step: "planned", busy: true, confirmationToken: null });
    await act(async () => { confirm.resolve({ confirmationToken: "execute-43" }); });
    expect(port.confirmMigrateForward.mock.calls).toStrictEqual([[{ planId: "plan-3", planHash: "digest-8" }]]);
    expect(result.current.migration).toMatchObject({ step: "confirmed", busy: false, confirmationToken: "execute-43", done: false });
    expect(getDatabaseSchemaState).toHaveBeenCalledTimes(1);
    expect(getDatabaseTimeline).toHaveBeenCalledTimes(1);

    const execute = deferred<{ migrated: true }>();
    port.executeMigrateForward.mockReturnValueOnce(execute.promise);
    act(() => { void result.current.migration.doExecute(); });
    expect(result.current.migration).toMatchObject({ step: "confirmed", busy: true, done: false });
    await act(async () => { execute.resolve({ migrated: true }); });
    expect(port.executeMigrateForward.mock.calls).toStrictEqual([[{ confirmationToken: "execute-43" }]]);
    expect(result.current.migration).toMatchObject({ step: "done", busy: false, done: true, error: null });
    await waitFor(() => {
      expect(result.current.schema.warning).toBeNull();
      expect(result.current.timeline.rows).toStrictEqual([next]);
    });
    expect(getDatabaseSchemaState).toHaveBeenCalledTimes(2);
    expect(getDatabaseTimeline).toHaveBeenCalledTimes(2);

    act(() => result.current.migration.reset());
    expect(result.current.migration).toMatchObject({ step: "idle", plan: null, confirmationToken: null, done: false, error: null });
  });

  it("surfaces a rejected plan in the host locale without opening confirmation, then clears it on reset", async () => {
    const { result, port } = renderMigration();
    port.planMigrateForward.mockRejectedValueOnce(new Error("raw plan failure"));
    await act(async () => { await result.current.migration.startPlan(); });
    expect(result.current.migration).toMatchObject({
      step: "idle", plan: null, busy: false, error: "No se pudo planificar la migración hacia adelante",
    });
    act(() => result.current.migration.reset());
    expect(result.current.migration.error).toBeNull();
    await act(async () => { await result.current.migration.startPlan(); });
    expect(result.current.migration).toMatchObject({ step: "planned", error: null, plan: { planId: "plan-3", planHash: "digest-8" } });
  });

  it("leaves a rejected confirmation at the same plan and succeeds on retry without replanning", async () => {
    const { result, port } = renderMigration();
    port.confirmMigrateForward.mockRejectedValueOnce(new Error("raw confirm failure"));
    await act(async () => { await result.current.migration.startPlan(); });
    await act(async () => { await result.current.migration.doConfirm(); });
    expect(result.current.migration).toMatchObject({
      step: "planned", plan: { planId: "plan-3", planHash: "digest-8" }, confirmationToken: null,
      error: "No se pudo confirmar la migración hacia adelante",
    });
    await act(async () => { await result.current.migration.doConfirm(); });
    expect(result.current.migration).toMatchObject({ step: "confirmed", confirmationToken: "execute-43", error: null });
    expect(port.planMigrateForward).toHaveBeenCalledTimes(1);
    expect(port.confirmMigrateForward.mock.calls).toStrictEqual([
      [{ planId: "plan-3", planHash: "digest-8" }], [{ planId: "plan-3", planHash: "digest-8" }],
    ]);
  });

  it("re-reads drift and timeline even when execution's response is lost, without declaring success", async () => {
    const { result, port, getDatabaseSchemaState, getDatabaseTimeline } = renderMigration();
    await waitFor(() => {
      expect(result.current.timeline.rows).toStrictEqual([first]);
      expect(result.current.schema.warning?.title).toBe("Your database is out of date");
    });
    port.executeMigrateForward.mockRejectedValueOnce(new Error("connection dropped after committing"));
    await act(async () => { await result.current.migration.startPlan(); });
    await act(async () => { await result.current.migration.doConfirm(); });
    await act(async () => { await result.current.migration.doExecute(); });
    expect(result.current.migration).toMatchObject({
      step: "confirmed", done: false, busy: false, error: "No se pudo ejecutar la migración hacia adelante",
    });
    await waitFor(() => {
      expect(result.current.schema.warning).toBeNull();
      expect(result.current.timeline.rows).toStrictEqual([next]);
    });
    expect(getDatabaseSchemaState).toHaveBeenCalledTimes(2);
    expect(getDatabaseTimeline).toHaveBeenCalledTimes(2);
    act(() => result.current.migration.reset());
    expect(result.current.migration).toMatchObject({ step: "idle", confirmationToken: null, error: null });
  });
});

describe("database schema state", () => {
  it("distinguishes a still-pending check from a settled in-sync result", async () => {
    const initial = deferred<AdminSchemaState>();
    const getDatabaseSchemaState = vi.fn(() => initial.promise);
    const { result } = renderHook(() => useSchemaStateSection({ port: { getDatabaseSchemaState }, host }), { wrapper: Providers });
    expect(result.current).toMatchObject({ settled: false, warning: null });
    await act(async () => { initial.resolve(clean); });
    expect(result.current).toMatchObject({ settled: true, warning: null });
    expect(getDatabaseSchemaState.mock.calls).toStrictEqual([[]]);
  });

  it("replaces the prior clean verdict with localized uncertainty when the next read fails", async () => {
    const getDatabaseSchemaState = vi.fn<() => Promise<AdminSchemaState>>()
      .mockResolvedValueOnce(clean).mockRejectedValueOnce(new Error("ETIMEDOUT: shard-7"));
    const { result } = renderHook(() => ({
      section: useSchemaStateSection({ port: { getDatabaseSchemaState }, host }),
      invalidate: useInvalidate(),
    }), { wrapper: Providers });
    await waitFor(() => expect(result.current.section.settled).toBe(true));
    expect(result.current.section.warning).toBeNull();
    await act(async () => { result.current.invalidate({ key: ["database", "schema-state"] }); });
    expect(result.current.section).toMatchObject({
      settled: true,
      warning: {
        title: noWarning, tone: "warning",
        body: "This check did not finish, so we cannot tell whether your database is up to date. Try reloading the page.",
      },
    });
    expect(result.current.section.t(noWarning)).toBe("No pudimos comprobar tu base de datos");
    expect(getDatabaseSchemaState).toHaveBeenCalledTimes(2);
  });
});

function renderTimeline(getDatabaseTimeline: TimelineSectionPort["getDatabaseTimeline"]) {
  const useTimelineSectionHook = () => useTimelineSection({ port: { getDatabaseTimeline }, host: enHost });
  return render(
    <Database
      useAdminLocaleHook={enHost.useLocale}
      useTimelineSectionHook={useTimelineSectionHook}
      useSchemaStateSectionHook={() => useSchemaStateSection({ port: { getDatabaseSchemaState: async () => clean }, host: enHost })}
      useMigrateForwardSectionHook={() => { throw new Error("Inactive migration tab must not mount"); }}
      ServerLabel={({ value }) => <span>{value}</span>}
    />,
    { wrapper: Providers },
  );
}

describe("database timeline", () => {
  it("commits draft filters on submit, pages the committed result and stops at the final cursor", async () => {
    const second = deferred<{ items: AdminLedgerRow[]; nextCursor: string | null }>();
    const getDatabaseTimeline = vi.fn<TimelineSectionPort["getDatabaseTimeline"]>()
      .mockResolvedValueOnce({ items: [first], nextCursor: null })
      .mockResolvedValueOnce({ items: [filtered], nextCursor: "opaque/2+=" })
      .mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    renderTimeline(getDatabaseTimeline);
    expect(screen.getByText("Loading timeline…")).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "queued" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Kind"), criteria.kind);
    await user.type(screen.getByRole("textbox", { name: "Outcome" }), criteria.outcome);
    await user.type(screen.getByLabelText("From"), criteria.fromDate);
    await user.type(screen.getByLabelText("To"), criteria.toDate);
    expect(getDatabaseTimeline.mock.calls).toStrictEqual([[{}, { options: noFilters }]]);
    expect(screen.getByRole("cell", { name: "queued" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByRole("cell", { name: "checked" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "queued" })).toBeNull();
    expect(getDatabaseTimeline.mock.calls[1]).toStrictEqual([{}, { options: { ...criteria, cursor: undefined } }]);

    await user.type(screen.getByRole("textbox", { name: "Outcome" }), " draft");
    await user.click(await screen.findByRole("button", { name: "Load more" }));
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
    expect(getDatabaseTimeline.mock.calls.slice(2)).toStrictEqual([[{}, { options: { ...criteria, cursor: "opaque/2+=" } }]]);
    await act(async () => { second.resolve({ items: [next], nextCursor: null }); });
    expect(screen.getByRole("cell", { name: "checked" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "committed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("preserves the current rows and cursor after a failed later page, then retries successfully", async () => {
    const getDatabaseTimeline = vi.fn<TimelineSectionPort["getDatabaseTimeline"]>()
      .mockResolvedValueOnce({ items: [first], nextCursor: "next-17" })
      .mockRejectedValueOnce(new Error("raw host failure"))
      .mockResolvedValueOnce({ items: [next], nextCursor: null });
    const user = userEvent.setup();
    renderTimeline(getDatabaseTimeline);
    await user.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("failed to load the Database Timeline")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "queued" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("cell", { name: "committed" })).toBeInTheDocument();
    expect(screen.queryByText("failed to load the Database Timeline")).toBeNull();
    expect(getDatabaseTimeline.mock.calls.slice(1)).toStrictEqual([
      [{}, { options: { ...noFilters, cursor: "next-17" } }], [{}, { options: { ...noFilters, cursor: "next-17" } }],
    ]);
  });

  it("keeps a late page from the previous filter set out of newly filtered results", async () => {
    const oldPage = deferred<{ items: AdminLedgerRow[]; nextCursor: string | null }>();
    const getDatabaseTimeline = vi.fn<TimelineSectionPort["getDatabaseTimeline"]>()
      .mockResolvedValueOnce({ items: [first], nextCursor: "old-page-2" })
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce({ items: [filtered], nextCursor: null });
    const user = userEvent.setup();
    renderTimeline(getDatabaseTimeline);
    await user.click(await screen.findByRole("button", { name: "Load more" }));
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Kind"), "core.migration");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByRole("cell", { name: "checked" })).toBeInTheDocument();
    await act(async () => { oldPage.resolve({ items: [next], nextCursor: "old-page-3" }); });

    expect(screen.getByRole("cell", { name: "checked" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "queued" })).toBeNull();
    expect(screen.queryByRole("cell", { name: "committed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(getDatabaseTimeline.mock.calls).toStrictEqual([
      [{}, { options: noFilters }],
      [{}, { options: { ...noFilters, cursor: "old-page-2" } }],
      [{}, { options: { ...noFilters, kind: "core.migration" } }],
    ]);
  });

  it("stashes the selected Recovery envelope before navigation without putting it in the route", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-08-20T06:20:30.000Z"));
      const row: AdminLedgerRow = { ...filtered, restorePointId: "rp-93" };
      const handoffs: Array<{ routePath: string; stored: string | null }> = [];
      navigateToRecoveryWithDeepLink({ row, navigate: ({ routePath }) => {
        handoffs.push({ routePath, stored: sessionStorage.getItem(envelopeKey) });
      } });
      expect(handoffs.map(({ routePath }) => routePath)).toStrictEqual(["/recovery"]);
      expect(JSON.parse(handoffs[0]?.stored ?? "null")).toStrictEqual({
        v: 1, correlationId: "database-timeline-migration-1", siteId: "workspace-local",
        ledgerEventId: "migration-1", restorePointId: "rp-93", drift: "core.migration", intent: "view",
        issuedAt: "2026-08-20T06:20:30.000Z",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not navigate or overwrite a pending Recovery handoff for a row without a restore point", () => {
    const navigate = vi.fn();
    sessionStorage.setItem(envelopeKey, '{"restorePointId":"earlier-selection"}');
    navigateToRecoveryWithDeepLink({ row: first, navigate });
    expect(navigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(envelopeKey)).toBe('{"restorePointId":"earlier-selection"}');
  });
});
