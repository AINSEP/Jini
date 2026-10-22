import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useAsyncAction } from "../use-async-action.hooks";

/**
 * @file `useAsyncAction` — the shared `[saving, error]` mutation-tracking primitive extracted out
 * of `useUsers`/`useRoles`/`useTaxonomy`'s repeated `setXSaving(true); setXError(null); try {...}
 * catch { setXError(...) } finally { setXSaving(false) }` shape. See the source file's own header
 * for which call sites did and didn't adopt it, and why.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useAsyncAction — initial state", () => {
  it("starts idle: not saving, no error", () => {
    const { result } = renderHook(() => useAsyncAction());
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe("useAsyncAction — run, success", () => {
  it("flips saving true for the duration of the call and back to false after", async () => {
    const { result } = renderHook(() => useAsyncAction());
    const d = deferred<void>();

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run({ action: () => d.promise, describeError: () => "fallback" });
    });
    expect(result.current.saving).toBe(true);

    await act(async () => {
      d.resolve();
      await runPromise;
    });
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("runs the action's success-path side effects before saving flips back to false — same ordering the hand-rolled try/finally had", async () => {
    const { result } = renderHook(() => useAsyncAction());
    const order: string[] = [];

    const gate = deferred<void>();
    let settled = false;
    let savingAtEffect: boolean | undefined;
    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run({ action: async () => {
        await gate.promise;
        savingAtEffect = result.current.saving;
        order.push("action");
      }, describeError: () => "fallback" });
      void runPromise.then(() => { settled = true; });
    });
    try {
      await act(async () => { await Promise.resolve(); });
      expect(result.current.saving).toBe(true);
      expect(settled).toBe(false);
      expect(order).toEqual([]);
    } finally {
      await act(async () => { gate.resolve(); await runPromise; });
    }
    expect(savingAtEffect).toBe(true);
    expect(settled).toBe(true);
    expect(order).toEqual(["action"]);
    expect(result.current.saving).toBe(false);
  });
});

describe("useAsyncAction — run, failure", () => {
  it("describes the caught error via the given describeError and stops saving", async () => {
    const { result } = renderHook(() => useAsyncAction());

    await act(async () => {
      await result.current.run({ action: () => Promise.reject(new Error("boom")), describeError: (e) => `describable: ${e instanceof Error ? e.message : "?"}` }
      );
    });

    expect(result.current.error).toBe("describable: boom");
    expect(result.current.saving).toBe(false);
  });

  it("clears a PRIOR error at the start of a new run, before the new attempt settles", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run({ action: () => Promise.reject(new Error("first")), describeError: () => "first failed" });
    });
    expect(result.current.error).toBe("first failed");

    const d = deferred<void>();
    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run({ action: () => d.promise, describeError: () => "second failed" });
    });
    // Cleared immediately, not just once the second attempt itself settles — a stale error must
    // not sit next to a field the operator is now retrying.
    expect(result.current.error).toBeNull();

    await act(async () => {
      d.resolve();
      await runPromise;
    });
    expect(result.current.error).toBeNull();
  });

  it("a second, successful run clears the error from a first, failed run", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run({ action: () => Promise.reject(new Error("nope")), describeError: () => "failed" });
    });
    expect(result.current.error).toBe("failed");

    await act(async () => {
      await result.current.run({ action: () => Promise.resolve(), describeError: () => "unused" });
    });
    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
  });
});

describe("useAsyncAction — setError", () => {
  it("sets the error directly, outside of any run call", () => {
    const { result } = renderHook(() => useAsyncAction());
    act(() => result.current.setError("typed error"));
    expect(result.current.error).toBe("typed error");
  });

  it("clears the error directly — the openResetPassword-style 'reset before a fresh attempt' case", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run({ action: () => Promise.reject(new Error("x")), describeError: () => "failed" });
    });
    expect(result.current.error).toBe("failed");

    act(() => result.current.setError(null));
    expect(result.current.error).toBeNull();
  });
});

describe("useAsyncAction — run, page-unload cancellation", () => {
  it("swallows an AbortError from the request itself — a page-unload cancellation, not a real mutation failure — leaving no error and no stuck busy state", async () => {
    const { result } = renderHook(() => useAsyncAction());

    await act(async () => {
      await result.current.run({ action: () => Promise.reject(new DOMException("request cancelled: the page is unloading", "AbortError")), describeError: () => "should never be shown" }
      );
    });

    // If this surfaced, it would be a mutation error banner set while the document was unloading —
    // invisible then, but restorable (with the rest of the frozen page) via the back/forward cache,
    // which is exactly what makes it worth swallowing here rather than trusting it to stay unseen.
    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
  });
});

describe("useAsyncAction — concurrent calls are independent per hook instance", () => {
  it("two separate useAsyncAction() instances never share saving/error state", async () => {
    const a = renderHook(() => useAsyncAction());
    const b = renderHook(() => useAsyncAction());

    await act(async () => {
      await a.result.current.run({ action: () => Promise.reject(new Error("a failed")), describeError: () => "a error" });
    });

    expect(a.result.current.error).toBe("a error");
    expect(b.result.current.error).toBeNull();
    expect(b.result.current.saving).toBe(false);
  });
});
