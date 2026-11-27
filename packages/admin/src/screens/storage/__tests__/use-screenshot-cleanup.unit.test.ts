// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ScreenshotCleanupClient } from "../api/screenshot-cleanup-api.js";
import { useScreenshotCleanup } from "../hooks/use-screenshot-cleanup.hooks.js";

const PREVIEW = { previewToken: "t1", deadline: 1, count: 1, bytes: 3, items: ["2026-01-01/old.jpg"] };

describe("useScreenshotCleanup", () => {
  it("shows the preview before anything is deleted, then applies only that preview", async () => {
    const client: ScreenshotCleanupClient = { preview: vi.fn(async () => PREVIEW), apply: vi.fn(async () => ({ deleted: ["2026-01-01/old.jpg"], kept: [] })) };
    const { result } = renderHook(() => useScreenshotCleanup({ client, describeError: () => "x" }));
    await act(async () => { await result.current.confirm(); });
    expect(client.apply).not.toHaveBeenCalled();
    await act(async () => { await result.current.preview({ before: 5 }); });
    expect(result.current.state).toEqual({ status: "shown", preview: PREVIEW });
    expect(client.apply).not.toHaveBeenCalled();
    await act(async () => { await result.current.confirm(); });
    expect(client.apply).toHaveBeenCalledWith({ previewToken: "t1" });
    expect(result.current.state).toEqual({ status: "done", result: { deleted: ["2026-01-01/old.jpg"], kept: [] } });
  });

});

it("reports a refused apply, discards its grant and resets to idle", async () => {
  const refusal = new Error("Preview expired");
  const client: ScreenshotCleanupClient = { preview: vi.fn(async () => PREVIEW), apply: vi.fn().mockRejectedValue(refusal) };
  const describeError = vi.fn(({ error }: { error: unknown }) => error === refusal ? "Preview expired" : "Unexpected failure");
  const { result } = renderHook(() => useScreenshotCleanup({ client, describeError }));
  await act(async () => { await result.current.preview({ before: 80 }); });
  expect(result.current.state).toEqual({ status: "shown", preview: PREVIEW });
  await act(async () => { await result.current.confirm(); });
  expect(client.apply).toHaveBeenCalledExactlyOnceWith({ previewToken: "t1" });
  expect(describeError).toHaveBeenCalledExactlyOnceWith({ error: refusal });
  expect(result.current.state).toEqual({ status: "error", message: "Preview expired" });
  await act(async () => { await result.current.confirm(); });
  expect(client.apply).toHaveBeenCalledTimes(1);
  act(() => result.current.reset());
  expect(result.current.state).toEqual({ status: "idle" });
});
