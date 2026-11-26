import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { bindStaticExport } from "../hooks/use-static-export.hooks.js";
import type { ExportRunSnapshot } from "@jini-ai/core/contracts/site/export-run";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const idle: ExportRunSnapshot = { status: "idle", startedAtIso: null, finishedAtIso: null, outputDir: null };
const running: ExportRunSnapshot = { ...idle, status: "running" };
const completed: ExportRunSnapshot = { ...idle, status: "completed", ok: true };

function binding(port: Parameters<typeof bindStaticExport>[0]["deps"]["port"]) {
  return bindStaticExport({
    hooks: {
      useLocaleHook: () => "en", useContentRefreshSubscription: () => {},
      useFetchQuery: () => ({ data: undefined, error: null, status: "loading", isFetching: true, refetch: () => {} }),
    },
    deps: {
      port, translate: ({ key }) => key,
      describeApiError: ({ e }) => String(e),
      exportLoadErrorMessage: ({ error }) => error,
      exportPollErrorMessage: ({ error }) => error,
      exportTriggerErrorMessage: ({ error }) => error,
      setTimeout, clearTimeout,
    },
  });
}

test("export refusal keeps clean false and surfaces the trigger error", async () => {
  const triggerSiteExport = vi.fn(async () => { throw new Error("output directory is not empty"); });
  const useExport = binding({ triggerSiteExport, getSiteExportStatus: async () => idle });
  const { result } = renderHook(() => useExport({}));
  await act(() => result.current.trigger());
  expect(triggerSiteExport).toHaveBeenCalledWith({}, { options: { clean: false } });
  expect(result.current.clean).toBe(false);
  expect(result.current.triggerError).toContain("output directory is not empty");
  expect(result.current.isRunning).toBe(false);
});

test("export reports progress and cancels its timer when unmounted", async () => {
  vi.useFakeTimers();
  const getSiteExportStatus = vi.fn(async () => completed);
  const useExport = binding({ triggerSiteExport: async () => running, getSiteExportStatus });
  const mounted = renderHook(() => useExport({}));
  await act(() => mounted.result.current.trigger());
  expect(mounted.result.current.isRunning).toBe(true);
  expect(vi.getTimerCount()).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(1500));
  expect(mounted.result.current.run).toEqual(completed);
  expect(mounted.result.current.isRunning).toBe(false);
  await act(() => mounted.result.current.trigger());
  expect(vi.getTimerCount()).toBe(1);
  mounted.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
