import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import { useFormSubmissionDetail } from "./legacy-ports.js";
import { createFakeFormSubmissionsPort } from "./legacy-ports.js";
import { ApiError } from "./harness.js";
import type { AdminFormSubmission } from "../../models.js";

/**
 * @file `useFormSubmissionDetail` — the submission detail view's load + two-click delete.
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

describe("useFormSubmissionDetail — injected port", () => {
  it("loads the fake port's seeded submission, with no fetch involved", async () => {
    const networkMock = vi.fn();
    vi.stubGlobal("fetch", networkMock);
    const port = createFakeFormSubmissionsPort({ submissions: [submissionFixture()] });
    const onDeleted = vi.fn();

    const { result } = renderHook(() => useFormSubmissionDetail({ formId: "f1", submissionId: "s1", onDeleted }, port), {
      wrapper,
    });

    await waitFor(() => expect(result.current.submission).not.toBeNull());
    expect(result.current.submission).toEqual(submissionFixture());
    expect(networkMock).not.toHaveBeenCalled();
  });

  it("requestDelete opens the confirm and deletes nothing", async () => {
    const port = createFakeFormSubmissionsPort({ submissions: [submissionFixture()] });
    port.deleteFormSubmission = vi.fn(port.deleteFormSubmission);
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useFormSubmissionDetail({ formId: "f1", submissionId: "s1", onDeleted }, port), {
      wrapper,
    });
    await waitFor(() => expect(result.current.submission).not.toBeNull());

    act(() => {
      result.current.requestDelete();
    });

    expect(result.current.confirmOpen).toBe(true);
    expect(port.deleteFormSubmission).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("confirmDelete deletes, calls onDeleted and closes", async () => {
    const port = createFakeFormSubmissionsPort({ submissions: [submissionFixture()] });
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useFormSubmissionDetail({ formId: "f1", submissionId: "s1", onDeleted }, port), {
      wrapper,
    });
    await waitFor(() => expect(result.current.submission).not.toBeNull());

    act(() => {
      result.current.requestDelete();
    });
    expect(result.current.confirmOpen).toBe(true);

    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(result.current.confirmOpen).toBe(false);
    expect(port.submissions).toEqual([]);
  });

  it("cancelDelete closes with no request", async () => {
    const port = createFakeFormSubmissionsPort({ submissions: [submissionFixture()] });
    port.deleteFormSubmission = vi.fn(port.deleteFormSubmission);
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useFormSubmissionDetail({ formId: "f1", submissionId: "s1", onDeleted }, port), {
      wrapper,
    });
    await waitFor(() => expect(result.current.submission).not.toBeNull());

    act(() => {
      result.current.requestDelete();
    });
    expect(result.current.confirmOpen).toBe(true);

    act(() => {
      result.current.cancelDelete();
    });

    expect(result.current.confirmOpen).toBe(false);
    expect(port.deleteFormSubmission).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

/** T7a (2026-09-21): submission removal routes through the generic `api.trash` (see
 *  `form-submissions-dependencies.hooks.ts`'s own doc) and its 404/409 contract — same classifier
 *  (`describeTrashError`) `use-forms-list.hooks.ts`'s own `removeForm` uses for the forms row delete. */
describe("useFormSubmissionDetail — trash errors", () => {
  it("a 404 (already gone) is treated as a successful delete — calls onDeleted, no error banner", async () => {
    const port = createFakeFormSubmissionsPort({ submissions: [submissionFixture()] });
    port.deleteFormSubmission = vi.fn(() => Promise.reject(new ApiError("not found", 404, "FORMS_SUBMISSION_NOT_FOUND")));
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useFormSubmissionDetail({ formId: "f1", submissionId: "s1", onDeleted }, port), {
      wrapper,
    });
    await waitFor(() => expect(result.current.submission).not.toBeNull());

    act(() => result.current.requestDelete());
    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(result.current.confirmOpen).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("a 409 TRASH_VERSION_CHANGED surfaces the reload-and-retry copy and does not call onDeleted", async () => {
    const port = createFakeFormSubmissionsPort({ submissions: [submissionFixture()] });
    port.deleteFormSubmission = vi.fn(() => Promise.reject(new ApiError("changed", 409, "TRASH_VERSION_CHANGED")));
    const onDeleted = vi.fn();
    const { result } = renderHook(() => useFormSubmissionDetail({ formId: "f1", submissionId: "s1", onDeleted }, port), {
      wrapper,
    });
    await waitFor(() => expect(result.current.submission).not.toBeNull());

    act(() => result.current.requestDelete());
    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(onDeleted).not.toHaveBeenCalled();
    expect(result.current.confirmOpen).toBe(false);
    await waitFor(() => expect(result.current.error).toBe("This item changed since you loaded it. Reload and try again."));
  });
});
