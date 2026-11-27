// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SitesSidebarNav, type SitesSidebarNavList, type SitesSidebarNavProps } from "../SitesSidebarNav.js";
import { useSitesSidebarNav } from "../../hooks/use-sites-sidebar-nav.hooks.js";

const groups = [{ label: "Manage", items: [
  { id: "sites", label: "Sites", href: "/admin/sites" }, { id: "posts", label: "Posts", href: "/admin/posts" },
] }];
const SidebarNav: SitesSidebarNavList = ({ groups, soonLabel }) => (
  <nav id="admin-sidebar" aria-label={soonLabel}>
    {groups.flatMap(group => group.items.map(item => (
      <a key={item.id} className="cms-item" href={item.href}><span>{item.label}</span></a>
    )))}
  </nav>
);
const port = { listSites: vi.fn(async () => { throw new Error("Snapshot adapter owns reads"); }) };
const translateNavLabel = ({ locale, key }: { locale: string; key: string }) =>
  locale === "fr" && key === "Sites ({siteName})" ? "Sites de {siteName} !" : key;

it("adds a hidden split label only to the Sites row and shows its tooltip only when the site name overflows", async () => {
  let overflow = true;
  const measure = vi.fn((element: HTMLElement) => ({ clientWidth: 60, scrollWidth: element.textContent === "Montreal" && overflow ? 90 : 60 }));
  const useSitesSnapshot = vi.fn(() => ({ data: { currentSite: { name: "Montreal" } } }));
  const props: SitesSidebarNavProps = { groups, locale: "fr", soonLabel: "Site navigation", SidebarNav, port, useSitesSnapshot,
    translateNavLabel, useSidebar: () => ({ collapsed: false }), useSitesSidebarNavHook: useSitesSidebarNav, options: { doc: document, measure } };
  const { unmount } = render(<SitesSidebarNav {...props} />);
  const nav = screen.getByRole("navigation", { name: "Site navigation" });
  const sites = within(nav).getByRole("link", { name: "Sites de Montreal !" });
  const posts = within(nav).getByRole("link", { name: "Posts" });
  expect(useSitesSnapshot).toHaveBeenLastCalledWith({ port }, { enabled: true });
  expect(sites.getAttribute("data-cms-sites-split")).toBe("");
  expect(posts.hasAttribute("data-cms-sites-split")).toBe(false);
  const split = sites.querySelector(".jini-sites-label");
  expect(split?.getAttribute("aria-hidden")).toBe("true");
  expect(split?.textContent).toBe("Sites de Montreal !");
  const name = within(sites).getByTitle("Montreal");
  expect(name.textContent).toBe("Montreal");
  overflow = false;
  act(() => { window.dispatchEvent(new Event("resize")); });
  expect(name.hasAttribute("title")).toBe(false);
  const replacement = sites.cloneNode(false) as HTMLElement;
  sites.replaceWith(replacement);
  await waitFor(() => expect(replacement.querySelector(".jini-sites-name")?.textContent).toBe("Montreal"));
  expect(sites.hasAttribute("data-cms-sites-split")).toBe(false);
  // Restore React's original row so its normal unmount owns removal again.
  replacement.replaceWith(sites);
  await waitFor(() => expect(sites.getAttribute("data-cms-sites-split")).toBe(""));
  unmount();
  expect(sites.hasAttribute("data-cms-sites-split")).toBe(false);
});

it("leaves the plain nav label without a snapshot and disables reads when the Sites row is absent", () => {
  const useSitesSnapshot = vi.fn(() => ({}));
  const props: SitesSidebarNavProps = { groups, locale: "en", SidebarNav, port, useSitesSnapshot,
    translateNavLabel, useSidebar: () => ({ collapsed: false }), useSitesSidebarNavHook: useSitesSidebarNav };
  const { rerender } = render(<SitesSidebarNav {...props} />);
  const sites = screen.getByRole("link", { name: "Sites" });
  expect(sites.querySelector(".jini-sites-label")).toBeNull();
  rerender(<SitesSidebarNav {...props} groups={[{ items: [{ id: "posts", label: "Posts", href: "/admin/posts" }] }]} />);
  expect(useSitesSnapshot).toHaveBeenLastCalledWith({ port }, { enabled: false });
  expect(screen.queryByRole("link", { name: "Sites" })).toBeNull();
  expect(screen.getByRole("link", { name: "Posts" }).getAttribute("href")).toBe("/admin/posts");
});
