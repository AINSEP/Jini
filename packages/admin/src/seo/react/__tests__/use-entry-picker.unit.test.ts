import { renderHook, waitFor } from "./harness/render.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEntryPicker } from "./harness/hooks.js";
import { createFakeSeoPort } from "./harness/api.js";
import type { AdminPost } from "./harness/api.js";

/**
 * @file `useEntryPicker` — the SEO screen's post+page dropdown.
 * `Seo.unit.test.tsx` already exercises the full UI flow through mocked hook modules; this file
 * is the hook's own injected-port coverage — see `seo-port.hooks.ts` for why the injection exists.
 */

function postFixture(overrides: Partial<AdminPost> = {}): AdminPost {
  return {
    id: "post-1",
    workspaceId: "fake-ws",
    kind: "post",
    title: "Hello world",
    slug: "hello-world",
    bodyJson: {},
    status: "published",
    updatedAt: "2026-08-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useEntryPicker — injected port", () => {
  it("combines posts and pages from the fake port's seed, with no fetch involved", async () => {
    const networkMock = vi.fn();
    vi.stubGlobal("fetch", networkMock);
    const post = postFixture({ id: "post-1", kind: "post", title: "A post" });
    const page = postFixture({ id: "page-1", kind: "page", title: "A page" });
    const port = createFakeSeoPort({ posts: [post], pages: [page] });

    const { result } = renderHook(() => useEntryPicker(port, "en"));

    await waitFor(() => expect(result.current.entries).not.toBeNull());
    expect(result.current.entries).toEqual([post, page]);
    expect(result.current.error).toBeNull();
    expect(networkMock).not.toHaveBeenCalled();
  });

  it("surfaces a rejected port call's message on the error channel", async () => {
    const port = createFakeSeoPort();
    port.listPosts = () => Promise.reject(new Error("posts table locked"));

    const { result } = renderHook(() => useEntryPicker(port, "en"));

    await waitFor(() => expect(result.current.error).toBe("posts table locked"));
    expect(result.current.entries).toBeNull();
  });
});
