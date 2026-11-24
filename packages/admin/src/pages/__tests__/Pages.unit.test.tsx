// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminKitProvider } from "../../react/kit.js";
import { fakeAdminKit } from "../../react/testing-kit.js";
import { Pages, pagesListNotice, type PagesListSorting } from "../Pages.js";
import type { PagesController } from "../hooks/use-pages.hooks.js";
import type { PageListRow } from "../hooks/pages-port.hooks.js";

const identityT = (key: string): string => key;

/**
 * Moved from the host's `Pages.unit.test.tsx`, which keeps the full-screen suite (rendered through
 * the host wiring and its kits).
 *
 * `pagesListNotice` — pulled out of `Pages` (2026-08-06, complexity pass, fourth pass; see its own
 * doc). The states above already exercise it end to end through the full component; these pin the
 * function's own branch decisions directly, no render involved.
 */
describe("pagesListNotice", () => {
  it("returns the error notice when there is an error and no list yet", () => {
    expect(pagesListNotice({ pages: null, error: "boom", t: identityT })).not.toBeNull();
  });

  it("returns the loading notice when there is no list and no error", () => {
    expect(pagesListNotice({ pages: null, error: null, t: identityT })).not.toBeNull();
  });

  it("prioritizes the error branch over the loading branch when both conditions could apply", () => {
    render(<>{pagesListNotice({ pages: null, error: "boom", t: identityT })}</>);
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.queryByText("Loading pages…")).not.toBeInTheDocument();
  });

  it("returns null once the list has loaded, even with an error set (the inline-banner case)", () => {
    expect(pagesListNotice({ pages: [], error: "a later error", t: identityT })).toBeNull();
  });
});

/**
 * The host seams `Pages` takes as required props (the host's own suite renders the real bindings
 * through its wiring; these pin that each injected value is the one actually rendered/called).
 */
const PAGE: PageListRow = { id: "pg1", title: "About", slug: "about", bodyJson: {}, status: "published", updatedAt: "2026-08-01T12:34:00.000Z", version: 1 };

const SORTING: PagesListSorting<PageListRow> = {
  defaultSort: { column: "updated", direction: "desc" },
  compareByTitle: (a, b) => a.title.localeCompare(b.title),
  compareBySlug: (a, b) => a.slug.localeCompare(b.slug),
  compareByStatus: (a, b) => a.status.localeCompare(b.status),
  compareByUpdated: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
  columnSortLabel: ({ columnName }) => `sort ${columnName}`,
  updatedColumnSortLabel: () => "sort updated",
};

function controller(): PagesController<PageListRow> {
  return {
    pages: [PAGE], error: null, creating: false, rowSavingId: null, pendingDelete: null, setPendingDelete: vi.fn(),
    createPage: vi.fn(async () => {}), togglePagePublish: vi.fn(async () => {}), removePage: vi.fn(async () => {}),
    t: identityT, locale: "en", rowMenuHandleById: new Map([["pg1", "pages-row-pg1"]]),
  };
}

function renderPages() {
  const kit = fakeAdminKit();
  const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
  return render(
    <Pages
      usePagesHook={controller}
      useThemePagesHook={() => ({ pageCount: 7 })}
      ThemePagesTab={({ controller: theme }) => <p>theme-tab:{theme.pageCount}</p>}
      PublishSectionButton={({ section }) => <span data-testid="publish-section">{section}</span>}
      ServerLabel={({ value }) => <em>label:{value}</em>}
      sorting={SORTING}
      paths={{ pageAdminPath: (page) => `/pages/host-${page.id}`, pagePublicPath: ({ slug }) => `/public-${slug}`, siteUrl: ({ path }) => `https://site.test${path}` }}
    />,
    { wrapper },
  );
}

describe("Pages — injected host seams", () => {
  afterEach(() => { window.history.replaceState(null, "", "/"); });

  it("renders the host's PublishSectionButton for the pages section", () => {
    renderPages();
    expect(screen.getByTestId("publish-section").textContent).toBe("pages");
  });

  it("renders each row's status through the host's ServerLabel", () => {
    renderPages();
    expect(screen.getByText("label:published")).toBeInTheDocument();
  });

  it("builds the title and slug links from the host's paths", () => {
    renderPages();
    expect(screen.getByRole("link", { name: "About" }).getAttribute("href")).toContain("/pages/host-pg1");
    expect(screen.getByRole("link", { name: "/public-about" })).toHaveAttribute("href", "https://site.test/public-about");
  });

  it("hands the Theme Pages tab the controller the host's useThemePagesHook returned", () => {
    renderPages();
    expect(screen.queryByText("theme-tab:7")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Theme Pages" }));
    expect(screen.getByText("theme-tab:7")).toBeInTheDocument();
  });
});
