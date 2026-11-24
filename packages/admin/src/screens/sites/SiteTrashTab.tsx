import type { Translate } from '@jini-ai/core/text';
import type { SitesLifecycleController, SitesScreenSnapshot, SitesScreenTrashedSite, SiteTrashPolicy } from "./sites-screen-ports.js";

export interface SiteTrashTabProps {
  snapshot: SitesScreenSnapshot;
  controller?: SitesLifecycleController | undefined;
  /** The host's trash card rules (subtitle, which buttons apply). */
  policy: SiteTrashPolicy;
  t: Translate;
}

/** Recoverable site Trash, in the same card language as All sites (2026-10-08 polish). Permanent
 *  deletion is offered only here: select the card, then Delete permanently, which the controller
 *  confirms. The danger button appears once its card is selected rather than sitting disabled. */
export function SiteTrashTab({ snapshot, controller, policy, t }: SiteTrashTabProps) {
  if (!snapshot.localManagementEnabled || !controller) return null;
  const trash = snapshot.trash ?? [];
  if (trash.length === 0) return <div className="jini-sites-empty"><p className="jini-sites-empty-lead">{t("Site Trash is empty.")}</p></div>;
  return <div className="jini-sites-grid" role="group" aria-label={t("Site Trash")}>
    {trash.map((site) => <TrashedSiteCard key={site.id} site={site} controller={controller} policy={policy} t={t} />)}
  </div>;
}

/** One trashed site. Accessible names carry the site's name, the same pattern as All sites' Start. */
function TrashedSiteCard({ site, controller, policy, t }: { site: SitesScreenTrashedSite; controller: SitesLifecycleController; policy: SiteTrashPolicy; t: Translate }) {
  const actions = policy.resolveTrashCardActions({ id: site.id, checked: controller.checked, busyName: controller.busyName });
  const subtitle = policy.resolveSiteSubtitle(site);
  return <div className="jini-sites-trash-card">
    <div className="jini-sites-trash-card-head"><span className="jini-status jini-status-neutral">{t("In Trash")}</span></div>
    <div className="jini-sites-trash-card-body">
      <span className="jini-sites-trash-card-name">{site.name}</span>
      {subtitle === null ? null : <p className="jini-site-card-display-name">{subtitle}</p>}
      <label className="jini-sites-trash-card-select">
        <input type="checkbox" checked={actions.selected} aria-label={`${t("Select for permanent deletion")} ${site.name}`}
          onChange={(event) => controller.toggleChecked(site.id, event.target.checked)} />
        {t("Select for permanent deletion")}
      </label>
      <div className="jini-sites-trash-card-actions">
        <button type="button" className="jini-btn-primary" disabled={actions.restoreDisabled}
          aria-label={`${t("Restore")} ${site.name}`} onClick={() => void controller.run(site.id, "restore")}>{t("Restore")}</button>
        {actions.selected ? <button type="button" className="jini-btn-danger" disabled={actions.deleteDisabled}
          aria-label={`${t("Delete permanently")} ${site.name}`} onClick={() => void controller.run(site.id, "delete")}>{t("Delete permanently")}</button> : null}
      </div>
    </div>
  </div>;
}
