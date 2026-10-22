import { fireEvent } from "@testing-library/react";
import { render, waitFor, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FetchQueryProvider as BuiltInProvider, useFetchQuery } from "..";
import { FetchQueryProvider as TanStackProvider } from "../tanstack.js";

/**
 * @file The `refetchOnWindowFocus` per-query passthrough (2026-09-21, forms plan §C) — additive, and
 * the provider default (`false`, for both adapters) must stay unchanged for every
 * query that does not explicitly opt in. Both cases pass `staleTime: 0` so the query is always
 * eligible to refetch on focus in the first place. Opting in alone must not re-fetch fresh data;
 * staleTime is still the contract's freshness gate.
 *
 * Host focus signals flow through the provider's environment instead of a global focusManager,
 * so independent providers do not overwrite one another's subscriptions. Provider disposal
 * releases these listeners rather than requiring tests to reset process-wide library state.
 */



function Reader({ fetch, refetchOnWindowFocus, id = "data" }: { fetch: () => Promise<string>; refetchOnWindowFocus?: boolean; id?: string }) {
  const q = useFetchQuery({ key: ["focus-thing", id], fetch }, { staleTime: 0, ...(refetchOnWindowFocus === undefined ? {} : { refetchOnWindowFocus }) });
  return <span data-testid={id}>{q.data ?? "-"}</span>;
}


describe.each([["built-in", BuiltInProvider], ["tanstack", TanStackProvider]] as const)("%s adapter conformance", (_name, FetchQueryProvider) => {

describe("useFetchQuery refetchOnWindowFocus", () => {
  it("retains fresh data on focus even when the query opts in", async () => {
    const fetch = vi.fn(async () => "fresh");
    let calls = 0;
    const sentinelFetch = vi.fn(async () => `sentinel${++calls}`);
    function Fresh() {
      const query = useFetchQuery({ key: ["fresh-focus"], fetch }, { staleTime: Infinity, refetchOnWindowFocus: true });
      return <span data-testid="fresh">{query.data}</span>;
    }
    render(<FetchQueryProvider><Fresh /><Reader fetch={sentinelFetch} refetchOnWindowFocus id="sentinel" /></FetchQueryProvider>);
    await waitFor(() => expect(screen.getByTestId("fresh").textContent).toBe("fresh"));
    await waitFor(() => expect(screen.getByTestId("sentinel").textContent).toBe("sentinel1"));
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByTestId("sentinel").textContent).toBe("sentinel2"));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

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

});
