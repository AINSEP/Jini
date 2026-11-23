import type { ComponentType } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";

import { TabBar } from "../../react/kit.js";
import { navigate } from "../../shell/lib/router.js";
import { IMPORT_EXPORT_LINKS, type ImportExportLink } from "./import-export-links.js";
import { resolveImportExportTabId, resolveImportExportTabs, type ImportExportHandleLabels, type ImportExportTabId } from "./import-export-tabs.js";
import type { GitBackupController } from "./hooks/use-git-backup.hooks.js";
import { GitBackupCard } from "./GitBackupCard.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file Operations → Import & Export (`/admin/import-export`). Three tabs (owner, 2026-10-25,
 * option A): Export and Import render the Sites screen's own Export Site / Import Site tabs as they
 * are — moved here because the desktop app and a hosted install have no Sites section, so the links
 * this page used to hold bounced to the dashboard. Other is still a hub, not a second copy of any
 * flow: one card per screen elsewhere that moves a site (see `import-export-links.ts`), plus the Git
 * backup card, whose flow lives here because it has no other screen (`GitBackupCard.tsx`).
 *
 * Host wiring: every hook, the two Sites tab components and the tabs' agent labels are required
 * props (the host's mount passes its locale-bound translators, its live Git backup controller, its
 * Sites availability rule and its Sites tabs). Classes are `jini-*`: the generic page/card/button
 * aliases plus `jini-import-export-*` (host aliases of its `import-export-*` rules).
 */

/** A Sites transfer tab the host renders inside Export or Import (`t` is the Sites dictionary). */
export type ImportExportSiteExportTab = ComponentType<{ t: Translate }>;
export type ImportExportSiteImportTab = ComponentType<{ t: Translate; canMakeSites?: boolean }>;
/** The Git backup controller hook, bound by the host to its live port (tests pass a fake). */
export type UseImportExportGitBackup = (required: { t: Translate }) => GitBackupController;

export interface ImportExportProps {
  /** This panel's locale-bound translator; tests inject their own. */
  useTranslate: () => Translate;
  /** The live Git backup controller; tests inject one over a fake port. */
  useGitBackup: UseImportExportGitBackup;
  /** The Sites dictionary the Export and Import tabs read. */
  useTransferTranslate: () => Translate;
  /** Whether this deployment has a Sites section. */
  useSitesAvailable: () => boolean;
  /** The Sites screen's Export Site tab, rendered as is. */
  SiteExportTab: ImportExportSiteExportTab;
  /** The Sites screen's Import Site tab, rendered as is. */
  SiteImportTab: ImportExportSiteImportTab;
  /** The Export and Import tabs' agent labels (host copy). */
  handleLabels: ImportExportHandleLabels;
  /** The `?tab=` query value from `panels.tsx` (`null` when absent). See `resolveImportExportTabId`. */
  tabId?: string | null;
}

function ImportExportCard({ link, t }: { link: ImportExportLink; t: Translate }) {
  return (
    <section className="jini-card jini-import-export-card" aria-labelledby={`import-export-${link.id}-title`}>
      <h2 id={`import-export-${link.id}-title`} className="jini-card-title">{t(link.title)}</h2>
      <p className="jini-card-lead">{t(link.lead)}</p>
      {/* Named "Open <title>" by its own text plus the heading, so each "Open" link stays distinct. */}
      <a
        id={`import-export-${link.id}-link`}
        className="jini-btn-secondary"
        href={link.href}
        aria-labelledby={`import-export-${link.id}-link import-export-${link.id}-title`}
        {...agentHandle({ handle: `import-export-${link.id}-link` }, { role: "link", label: `Open ${link.title}` })}
      >
        {t("Open")}
      </a>
    </section>
  );
}

/** The Other tab: the cards for screens elsewhere, then Git backup. Its own component so the Git
 *  backup read runs only while this tab is open. */
function OtherTab({ t, useGitBackup }: { t: Translate; useGitBackup: UseImportExportGitBackup }) {
  const gitBackup = useGitBackup({ t });
  return (
    <>
      <div className="jini-import-export-grid">
        {IMPORT_EXPORT_LINKS.map((link) => <ImportExportCard key={link.id} link={link} t={t} />)}
      </div>
      <GitBackupCard controller={gitBackup} t={t} />
    </>
  );
}

/** The Export and Import tabs, each with the translator it was written against. Hooks run here, not
 *  in `ImportExport`, so the Other tab never reads the sites list. */
function TransferTab({ tab, useTransferTranslate, useSitesAvailable, SiteExportTab, SiteImportTab }: {
  tab: "export" | "import";
} & Pick<ImportExportProps, "useTransferTranslate" | "useSitesAvailable" | "SiteExportTab" | "SiteImportTab">) {
  const t = useTransferTranslate();
  const sitesAvailable = useSitesAvailable();
  // No Publish button beside "Export this site" any more. It sat here from 2026-10-18 and was kept
  // on every host earlier on 2026-10-25 ("i should be able to publish media, posts, pages, etc"),
  // then removed the same day (owner: "lets remove it") because it republishes the WHOLE site and
  // read as publishing the zip. Publishing stays on the dashboard's "Publish All" and Deployment,
  // both present on desktop too.
  if (tab === "export") return <SiteExportTab t={t} />;
  return <SiteImportTab t={t} canMakeSites={sitesAvailable} />;
}

/** `replace: true` so switching tabs does not grow the back stack, as Sites and Deployment do. */
function goToImportExportTab(id: string) {
  navigate({ routePath: `/import-export?tab=${id}` }, { replace: true });
}

export function ImportExport({
  useTranslate,
  useGitBackup,
  useTransferTranslate,
  useSitesAvailable,
  SiteExportTab,
  SiteImportTab,
  handleLabels,
  tabId,
}: ImportExportProps) {
  const t = useTranslate();
  const tab: ImportExportTabId = resolveImportExportTabId({ tabId: tabId });
  return (
    // No "Operations" kicker above the title (owner, 2026-10-25); the other Operations pages keep theirs.
    <div className="jini-page jini-import-export-page">
      <div className="jini-page-header">
        <div className="jini-page-header-text">
          <h1 className="jini-page-title">{t("Import & Export")}</h1>
          <p className="jini-page-description">{t("Move a site in or out.")}</p>
        </div>
      </div>
      <TabBar
        tabs={resolveImportExportTabs({ t, handleLabels })}
        activeId={tab}
        onChange={goToImportExportTab}
        ariaLabel={t("Import & Export")}
        containerHandle="import-export-tabs"
      />
      {tab === "other"
        ? <OtherTab t={t} useGitBackup={useGitBackup} />
        : <TransferTab key={tab} tab={tab} useTransferTranslate={useTransferTranslate} useSitesAvailable={useSitesAvailable} SiteExportTab={SiteExportTab} SiteImportTab={SiteImportTab} />}
    </div>
  );
}
