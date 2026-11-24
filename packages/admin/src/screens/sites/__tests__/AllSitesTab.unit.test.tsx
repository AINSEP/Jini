// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { AllSitesTab, type AllSitesTabProps } from "../AllSitesTab.js";
import type { AllSitesPolicy, SitesCardKit, SitesListView, SitesScreenSite, UseSitesListViewHook } from "../sites-screen-ports.js";

/**
 * @file All sites: the created-site notice, the host's empty state, and each card drawn through the
 * injected card kit, preview hook and policy. The fakes are plain components and functions (no
 * module mocks); every assertion is on rendered DOM or recorded calls.
 */

type Prefs = { hidden: string[] };
const kit = fakeAdminKit();
const renderWithAdminKit = (ui: ReactElement) => render(ui, { wrapper: ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider> });
const t = (key: string) => key;

const cardKit: SitesCardKit<SitesListView> = {
  SiteCard: (p) => <article title={p.title} data-name={p.name}>
    {p.previewSrc ? <img alt="" src={p.previewSrc} onError={p.onPreviewError} /> : null}
    <h3>{p.name}</h3>{p.nameDetail}{p.nameExtra}{p.menu}<p data-part="details">{p.details}</p>{p.status}{p.notes}{p.actions}
  </article>,
  SiteCardPin: (p) => <button type="button" aria-pressed={p.pinned} onClick={p.onToggle}>{p.label}</button>,
  SiteCardStatus: (p) => <span data-tone={p.tone} title={p.title}>{p.label}</span>,
  SiteListToolbar: (p) => <div role="toolbar">{p.copy.all}</div>,
};

function policy(overrides: Partial<AllSitesPolicy> = {}): AllSitesPolicy {
  return {
    resolveSitesEmpty: ({ sites }) => sites.length === 0,
    resolveSitesRowHandles: ({ sites }) => sites.map((site) => `site-${site.name}`),
    resolveSiteListItems: ({ sites }) => sites.map((site) => ({ id: site.name, name: site.name, createdAt: site.createdAt, site })),
    resolveSiteCardView: ({ site }) => ({ lifecycle: { action: "stop", labelKey: "Stop", className: "host-btn", disabled: false }, openUrl: `https://${site.name}.test/admin/`, menu: ["trash"], noteKey: "Serving note" }),
    buildSiteCardMenuItems: ({ menu }, { hide }) => [...(menu as string[]).map((key) => ({ key, label: key, onSelect: () => {} })), ...(hide ? [{ key: "hide", label: hide.label, onSelect: hide.onSelect }] : [])],
    resolveSiteStatusPill: () => ({ toneClass: "status-ok", label: "Running" }),
    resolveSiteRunningTitle: ({ site }) => `Running ${site.name}`,
    resolveSiteCardMeta: ({ site, activatingName }) => (activatingName === site.name ? "Saving…" : null),
    resolveSiteIsDefault: ({ site }) => site.name === "atlas",
    resolveSiteCardTitle: (site) => `/sites/${site.name}`,
    resolveSiteSubtitle: (site) => (site.displayName === site.name ? null : site.displayName),
    resolveSiteRegistrationBadge: ({ site }) => (site.name === "boreal" ? { labelKey: "Not initialized", titleKey: "No config here" } : null),
    ...overrides,
  };
}

const sites: SitesScreenSite[] = [{ name: "atlas", displayName: "Atlas Co", createdAt: "2026-09-30" }, { name: "boreal", displayName: "boreal", createdAt: "2026-09-29" }];

function listHook(toggleHidden = vi.fn()): UseSitesListViewHook<Prefs, SitesListView> {
  return ({ items, prefs }) => ({
    visible: items.filter((item) => !prefs.hidden.includes(item.id)), allCount: items.length, hiddenCount: prefs.hidden.length,
    isPinned: () => false, togglePin: () => {}, isHidden: (id) => prefs.hidden.includes(id), toggleHidden,
  });
}

function props(overrides: Partial<AllSitesTabProps<Prefs, SitesListView>> = {}): AllSitesTabProps<Prefs, SitesListView> {
  return {
    sites, snapshot: { previewVersions: { atlas: 7 } }, switchingEnabled: true, activatingName: null, createdName: null, onActivate: () => {},
    listPrefs: { prefs: { hidden: [] }, ready: true, onPrefsChange: () => {}, loadError: null, saveError: null },
    useSiteListViewHook: listHook(), emptyState: { leadKey: "Host lead", newSiteHref: "/host/sites?tab=new" },
    policy: policy(), cardKit, previewUrlFor: ({ name, version }) => `/preview/${name}?v=${version}`,
    useSiteCardPreviewHook: ({ site, snapshot, urlFor }) => {
      const version = snapshot.previewVersions?.[site.name];
      return { src: version === undefined ? null : urlFor({ name: site.name, version }), onError: () => {} };
    },
    t, ...overrides,
  };
}

describe("AllSitesTab", () => {
  it("shows the created notice with token names verbatim, and nothing without a create", () => {
    const { rerender, container } = renderWithAdminKit(<AllSitesTab {...props({ createdName: "atlas", createdAdminLogin: "admin / pw", createdTokens: { names: ["Supabase", "Atlas Cloud"], note: "will connect" } })} />);
    const notice = container.querySelector(".jini-save-ok")!;
    expect(notice.textContent).toBe("atlas was created. Start it to open its admin.admin / pw Supabase, Atlas Cloud will connect");
    expect(within(notice as HTMLElement).getByText("Supabase, Atlas Cloud").tagName).toBe("STRONG");
    rerender(<AllSitesTab {...props()} />);
    expect(container.querySelector(".jini-save-ok")).toBeNull();
  });

  it("renders the host's empty-state lead and New site address when nothing is listed", () => {
    renderWithAdminKit(<AllSitesTab {...props({ sites: [] })} />);
    expect(screen.getByText("Host lead")).toHaveClass("jini-sites-empty-lead");
    expect(screen.getByRole("link", { name: "New site" })).toHaveAttribute("href", "/host/sites?tab=new");
  });

  it("draws each card from the policy, the injected preview address and the card kit", () => {
    // Mutation: run the card's lifecycle button with a fixed "start" instead of the policy's action.
    const run = vi.fn();
    renderWithAdminKit(<AllSitesTab {...props({ localSites: { busyName: null, checked: {}, toggleChecked: () => {}, run } })} />);
    const atlas = screen.getByTitle("/sites/atlas");
    expect(atlas.querySelector("img")?.getAttribute("src")).toBe("/preview/atlas?v=7");
    expect(within(atlas).getByText("Atlas Co")).toHaveClass("jini-site-card-display-name");
    expect(within(atlas).getByRole("img", { name: "Opens by default" })).toHaveClass("jini-site-card-default");
    expect(within(atlas).getByText("Running")).toHaveAttribute("data-tone", "running");
    expect(within(atlas).getByText("Running")).toHaveAttribute("title", "Running atlas");
    expect(within(atlas).getByText("Serving note")).toHaveClass("jini-field-hint");
    expect(within(atlas).getByRole("link", { name: "Open atlas in a new tab" })).toHaveAttribute("href", "https://atlas.test/admin/");
    fireEvent.click(within(atlas).getByRole("button", { name: "Stop atlas" }));
    expect(run.mock.calls).toEqual([["atlas", "stop"]]);
    const boreal = screen.getByTitle("/sites/boreal");
    expect(boreal.querySelector("img")).toBeNull();
    expect(within(boreal).getByText("Not initialized")).toHaveAttribute("title", "No config here");
    expect(screen.getByRole("toolbar").textContent).toBe("Show all (2)");
  });

  it("offers Hide in each card's menu through the list view, and says when every site is hidden", () => {
    const toggleHidden = vi.fn();
    const { rerender } = renderWithAdminKit(<AllSitesTab {...props({ useSiteListViewHook: listHook(toggleHidden) })} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for boreal" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide from list" }));
    expect(toggleHidden.mock.calls).toEqual([["boreal"]]);
    rerender(<AllSitesTab {...props({ listPrefs: { prefs: { hidden: ["atlas", "boreal"] }, ready: true, onPrefsChange: () => {}, loadError: "disk full", saveError: null } })} />);
    expect(screen.getByText("Every site is hidden. Open Hidden to bring one back.")).toBeInTheDocument();
    expect(screen.getByText("Your saved list choices could not be loaded: disk full. Changes apply until you reload.")).toHaveClass("jini-notice-error");
  });

  it("waits for the remembered list choices before drawing the grid", () => {
    renderWithAdminKit(<AllSitesTab {...props({ listPrefs: { prefs: { hidden: [] }, ready: false, onPrefsChange: () => {}, loadError: null, saveError: null } })} />);
    expect(screen.queryByRole("group", { name: "Sites" })).toBeNull();
  });
});
