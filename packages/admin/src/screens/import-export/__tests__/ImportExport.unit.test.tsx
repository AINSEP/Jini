// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { ImportExport, type ImportExportProps, type ImportExportSiteExportTab, type ImportExportSiteImportTab } from "../ImportExport.js";
import { IMPORT_EXPORT_DICT, t } from "../import-export-i18n.js";
import { resolveImportExportTabId, resolveImportExportTabs } from "../import-export-tabs.js";
import { EMPTY_GIT_BACKUP_FORM } from "../git-backup-rules.js";
import type { GitBackupController } from "../hooks/use-git-backup.hooks.js";

/**
 * @file Characterization of the moved Import & Export screen under the Jini test kit: the tabs, the
 * host-injected Sites tabs and hooks, the Other tab's cards, and its dictionary. The real Sites tabs
 * and the host's `useSitesSectionAvailable` stay tested in Tovu's `ImportExport.unit.test.tsx`.
 */

const kit = fakeAdminKit();
function Kit({ children }: { children: ReactNode }) { return <AdminKitProvider kit={kit}>{children}</AdminKitProvider>; }

/** A Git backup controller with no saved connection, so the card shows its Source Control link. */
const noConnection: GitBackupController = {
  connections: [], connectionsError: null, form: EMPTY_GIT_BACKUP_FORM, setField: () => {}, canPlan: false, phase: "idle",
  plan: null, progress: null, done: null, message: null, planBackup: async () => {}, pushBackup: async () => {}, reset: () => {},
};
const identity = () => (key: string) => key;
const handleLabels = { export: "Switch to Export (host label)", import: "Switch to Import (host label)" };
/** Stand-ins for the host's Sites tabs: they show which translator and which `canMakeSites` they got. */
const SiteExportTab: ImportExportSiteExportTab = ({ t: translate }) => <button type="button">{translate("Export this site")}</button>;
const SiteImportTab: ImportExportSiteImportTab = ({ t: translate, canMakeSites }) => <p>{translate("Import")} {canMakeSites ? "can make sites" : "cannot make sites"}</p>;

/** Every navigation the screen asks the host router for. */
const navigate = vi.fn<ImportExportProps["navigate"]>();

function renderPanel(tabId: string | null, overrides: Partial<ImportExportProps> = {}) {
  return render(
    <ImportExport
      tabId={tabId} useTranslate={identity} useGitBackup={() => noConnection} useTransferTranslate={() => (key) => `sites:${key}`}
      useSitesAvailable={() => false} SiteExportTab={SiteExportTab} SiteImportTab={SiteImportTab} handleLabels={handleLabels} navigate={navigate} {...overrides}
    />,
    { wrapper: Kit },
  );
}

afterEach(() => { cleanup(); navigate.mockClear(); });

describe("Import & Export tabs (owner, 2026-10-25, option A)", () => {
  it("opens Export by default with the host's Export tab on the Sites translator, and no Publish button", () => {
    renderPanel(null);
    expect(screen.getByRole("heading", { level: 1, name: "Import & Export" })).toBeTruthy();
    expect(screen.queryByText("Operations")).toBeNull();
    expect(screen.getByRole("tab", { name: /Export/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "sites:Export this site" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("opens Import from ?tab=import and passes whether the host can make sites", () => {
    const view = renderPanel("import");
    expect(screen.getByRole("tab", { name: /Import/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("sites:Import cannot make sites")).toBeTruthy();
    view.unmount();
    renderPanel("import", { useSitesAvailable: () => true });
    expect(screen.getByText("sites:Import can make sites")).toBeTruthy();
  });

  it("keeps the Static Site card and Git backup on Other", () => {
    renderPanel("other");
    expect(screen.getByRole("tab", { name: /Other/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("link", { name: "Open Static Site" }).getAttribute("href")).toBe("/admin/deployment?tab=static-site");
    expect(screen.queryByRole("link", { name: /Open (Export|Import) Site/ })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Git backup" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Source Control" }).getAttribute("href")).toBe("/admin/source-control");
    expect(document.querySelector(".jini-card.jini-import-export-card .jini-btn-secondary")).toBeTruthy();
  });

  it("falls back to Export for an unknown or absent ?tab=", () => {
    expect(resolveImportExportTabId({ tabId: "other" })).toBe("other");
    expect(resolveImportExportTabId({ tabId: "import" })).toBe("import");
    expect(resolveImportExportTabId({ tabId: "Import" })).toBe("export");
    expect(resolveImportExportTabId({ tabId: "static" })).toBe("export");
    expect(resolveImportExportTabId({ tabId: null })).toBe("export");
    expect(resolveImportExportTabId({ tabId: undefined })).toBe("export");
    renderPanel("nope");
    expect(screen.getByRole("tab", { name: /Export/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows every tab without a Soon tag, every tab navigates in place, and the host labels reach the tabs", () => {
    renderPanel("other");
    expect(document.querySelector(".jini-page.jini-import-export-page")).toBeTruthy();
    for (const [name, search] of [[/Export/, "?tab=export"], [/Import/, "?tab=import"], [/Other/, "?tab=other"]] as const) {
      const tab = screen.getByRole("tab", { name: name });
      expect(tab.hasAttribute("disabled")).toBe(false);
      fireEvent.click(tab);
      expect(navigate).toHaveBeenLastCalledWith({ routePath: `/import-export${search}` }, { replace: true });
    }
    expect(navigate).toHaveBeenCalledTimes(3);
    const tabs = resolveImportExportTabs({ t: (key) => key, handleLabels });
    expect(tabs.map((tab) => [tab.id, tab.label, tab.tag, tab.handle, tab.handleLabel])).toEqual([
      ["export", "Export", undefined, "import-export-tab-export", "Switch to Export (host label)"],
      ["import", "Import", undefined, "import-export-tab-import", "Switch to Import (host label)"],
      ["other", "Other", undefined, "import-export-tab-other", "Switch to the Other tab — static site export and Git backup"],
    ]);
  });
});

it("renders through the translator it is given, and hands it to the Git backup hook", () => {
  const seen: string[] = [];
  renderPanel("other", { useTranslate: () => (key) => `[${key}]`, useGitBackup: ({ t: translate }) => { seen.push(translate("x")); return noConnection; } });
  expect(screen.getByRole("heading", { level: 1, name: "[Import & Export]" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /\[Other\]/ })).toBeTruthy();
  expect(screen.getByText("[Read-only HTML of the published pages, for any static host.]")).toBeTruthy();
  expect(seen[0]).toBe("[x]");
});

it("carries every key in every locale and falls back to the common dictionary", () => {
  const keys = Object.keys(IMPORT_EXPORT_DICT.es!);
  for (const [locale, entries] of Object.entries(IMPORT_EXPORT_DICT)) expect(Object.keys(entries), locale).toEqual(keys);
  expect(keys).toEqual(expect.arrayContaining(["Export", "Import", "Other"]));
  expect(keys).not.toContain("Soon");
  expect(t({ locale: "fr", key: "Open" })).toBe("Ouvrir");
  expect(t({ locale: "fr", key: "Other" })).toBe("Autres");
  expect(keys).not.toContain("Cancel");
  expect(t({ locale: "fr", key: "Cancel" })).not.toBe("Cancel");
});
