// @vitest-environment jsdom
import { renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { describe, expect, it, vi } from "vitest";
import { useFetchMutation, useFetchQuery, useInvalidate } from "../../../react/kit.js";
import { createFakeTaxonomyPort } from "../hooks/taxonomy-dependencies.hooks.js";
import { useTaxonomy } from "../hooks/use-taxonomy.hooks.js";
import { useTaxonomyHtmlEmbed } from "../hooks/use-taxonomy-html-embed.hooks.js";
import type { TaxonomyHostKit } from "../taxonomy-host-kit.js";

/**
 * @file `useTaxonomy` calls the list read, the Trash mutations and the list invalidator only through the
 * host kit's injected `useFetchQuery` / `useFetchMutation` / `useInvalidate`, never a kit-facade import.
 */
describe("useTaxonomy — kit-injected fetch hooks", () => {
  it("runs the list read, the two mutations and the content-refresh invalidator through the kit", async () => {
    const spyQuery = vi.fn(useFetchQuery) as unknown as TaxonomyHostKit["useFetchQuery"];
    const spyMutation = vi.fn(useFetchMutation) as unknown as TaxonomyHostKit["useFetchMutation"];
    const spyInvalidate = vi.fn(useInvalidate) as unknown as TaxonomyHostKit["useInvalidate"];
    const kit: TaxonomyHostKit = {
      isApiError: (_e: unknown): _e is never => false,
      describeApiError: ({ fallback }) => fallback,
      translate: ({ key }) => key,
      failures: { getGeneration: () => 0, isClipboardRefusal: () => false, publishLocalFailure: vi.fn() },
      useContentRefreshSubscription: vi.fn(),
      useTaxonomyHtmlEmbed,
      useFetchQuery: spyQuery, useFetchMutation: spyMutation, useInvalidate: spyInvalidate,
    };
    const port = createFakeTaxonomyPort({ blockedError: () => new Error("blocked") });
    const { result } = renderHook(() => useTaxonomy({ port, locale: "en", t: (k) => k, kit }));
    await waitFor(() => expect(result.current.taxonomies).not.toBeNull());
    expect(spyQuery).toHaveBeenCalled();
    expect(spyMutation).toHaveBeenCalledTimes(2 * (spyQuery as unknown as { mock: { calls: unknown[] } }).mock.calls.length);
    expect(spyInvalidate).toHaveBeenCalled();
  });
});
