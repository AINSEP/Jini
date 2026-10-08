import { CommentsTestProvider } from "./support.js";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FetchQueryProvider } from "@jini-ai/ui/fetch-query";
import { createFakeCommentsPort } from "./support.js";
import { useComments, useWiredComments } from "./support.js";

/**
 * @file `useComments` — the top-level `Comments()` screen's permissions load. New coverage added
 * alongside the `useWiredX` conversion (`comments-port.hooks.ts` / `comments-dependencies.hooks.ts`)
 * — `Comments.unit.test.tsx` already exercises the wired composition end-to-end through real
 * `fetch`; this file proves the pure hook is independently testable against an injected port, no
 * `fetch` stub required.
 *
 * `fetch-query` migration (2026-08-12): every `renderHook` now needs `wrapper: FetchQueryProvider`
 * — see `redirects/__tests__/use-redirects.hooks.unit.test.tsx`'s identical wrapper for the pilot
 * precedent.
 */

function wrapper({ children }: { children: React.ReactNode }) {
  return <CommentsTestProvider><FetchQueryProvider>{children}</FetchQueryProvider></CommentsTestProvider>;
}

describe("useComments", () => {
  it("resolves permissions from the injected port, without touching fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const port = createFakeCommentsPort({ effectivePermissions: ["comments.moderate"] });
      const { result } = renderHook(() => useComments({ port, locale: "en" }), { wrapper });
      await waitFor(() => expect(result.current.permissions).not.toBeNull());
      expect(result.current.permissions).toEqual(["comments.moderate"]);
      expect(result.current.error).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sets the fallback error when the injected port rejects", async () => {
    const port = createFakeCommentsPort({ meError: new Error("boom") });
    const { result } = renderHook(() => useComments({ port, locale: "en" }), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe("boom");
    expect(result.current.permissions).toBeNull();
  });

  it("useWiredComments resolves permissions through the real port with no port argument", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/auth/me")) return Response.json({ effectivePermissions: ["comments.moderate"] });
      if (String(url).includes("/settings/effective")) return Response.json({ data: [] });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { result } = renderHook(() => useWiredComments(), { wrapper });
      expect(result.current.permissions).toBeNull();
      expect(result.current.error).toBeNull();
      await waitFor(() => expect(result.current.permissions).toEqual(["comments.moderate"]));
      expect(result.current.error).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
