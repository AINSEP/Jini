import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit, fixtureQuery } from "../../../react/testing-kit.js";
import { createMemorySeoApi } from "../../adapters/memory.js";
import type { SitemapModalController } from "../../models.js";
import type { SeoMediaPickerSlotProps } from "../options.js";
import { EntryPicker } from "../components/EntryPicker.js";
import { SeoEntryPanel, SeoEntrySection } from "../components/SeoEntryPanel.js";
import { MediaRefField } from "../components/MediaRefField.js";
import { SitemapModal, SitemapModalBody, SitemapModalHeaderActions, SitemapModalTable } from "../components/SitemapModal.js";
import * as copyHooks from "../hooks/SeoPorts.hooks.js";
import * as pickerHooks from "../hooks/use-entry-picker.hooks.js";
import * as panelHooks from "../hooks/use-seo-entry-panel.hooks.js";
import * as sectionHooks from "../hooks/use-seo-entry-section.hooks.js";
import * as mediaHooks from "../hooks/MediaRefField.hooks.js";
import * as modalHooks from "../hooks/use-sitemap-modal.hooks.js";
import * as sitemapHooks from "../hooks/SitemapModal.hooks.js";

const fakeCopy: typeof copyHooks.useSeoCopy = () => ({ key }) => `FAKE:${key}`;

function KitScope({ children }: { children: ReactNode }) {
  const kit = fakeAdminKit({ query: fixtureQuery({ data: {
    posts: [{ id: "fake-entry", title: "Fake entry", status: "published" }], pages: [],
  } }) });
  return <AdminKitProvider kit={kit}>
    <copyHooks.SeoPortsContext.Provider value={{ seoApi: createMemorySeoApi({}) }}>
      <copyHooks.SeoOptionsContext.Provider value={{ siteUrl: () => "https://host.test" }}>
        {children}
      </copyHooks.SeoOptionsContext.Provider>
    </copyHooks.SeoPortsContext.Provider>
  </AdminKitProvider>;
}

function modalController(overrides: Partial<SitemapModalController> = {}): SitemapModalController {
  return {
    status: "ready", error: null, xmlText: "<urlset />", entries: [], filteredEntries: [],
    filter: "", setFilter: vi.fn(), view: "table", setView: vi.fn(), refetch: vi.fn(), ...overrides,
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("JM2-pre leftover components use injected hooks", () => {
  it("EntryPicker renders fake options and sends selection to its callback without real hooks", () => {
    const realPicker = vi.spyOn(pickerHooks, "useWiredEntryPicker");
    const realCopy = vi.spyOn(copyHooks, "useSeoCopy");
    const hook = vi.fn<typeof pickerHooks.useWiredEntryPicker>(() => ({
      entries: [{ id: "fake-entry", title: "Fake entry", status: "published" }], error: null,
      options: [{ value: "fake-entry", label: "FAKE OPTION", group: "Posts" }],
    }));
    const change = vi.fn();
    render(<EntryPicker locale="en" entryId="" onChange={change}
      useEntryPickerHook={hook} useSeoCopyHook={fakeCopy} />, { wrapper: KitScope });
    expect(screen.getByRole("option", { name: "FAKE OPTION" })).toHaveValue("fake-entry");
    fireEvent.change(screen.getByRole("combobox", { name: "FAKE:Entry" }), { target: { value: "fake-entry" } });
    expect(change).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledWith("fake-entry");
    expect(hook).toHaveBeenCalledOnce();
    expect(realPicker).not.toHaveBeenCalled();
    expect(realCopy).not.toHaveBeenCalled();
  });

  it("SeoEntryPanel renders the fake loading state and copy without real hooks", () => {
    const realPanel = vi.spyOn(panelHooks, "useWiredSeoEntryPanel");
    const realCopy = vi.spyOn(copyHooks, "useSeoCopy");
    const hook = vi.fn<typeof panelHooks.useWiredSeoEntryPanel>(() => ({
      resolved: null, analysis: null, loadError: null, saving: false, saveError: null, notice: null,
      fieldValue: (_key, value) => value, setField: vi.fn(), save: vi.fn(async () => {}), touched: {},
    }));
    render(<SeoEntryPanel locale="en" entryId="fake-entry" useSeoEntryPanelHook={hook} useSeoCopyHook={fakeCopy} />);
    expect(screen.getByText("FAKE:Loading entry SEO…")).toBeInTheDocument();
    expect(hook).toHaveBeenCalledOnce();
    expect(hook).toHaveBeenCalledWith({ entryId: "fake-entry" });
    expect(realPanel).not.toHaveBeenCalled();
    expect(realCopy).not.toHaveBeenCalled();
  });

  it("SeoEntrySection renders fake copy and routes entry changes to the fake state hook", () => {
    const realSection = vi.spyOn(sectionHooks, "useSeoEntrySection");
    const setEntryId = vi.fn();
    const hook = vi.fn<typeof sectionHooks.useSeoEntrySection>(() => ({ entryId: "", setEntryId }));
    render(<SeoEntrySection locale="en" useSeoEntrySectionHook={hook} useSeoCopyHook={fakeCopy} />, { wrapper: KitScope });
    expect(screen.getByRole("heading", { name: "FAKE:Per-entry SEO" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Entry" }), { target: { value: "fake-entry" } });
    expect(setEntryId).toHaveBeenCalledOnce();
    expect(setEntryId).toHaveBeenCalledWith("fake-entry");
    expect(hook).toHaveBeenCalledOnce();
    expect(realSection).not.toHaveBeenCalled();
  });

  it("MediaRefField renders the fake file, preview and picker and uses fake actions without real hooks", () => {
    const realField = vi.spyOn(mediaHooks, "useWiredMediaRefField");
    const realPresentation = vi.spyOn(mediaHooks, "useMediaRefPresentation");
    const realCopy = vi.spyOn(copyHooks, "useSeoCopy");
    const openPicker = vi.fn(), clear = vi.fn(), closePicker = vi.fn(), onChange = vi.fn();
    const hook = vi.fn<typeof mediaHooks.useWiredMediaRefField>(() => ({
      pickerOpen: true, openPicker, closePicker, clear, handleSelect: vi.fn(),
      previewUrl: "https://fake.test/preview.png", file: { name: "FAKE FILE", size: "12 × 34" }, accept: ["image/*"],
    }));
    const Picker = ({ onCancel }: SeoMediaPickerSlotProps) => <button onClick={onCancel}>FAKE PICKER</button>;
    const presentation = vi.fn<typeof mediaHooks.useMediaRefPresentation>(() => ({ Picker, storedReference: true }));
    render(<MediaRefField locale="en" id="fake-image" label="Social image" value="asset:public" onChange={onChange}
      useField={hook} useSeoCopyHook={fakeCopy} useMediaRefPresentationHook={presentation} />);
    expect(screen.getByText("FAKE FILE")).toBeInTheDocument();
    expect(screen.getByText("12 × 34")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Social image preview" })).toHaveAttribute("src", "https://fake.test/preview.png");
    fireEvent.click(screen.getByRole("button", { name: "FAKE:Choose image" }));
    fireEvent.click(screen.getByRole("button", { name: "FAKE:Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "FAKE PICKER" }));
    expect(openPicker).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(closePicker).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledOnce();
    expect(hook).toHaveBeenCalledWith({ value: "asset:public", onChange });
    expect(presentation).toHaveBeenCalledOnce();
    expect(presentation).toHaveBeenCalledWith({ value: "asset:public" });
    expect(realField).not.toHaveBeenCalled();
    expect(realPresentation).not.toHaveBeenCalled();
    expect(realCopy).not.toHaveBeenCalled();
  });

  it("SitemapModal renders fake state and title and routes regeneration through the fake action hook", () => {
    const realModal = vi.spyOn(modalHooks, "useWiredSitemapModal");
    const realRegenerate = vi.spyOn(sitemapHooks, "useSitemapModalRegenerate");
    const modal = modalController({ view: "raw", xmlText: "<urlset>FAKE XML</urlset>" });
    const hook = vi.fn<typeof modalHooks.useWiredSitemapModal>(() => modal);
    const presentation = vi.fn<typeof sitemapHooks.useSitemapPresentation>(() => ({ title: "FAKE TITLE", sourceUrl: "https://fake.test/sitemap.xml" }));
    const handleRegenerate = vi.fn(async () => true), onRegenerate = vi.fn(async () => false), onClose = vi.fn();
    const regenerate = vi.fn<typeof sitemapHooks.useSitemapModalRegenerate>(() => ({ handleRegenerate }));
    render(<SitemapModal locale="en" sitemapEnabled regenerating={false} onRegenerate={onRegenerate} onClose={onClose}
      useModal={hook} useSeoCopyHook={fakeCopy} useSitemapPresentationHook={presentation}
      useSitemapModalRegenerateHook={regenerate} />, { wrapper: KitScope });
    expect(screen.getByRole("dialog", { name: "FAKE TITLE" })).toBeInTheDocument();
    expect(screen.getByText("<urlset>FAKE XML</urlset>")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "FAKE:Regenerate sitemap" }));
    fireEvent.click(screen.getByRole("button", { name: "FAKE:Close" }));
    expect(handleRegenerate).toHaveBeenCalledOnce();
    expect(onRegenerate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(hook).toHaveBeenCalledOnce();
    expect(hook).toHaveBeenCalledWith({ enabled: true, onClose });
    expect(presentation).toHaveBeenCalledOnce();
    expect(presentation).toHaveBeenCalledWith({ locale: "en", modal });
    expect(regenerate).toHaveBeenCalledOnce();
    expect(regenerate).toHaveBeenCalledWith({ onRegenerate });
    expect(realModal).not.toHaveBeenCalled();
    expect(realRegenerate).not.toHaveBeenCalled();
  });

  it("SitemapModalHeaderActions uses the fake source, copy and toggle without real hooks", () => {
    const realPresentation = vi.spyOn(sitemapHooks, "useSitemapPresentation");
    const realToggle = vi.spyOn(sitemapHooks, "useSitemapViewToggle");
    const realCopy = vi.spyOn(copyHooks, "useSeoCopy");
    const modal = modalController();
    const presentation = vi.fn<typeof sitemapHooks.useSitemapPresentation>(() => ({ title: "FAKE TITLE", sourceUrl: "https://fake.test/source.xml" }));
    const toggleView = vi.fn();
    const toggle = vi.fn<typeof sitemapHooks.useSitemapViewToggle>(() => ({ toggleView }));
    render(<SitemapModalHeaderActions locale="en" modal={modal} useSeoCopyHook={fakeCopy}
      useSitemapPresentationHook={presentation} useSitemapViewToggleHook={toggle} />);
    expect(screen.getByRole("link", { name: "FAKE:sitemap.xml ↗" })).toHaveAttribute("href", "https://fake.test/source.xml");
    fireEvent.click(screen.getByRole("button", { name: "FAKE:Raw XML" }));
    expect(toggleView).toHaveBeenCalledOnce();
    expect(modal.setView).not.toHaveBeenCalled();
    expect(presentation).toHaveBeenCalledOnce();
    expect(presentation).toHaveBeenCalledWith({ locale: "en", modal });
    expect(toggle).toHaveBeenCalledOnce();
    expect(toggle).toHaveBeenCalledWith({ modal });
    expect(realPresentation).not.toHaveBeenCalled();
    expect(realToggle).not.toHaveBeenCalled();
    expect(realCopy).not.toHaveBeenCalled();
  });

  it("SitemapModalBody renders disabled copy from its fake hook without the real hook", () => {
    const realCopy = vi.spyOn(copyHooks, "useSeoCopy");
    render(<SitemapModalBody locale="en" sitemapEnabled={false} modal={modalController({ status: "disabled" })}
      useSeoCopyHook={fakeCopy} />);
    expect(screen.getByText('FAKE:Sitemap is off. Turn on "Sitemap enabled" above to publish one.')).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(realCopy).not.toHaveBeenCalled();
  });

  it("SitemapModalTable uses fake copy, date formatting and row handles without real hooks", () => {
    const realCopy = vi.spyOn(copyHooks, "useSeoCopy");
    const realOptions = vi.spyOn(copyHooks, "useSeoOptions");
    const realTable = vi.spyOn(sitemapHooks, "useSitemapTable");
    const entries = [{ loc: "https://fake.test/page", lastmod: "2026-11-18" }];
    const modal = modalController({ entries, filteredEntries: entries });
    const formatDate = vi.fn(() => "FAKE DATE");
    const options = vi.fn<typeof copyHooks.useSeoOptions>(() => ({ siteUrl: () => "https://fake.test", formatDate }));
    const table = vi.fn<typeof sitemapHooks.useSitemapTable>(() => ({ rowHandles: ["fake-sitemap-row"] }));
    render(<SitemapModalTable locale="en" modal={modal} useSeoCopyHook={fakeCopy}
      useSeoOptionsHook={options} useSitemapTableHook={table} />);
    expect(screen.getByRole("columnheader", { name: "FAKE:Last modified" })).toBeInTheDocument();
    expect(screen.getByText("FAKE DATE")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: entries[0]!.loc })).toHaveAttribute("data-agent-element", "fake-sitemap-row");
    fireEvent.change(screen.getByRole("searchbox", { name: "FAKE:Filter sitemap URLs" }), { target: { value: "page" } });
    expect(modal.setFilter).toHaveBeenCalledOnce();
    expect(modal.setFilter).toHaveBeenCalledWith("page");
    expect(formatDate).toHaveBeenCalledOnce();
    expect(formatDate).toHaveBeenCalledWith({ iso: "2026-11-18" });
    expect(table).toHaveBeenCalledOnce();
    expect(table).toHaveBeenCalledWith({ modal });
    expect(options).toHaveBeenCalledOnce();
    expect(realCopy).not.toHaveBeenCalled();
    expect(realOptions).not.toHaveBeenCalled();
    expect(realTable).not.toHaveBeenCalled();
  });
});
