// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { FetchQueryProvider, useFetchQuery } from "@jini-ai/ui/fetch-query";
import type { ServerLogEntry } from "@jini-ai/core/contracts/site/platform-server-logs";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import type { AdminTelemetryTestResult } from "../api/observability-api.types.js";
import { useObservabilityStatus } from "../hooks/use-observability-status.hooks.js";
import { useQueriesTab, type QueriesIdentityPort } from "../hooks/use-queries-tab.hooks.js";
import { createFakeRecentServerErrorsPort } from "../hooks/recent-server-errors-dependencies.hooks.js";
import { useRecentServerErrors } from "../hooks/use-recent-server-errors.hooks.js";

afterEach(cleanup);
const kit = fakeAdminKit({ query: { useFetchQuery } });
function ObservabilityQueryHarness({ children }: { children: ReactNode }) {
  return <AdminKitProvider kit={kit}><FetchQueryProvider>{children}</FetchQueryProvider></AdminKitProvider>;
}
const wrapper = ObservabilityQueryHarness;
const t = (key: string) => key;
const describeError = ({ fallback }: { fallback: string }) => fallback;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

it("loads status once and refreshes after one in-flight diagnostic with no duplicate sends", async () => {
  const initial = { enabled: true, serviceName: "initial-worker" };
  const refreshed = { enabled: true, serviceName: "refreshed-worker" };
  const firstRead = deferred<typeof initial>();
  const test = deferred<AdminTelemetryTestResult>();
  const getObservabilityStatus = vi.fn(async () => refreshed).mockReturnValueOnce(firstRead.promise);
  const sendTestError = vi.fn(() => test.promise);
  const { result } = renderHook(() => useObservabilityStatus({ port: { getObservabilityStatus, sendTestError }, locale: "es", t, describeError }), { wrapper });
  expect(result.current.status).toBeNull();
  expect(result.current.error).toBeNull();
  expect(result.current.locale).toBe("es");
  expect(result.current.t).toBe(t);
  await act(async () => firstRead.resolve(initial));
  await waitFor(() => expect(result.current.status).toEqual(initial));
  expect(getObservabilityStatus).toHaveBeenCalledExactlyOnceWith();

  let pending: Promise<void> | undefined;
  act(() => { pending = result.current.sendTestError?.(); });
  expect(result.current.sendingTestError).toBe(true);
  expect(result.current.testResult).toBeNull();
  let duplicate: Promise<void> | undefined;
  act(() => { duplicate = result.current.sendTestError?.(); });
  expect(sendTestError).toHaveBeenCalledExactlyOnceWith();

  const report: AdminTelemetryTestResult = { providers: [{ providerId: "local-log", signals: ["error", "metric"] }] };
  await act(async () => { test.resolve(report); await Promise.all([pending, duplicate]); });
  expect(result.current.testResult).toEqual(report);
  expect(result.current.testError).toBeNull();
  expect(result.current.sendingTestError).toBe(false);
  await waitFor(() => expect(result.current.status).toEqual(refreshed));
  expect(getObservabilityStatus.mock.calls).toEqual([[], []]);
});

it("describes failed status and diagnostic calls separately and clears errors on retry", async () => {
  const readFailure = new Error("connection down");
  const sendFailure = new Error("diagnostic refused");
  const initial = { enabled: true, serviceName: "site-worker" };
  const getObservabilityStatus = vi.fn(async () => initial).mockRejectedValueOnce(readFailure);
  const report: AdminTelemetryTestResult = { providers: [{ providerId: "local-log", signals: ["error"] }] };
  const retry = deferred<AdminTelemetryTestResult>();
  const sendTestError = vi.fn(async () => report).mockRejectedValueOnce(sendFailure);
  const describe = vi.fn(({ fallback }: { fallback: string }) => `Shown: ${fallback}`);
  const { result } = renderHook(() => useObservabilityStatus({ port: { getObservabilityStatus, sendTestError }, locale: "es", t, describeError: describe }), { wrapper });

  await waitFor(() => expect(result.current.error).toBe("Shown: no se pudo cargar el estado de observabilidad"));
  expect(result.current.status).toBeNull();
  expect(describe).toHaveBeenCalledExactlyOnceWith({ e: readFailure, fallback: "no se pudo cargar el estado de observabilidad" });
  act(() => result.current.refresh?.());
  await waitFor(() => expect(result.current.status).toEqual(initial));
  expect(result.current.error).toBeNull();

  await act(async () => { await result.current.sendTestError?.(); });
  expect(result.current.testError).toBe("Shown: Failed to send test error");
  expect(result.current.testResult).toBeNull();
  expect(result.current.sendingTestError).toBe(false);
  expect(describe).toHaveBeenLastCalledWith({ e: sendFailure, fallback: "Failed to send test error" });
  expect(getObservabilityStatus.mock.calls).toEqual([[], []]);
  await act(async () => { await result.current.sendTestError?.(); });
  expect(result.current.testError).toBeNull();
  expect(result.current.testResult).toEqual(report);
  sendTestError.mockReturnValueOnce(retry.promise);
  let pending: Promise<void> | undefined;
  act(() => { pending = result.current.sendTestError?.(); });
  expect(result.current.testResult).toBeNull();
  expect(result.current.sendingTestError).toBe(true);
  const nextReport: AdminTelemetryTestResult = { providers: [{ providerId: "disk-log", signals: ["span"] }] };
  await act(async () => { retry.resolve(nextReport); await pending; });
  expect(result.current.testResult).toEqual(nextReport);
});

it("does not refresh or show a failure when the port has no diagnostic action", async () => {
  const status = { enabled: false, serviceName: null };
  const getObservabilityStatus = vi.fn(async () => status);
  const { result } = renderHook(() => useObservabilityStatus({ port: { getObservabilityStatus }, locale: "en", t, describeError }), { wrapper });
  await waitFor(() => expect(result.current.status).toEqual(status));
  await act(async () => { await result.current.sendTestError?.(); });
  expect(getObservabilityStatus).toHaveBeenCalledExactlyOnceWith();
  expect(result.current.testError).toBeNull();
  expect(result.current.sendingTestError).toBe(false);
});

it.each(["builtin", null] as const)("never reads identity for the %s adapter and keeps tools hidden", async (adapter) => {
  const me = vi.fn(async () => ({ effectivePermissions: ["*"] }));
  const { result } = renderHook(() => useQueriesTab({ adapter, port: { me } }), { wrapper });
  await act(async () => {});
  expect(me).not.toHaveBeenCalled();
  expect(result.current).toEqual({ visible: false, readOnly: true });
});

it.each([false, true])("shows the owner tab only after identity resolves (development=%s)", async (development) => {
  const identity = deferred<{ effectivePermissions: string[] }>();
  const me = vi.fn(() => identity.promise);
  const { result, rerender } = renderHook((adapter: Parameters<typeof useQueriesTab>[0]["adapter"]) => useQueriesTab({ adapter, port: { me } }, { development }), { wrapper, initialProps: "tanstack" as Parameters<typeof useQueriesTab>[0]["adapter"] });
  expect(result.current.visible).toBe(false);
  await act(async () => identity.resolve({ effectivePermissions: ["plugins:read", "*"] }));
  expect(me).toHaveBeenCalledExactlyOnceWith();
  await waitFor(() => expect(result.current).toEqual({ visible: true, readOnly: !development }));
  rerender("builtin");
  expect(result.current).toEqual({ visible: false, readOnly: !development });
  expect(me).toHaveBeenCalledTimes(1);
});

it.each(["scoped", "missing", "refused"] as const)("keeps TanStack tools hidden for a %s identity", async (kind) => {
  const me = vi.fn<QueriesIdentityPort["me"]>(async () => {
    if (kind === "refused") throw new Error("identity expired");
    return kind === "scoped" ? { effectivePermissions: ["plugins:*", "auth:me"] } : {};
  });
  const { result } = renderHook(() => useQueriesTab({ adapter: "tanstack", port: { me } }, {}), { wrapper });
  await act(async () => {});
  expect(me).toHaveBeenCalledExactlyOnceWith();
  expect(result.current).toEqual({ visible: false, readOnly: true });
});

it("requests only recent errors, groups repeats and uses the full latest message for clipboard", async () => {
  const path = "/home/jini/work/packages/site/run.ts:5:4";
  const before = "2026-10-08T17:01:00.000Z";
  const after = "2026-10-08T17:03:00.000Z";
  const message = `[queue] cannot save\n    at retry (${path})`;
  const entries: ServerLogEntry[] = [
    { seq: 1, level: "error", source: "daemon", at: before, message: "[queue] cannot save\n    at start (old.ts:1:1)" },
    { seq: 2, level: "error", source: "server", at: "bad timestamp", message: "cache unavailable" },
    { seq: 3, level: "error", source: "daemon", at: after, message },
  ];
  const logs = { entries, matched: 3, buffered: 8, truncated: false, capturing: true };
  const port = createFakeRecentServerErrorsPort({ logs, copyResult: false });
  const { result } = renderHook(() => useRecentServerErrors({ port, locale: "en-US", t, describeError }), { wrapper });
  expect(result.current.rows).toEqual([]);
  expect(result.current.logs).toBeNull();
  await waitFor(() => expect(result.current.logs).toEqual(logs));
  expect(port.queries).toEqual([{ level: "error", limit: 50 }]);
  expect(result.current.rows.map(({ at, firstAt, source, scope, summary, count }) => ({ at, firstAt, source, scope, summary, count }))).toEqual([
    { at: after, firstAt: before, source: "daemon", scope: "queue", summary: "cannot save", count: 2 },
    { at: "bad timestamp", firstAt: null, source: "server", scope: null, summary: "cache unavailable", count: 1 },
  ]);
  const repeat = result.current.rows.find((row) => row.scope === "queue")!;
  const single = result.current.rows.find((row) => row.source === "server")!;
  const localDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium" });
  expect(repeat.when).toBe(localDate.format(new Date(after)));
  expect(repeat.firstWhen).toBe(localDate.format(new Date(before)));
  expect(single.when).toBe("bad timestamp");
  expect(single.firstWhen).toBeNull();
  expect(repeat.segments).toContainEqual({ text: "packages/site/run.ts:5:4", fullPath: path });
  await expect(result.current.clipboard.copyText(repeat.copyText)).resolves.toBe(false);
  expect(port.copied).toEqual([`Time: ${after}\nSource: daemon\nOccurrences: 2 (first ${before}, last ${after})\nMessage:\n${message}`]);
  expect(result.current.loading).toBe(false);
});

it("reports a log failure and refreshes with the same filters", async () => {
  const fail = new Error("log access denied");
  const logs = { entries: [], matched: 0, buffered: 11, truncated: false, capturing: false };
  const retry = deferred<typeof logs>();
  const getServerLogs = vi.fn(() => retry.promise).mockRejectedValueOnce(fail);
  const describe = vi.fn(describeError);
  const { result } = renderHook(() => useRecentServerErrors({ port: { getServerLogs, copyText: async () => false }, locale: "es", t, describeError: describe }), { wrapper });
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.error).toBe("no se pudieron cargar los errores recientes del servidor"));
  expect(result.current.loading).toBe(false);
  expect(result.current.logs).toBeNull();
  expect(describe).toHaveBeenCalledExactlyOnceWith({ e: fail, fallback: "no se pudieron cargar los errores recientes del servidor" });
  act(() => result.current.refresh());
  // The second read is held in flight to prove the loading transition on refresh.
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(getServerLogs.mock.calls).toEqual([[{ level: "error", limit: 50 }], [{ level: "error", limit: 50 }]]));
  await act(async () => retry.resolve(logs));
  expect(result.current.logs).toEqual(logs);
  expect(result.current.error).toBeNull();
  expect(result.current.loading).toBe(false);
});
