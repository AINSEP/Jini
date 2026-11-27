// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { Recovery, type RecoveryProps, type RestoreFlowProps } from "../Recovery.js";
import { RestoreFlowBody } from "../Recovery.restore-steps.js";

afterEach(cleanup);

const point: RestoreFlowProps["point"] = {
  id: "manual-1", trigger: "manual", costClass: "cheap", kind: "file-snapshot",
  watermarkAtCapture: 7, createdAt: "2026-11-20T00:00:00Z",
};
const unavailable = { ...point, id: "migration-2", trigger: "pre-migration", costClass: "unavailable" };
const copy: RecoveryProps["copy"] = {
  t: ({ key }) => key, sinceDiscardMessage: ({ createdAt }) => `Writes since ${createdAt}`,
  discardCountLine: ({ count, categoryLabelText }) => `${categoryLabelText}: ${count}`,
  baselineUnavailableMessage: () => "Write counts are unverified",
  restorePlanReadyMessage: ({ planId }) => `Plan ${planId} ready`,
  restoreDoneMessage: ({ restoreRunId, stateNode }) => <>Run {restoreRunId} ended with {stateNode}</>,
  categoryLabel: ({ category }) => category,
  costClassLabel: ({ costClass }) => `Cost: ${costClass}`,
  isAssertiveRecoveryBanner: banner => banner.kind === "migration-interrupted",
  recoveryBannerTone: banner => banner.kind === "migration-interrupted" ? "error" : "warning",
  restoreButtonAccessibleName: ({ locale, point, viewerTimeZone }) => `Restore ${point.createdAt} (${locale}, ${viewerTimeZone})`,
};

type Controller = ReturnType<RecoveryProps["useRestoreFlowHook"]>;
function restoreController(over: Partial<Controller> = {}): Controller {
  return {
    disclosure: null, error: null, acknowledged: false, setAcknowledged: vi.fn(), step: "idle", busy: false,
    ceremonyError: null, plan: null, confirmationToken: null, result: null,
    startPlan: vi.fn(async () => {}), doConfirm: vi.fn(async () => {}), doExecute: vi.fn(async () => {}),
    t: key => key, locale: "en", ...over,
  };
}

const kit: RecoveryProps["kit"] = {
  DataTable: ({ rows, rowKey, empty, columns }) => rows.length === 0 ? <>{empty}</> : (
    <table>
      <thead><tr>{columns.map(col => <th key={col.key}>{col.header}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) =>
        <tr key={rowKey(row, index)}>{columns.map(col => <td key={col.key}>{col.cell(row, index)}</td>)}</tr>
      )}</tbody>
    </table>
  ),
  I18nProvider: ({ children }) => <>{children}</>,
  SettingsDialogShell: ({ tabs, activeTabId, onActiveTabIdChange }) => <>
    <div role="tablist">{tabs.map(tab => (
      <button key={tab.id} role="tab" aria-selected={tab.id === activeTabId} onClick={() => onActiveTabIdChange(tab.id)}>{tab.label}</button>
    ))}</div>
    <div role="tabpanel">{tabs.find(tab => tab.id === activeTabId)?.panel}</div>
  </>,
};
const serverLabel: RecoveryProps["ServerLabel"] = ({ value }) => <>{value}</>;
type RecoveryController = ReturnType<RecoveryProps["useRecoveryHook"]>;
function recoveryProps(over: Partial<RecoveryController> = {}): RecoveryProps {
  const useRecoveryNavigationHook: RecoveryProps["useRecoveryNavigationHook"] = ({ setSelected }) => {
    const [activeTabId, onTabChange] = useState("restore-points");
    return { activeTabId, onTabChange, onSelectPoint: selected => { setSelected(selected); onTabChange("restore"); },
      onBackFromFlow: () => { setSelected(null); onTabChange("restore-points"); } };
  };
  return {
    useRecoveryHook: () => {
      const [selected, setSelected] = useState<RestoreFlowProps["point"] | null>(null);
      return { status: { costClass: "cheap", banner: null }, points: [], error: null, creating: false,
        selected, setSelected, createRestorePoint: async () => {}, t: key => key, locale: "en", ...over };
    },
    useRecoveryNavigationHook, useRestoreFlowHook: () => restoreController(),
    navigationPort: { navigate: vi.fn() }, kit, ServerLabel: serverLabel, dictionaries: {}, copy,
    viewerTimeZone: "America/Los_Angeles",
  };
}

async function click(element: HTMLElement) {
  await act(async () => { element.click(); });
}

it("shows a load failure before the initial list, then keeps a loaded list visible with a later error", () => {
  const { rerender } = render(<Recovery {...recoveryProps({ points: null, status: null })} />);
  expect(screen.getByText("Loading restore points…").textContent).toBe("Loading restore points…");
  expect(screen.queryByRole("tablist")).toBeNull();
  rerender(<Recovery {...recoveryProps({ points: null, error: "Storage could not open" })} />);
  expect(screen.getByText("Storage could not open").textContent).toBe("Storage could not open");
  expect(screen.queryByText("Loading restore points…")).toBeNull();
  rerender(<Recovery {...recoveryProps({ status: null })} />);
  expect(screen.getByText("Loading restore points…").textContent).toBe("Loading restore points…");
  rerender(<Recovery {...recoveryProps({ error: "Refresh failed" })} />);
  expect(screen.getByRole("heading", { name: "Recovery" }).textContent).toBe("Recovery");
  expect(screen.getByText("Refresh failed").textContent).toBe("Refresh failed");
  expect(within(screen.getByRole("tabpanel")).getByText("No restore points yet.").textContent).toBe("No restore points yet.");
});

it("the create action disables during capture and selects only a recoverable row", async () => {
  const createRestorePoint = vi.fn(async () => {});
  const useRestoreFlowHook = vi.fn<RecoveryProps["useRestoreFlowHook"]>(() => restoreController());
  const first = recoveryProps({ points: [unavailable, point], createRestorePoint });
  const { rerender } = render(<Recovery {...first} useRestoreFlowHook={useRestoreFlowHook} />);
  await click(screen.getByRole("button", { name: "Create restore point" }));
  expect(createRestorePoint.mock.calls).toEqual([[]]);
  rerender(<Recovery {...recoveryProps({ points: [unavailable, point], createRestorePoint, creating: true })} useRestoreFlowHook={useRestoreFlowHook} />);
  const creating = screen.getByRole("button", { name: "Creating…" }) as HTMLButtonElement;
  expect(creating.disabled).toBe(true);
  await click(creating);
  expect(createRestorePoint.mock.calls).toEqual([[]]);

  const blockedRow = screen.getByRole("row", { name: /pre-migration/ });
  expect(within(blockedRow).queryByRole("button")).toBeNull();
  expect(within(blockedRow).getByText("No restore-point mechanism available — see the runbook.").textContent).toMatch(/see the runbook/);
  const eligibleRow = screen.getByRole("row", { name: /manual/ });
  expect(within(eligibleRow).getByText("Cost: cheap").textContent).toBe("Cost: cheap");
  await click(within(eligibleRow).getByRole("button", { name: "Restore 2026-11-20T00:00:00Z (en, America/Los_Angeles)" }));
  expect(screen.getByRole("tab", { name: "Restore" }).getAttribute("aria-selected")).toBe("true");
  expect(useRestoreFlowHook.mock.calls).toEqual([[{ point }]]);
  await click(screen.getByRole("button", { name: "← Restore points" }));
  expect(screen.getByRole("tab", { name: "Restore points" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByRole("button", { name: "← Restore points" })).toBeNull();
});

it("pending migration links to Database, while an interrupted migration has an assertive unavailable action", () => {
  const { rerender } = render(<Recovery {...recoveryProps({ status: { costClass: "unavailable", banner: {
    kind: "pending-migration", actionKind: "deep-link-to-database-migration", accessibleText: "Pending schema migration",
  } } })} />);
  expect(screen.getByRole("link", { name: "Go to Database" }).getAttribute("href")).toBe("/admin/database");
  expect(screen.getByText("Pending schema migration").parentElement?.getAttribute("aria-live")).toBe("polite");
  expect(screen.queryByRole("alert")).toBeNull();
  rerender(<Recovery {...recoveryProps({ status: { costClass: "unavailable", banner: {
    kind: "migration-interrupted", actionKind: "unblock-interrupted-migration", accessibleText: "Interrupted schema migration",
  } } })} />);
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("Interrupted schema migration");
  expect(alert.getAttribute("aria-live")).toBe("assertive");
  expect((within(alert).getByRole("button", { name: "Unblock (not yet available)" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("link", { name: "Go to Database" })).toBeNull();
});

function flow(controller: Controller) {
  return <RestoreFlowBody point={point} onBack={vi.fn()} controller={controller}
    copy={copy} ServerLabel={serverLabel} viewerTimeZone="UTC" />;
}

it("disclosure distinguishes unknown from zero and exposes the baseline alarm only without a baseline", () => {
  const known = { partial: true, watermarkBaselineAvailable: true, counts: { posts: 0, pages: 4 } } as const;
  const { rerender } = render(flow(restoreController()));
  expect(screen.getByText("Computing the discarded-write-window disclosure…").textContent).toMatch(/Computing/);
  expect(screen.queryByRole("checkbox")).toBeNull();
  rerender(flow(restoreController({ disclosure: known, error: "Disclosure read failed", ceremonyError: "Planning refused" })));
  expect(screen.getByText("Disclosure read failed").textContent).toBe("Disclosure read failed");
  expect(screen.getByText("Planning refused").textContent).toBe("Planning refused");
  expect(screen.queryByRole("checkbox")).toBeNull();
  rerender(flow(restoreController({ disclosure: { ...known, watermarkBaselineAvailable: false, counts: { posts: "unknown", pages: "unknown" } } })));
  expect(screen.getByRole("alert").textContent).toBe("Write counts are unverified");
  expect(screen.getAllByRole("listitem").map(row => row.textContent)).toEqual(["posts: unknown", "pages: unknown"]);
  expect(screen.getByRole("checkbox", { name: /accept the loss window/ }).getAttribute("type")).toBe("checkbox");
  rerender(flow(restoreController({ disclosure: known })));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getAllByRole("listitem").map(row => row.textContent)).toEqual(["posts: 0", "pages: 4"]);
});

it.each([
  { step: "idle", label: "Planning…", action: "startPlan" },
  { step: "planned", label: "Confirming…", action: "doConfirm" },
  { step: "confirmed", label: "Restoring…", action: "doExecute" },
] as const)("a busy $step step names its progress and cannot dispatch its action again", async ({ step, label, action }) => {
  const callback = vi.fn(async () => {});
  render(flow(restoreController({ acknowledged: true, busy: true, step,
    plan: { planId: "plan-a", planHash: "hash-a" }, confirmationToken: "token-a", [action]: callback })));
  const button = screen.getByRole("button", { name: label }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  await click(button);
  expect(callback.mock.calls).toEqual([]);
});

it("only a concrete terminal result announces completion and a required restart", () => {
  const { rerender } = render(flow(restoreController({ step: "done" })));
  expect(screen.queryByRole("status")).toBeNull();
  const result = { restoreRunId: "run-14", state: "RESTORED" };
  rerender(flow(restoreController({ step: "done", result: { ...result, restartRequired: true } })));
  expect(screen.getByRole("status").textContent).toBe("Run run-14 ended with RESTORED");
  expect(screen.getByRole("alert").textContent).toContain("Restart the server now to pick up the restored data.");
  expect(screen.queryByRole("button", { name: "Execute restore" })).toBeNull();
  rerender(flow(restoreController({ step: "done", result })));
  expect(screen.getByRole("status").textContent).toBe("Run run-14 ended with RESTORED");
  expect(screen.queryByRole("alert")).toBeNull();
});
