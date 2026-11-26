// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { screen, within } from "@testing-library/react";
import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Dashboard, type DashboardLinks, type DashboardProps } from "../Dashboard.js";
import type { DashboardController } from "../hooks/use-dashboard.hooks.js";
import type { DashboardActivityRow } from "../dashboard-view.types.js";
import { activityRowHref } from "../rules.js";

/**
 * @file `Dashboard`'s markup against an injected controller — no port, no fetch. The host's
 * end-to-end screen test drives the same component through its real wiring; this file pins what the
 * component itself owns: each stat card's states, the activity panel's four states, and that every
 * href and action is the injected one.
 */

const LINKS: DashboardLinks = {
  posts: "/x/posts", pages: "/x/pages", media: "/x/media", comments: "/x/comments", themes: "/x/themes",
  changePassword: "/x/users/change-password", viewSite: "https://site.example/", activityRow: activityRowHref,
};

function row(overrides: Partial<DashboardActivityRow>): DashboardActivityRow {
  return { id: "r", kind: "post", slug: "r", title: "R", status: "draft", updatedAt: "2026-07-01T09:00:00.000Z", ...overrides };
}

function controller(overrides: Partial<DashboardController> = {}): DashboardController {
  return {
    posts: { value: 3, error: null }, published: 2, pages: { value: 2, error: null }, drafts: 2,
    media: { value: 2, error: null }, comments: { value: 4, error: null },
    themeId: "editorial", themeName: "Editorial", themeError: null, recent: [], t: (key) => key,
    showDefaultPasswordBanner: false, dismissDefaultPasswordBanner: () => {},
    showSiteKeyBanner: false, siteKeyBannerMessage: "",
    ...overrides,
  };
}

function renderDashboard(state: Partial<DashboardController> = {}, props: Partial<DashboardProps> = {}) {
  return renderWithAdminKit(
    <Dashboard
      useDashboardHook={() => controller(state)}
      usePublishToLiveAvailableHook={() => true}
      useRecentActivityDisclosureHook={() => ({ open: true, toggle: () => {}, panelId: "recent-panel" })}
      onPublishAll={() => {}}
      links={LINKS}
      {...props}
    />,
  );
}

function statCard(container: HTMLElement, label: string): HTMLElement {
  const labelEl = Array.from(container.querySelectorAll(".jini-dash-stat-label")).find((el) => el.textContent === label);
  const card = labelEl?.closest(".jini-dash-stat");
  if (!card) throw new Error(`no stat card labeled "${label}"`);
  return card as HTMLElement;
}

describe("stat cards", () => {
  it("render each value, its meta line and the injected link", () => {
    const { container } = renderDashboard();
    expect(within(statCard(container, "Posts")).getByText("3")).toBeInTheDocument();
    expect(within(statCard(container, "Posts")).getByText("2 published")).toBeInTheDocument();
    expect(within(statCard(container, "Pages")).getByText("2 drafts")).toBeInTheDocument();
    expect(within(statCard(container, "Comments")).getByText("awaiting moderation")).toBeInTheDocument();
    expect(statCard(container, "Media")).toHaveAttribute("href", "/x/media");
    expect(statCard(container, "Comments")).toHaveAttribute("href", "/x/comments");
  });

  it("show a failed stat's own reason and an em-dash, leaving the others intact", () => {
    const { container } = renderDashboard({ media: { value: null, error: "media unavailable" } });
    expect(within(statCard(container, "Media")).getByText("—")).toHaveClass("jini-dash-is-error");
    expect(within(statCard(container, "Media")).getByText("media unavailable")).toHaveClass("jini-dash-is-error");
    expect(within(statCard(container, "Posts")).getByText("3")).not.toHaveClass("jini-dash-is-error");
  });

  it("read '…' while a value is pending", () => {
    const { container } = renderDashboard({ posts: { value: null, error: null } });
    expect(within(statCard(container, "Posts")).getByText("…")).toBeInTheDocument();
  });
});

describe("Recently updated panel", () => {
  it("renders the controller's rows in order, at most six, with the injected row hrefs", () => {
    const recent = Array.from({ length: 7 }, (_, i) => row({ id: `p${i}`, slug: `s${i}`, title: `Row ${i}`, kind: i === 0 ? "page" : "post" }));
    const { container } = renderDashboard({ recent });
    const titles = Array.from(container.querySelectorAll<HTMLAnchorElement>(".jini-dash-activity-title"));
    expect(titles.map((el) => el.textContent)).toEqual(["Row 0", "Row 1", "Row 2", "Row 3", "Row 4", "Row 5"]);
    expect(titles[0]).toHaveAttribute("href", "/admin/pages");
    expect(titles[1]).toHaveAttribute("href", "/admin/posts/s1");
  });

  it("names an untitled row Untitled", () => {
    renderDashboard({ recent: [row({ title: "" })] });
    expect(screen.getByRole("link", { name: "Untitled" })).toBeInTheDocument();
  });

  it("shows the empty state when there are no posts or pages yet", () => {
    const { container } = renderDashboard({ recent: [] });
    expect(screen.getByText("Nothing published or drafted yet.")).toBeInTheDocument();
    expect(screen.getByText("Create a post or page and it will show up here.")).toBeInTheDocument();
    expect(container.querySelector(".jini-dash-activity")).toBeNull();
  });

  it("shows Loading… while neither source has settled", () => {
    renderDashboard({ recent: null });
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("Nothing published or drafted yet.")).not.toBeInTheDocument();
  });

  it("shows an alert instead of Loading… when both sources failed", () => {
    renderDashboard({ recent: null, posts: { value: null, error: "posts down" }, pages: { value: null, error: "pages down" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load recent activity. posts down");
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("hides the body while the injected disclosure is closed, keeping All posts on the injected link", () => {
    renderDashboard({ recent: [row({ title: "Hidden row" })] }, {
      useRecentActivityDisclosureHook: () => ({ open: false, toggle: () => {}, panelId: "recent-panel" }),
    });
    expect(screen.getByRole("button", { name: "Recently updated" })).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("recent-panel")).not.toBeVisible();
    expect(screen.getByRole("link", { name: "All posts" })).toHaveAttribute("href", "/x/posts");
  });
});

describe("header, banners and appearance", () => {
  it("Publish All calls the injected action, and View site uses the injected href", async () => {
    const onPublishAll = vi.fn();
    renderDashboard({}, { onPublishAll });
    await userEvent.click(screen.getByRole("button", { name: "Publish All" }));
    expect(onPublishAll).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "View site ↗" })).toHaveAttribute("href", "https://site.example/");
  });

  it("hides Publish All when the injected availability hook reports false", () => {
    renderDashboard({}, { usePublishToLiveAvailableHook: () => false });
    expect(screen.queryByRole("button", { name: "Publish All" })).not.toBeInTheDocument();
  });

  it("renders the password banner with the injected change-password link and dismiss", async () => {
    const dismissDefaultPasswordBanner = vi.fn();
    renderDashboard({ showDefaultPasswordBanner: true, dismissDefaultPasswordBanner });
    expect(screen.getByRole("link", { name: "Change password" })).toHaveAttribute("href", "/x/users/change-password");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(dismissDefaultPasswordBanner).toHaveBeenCalledTimes(1);
  });

  it("renders the site-key banner's message only when asked to", () => {
    const { container, unmount } = renderDashboard({ showSiteKeyBanner: false, siteKeyBannerMessage: "key trouble" });
    expect(container.querySelector(".jini-dash-site-key-banner")).toBeNull();
    unmount();
    renderDashboard({ showSiteKeyBanner: true, siteKeyBannerMessage: "key trouble" });
    expect(screen.getByText("key trouble")).toBeInTheDocument();
  });

  it("shows the active theme and the injected Themes link, or the theme error alone", () => {
    const { unmount } = renderDashboard();
    expect(screen.getByText("Editorial")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change" })).toHaveAttribute("href", "/x/themes");
    unmount();
    renderDashboard({ themeError: "theme unavailable" });
    expect(screen.getByRole("alert")).toHaveTextContent("theme unavailable");
    expect(screen.queryByText("Active theme")).not.toBeInTheDocument();
  });
});

it("collapsed and error dashboard states match the shipped selectors", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../dashboard.css"), "utf8");
  const { container } = renderDashboard({ media: { value: null, error: "media unavailable" } }, {
    useRecentActivityDisclosureHook: () => ({ open: false, toggle: () => {}, panelId: "recent-panel" }),
  });
  expect(container.querySelector(".jini-dash-is-collapsed")).not.toBeNull();
  expect(within(statCard(container, "Media")).getByText("—")).toHaveClass("jini-dash-is-error");
  for (const node of container.querySelectorAll("[class]")) {
    for (const token of node.classList) if (token.startsWith("jini-dash-")) expect(css).toContain(`.${token}`);
  }
  expect(css).not.toMatch(/\.jini-dash-[^{}]*\.is-(error|collapsed)\b/);
});
