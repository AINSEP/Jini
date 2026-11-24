import { Icon, type TabBarTab } from "../../react/kit.js";

import { type Translate, resolveActiveTabId } from '@jini-ai/core/text';
/**
 * @file The Import & Export page's tabs (owner, 2026-10-25, option A): Export and Import moved here
 * from Sites, so they work on every host — the desktop app and a hosted install have no Sites
 * section, and their links to `/sites?tab=export|import` bounced to the dashboard. Other keeps the
 * cards that link elsewhere plus Git backup. `?tab=` names the tab, the same key every tabbed admin
 * screen uses and `panels.tsx` threads in. The Export and Import tabs' agent labels name the host's
 * archive format, so the host passes them in (`handleLabels`).
 */
export const IMPORT_EXPORT_TAB_IDS = ["export", "import", "other"] as const;
export type ImportExportTabId = (typeof IMPORT_EXPORT_TAB_IDS)[number];

/** Falls back to Export for an absent or unrecognized `?tab=`, through the shared guard Sites and
 *  Deployment use — a stale bookmark or a typo must open a tab, never a blank panel. */
/** The Export and Import tabs' agent labels: host copy, because they name the host's archive format. */
export interface ImportExportHandleLabels {
  export: string;
  import: string;
}

export function resolveImportExportTabId({ tabId }: { tabId: string | null | undefined }, _optional = {}): ImportExportTabId {
  return resolveActiveTabId({ tabId: tabId, validIds: IMPORT_EXPORT_TAB_IDS, defaultId: "export" });
}

/**
 * The three tabs, in the shape `TabBar` takes. Actions, so no counts. `handleLabels` are the
 * Export and Import tabs' agent labels (host copy, see {@link ImportExportHandleLabels}).
 * @complexity O(1) — a fixed array of three tabs.
 */
export function resolveImportExportTabs(
  { t, handleLabels }: { t: Translate; handleLabels: ImportExportHandleLabels },
  _options: Record<string, never> = {},
): TabBarTab[] {
  return [
    {
      id: "export",
      label: t("Export"),
      icon: <Icon name="tray-export" size={16} strokeWidth={1.5} />,
      handle: "import-export-tab-export",
      handleLabel: handleLabels.export,
    },
    {
      id: "import",
      label: t("Import"),
      // Import uses the same tray as Export, with the arrow pointing in.
      icon: <Icon name="tray-import" size={16} strokeWidth={1.5} />,
      handle: "import-export-tab-import",
      handleLabel: handleLabels.import,
    },
    {
      id: "other",
      label: t("Other"),
      // Other uses the three-dot ‘more’ mark for the remaining paths: static HTML and Git backup.
      icon: <Icon name="more-horizontal-outline" size={16} strokeWidth={1.5} />,
      handle: "import-export-tab-other",
      handleLabel: "Switch to the Other tab — static site export and Git backup",
    },
  ];
}
