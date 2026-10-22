import { act, renderHook, waitFor } from "@testing-library/react";
import { assert, afterEach, describe, expect, it, vi } from "vitest";

import { FetchQueryProvider, useInvalidate } from "@jini-ai/ui/fetch-query";
import { useFormSubmissions } from "./legacy-ports.js";
import { createFakeFormSubmissionsPort } from "./legacy-ports.js";
import type { FormSubmissionsPort } from "./legacy-ports.js";
import { KEYS } from "../../rules.js";
import type { AdminFormSubmission } from "../../models.js";

/**
 * @file `useFormSubmissions` — the submissions list's cursor-append load.
 * `FormEditor.unit.test.tsx` already exercises the full UI flow through a stubbed `fetch`; this
 * file is the hook's own injected-port coverage — see `form-submissions-port.hooks.ts` for why
 * the injection exists.
 *
 * `fetch-query` migration (2026-08-12): every `renderHook` now needs `wrapper: FetchQueryProvider`
 * — see `redirects/__tests__/use-redirects.hooks.unit.test.tsx`'s identical wrapper for the pilot
 * precedent.
 */

function wrapper({ children }: { children: React.ReactNode }) {
  return <FetchQueryProvider>{children}</FetchQueryProvider>;
}

function submissionFixture(overrides: Partial<AdminFormSubmission> = {}): AdminFormSubmission {
  return {
    id: "s1",
    formDefinitionId: "f1",
    workspaceId: "fake-ws",
    data: { email: "a@example.com" },
    sourceIp: "127.0.0.1",
    submittedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useFormSubmissions — injected port", () => {
  it("loads only the given form's submissions from the fake port's seed, with no fetch involved", async () => {
    const networkMock = vi.fn();
    vi.stubGlobal("fetch", networkMock);
    const port = createFakeFormSubmissionsPort({
      submissions: [submissionFixture({ id: "s1", formDefinitionId: "f1" }), submissionFixture({ id: "s2", formDefinitionId: "other" })],
    });

    const { result } = renderHook(() => useFormSubmissions({ formId: "f1" }, port), { wrapper });

    await waitFor(() => expect(result.current.submissions).not.toBeNull());
    expect(result.current.submissions).toEqual([submissionFixture({ id: "s1", formDefinitionId: "f1" })]);
    expect(networkMock).not.toHaveBeenCalled();
  });

  it("selectedId drives the detail view without touching the port", async () => {
    const port = createFakeFormSubmissionsPort();
    const { result } = renderHook(() => useFormSubmissions({ formId: "f1" }, port), { wrapper });
    await waitFor(() => expect(result.current.submissions).toEqual([]));

    act(() => result.current.setSelectedId("s1"));
    expect(result.current.selectedId).toBe("s1");
    act(() => result.current.setSelectedId(null));
    expect(result.current.selectedId).toBeNull();
  });
});

/**
 * Load more paging (`ADS-memory/.local-artifacts/terra-admin-review-2026-09-20/plan-content2.md`,
 * "#3 + #5 + S2"): `loadMore` had no in-flight guard (#3, a double click sent two requests and
 * appended the page twice), `moreError` was never cleared by a retry or a form switch (#5), and a
 * refetched first page kept stale "more" pages instead of dropping them (S2, e.g. after S5's
 * delete invalidates the list).
 *
 * `createControlledPort`'s cursorless calls resolve with whatever `setFirstPage` last set
 * (defaulting to page 1); cursor calls never resolve on their own — each pushes a `{ resolve,
 * reject }` pair onto `cursorCalls` so a test settles it manually, deferred-promise style (see
 * `use-post-editor.hooks.unit.test.tsx`'s `deferredSavePort`/`resolvers` for the same idiom this
 * codebase uses elsewhere).
 */
describe("useFormSubmissions — Load more paging (2026-09-20)", () => {
  function submissionFixture(overrides: Partial<AdminFormSubmission> = {}): AdminFormSubmission {
    return {
      id: "s1",
      formDefinitionId: "f1",
      workspaceId: "fake-ws",
      data: {},
      sourceIp: "127.0.0.1",
      submittedAt: "2026-08-01T00:00:00.000Z",
      ...overrides,
    };
  }

  interface ControlledPort {
    port: FormSubmissionsPort;
    cursorCalls: Array<{
      resolve: (v: { data: AdminFormSubmission[]; nextCursor: string | null }) => void;
      reject: (e: Error) => void;
    }>;
    setFirstPage: (data: AdminFormSubmission[], nextCursor: string | null) => void;
  }

  function createControlledPort(): ControlledPort {
    let firstPageResult: { data: AdminFormSubmission[]; nextCursor: string | null } = {
      data: [submissionFixture({ id: "s1" })],
      nextCursor: "c2",
    };
    const cursorCalls: ControlledPort["cursorCalls"] = [];
    const port: FormSubmissionsPort = {
      listFormSubmissions: vi.fn((_target: { formId: string }, options?: { cursor?: string }) => {
        if (options?.cursor) {
          return new Promise<{ data: AdminFormSubmission[]; nextCursor: string | null }>((resolve, reject) => {
            cursorCalls.push({ resolve, reject });
          });
        }
        return Promise.resolve(firstPageResult);
      }),
      async getFormSubmission() {
        throw new Error("not used by this test");
      },
      async deleteFormSubmission() {
        throw new Error("not used by this test");
      },
    };
    return {
      port,
      cursorCalls,
      setFirstPage(data, nextCursor) {
        firstPageResult = { data, nextCursor };
      },
    };
  }

  it("two Load more calls in the same tick send one request and append the page once", async () => {
    const { port, cursorCalls } = createControlledPort();
    const { result } = renderHook(() => useFormSubmissions({ formId: "f1" }, port), { wrapper });
    await waitFor(() => expect(result.current.submissions).toEqual([submissionFixture({ id: "s1" })]));

    act(() => {
      result.current.load("c2");
      result.current.load("c2");
    });

    // 1 first-page call (on mount) + 1 loadMore call — the second same-tick call must be dropped
    // by the in-flight guard. Today (no guard) this is 3.
    expect(port.listFormSubmissions).toHaveBeenCalledTimes(2);
    expect(result.current.loadingMore).toBe(true);
    expect(cursorCalls).toHaveLength(1);

    await act(async () => {
      assert.isDefined(cursorCalls[0]);
      cursorCalls[0].resolve({ data: [submissionFixture({ id: "s2" })], nextCursor: null });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.submissions?.map((s) => s.id)).toEqual(["s1", "s2"]));
    expect(result.current.loadingMore).toBe(false);
  });

  it("a successful retry clears the previous Load more failure", async () => {
    const { port, cursorCalls } = createControlledPort();
    const { result } = renderHook(() => useFormSubmissions({ formId: "f1" }, port), { wrapper });
    await waitFor(() => expect(result.current.submissions).not.toBeNull());

    act(() => result.current.load("c2"));
    await waitFor(() => expect(cursorCalls).toHaveLength(1));
    await act(async () => {
      assert.isDefined(cursorCalls[0]);
      cursorCalls[0].reject(new Error("network down"));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.error).toBe("network down"));

    act(() => result.current.load("c2"));
    await waitFor(() => expect(cursorCalls).toHaveLength(2));
    await act(async () => {
      assert.isDefined(cursorCalls[1]);
      cursorCalls[1].resolve({ data: [submissionFixture({ id: "s2" })], nextCursor: null });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it("switching forms clears a Load more failure from the previous form", async () => {
    const { port, cursorCalls } = createControlledPort();
    const { result, rerender } = renderHook(({ formId }: { formId: string }) => useFormSubmissions({ formId }, port), {
      wrapper,
      initialProps: { formId: "f1" },
    });
    await waitFor(() => expect(result.current.submissions).not.toBeNull());

    act(() => result.current.load("c2"));
    await waitFor(() => expect(cursorCalls).toHaveLength(1));
    await act(async () => {
      assert.isDefined(cursorCalls[0]);
      cursorCalls[0].reject(new Error("network down"));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.error).toBe("network down"));

    rerender({ formId: "f2" });

    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it("a refetched first page drops the stale Load more pages", async () => {
    const { port, cursorCalls, setFirstPage } = createControlledPort();
    const { result } = renderHook(
      () => ({ subs: useFormSubmissions({ formId: "f1" }, port), invalidate: useInvalidate() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.subs.submissions).not.toBeNull());

    act(() => result.current.subs.load("c2"));
    await waitFor(() => expect(cursorCalls).toHaveLength(1));
    await act(async () => {
      assert.isDefined(cursorCalls[0]);
      cursorCalls[0].resolve({ data: [submissionFixture({ id: "s2" })], nextCursor: null });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.subs.submissions?.map((s) => s.id)).toEqual(["s1", "s2"]));

    setFirstPage([submissionFixture({ id: "s1b" })], "c2b");
    act(() => result.current.invalidate({ key: KEYS.submissionsList("f1") }));

    await waitFor(() => expect(result.current.subs.submissions?.map((s) => s.id)).toEqual(["s1b"]));
    expect(result.current.subs.nextCursor).toBe("c2b");
  });

  it("a Load more that settles after a list reset does not append", async () => {
    const { port, cursorCalls } = createControlledPort();
    const { result } = renderHook(() => useFormSubmissions({ formId: "f1" }, port), { wrapper });
    await waitFor(() => expect(result.current.submissions).not.toBeNull());

    act(() => result.current.load("c2"));
    await waitFor(() => expect(cursorCalls).toHaveLength(1));

    act(() => result.current.load()); // no-cursor reset, e.g. after a delete invalidates the list

    await act(async () => {
      assert.isDefined(cursorCalls[0]);
      cursorCalls[0].resolve({ data: [submissionFixture({ id: "s2" })], nextCursor: null });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.submissions).not.toBeNull());
    expect(result.current.submissions?.map((s) => s.id)).not.toContain("s2");
  });
});
