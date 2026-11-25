// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Recovery, type RecoveryProps } from "../Recovery.js";

afterEach(cleanup);

it("requires disclosure acknowledgement, a plan, confirmation, and an execution token", async () => {
  const point = { id: "restore-1", trigger: "manual", costClass: "cheap", kind: "snapshot", watermarkAtCapture: 1, createdAt: "2026-01-01T00:00:00Z" };
  const planned = vi.fn();
  const confirmed = vi.fn();
  const executed = vi.fn();
  let issueToken: (value: string) => void = () => {};
  const token = new Promise<string>(resolve => { issueToken = resolve; });
  const useRestoreFlowHook: RecoveryProps["useRestoreFlowHook"] = () => {
    const [acknowledged, setAcknowledged] = useState(false);
    const [step, setStep] = useState<ReturnType<RecoveryProps["useRestoreFlowHook"]>["step"]>("idle");
    const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
    return {
      disclosure: { partial: true, watermarkBaselineAvailable: true, counts: { posts: 2 } }, error: null,
      acknowledged, setAcknowledged, step, busy: false, ceremonyError: null,
      plan: step === "idle" ? null : { planId: "plan-1", planHash: "hash-1" }, confirmationToken, result: null,
      startPlan: async () => { planned(); setStep("planned"); },
      doConfirm: async () => { confirmed(); setStep("confirmed"); setConfirmationToken(await token); },
      doExecute: async () => { executed(confirmationToken); }, t: key => key, locale: "en",
    };
  };
  const props: RecoveryProps = {
    useRecoveryHook: () => ({ status: { costClass: "cheap", banner: null }, points: [point], error: null, creating: false,
      createRestorePoint: vi.fn(async () => {}), selected: point, setSelected: vi.fn(), t: key => key, locale: "en" }),
    useRecoveryNavigationHook: () => ({ activeTabId: "restore", onTabChange: vi.fn(), onSelectPoint: vi.fn(), onBackFromFlow: vi.fn() }),
    useRestoreFlowHook, navigationPort: { navigate: vi.fn() }, dictionaries: {}, viewerTimeZone: "UTC",
    kit: { DataTable: () => null, I18nProvider: ({ children }) => <>{children}</>,
      SettingsDialogShell: ({ tabs, activeTabId }) => <>{tabs.find(tab => tab.id === activeTabId)?.panel}</> },
    ServerLabel: ({ value }) => <>{value}</>,
    copy: { t: ({ key }) => key, sinceDiscardMessage: () => "Writes since this point", discardCountLine: ({ count }) => `${count} writes`,
      baselineUnavailableMessage: () => "Unknown baseline", restorePlanReadyMessage: ({ planId }) => `Plan ${planId} ready`,
      restoreDoneMessage: () => "Done", categoryLabel: ({ category }) => category, costClassLabel: ({ costClass }) => costClass,
      isAssertiveRecoveryBanner: () => false, recoveryBannerTone: () => "", restoreButtonAccessibleName: () => "Restore point" },
  };
  render(<Recovery {...props} />);
  const start = screen.getByRole("button", { name: "Continue to confirm" }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  fireEvent.click(start);
  expect(planned).toHaveBeenCalledTimes(0);
  expect(screen.queryByRole("button", { name: "Execute restore" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(start);
  expect(planned).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Plan plan-1 ready")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));
  expect(confirmed).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Execute restore" })).toBeNull();
  expect(executed).toHaveBeenCalledTimes(0);
  await act(async () => { issueToken("confirmed-token"); await token; });
  fireEvent.click(screen.getByRole("button", { name: "Execute restore" }));
  await waitFor(() => expect(executed).toHaveBeenCalledExactlyOnceWith("confirmed-token"));
});
