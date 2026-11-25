// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Recovery, type RecoveryProps } from "../Recovery.js";

afterEach(cleanup);

it("keeps a direct restore tab with no selection on the prompt without mounting the restore hook", () => {
  const useRestoreFlowHook: RecoveryProps["useRestoreFlowHook"] = vi.fn(() => { throw new Error("must not mount without a point"); });
  const props: RecoveryProps = {
    tabId: "restore",
    useRecoveryHook: () => ({ status: { costClass: "cheap", banner: null }, points: [], error: null, creating: false,
      createRestorePoint: vi.fn(async () => {}), selected: null, setSelected: vi.fn(), t: key => key, locale: "en" }),
    useRecoveryNavigationHook: ({ tabId }) => ({ activeTabId: tabId ?? "restore-points", onTabChange: vi.fn(), onSelectPoint: vi.fn(), onBackFromFlow: vi.fn() }),
    useRestoreFlowHook, navigationPort: { navigate: vi.fn() }, dictionaries: {}, viewerTimeZone: "UTC",
    kit: { DataTable: () => <div>Restore points list</div>, I18nProvider: ({ children }) => <>{children}</>,
      SettingsDialogShell: ({ tabs, activeTabId }) => <>{tabs.find(tab => tab.id === activeTabId)?.panel}</> },
    ServerLabel: ({ value }) => <>{value}</>,
    copy: { t: ({ key }) => key, sinceDiscardMessage: () => "Writes since this point", discardCountLine: ({ count }) => `${count} writes`,
      baselineUnavailableMessage: () => "Unknown baseline", restorePlanReadyMessage: ({ planId }) => `Plan ${planId} ready`,
      restoreDoneMessage: () => "Done", categoryLabel: ({ category }) => category, costClassLabel: ({ costClass }) => costClass,
      isAssertiveRecoveryBanner: () => false, recoveryBannerTone: () => "", restoreButtonAccessibleName: () => "Restore point" },
  };
  render(<Recovery {...props} />);
  expect(screen.getByText("Select a restore point from the Restore points tab to begin.")).toBeTruthy();
  expect(screen.queryByText("Restore points list")).toBeNull();
  expect(useRestoreFlowHook).toHaveBeenCalledTimes(0);
});
