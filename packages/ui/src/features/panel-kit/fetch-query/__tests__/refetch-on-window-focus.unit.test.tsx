import { fireEvent } from "@testing-library/react";
import { render, waitFor, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FetchQueryProvider, useFetchQuery } from "..";

/**
 * @file The `refetchOnWindowFocus` per-query passthrough (2026-09-21, forms plan §C) — additive, and
 * the client default (`false`, `adapter.tanstack.tsx`'s `createClient`) must stay unchanged for every
 * query that does not explicitly opt in. Both cases pass `staleTime: 0` so the query is always
 * eligible to refetch on focus in the first place; TanStack's own focus-refetch gate additionally
 * requires the query be stale, which this file's header (see `fetch-query.test.tsx`) says is
 * deliberately out of scope to otherwise re-derive here.
 *
 * `focusManager.setFocused` only notifies subscribers on an actual CHANGE (see
 * `@tanstack/query-core`'s `FocusManager`), so each test flips unfocused -> focused to trigger it,
 * and `afterEach` resets it back to the library's own default focus check so no state leaks into a
 * later test in this file.
 */



function Reader({ fetch, refetchOnWindowFocus, id = "data" }: { fetch: () => Promise<string>; refetchOnWindowFocus?: boolean; id?: string }) {
  const q = useFetchQuery({ key: ["focus-thing", id], fetch }, { staleTime: 0, ...(refetchOnWindowFocus === undefined ? {} : { refetchOnWindowFocus }) });
  return <span data-testid={id}>{q.data ?? "-"}</span>;
}

describe("useFetchQuery refetchOnWindowFocus", () => {
  it("refetches when the window regains focus, when explicitly opted in", async () => {
    let call = 0;
    const fetch = vi.fn(async () => `v${++call}`);
    render(
      <FetchQueryProvider>
        <Reader fetch={fetch} refetchOnWindowFocus />
      </FetchQueryProvider>
    );
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("v1"));

    
    fireEvent.focus(window);

    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("v2"));
  });

  it("does NOT refetch on window focus when the option is omitted — the default stays unchanged", async () => {
    let call = 0;
    const fetch = vi.fn(async () => `v${++call}`);
    let sentinelCalls = 0;
    const sentinelFetch = vi.fn(async () => `sentinel${++sentinelCalls}`);
    render(
      <FetchQueryProvider>
        <Reader fetch={fetch} />
        <Reader fetch={sentinelFetch} refetchOnWindowFocus id="sentinel" />
      </FetchQueryProvider>
    );
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("v1"));

    
    fireEvent.focus(window);

    await waitFor(() => expect(screen.getByTestId("sentinel")).toHaveTextContent("sentinel2"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("data")).toHaveTextContent("v1");
  });
});
