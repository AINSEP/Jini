import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FetchQueryProvider, useFetchQuery, useInvalidate } from "@jini-ai/ui/fetch-query";
import { createFakeCommentSettingsPort } from "./support.js";
import { useCommentSettings } from "./support.js";
import { KEYS } from "../../rules.js";

/**
 * @file `useCommentSettings` — new coverage added alongside the `useWiredX` conversion
 * (`comment-settings-port.hooks.ts` / `comment-settings-dependencies.hooks.ts`). There was no
 * hook-level test file for this before — `Comments.unit.test.tsx` already exercises it end-to-end
 * through real `fetch` (mounted via `Comments`'s `SettingsSection`); this file proves the pure
 * hook is independently testable against an injected port, no `fetch` stub required.
 *
 * `fetch-query` migration (2026-08-12): every `renderHook` now needs `wrapper: FetchQueryProvider`
 * — see `redirects/__tests__/use-redirects.hooks.unit.test.tsx`'s identical wrapper for the pilot
 * precedent.
 */

function wrapper({ children }: { children: React.ReactNode }) {
  return <FetchQueryProvider>{children}</FetchQueryProvider>;
}

/** A `FormData` matching the fake's default settings exactly except for one changed field, so
 *  `buildSettingsPatch`'s diff isolates the one field under test. */
function formWithMaxDepth(maxDepth: string) {
  const form = new FormData();
  form.set("enabled", "on");
  form.set("requireModeration", "on");
  form.set("maxDepth", maxDepth);
  form.set("closeAfterDays", "");
  form.set("spamAutoRejectScore", "0.05");
  form.set("maxPerIpPerHour", "10");
  return form;
}

describe("useCommentSettings", () => {
  it("loads settings through the injected port when canConfigure is true, without touching fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const port = createFakeCommentSettingsPort();
      const { result } = renderHook(() => useCommentSettings(true, { port, locale: "en" }), { wrapper });

      await waitFor(() => expect(result.current.settings).not.toBeNull());
      expect(result.current.settings?.maxDepth).toBe(3);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips the load entirely when canConfigure is false (AC-10) — settings stay null, no error", async () => {
    const port = createFakeCommentSettingsPort();
    const { result } = renderHook(() => useCommentSettings(false, { port, locale: "en" }), { wrapper });

    // No `waitFor` to settle a load that should never start — asserting the synchronous initial
    // state is the point.
    expect(result.current.settings).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("sets the fallback error when the injected port's load rejects", async () => {
    const port = createFakeCommentSettingsPort({ getError: new Error("network down") });
    const { result } = renderHook(() => useCommentSettings(true, { port, locale: "en" }), { wrapper });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe("network down");
  });

  it("save sends only the changed field through the injected port and sets settings + notice", async () => {
    const port = createFakeCommentSettingsPort();
    const { result } = renderHook(() => useCommentSettings(true, { port, locale: "en" }), { wrapper });
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    await act(async () => {
      await result.current.save(formWithMaxDepth("5"));
    });

    expect(port.settings.maxDepth).toBe(5);
    expect(result.current.settings?.maxDepth).toBe(5);
    expect(result.current.notice).toBe("Saved.");
  });

  it("is a no-op through the port when the client-side spamAutoRejectScore validation fails", async () => {
    const port = createFakeCommentSettingsPort();
    const { result } = renderHook(() => useCommentSettings(true, { port, locale: "en" }), { wrapper });
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    const form = formWithMaxDepth("3");
    form.set("spamAutoRejectScore", "5"); // out of the valid 0-1 range

    await act(async () => {
      await result.current.save(form);
    });

    expect(result.current.error).toBe("Spam auto-reject score must be between 0 and 1.");
    expect(port.settings.spamAutoRejectScore).toBeCloseTo(0.05); // unchanged — the port was never called
  });

  it("keeps a concurrent operator's committed change after a background refetch races an in-progress edit (lost-update guard, TM-TOVU-2026-08-12-A round 2)", async () => {
    const port = createFakeCommentSettingsPort();

    // Render `useCommentSettings`, `useInvalidate`, and a bare `useFetchQuery` "probe" on the
    // same key together under one `wrapper` mount so all three share one `FetchQueryCache` instance
    // — `wrapper` builds a fresh client per render tree (see its own file's `useMemo` comment),
    // so separate `renderHook` calls would each get their own cache and could never observe each
    // other's invalidation. The probe reads the raw Jini cache entry directly: unlike
    // `ctrl.settings`, it is untouched by the fix under test (the fix only changes when the LOCAL
    // `settings` baseline re-seeds, not when the underlying query itself refetches), so it is a
    // synchronization point that behaves identically before and after the fix.
    const { result } = renderHook(
      () => ({
        ctrl: useCommentSettings(true, { port, locale: "en" }),
        invalidate: useInvalidate(),
        probe: useFetchQuery({ key: KEYS.settings, fetch: () => port.getCommentsSettings() }, { enabled: true }),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.ctrl.settings).not.toBeNull());
    expect(result.current.ctrl.settings?.maxDepth).toBe(3);

    // Operator B commits maxDepth=5 out-of-band — their own save, on their own screen — while
    // this operator (A)'s uncontrolled `maxDepth` input still shows the page-load value, 3.
    await port.putCommentsSettings({ maxDepth: 5 });

    // Something invalidates `KEYS.settings` independent of A's own save — in production this is
    // exactly what A's OWN earlier unrelated-field save already triggers via `saveMutation`'s
    // `invalidates: [KEYS.settings]`. Simulate that background refetch landing directly, then
    // wait on the probe's cache-level `data` (a real `waitFor` poll, not `await Promise.resolve()`
    // — the cache update still needs to reach React) rather than
    // on `ctrl.settings`, which the fix deliberately stops moving on a background refetch.
    act(() => {
      result.current.invalidate({ key: KEYS.settings });
    });
    await waitFor(() => expect(result.current.probe.data?.data.maxDepth).toBe(5));

    // A now saves some other change. The DOM's `maxDepth` input was never remounted, so it still
    // carries "3" — exactly the uncontrolled-input behavior (`defaultValue`, read via `FormData`
    // on submit) that `buildSettingsPatch` diffs against.
    await act(async () => {
      await result.current.ctrl.save(formWithMaxDepth("3"));
    });

    // The defect: a re-seeded baseline of 5 makes `buildSettingsPatch` see form="3" vs
    // current=5, so it (wrongly) includes `maxDepth: 3` in the patch sent through the port,
    // silently reverting B's committed change. Assert on what was actually PATCHed, not on hook
    // state, since hook state alone can look fine right up until the network call.
    expect(port.settings.maxDepth).toBe(5);
  });

  it("sets the fallback error when the injected port's save rejects", async () => {
    const port = createFakeCommentSettingsPort({ putError: new Error("stale version") });
    const { result } = renderHook(() => useCommentSettings(true, { port, locale: "en" }), { wrapper });
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    await act(async () => {
      await result.current.save(formWithMaxDepth("5"));
    });

    expect(result.current.error).toBe("stale version");
    expect(result.current.notice).toBeNull();
  });
});
