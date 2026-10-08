import { act, renderHook, waitFor } from "./harness/render.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSeoEntryPanel } from "./harness/hooks.js";
import { createFakeSeoPort } from "./harness/api.js";
import type { SeoPort } from "./harness/api.js";
import type { SeoEntryAnalysis, SeoEntryMeta } from "./harness/api.js";

/**
 * @file `useSeoEntryPanel` — the per-entry overrides form + analyze view.
 * `Seo.unit.test.tsx` already exercises the full UI flow through mocked hook modules; this file
 * is the hook's own injected-port coverage — see `seo-port.hooks.ts` for why the injection exists.
 */

function metaFixture(overrides: Partial<SeoEntryMeta> = {}): SeoEntryMeta {
  return {
    title: "Original title",
    description: "Original description",
    canonical: "https://example.com/post-1",
    robots: { noindex: false, nofollow: false },
    openGraph: { title: "Original title", type: "article", url: "https://example.com/post-1" },
    twitter: { card: "summary", title: "Original title" },
    jsonLd: [],
    ...overrides,
  };
}

function analysisFixture(overrides: Partial<SeoEntryAnalysis> = {}): SeoEntryAnalysis {
  return {
    entryId: "entry-1",
    score: 80,
    issues: [],
    resolved: metaFixture(),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useSeoEntryPanel — injected port", () => {
  it("loads meta + analysis on mount from the fake port's seed, with no fetch involved", async () => {
    const networkMock = vi.fn();
    vi.stubGlobal("fetch", networkMock);
    const port = createFakeSeoPort({
      entries: { "entry-1": { meta: metaFixture(), analysis: analysisFixture() } },
    });

    const { result } = renderHook(() => useSeoEntryPanel({ entryId: "entry-1" }, port, "en"));

    await waitFor(() => expect(result.current.resolved).not.toBeNull());
    expect(result.current.resolved?.title).toBe("Original title");
    expect(result.current.analysis?.score).toBe(80);
    expect(networkMock).not.toHaveBeenCalled();
  });

  it("save writes only the touched fields through the port and clears touched on success", async () => {
    const port = createFakeSeoPort({
      entries: { "entry-1": { meta: metaFixture(), analysis: analysisFixture() } },
    });
    const { result } = renderHook(() => useSeoEntryPanel({ entryId: "entry-1" }, port, "en"));
    await waitFor(() => expect(result.current.resolved).not.toBeNull());

    act(() => result.current.setField("title", "New title"));
    expect(result.current.touched).toEqual({ title: "New title" });

    await act(async () => {
      await result.current.save();
    });

    expect(result.current.resolved?.title).toBe("New title");
    expect(result.current.touched).toEqual({});
    expect(result.current.notice).toBe("Saved.");
  });

  it("does not let a slower, earlier save's trailing analyze refresh overwrite a newer save's fresher analysis (out-of-order response race)", async () => {
    const port = createFakeSeoPort({
      entries: { "entry-1": { meta: metaFixture(), analysis: analysisFixture({ score: 80 }) } },
    });

    const { result } = renderHook(() => useSeoEntryPanel({ entryId: "entry-1" }, port, "en"));
    // Let the mount-time `load()` (its own `getSeoEntryAnalyze` call) settle naturally, BEFORE
    // installing the controllable mocks below — only the two SAVE-triggered analyze calls need
    // controllable ordering.
    await waitFor(() => expect(result.current.resolved).not.toBeNull());

    let resolveFirstAnalyze!: (v: { data: SeoEntryAnalysis }) => void;
    let resolveSecondAnalyze!: (v: { data: SeoEntryAnalysis }) => void;
    vi.spyOn(port, "getSeoEntryAnalyze")
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirstAnalyze = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecondAnalyze = resolve)));

    // First edit+save. `save()` resolves as soon as its PUT does — it never awaits its own
    // trailing analyze call — so the button re-enables immediately, well before this save's
    // analyze (the FIRST mocked call above) settles.
    act(() => result.current.setField("title", "First edit"));
    await act(async () => {
      await result.current.save();
    });

    // A second, later edit+save runs to completion — including its OWN trailing analyze refresh
    // (the SECOND mocked call) — before the first save's analyze call ever resolves.
    act(() => result.current.setField("title", "Second edit"));
    await act(async () => {
      await result.current.save();
    });
    await act(async () => {
      resolveSecondAnalyze({ data: analysisFixture({ score: 42 }) });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.analysis?.score).toBe(42));

    // The FIRST save's now-stale analyze call finally settles. It must not resurrect the older score.
    await act(async () => {
      resolveFirstAnalyze({ data: analysisFixture({ score: 80 }) });
      await Promise.resolve();
    });

    expect(result.current.analysis?.score).toBe(42);
  });

  it("fieldValue falls back to the resolved value until the field is touched", async () => {
    const port = createFakeSeoPort({
      entries: { "entry-1": { meta: metaFixture({ description: "Resolved description" }), analysis: analysisFixture() } },
    });
    const { result } = renderHook(() => useSeoEntryPanel({ entryId: "entry-1" }, port, "en"));
    await waitFor(() => expect(result.current.resolved).not.toBeNull());

    expect(result.current.fieldValue("description", result.current.resolved!.description)).toBe("Resolved description");

    act(() => result.current.setField("description", "Draft description"));
    expect(result.current.fieldValue("description", result.current.resolved!.description)).toBe("Draft description");
  });
});

/**
 * Clearing an override (2026-09-06). The server has accepted `null` as "remove this key" since
 * `eb10f5de` (`SeoExtFieldsPatch`, `apps/website/src/features/seo/types.ts`), but this hook could
 * only ever send `""` — which `setEntrySeoOverrides` stores as a REAL override and `seo.ts` then
 * resolves with `??`, so a blank beat the site default and there was no way back from the UI.
 *
 * Every assertion below reads the PUT body the port actually received, not the fake's merged
 * result: the fake's `applySeoPatch` folds `null` and `""` into the same resolved meta, so an
 * assertion on `resolved` would pass under the bug.
 */
describe("useSeoEntryPanel — clearing an override", () => {
  function recordingPort() {
    const fake = createFakeSeoPort({
      entries: { "entry-1": { meta: metaFixture(), analysis: analysisFixture() } },
    });
    const puts: unknown[] = [];
    const port: SeoPort = {
      ...fake,
      putSeoEntry(target, patch = {}) {
        puts.push(patch);
        return fake.putSeoEntry(target, patch);
      },
    };
    return { port, puts };
  }

  it("emptying a text field PUTs null for that key, not an empty string", async () => {
    const { port, puts } = recordingPort();
    const { result } = renderHook(() => useSeoEntryPanel({ entryId: "entry-1" }, port, "en"));
    await waitFor(() => expect(result.current.resolved).not.toBeNull());

    act(() => result.current.setField("title", ""));
    await act(async () => {
      await result.current.save();
    });

    expect(puts).toEqual([{ title: null }]);
  });

  it("emptying a URL field PUTs null for that key too", async () => {
    const { port, puts } = recordingPort();
    const { result } = renderHook(() => useSeoEntryPanel({ entryId: "entry-1" }, port, "en"));
    await waitFor(() => expect(result.current.resolved).not.toBeNull());

    act(() => result.current.setField("canonical", ""));
    act(() => result.current.setField("ogImage", ""));
    await act(async () => {
      await result.current.save();
    });

    expect(puts).toEqual([{ canonical: null, ogImage: null }]);
  });

  it("the null survives JSON serialization — an `undefined` clear would be dropped from the wire body entirely", async () => {
    const { port, puts } = recordingPort();
    const { result } = renderHook(() => useSeoEntryPanel({ entryId: "entry-1" }, port, "en"));
    await waitFor(() => expect(result.current.resolved).not.toBeNull());

    act(() => result.current.setField("description", ""));
    await act(async () => {
      await result.current.save();
    });

    expect(JSON.parse(JSON.stringify(puts[0]))).toEqual({ description: null });
  });

  it("a field the operator never touched stays absent — 'unchanged' must not become 'clear'", async () => {
    const { port, puts } = recordingPort();
    const { result } = renderHook(() => useSeoEntryPanel({ entryId: "entry-1" }, port, "en"));
    await waitFor(() => expect(result.current.resolved).not.toBeNull());

    act(() => result.current.setField("title", ""));
    await act(async () => {
      await result.current.save();
    });

    expect(Object.keys(puts[0] as object)).toEqual(["title"]);
  });

  it("a non-empty edit still PUTs the string, and a checkbox still PUTs its boolean", async () => {
    const { port, puts } = recordingPort();
    const { result } = renderHook(() => useSeoEntryPanel({ entryId: "entry-1" }, port, "en"));
    await waitFor(() => expect(result.current.resolved).not.toBeNull());

    act(() => result.current.setField("title", "New title"));
    act(() => result.current.setField("noindex", false));
    await act(async () => {
      await result.current.save();
    });

    expect(puts).toEqual([{ title: "New title", noindex: false }]);
  });

  it("fieldValue reads a pending clear back as null, which Seo.tsx's own `?? \"\"` renders as an empty box rather than snapping back to the resolved value", async () => {
    const { port } = recordingPort();
    const { result } = renderHook(() => useSeoEntryPanel({ entryId: "entry-1" }, port, "en"));
    await waitFor(() => expect(result.current.resolved).not.toBeNull());

    act(() => result.current.setField("title", ""));

    const pending = result.current.fieldValue("title", result.current.resolved!.title);
    expect(pending).toBeNull();
    // The second half of what the operator sees. Every text input in `Seo.tsx` binds
    // `value={fieldValue(...) ?? ""}`, so this is the exact expression the box renders — without
    // it, `null` would be an uncontrolled-input value and the box would not stay empty.
    expect(pending ?? "").toBe("");
  });
});


describe("useSeoEntryPanel — failures and entry changes", () => {
  it("reports a failed load without resolved metadata", async () => {
    const port = createFakeSeoPort();
    port.getSeoEntry = vi.fn().mockRejectedValue(new Error("SEO read denied"));
    const { result } = renderHook(() => useSeoEntryPanel({ entryId: "entry-1" }, port, "en"));
    await waitFor(() => expect(result.current.loadError).toBe("SEO read denied"));
    expect(result.current.resolved).toBeNull();
    expect(result.current.analysis).toBeNull();
  });

  it("keeps the edited field after save failure and allows retry", async () => {
    const port = createFakeSeoPort({ entries: { "entry-1": { meta: metaFixture(), analysis: analysisFixture() } } });
    const put = vi.spyOn(port, "putSeoEntry").mockRejectedValueOnce(new Error("SEO write denied"));
    const { result } = renderHook(() => useSeoEntryPanel({ entryId: "entry-1" }, port, "en"));
    await waitFor(() => expect(result.current.resolved).not.toBeNull());
    act(() => result.current.setField("title", "Retry title"));
    await act(async () => { await result.current.save(); });
    expect(result.current.saveError).toBe("SEO write denied");
    expect(result.current.touched).toEqual({ title: "Retry title" });
    expect(result.current.fieldValue("title", "Original title")).toBe("Retry title");
    expect(result.current.saving).toBe(false);
    expect(result.current.notice).toBeNull();
    await act(async () => { await result.current.save(); });
    expect(put).toHaveBeenNthCalledWith(2, { entryId: "entry-1" }, { title: "Retry title" });
    expect(result.current.saveError).toBeNull();
    expect(result.current.resolved?.title).toBe("Retry title");
    expect(result.current.touched).toEqual({});
  });

  it("clears edits and metadata while the newly selected entry loads", async () => {
    const port = createFakeSeoPort({ entries: { "entry-1": { meta: metaFixture(), analysis: analysisFixture() } } });
    const { result, rerender } = renderHook(({ entryId }) => useSeoEntryPanel({ entryId }, port, "en"), { initialProps: { entryId: "entry-1" } });
    await waitFor(() => expect(result.current.resolved).not.toBeNull());
    act(() => result.current.setField("title", "Unsaved entry one"));
    let release!: (value: { data: SeoEntryMeta }) => void;
    vi.spyOn(port, "getSeoEntry").mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    vi.spyOn(port, "getSeoEntryAnalyze").mockResolvedValueOnce({ data: analysisFixture({ entryId: "entry-2", score: 55 }) });
    rerender({ entryId: "entry-2" });
    expect(result.current.touched).toEqual({});
    expect(result.current.resolved).toBeNull();
    expect(result.current.analysis).toBeNull();
    await act(async () => { release({ data: metaFixture({ title: "Entry two" }) }); });
    expect(result.current.resolved?.title).toBe("Entry two");
    expect(result.current.analysis?.entryId).toBe("entry-2");
    expect(result.current.touched).toEqual({});
  });
});
