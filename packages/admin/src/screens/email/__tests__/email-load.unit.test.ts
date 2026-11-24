// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLoad } from "../hooks/email-load.hooks.js";

/** Stand-in for the host's transport error class (message + HTTP status), injected as `ApiError`. */
class ApiError extends Error {
  readonly status: number;
  constructor({ message, status }: { message: string; status: number }) { super(message); this.status = status; }
}

/** @file Tab reads distinguish permission, transport failure and empty data, and discard stale reads. */
describe("useLoad", () => {
  it("starts loading, then keeps a successfully loaded empty list", async () => {
    const load = vi.fn(async () => ({ items: [] }));
    const { result } = renderHook(() => useLoad({ ApiError, load }));
    expect(result.current.view).toEqual({ kind: "loading" });
    await waitFor(() => expect(result.current.view).toEqual({ kind: "loaded", data: { items: [] } }));
  });

  it("shows forbidden for 403 instead of an empty list", async () => {
    const load = vi.fn(async () => { throw new ApiError({ message: "Forbidden", status: 403 }); });
    const { result } = renderHook(() => useLoad({ ApiError, load }));
    await waitFor(() => expect(result.current.view).toEqual({ kind: "forbidden" }));
  });

  it("keeps safe API errors and retries after a failure", async () => {
    const load = vi.fn<() => Promise<string[]>>().mockRejectedValueOnce(new ApiError({ message: "Try later", status: 503 })).mockResolvedValueOnce(["fresh"]);
    const { result } = renderHook(() => useLoad({ ApiError, load }));
    await waitFor(() => expect(result.current.view).toEqual({ kind: "error", message: "Try later" }));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.view).toEqual({ kind: "loaded", data: ["fresh"] }));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("uses the generic message rather than exposing a non-API exception", async () => {
    const load = vi.fn(async () => { throw new Error("private disk path and token"); });
    const { result } = renderHook(() => useLoad({ ApiError, load }));
    await waitFor(() => expect(result.current.view).toEqual({ kind: "error", message: "Something went wrong. Try again." }));
  });

  it("a superseded read cannot replace the new result", async () => {
    let resolveOld!: (data: string) => void;
    const oldLoad = vi.fn(() => new Promise<string>((resolve) => { resolveOld = resolve; }));
    const newLoad = vi.fn(async () => "new result");
    const { result, rerender } = renderHook(({ load }) => useLoad({ ApiError, load }), { initialProps: { load: oldLoad } });
    rerender({ load: newLoad });
    await waitFor(() => expect(result.current.view).toEqual({ kind: "loaded", data: "new result" }));
    await act(async () => resolveOld("old result"));
    expect(result.current.view).toEqual({ kind: "loaded", data: "new result" });
  });

});
