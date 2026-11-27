// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useRestoreFlow } from "../use-restore-flow.hooks.js";
import type { RestoreFlowPort } from "../restore-flow-port.hooks.js";
import type { AdminDisclosureResult, AdminRestorePoint } from "../../../core/index.js";

const original: AdminRestorePoint = {
  id: "before-import", trigger: "manual", costClass: "cheap", kind: "full",
  watermarkAtCapture: 27, createdAt: "2026-08-05T14:00:00Z",
};
const next = { ...original, id: "after-import", watermarkAtCapture: 81 };
const disclosure: AdminDisclosureResult = { partial: true, watermarkBaselineAvailable: true, counts: { posts_pages: 54 } };
const host = { useLocale: () => "en", describeError: ({ fallback }: { fallback: string }) => fallback };

function fixture() {
  const computeRecoveryDisclosure = vi.fn<RestoreFlowPort["computeRecoveryDisclosure"]>(async () => disclosure);
  const planRestore = vi.fn<RestoreFlowPort["planRestore"]>(async () => ({ planId: "plan-31", planHash: "plan-hash-7", details: {} }));
  const confirmRestore = vi.fn<RestoreFlowPort["confirmRestore"]>(async () => ({ confirmationToken: "confirm-91" }));
  const executeRestore = vi.fn<RestoreFlowPort["executeRestore"]>(async () => ({ restoreRunId: "run-6", state: "completed", restartRequired: true }));
  const port = { computeRecoveryDisclosure, planRestore, confirmRestore, executeRestore };
  return { port, ...renderHook(({ point }) => useRestoreFlow({ point, host, port }), { initialProps: { point: original } }) };
}

it("uses the server-issued plan and confirmation, shows restart requirement, and resets for another point", async () => {
  const { result, rerender, port } = fixture();
  await waitFor(() => expect(result.current.disclosure).toEqual(disclosure));
  expect(port.computeRecoveryDisclosure.mock.calls).toEqual([[{ restorePointId: "before-import" }]]);
  await act(() => result.current.doConfirm());
  await act(() => result.current.doExecute());
  expect(port.confirmRestore.mock.calls).toEqual([]);
  expect(port.executeRestore.mock.calls).toEqual([]);

  await act(() => result.current.startPlan());
  expect(port.planRestore.mock.calls).toEqual([[{ restorePointId: "before-import" }]]);
  expect(result.current.step).toBe("planned");
  expect(result.current.plan).toEqual({ planId: "plan-31", planHash: "plan-hash-7" });
  act(() => result.current.setAcknowledged(true));
  await act(() => result.current.doConfirm());
  expect(port.confirmRestore.mock.calls).toEqual([[{ planId: "plan-31", planHash: "plan-hash-7", disclosureAcknowledged: true }]]);
  expect(result.current.step).toBe("confirmed");
  await act(() => result.current.doExecute());
  expect(port.executeRestore.mock.calls).toEqual([[{ confirmationToken: "confirm-91", restorePointId: "before-import" }]]);
  expect(result.current.step).toBe("done");
  expect(result.current.result).toEqual({ restoreRunId: "run-6", state: "completed", restartRequired: true });

  rerender({ point: next });
  expect(result.current).toMatchObject({ step: "idle", acknowledged: false, confirmationToken: null, plan: null, result: null });
  await act(() => result.current.doExecute());
  expect(port.executeRestore).toHaveBeenCalledTimes(1);
  expect(port.computeRecoveryDisclosure).toHaveBeenLastCalledWith({ restorePointId: "after-import" });
});

it("reports each failed ceremony step without advancing and permits retry", async () => {
  const { result, port } = fixture();
  const failure = new Error("port offline");
  await waitFor(() => expect(result.current.disclosure).toEqual(disclosure));
  port.planRestore.mockRejectedValueOnce(failure);
  await act(() => result.current.startPlan());
  expect(result.current).toMatchObject({ step: "idle", busy: false, ceremonyError: "Failed to plan the restore" });

  await act(() => result.current.startPlan());
  expect(result.current).toMatchObject({ step: "planned", busy: false, ceremonyError: null });
  port.confirmRestore.mockRejectedValueOnce(failure);
  await act(() => result.current.doConfirm());
  expect(port.confirmRestore.mock.calls).toEqual([[{ planId: "plan-31", planHash: "plan-hash-7", disclosureAcknowledged: false }]]);
  expect(result.current).toMatchObject({ step: "planned", busy: false, ceremonyError: "Failed to confirm the restore" });

  act(() => result.current.setAcknowledged(true));
  await act(() => result.current.doConfirm());
  expect(result.current).toMatchObject({ step: "confirmed", busy: false, ceremonyError: null });
  port.executeRestore.mockRejectedValueOnce(failure);
  await act(() => result.current.doExecute());
  expect(result.current).toMatchObject({ step: "confirmed", busy: false, result: null, ceremonyError: "Failed to execute the restore" });
  await act(() => result.current.doExecute());
  expect(result.current).toMatchObject({ step: "done", busy: false, ceremonyError: null });
});

it("reports a disclosure load failure without pretending there were no discarded writes", async () => {
  const failure = new Error("baseline not available");
  const port: RestoreFlowPort = {
    computeRecoveryDisclosure: async () => { throw failure; },
    planRestore: vi.fn(), confirmRestore: vi.fn(), executeRestore: vi.fn(),
  };
  const describeError = vi.fn(({ e, fallback }: { e: unknown; fallback: string }) => e === failure ? "Snapshot could not be read" : fallback);
  const { result } = renderHook(() => useRestoreFlow({ point: original, host: { ...host, describeError }, port }));
  await waitFor(() => expect(result.current.error).toBe("Snapshot could not be read"));
  expect(result.current.disclosure).toBeNull();
  expect(result.current.ceremonyError).toBeNull();
  expect(describeError.mock.calls).toEqual([[{ e: failure, fallback: "Failed to compute the discarded-write-window disclosure" }]]);
});

it("never displays another restore point's disclosure after switching points", async () => {
  let finishOld!: (value: AdminDisclosureResult) => void;
  const oldResponse = new Promise<AdminDisclosureResult>((resolve) => { finishOld = resolve; });
  const currentDisclosure: AdminDisclosureResult = { partial: true, watermarkBaselineAvailable: true, counts: { posts_pages: 2 } };
  const port: RestoreFlowPort = {
    computeRecoveryDisclosure: ({ restorePointId }) => {
      if (restorePointId === "before-import") return oldResponse;
      if (restorePointId === "after-import") return Promise.resolve(currentDisclosure);
      throw new Error("Unexpected restore point");
    },
    planRestore: vi.fn(), confirmRestore: vi.fn(), executeRestore: vi.fn(),
  };
  const { result, rerender } = renderHook(({ point }) => useRestoreFlow({ point, host, port }), { initialProps: { point: original } });
  rerender({ point: next });
  await waitFor(() => expect(result.current.disclosure).toEqual(currentDisclosure));

  await act(async () => { finishOld(disclosure); await oldResponse; });
  expect(result.current.disclosure).toEqual(currentDisclosure);
});
