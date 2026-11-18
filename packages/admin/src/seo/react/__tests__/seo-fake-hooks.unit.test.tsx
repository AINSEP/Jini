import { fireEvent, render, screen } from "./harness/render.js";
import { describe, expect, it, vi } from "vitest";

import type { SeoEntryAnalysis, SeoEntryMeta, SeoSettings } from "../../models.js";
import type { SeoTabController } from "../hooks/SeoPage.hooks.js";
import type { useAnalyzePanel, useSeoDefaults, useSeoPageActions, useSeoTabs } from "../hooks/SeoPage.hooks.js";
import type { useSeoCopy, useSeoOptions } from "../hooks/SeoPorts.hooks.js";
import type { useWiredSeo } from "../hooks/use-seo.hooks.js";
import { AnalyzePanel } from "../components/AnalyzePanel.js";
import { MediaPickerBridge } from "../components/MediaPickerBridge.js";
import { SeoDefaultsTab } from "../tabs/SeoDefaultsTab.js";
import { SeoSitemapTab } from "../tabs/SeoSitemapTab.js";
import { Seo } from "../pages/SeoPage.js";

/**
 * @file One fake-hook output test per seo component that takes hooks as props (hook-injection rule).
 * The fake translator prefixes every key with `FAKE:`, which the real `useSeoCopy` can never
 * produce, so a rendered `FAKE:` string proves the injected hook fed the markup; handler fakes prove
 * the events reached the injected hooks rather than the real ones. The `jini-` class-prefix rule
 * applies when a component moves, so it is not asserted here.
 */

const fakeCopy: typeof useSeoCopy = () => ({ key }) => `FAKE:${key}`;
const SETTINGS: SeoSettings = {
  titleTemplate: "%s | Site", defaultDescription: "desc", twitterSite: "@site", defaultRobots: { noindex: false, nofollow: false }, sitemapEnabled: true, robotsRules: [],
};
const RESOLVED: SeoEntryMeta = {
  title: "t", canonical: "https://example.com/e", robots: { noindex: false, nofollow: false },
  openGraph: { title: "o", type: "article", url: "https://example.com/e" }, twitter: { card: "summary", title: "tw" }, jsonLd: [],
};
const ANALYSIS: SeoEntryAnalysis = { entryId: "e1", score: 99, issues: [], resolved: RESOLVED };
const controller = (extra: Partial<SeoTabController> = {}): SeoTabController => ({
  locale: "en", settings: SETTINGS, saving: false, save: vi.fn(), defaultOgImage: "", setDefaultOgImage: vi.fn(), regenerateSitemap: vi.fn(), openSitemapModal: vi.fn(), ...extra,
});

describe("seo components render from their injected hooks", () => {
  it("SeoDefaultsTab uses the fake translator and routes submit to the fake hook", () => {
    const submit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const hook = vi.fn<typeof useSeoDefaults>(() => ({ submit }));
    const c = controller();
    const { container } = render(<SeoDefaultsTab controller={c} useSeoCopyHook={fakeCopy} useSeoDefaultsHook={hook} />);
    expect(screen.getByText("FAKE:Search appearance")).toBeTruthy();
    fireEvent.submit(container.querySelector("form")!);
    expect(submit).toHaveBeenCalledOnce();
    expect(c.save).not.toHaveBeenCalled();
  });

  it("SeoSitemapTab uses the fake translator", () => {
    render(<SeoSitemapTab controller={controller()} useSeoCopyHook={fakeCopy} />);
    expect(screen.getByText("FAKE:Cached sitemap")).toBeTruthy();
  });

  it("AnalyzePanel shows the issues and tone the fake hook returns", () => {
    const hook = vi.fn<typeof useAnalyzePanel>(() => ({ sortedIssues: [{ code: "x", severity: "warning", message: "FAKE-ISSUE" }], tone: "warning" }));
    const { container } = render(<AnalyzePanel locale="en" analysis={ANALYSIS} useSeoCopyHook={fakeCopy} useAnalyzePanelHook={hook} />);
    expect(screen.getByText("FAKE:Analysis")).toBeTruthy();
    expect(screen.getByText("FAKE-ISSUE")).toBeTruthy();
    expect(container.querySelector(".jini-status-warning")).not.toBeNull();
  });

  it("MediaPickerBridge shows the error from the fake hook and wires Cancel to it", () => {
    const cancel = vi.fn();
    const hook = vi.fn<typeof import("../hooks/MediaPickerBridge.hooks.js").useMediaPickerBridge>(() => ({ error: "FAKE-ERROR", cancel }));
    render(<MediaPickerBridge onSelect={vi.fn()} onCancel={vi.fn()} useMediaPickerBridgeHook={hook} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("FAKE-ERROR")).toBeTruthy();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("Seo renders the shell from the fake hooks and reports tab changes through the fake actions hook", () => {
    const seo = vi.fn<typeof useWiredSeo>(() => ({
      settings: SETTINGS, error: null, saving: false, notice: "FAKE-NOTICE", save: vi.fn(), defaultOgImage: "", setDefaultOgImage: vi.fn(),
      regenerateSitemap: vi.fn(), sitemapModalOpen: false, openSitemapModal: vi.fn(), closeSitemapModal: vi.fn(), locale: "en",
    }));
    const changeTab = vi.fn();
    const actions = vi.fn<typeof useSeoPageActions>(() => ({ changeTab }));
    const tabs = vi.fn<typeof useSeoTabs>(() => ({ activeTabId: "sitemap", tabs: [{ id: "sitemap", label: "FAKE tab" }] }));
    const options = vi.fn<typeof useSeoOptions>(() => ({ siteUrl: () => "https://example.com", headerActions: <span>FAKE-HEADER</span> }));
    render(<Seo useSeoHook={seo} useSeoCopyHook={fakeCopy} useSeoOptionsHook={options} useSeoPageActionsHook={actions} useSeoTabsHook={tabs} />);
    expect(screen.getByText("FAKE-HEADER")).toBeTruthy();
    expect(screen.getByText("FAKE-NOTICE")).toBeTruthy();
    expect(screen.getByText("FAKE:Marketing")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "FAKE tab" }));
    expect(changeTab).toHaveBeenCalledWith("sitemap");
  });
});
