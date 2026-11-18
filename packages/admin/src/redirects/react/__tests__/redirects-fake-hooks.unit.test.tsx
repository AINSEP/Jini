import { render, screen } from "../../../__tests__/fetch-query-support.js";
import { describe, expect, it, vi } from "vitest";

import { createMemoryRedirectsApi } from "../../adapters/memory.js";
import { RedirectsPortsContext } from "../hooks/RedirectsPorts.hooks.js";
import type { useRedirectsPage } from "../hooks/RedirectsPage.hooks.js";
import { RedirectsPage } from "../pages/RedirectsPage.js";

/**
 * @file The redirects page renders from its injected page hook (hook-injection rule): the fake returns
 * a translator, header slot and rows the real hook could never produce, so seeing them proves the
 * injected hook fed the markup. The `jini-` class-prefix rule applies when the page moves.
 */
describe("RedirectsPage renders from its injected page hook", () => {
  it("shows the fake translator, header slot and rows", () => {
    const hook = vi.fn<typeof useRedirectsPage>(() => ({
      redirects: [], listStatus: "success", listError: null, error: null, saving: false, pendingDelete: null, confirmDelete: vi.fn(),
      deletePending: false, submitCreate: vi.fn(), t: (key: string) => `FAKE:${key}`, locale: "en", columns: [], deleteBody: null,
      cancelDelete: vi.fn(), headerActions: <span>FAKE-HEADER</span>, setPendingDelete: vi.fn(), createRedirect: vi.fn(), onToggleStatus: vi.fn(), onRequestDelete: vi.fn(), rowMenuHandles: [],
    }));
    render(<RedirectsPortsContext.Provider value={{ redirectsApi: createMemoryRedirectsApi({ redirects: [] }) }}><RedirectsPage useRedirectsPageHook={hook} /></RedirectsPortsContext.Provider>);
    expect(screen.getByText("FAKE:Redirects")).toBeTruthy();
    expect(screen.getByText("FAKE-HEADER")).toBeTruthy();
    expect(screen.getByText("FAKE:No redirect rules yet.")).toBeTruthy();
    expect(hook).toHaveBeenCalledOnce();
  });
});
