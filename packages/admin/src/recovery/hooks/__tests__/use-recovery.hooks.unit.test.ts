// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { afterEach, expect, it, vi } from "vitest";
import { useRecovery, type RecoveryHost } from "../use-recovery.hooks.js";
import type { RecoveryPort } from "../recovery-port.hooks.js";
import type { AdminRestorePoint } from "../../../core/index.js";

const STORAGE_KEY = "recovery-deep-link-envelope";
const point: AdminRestorePoint = {
  id: "manual-7", trigger: "manual", costClass: "cheap", kind: "full", watermarkAtCapture: 47, createdAt: "2026-04-01T20:30:00Z",
};
const newer = { ...point, id: "manual-8", watermarkAtCapture: 51 };
const envelope = {
  v: 1, siteId: "site-9", correlationId: "corr-7", ledgerEventId: null, restorePointId: "untrusted",
  drift: "none", intent: "restore", issuedAt: "2026-04-02T09:00:00Z",
};
afterEach(() => sessionStorage.removeItem(STORAGE_KEY));

function fixture() {
  let items = [point];
  const getRecoveryStatus = vi.fn<RecoveryPort["getRecoveryStatus"]>(async () => ({ costClass: "cheap", banner: null }));
  const listRecoveryRestorePoints = vi.fn<RecoveryPort["listRecoveryRestorePoints"]>(async () => ({ items }));
  const resolveRecoveryDeepLink = vi.fn<RecoveryPort["resolveRecoveryDeepLink"]>(async () => ({
    found: true, restorePoint: { restorePointId: point.id, capturedAt: point.createdAt },
  }));
  const createRestorePoint = vi.fn<RecoveryPort["createRestorePoint"]>(async () => {
    items = [point, newer];
    return { restorePoint: { id: "manual-8", costClass: "cheap", kind: "full" } };
  });
  const navigate = vi.fn<RecoveryHost["navigate"]>();
  const reportError = vi.fn<RecoveryHost["reportError"]>();
  const describeError = vi.fn<RecoveryHost["describeError"]>(({ e, fallback }) => e instanceof Error ? e.message : fallback);
  const register = vi.fn<RecoveryHost["useContentRefreshSubscription"]>();
  const port = { getRecoveryStatus, listRecoveryRestorePoints, resolveRecoveryDeepLink, createRestorePoint };
  const host: RecoveryHost = { useLocale: () => "en", describeError, navigate, reportError, useContentRefreshSubscription: register };
  return { port, host, navigate, reportError, describeError, register, mount: () => renderHook(() => useRecovery({ host, port })) };
}

it("selects the server-resolved point, not the stashed id, without reusing the envelope on refresh", async () => {
  const { mount, port, navigate, register } = fixture();
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  const { result } = mount();
  await waitFor(() => expect(result.current.selected).toEqual(point));
  expect(result.current.status).toEqual({ costClass: "cheap", banner: null });
  expect(result.current.points).toEqual([point]);
  expect(result.current.t("Restore…")).toBe("Restore…");
  expect(port.resolveRecoveryDeepLink.mock.calls).toEqual([[envelope]]);
  expect(navigate.mock.calls).toEqual([[{ routePath: "/recovery?tab=restore" }, { replace: true }]]);
  expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();

  const refresh = register.mock.lastCall![0];
  expect(refresh.resource).toBe("recovery");
  act(() => refresh.onRefresh());
  await waitFor(() => expect(port.listRecoveryRestorePoints).toHaveBeenCalledTimes(2));
  expect(result.current.selected).toEqual(point);
  expect(port.resolveRecoveryDeepLink.mock.calls).toEqual([[envelope]]);
});

it.each(["malformed", "pruned", "unlisted", "refused"] as const)("keeps the list open when a deep link is %s", async (scenario) => {
  const { mount, port, navigate } = fixture();
  sessionStorage.setItem(STORAGE_KEY, scenario === "malformed" ? "{" : JSON.stringify(envelope));
  if (scenario === "pruned") port.resolveRecoveryDeepLink.mockResolvedValueOnce({ found: false, restorePoint: null });
  if (scenario === "unlisted") port.resolveRecoveryDeepLink.mockResolvedValueOnce({ found: true, restorePoint: { restorePointId: "not-listed", capturedAt: point.createdAt } });
  if (scenario === "refused") port.resolveRecoveryDeepLink.mockRejectedValueOnce(new Error("verification unavailable"));
  const { result } = mount();
  await waitFor(() => expect(result.current.points).toEqual([point]));
  expect(result.current.selected).toBeNull();
  expect(result.current.error).toBeNull();
  expect(navigate.mock.calls).toEqual([]);
  expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(port.resolveRecoveryDeepLink.mock.calls).toEqual(scenario === "malformed" ? [] : [[envelope]]);
});

it("surfaces failure to apply a verified link through the injected router", async () => {
  const { mount, reportError, navigate } = fixture();
  const error = new Error("router unavailable");
  navigate.mockImplementationOnce(() => { throw error; });
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  const { result } = mount();
  await waitFor(() => expect(result.current.error).toBe("Failed to open recovery link"));
  expect(reportError.mock.calls).toEqual([[{ message: "[recovery] Could not apply the recovery link", error }]]);
});

it("distinguishes overview load failure from a rejected capture and refreshes on a successful retry", async () => {
  const { mount, port, register, describeError } = fixture();
  const loadError = new Error("status unavailable");
  const captureError = new Error("capture refused");
  port.getRecoveryStatus.mockRejectedValueOnce(loadError);
  port.createRestorePoint.mockRejectedValueOnce(captureError);
  const { result } = mount();
  await waitFor(() => expect(result.current.error).toBe("status unavailable"));
  expect(result.current.points).toBeNull();
  expect(describeError).toHaveBeenCalledWith({ e: loadError, fallback: "failed to load Recovery" });

  act(() => register.mock.lastCall![0].onRefresh());
  await waitFor(() => expect(result.current.points).toEqual([point]));
  await act(() => result.current.createRestorePoint());
  expect(result.current).toMatchObject({ error: "capture refused", creating: false, points: [point] });
  expect(describeError).toHaveBeenCalledWith({ e: captureError, fallback: "Failed to create restore point" });

  act(() => result.current.setSelected(point));
  await act(() => result.current.createRestorePoint());
  expect(port.createRestorePoint.mock.calls).toEqual([
    [{}, { trigger: "manual", costAck: true }],
    [{}, { trigger: "manual", costAck: true }],
  ]);
  expect(result.current).toMatchObject({ error: null, creating: false, points: [point, newer], selected: point });
});
