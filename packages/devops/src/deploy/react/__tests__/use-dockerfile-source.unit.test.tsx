// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import { afterEach, expect, it, vi } from "vitest";
import { useDockerfileSource } from "../hooks/use-dockerfile-source.hooks.js";

type Input = Parameters<typeof useDockerfileSource>[0];
const initial = { exists: true, contents: "FROM scratch", etag: '"initial"' };
const describeFailure: Input["describeFailure"] = ({ error, locale, operation }) => `${locale} ${operation}: ${String(error)}`;

function fixture(overrides: Partial<Input> = {}) {
  const setDockerfileSource = vi.fn<Input["port"]["setDockerfileSource"]>();
  const getDockerfileSource = vi.fn<Input["port"]["getDockerfileSource"]>();
  const useFetchMutationHook: FetchQueryAdapter["useFetchMutation"] = ({ run }) => {
    const [error, setError] = useState<Error | null>(null);
    return { status: error ? "error" : "idle", error, reset: () => setError(null), mutate: async input => {
      try { return await run(input); } catch (err) { setError(err instanceof Error ? err : new Error(String(err))); throw err; }
    } };
  };
  const input: Input = {
    port: { getDockerfileSource, setDockerfileSource }, t: key => key, locale: "en", describeFailure,
    useFetchQueryHook: <T,>() => ({ data: initial as T, error: null, status: "success" as const, isFetching: false, refetch: () => {} }),
    useFetchMutationHook, useDirtyGuardHook: ({ original, current }) => ({ isDirty: original !== null && original !== current }),
    writeClipboard: async () => { throw new Error("unexpected clipboard write"); },
    readSaveConflict: ({ error }) => error instanceof Error && error.message === "stale" ? { exists: true, contents: "FROM remote" } : null,
    ...overrides,
  };
  return { input, setDockerfileSource, getDockerfileSource };
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("an empty draft cannot be copied, and only a successful copy starts the confirmation timer", async () => {
  vi.useFakeTimers();
  const writeClipboard = vi.fn<Input["writeClipboard"]>()
    .mockRejectedValueOnce(new Error("clipboard permission denied")).mockResolvedValueOnce(undefined);
  const { input } = fixture({ writeClipboard,
    useFetchQueryHook: <T,>() => ({ data: { exists: false, contents: null, etag: 'W/"missing"' } as T,
      status: "success" as const, error: null, isFetching: false, refetch: () => {} }),
  });
  const { result } = renderHook(() => useDockerfileSource(input));
  await act(() => result.current.copy());
  expect(writeClipboard).not.toHaveBeenCalled();
  expect(result.current.copied).toBe(false);
  act(() => result.current.setDraft("FROM custom"));
  await act(() => result.current.copy());
  expect(result.current.copied).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  await act(() => result.current.copy());
  expect(result.current.copied).toBe(true);
  expect(writeClipboard.mock.calls).toEqual([[{ contents: "FROM custom" }], [{ contents: "FROM custom" }]]);
  act(() => vi.advanceTimersByTime(1499));
  expect(result.current.copied).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.copied).toBe(false);
});

it("load and save failures describe the correct operation and a failed reload retains the conflict", async () => {
  const { input, setDockerfileSource, getDockerfileSource } = fixture({
    useFetchQueryHook: <T,>() => ({ data: initial as T, status: "success" as const, error: new Error("refresh unavailable"), isFetching: false, refetch: () => {} }),
  });
  const { result } = renderHook(() => useDockerfileSource(input));
  expect(result.current.error).toBe("en load: Error: refresh unavailable");
  expect(result.current.draft).toBe("FROM scratch");
  act(() => result.current.setDraft("FROM local"));
  setDockerfileSource.mockRejectedValueOnce(new Error("disk full")).mockRejectedValueOnce(new Error("stale"));
  getDockerfileSource.mockRejectedValueOnce(new Error("refresh still unavailable"));
  await act(() => result.current.save());
  expect(result.current.saveError).toBe("en save: Error: disk full");
  expect(result.current.saveConflict).toBeNull();
  await act(() => result.current.save());
  expect(result.current.saveError).toBeNull();
  expect(result.current.saveConflict).toEqual({ exists: true, contents: "FROM remote" });
  await act(() => result.current.reloadAfterConflict());
  expect(result.current.saveConflict).toEqual({ exists: true, contents: "FROM remote" });
  expect(result.current.draft).toBe("FROM local");
  expect(result.current.snapshot).toEqual(initial);
  expect(getDockerfileSource).toHaveBeenCalledExactlyOnceWith();
  expect(setDockerfileSource.mock.calls).toEqual(Array.from({ length: 2 }, () => [{ contents: "FROM local", ifMatch: '"initial"' }]));
});
