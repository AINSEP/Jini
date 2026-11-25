// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSiteKeyRecovery, type SiteKeyRecoveryPort } from "../use-site-key-recovery.hooks.js";

afterEach(cleanup);

it("loads the affected-resource preview and writes only after exact START FRESH", async () => {
  const preview = { removes: 2, affectedWebhooks: [{ label: "News", targetUrl: "https://example.com/hooks" }], detail: "Removes two credentials and changes News signing secret.", runtimeMode: "local" as const };
  const port: SiteKeyRecoveryPort = {
    importSiteKey: vi.fn(), previewStartFresh: vi.fn(async () => preview),
    startFresh: vi.fn<SiteKeyRecoveryPort["startFresh"]>(async () => ({ outcome: "started-fresh", fingerprint: "new", keyFilePath: "/keys/site-key", discarded: 2, kept: 0,
      restorePointId: "restore-1", affectedWebhooks: preview.affectedWebhooks, runtimeMode: "local" })),
  };
  const { result } = renderHook(() => useSiteKeyRecovery({
    port, t: key => key, onRecovered: undefined, describeApiError: ({ fallback }) => fallback,
    readApiRefusal: () => null, copy: { unknownError: "unknown error" },
  }));
  await act(async () => { await result.current.openStartFresh(); });
  expect(port.previewStartFresh).toHaveBeenCalledTimes(1);
  expect(result.current.startFreshStep).toBe("confirm");
  expect(result.current.preview).toEqual(preview);
  expect(port.startFresh).toHaveBeenCalledTimes(0);
  act(() => result.current.setConfirmText("start fresh"));
  await act(async () => { await result.current.startFresh(); });
  expect(port.startFresh).toHaveBeenCalledTimes(0);
  act(() => result.current.setConfirmText("START FRESH"));
  await act(async () => { await result.current.startFresh(); });
  expect(port.startFresh).toHaveBeenCalledExactlyOnceWith({ confirm: "START FRESH" });
});
