import { agentHandle } from "@jini-ai/core/agent-handles";
import { interpolate, type Translate } from '@jini-ai/core/text';
import { SiteCardView, type SiteCardBindings } from "./SiteCardView.js";
import type {
  SitesLifecycleController, SitesListPrefsState, SitesListView, SitesScreenSite, SitesScreenSnapshot, UseSitesListViewHook,
} from "./sites-screen-ports.js";

/**
 * @file The "All sites" tab — the card grid of every site folder listed under `sites/`, and the
 * empty state for when there are none.
 *
 * Split out of the host's Sites screen for the tab redesign (2026-09-05, owner: "the first tab is all sites …
 * and in that, we have cards for all the sites we have currently active … whether they're active or
 * not"). The card grid itself is unchanged from the layout pass that preceded it — the `auto-fill`
 * `.sites-grid`, the tinted `site-card-serving` head, the per-card state badge and Activate button
 * all render exactly as they did. What left this tab is the Create tile: a whole form crammed into
 * one grid cell, which is the specific thing the owner rejected ("This is just awful"). Creating now
 * has a tab of its own (the host's create-site onboarding).
 *
 * ## The create confirmation lives here, not on the form
 *
 * A successful create returns to this tab — the owner's requirement, *"That should go back to the
 * first tab, and then we should see the new website created there"* — so {@link CreatedSiteNotice}
 * is what she lands on, directly above the grid that now contains the new card. It used to sit in
 * the create form's own footer, where after the return it could only ever be read as stale.
 *
 * ## The compact card (2026-09-05)
 *
 * The owner's brief: "that top card, the now serving card should not even be there. It should just
 * be a card in all sites with a green active button. So we save some space. And then we also have
 * the folder, just a regular square card with a hover tooltip for the actual folder directory."
 *
 * So the card lost its always-visible path line and its "Created" line, gained a square aspect and
 * a `title` tooltip carrying the absolute path, and the page-level "Now serving" panel above the
 * grid is gone entirely — the served site is a card in this grid like any other, wearing the green
 * `Serving now` badge.
 *
 * That was only possible because the served site now REACHES this grid. It did not before:
 * the host's site listing requires `config.json` + `.site-meta.json`, the host's own dev site folder has
 * neither, so the grid rendered zero cards on a server that was plainly serving it — which is what
 * the removed panel existed to confess. the host's site registry now composes the
 * served directory into the listing, and {@link SiteCardView} carries the one fact that panel's amber
 * banner used to: `resolveSiteRegistrationBadge` marks a folder the host's serve command would refuse. Removing
 * the panel without that badge would have deleted the truth and kept the bug.
 *
 * ## The card's actions (2026-10-08 polish)
 *
 * Owner: "make sure it looks good UI-wise" — four equal-weight buttons wrapped into a ragged pile,
 * clipped the fourth inside the square card, and sat Delete next to Start. Now a card shows a status
 * pill, the name, a muted meta line, then ONE visible lifecycle action (Start, or Stop) plus Open ↗
 * for a ready admin; Make default, Switch now and Delete… live in the shared `RowMenu` overflow menu,
 * Delete last and danger-toned. Actions that do not apply are left out rather than shown disabled —
 * `resolveSiteCardView` (the host's card policy) carries the same rules the old disabled states encoded.
 *
 * ## The preview (2026-10-08)
 *
 * Owner: the desktop app's cards show a picture of each site; these did not. the card preview
 * sits on top of the card: the server's last capture of the site's public page (re-captured while it
 * runs, see the shared `useSiteCardPreview`), or a neutral placeholder for a site never captured.
 *
 * ## The shared card and the list above it (2026-11-06)
 *
 * The card is now the shared `SiteCard`, the one the desktop app draws, so the two look alike: tile, then
 * name | menu, details | status, then the buttons. Everything above still holds except where it says
 * where a control sits: the menu moved up beside the name. `SiteListToolbar` picks what shows (Recent
 * + Pinned by default) and the sort; the choices are stored per person, through
 * the host's list-prefs binding. Hiding only takes a card off this list, the site stays on disk.
 *
 * ## The empty state
 *
 * Now genuinely rare rather than this install's normal state: it takes a `sites/` with nothing in it
 * AND a served directory that is not on disk. {@link SitesEmptyState} still avoids reading as a flat
 * "you have no sites", because the page-level notices above the grid may still be describing a
 * pending choice.
 */

/** The host's empty-state copy and destination: the lead line (a translation key) and the URL of
 *  its "New site" tab. */
export interface SitesEmptyStateCopy { leadKey: string; newSiteHref: string }

/**
 * Shown instead of the grid when nothing is listed at all.
 *
 * The action is a real `<a href>` rather than a `<button onClick={navigate}>` so it is
 * middle-clickable, copyable, and works with the app's own internal-link interceptor — and it
 * targets the same `?tab=new` URL the "New site" tab itself does, so there is one destination, not
 * two.
 */
function SitesEmptyState({ emptyState, t }: { emptyState: SitesEmptyStateCopy; t: Translate }) {
  return (
    <div
      className="jini-sites-empty"
      {...agentHandle({ handle: "sites-empty" }, {
        role: "region",
        label: "Empty state for the All sites tab — no site folders are listed under sites/",
      })}
    >
      <h2 className="jini-sites-empty-title">{t("No listed sites")}</h2>
      <p className="jini-sites-empty-lead">{t(emptyState.leadKey)}</p>
      <a
        className="jini-btn-primary jini-sites-empty-action"
        href={emptyState.newSiteHref}
        {...agentHandle({ handle: "sites-empty-new-site" }, { role: "link", label: "Go to the New site tab" })}
      >
        {t("New site")}
      </a>
    </div>
  );
}

/** The line an operator lands on after a successful create — see this file's header. Renders
 *  nothing when there has not been one, so {@link AllSitesTab} needs no conditional of its own.
 *
 *  The name is rendered VERBATIM and never through `t()`: it is data (a folder name), the same
 *  treatment every other site name on this screen gets. */
function CreatedSiteNotice({ createdName, createdTokens, createdAdminLogin, t }: { createdName: string | null; createdTokens: CreatedTokens | null; createdAdminLogin: string | null | undefined; t: Translate }) {
  if (createdName === null) return null;
  return (
    <p
      className="jini-save-ok"
      {...agentHandle({ handle: "sites-created-notice" }, {
        role: "status",
        label: "Confirmation that a site folder was created, and that creating it switched nothing",
      })}
    >
      <strong>{createdName}</strong> {t("was created. Start it to open its admin.")}
      <span className="jini-field-hint" style={{ display: "block" }} data-agent-private="">{createdAdminLogin}</span>
      <CreatedTokensLine createdTokens={createdTokens} />
    </p>
  );
}

/** Tokens given with a create: plugin display names and the server's follow-on note. */
export interface CreatedTokens { names: string[]; note: string }

/** The follow-on for tokens given with the create ("Supabase will connect when this site first
 *  starts."), or nothing. Names are plugin display names, rendered verbatim. */
function CreatedTokensLine({ createdTokens }: { createdTokens: CreatedTokens | null }) {
  if (!createdTokens) return null;
  return (
    <>
      {" "}
      <strong>{createdTokens.names.join(", ")}</strong> {createdTokens.note}
    </>
  );
}

export interface AllSitesTabProps<TPrefs, TList extends SitesListView> extends SiteCardBindings<TList> {
  sites: SitesScreenSite[];
  snapshot: SitesScreenSnapshot;
  switchingEnabled: boolean;
  activatingName: string | null;
  /** The site the last successful create made, or `null` — see {@link CreatedSiteNotice}. */
  createdName: string | null;
  createdAdminLogin?: string | null | undefined;
  /** Tokens given with that create, from the host controller's `createdTokens`. Optional for older callers. */
  createdTokens?: CreatedTokens | null | undefined;
  onActivate: (name: string) => void;
  localSites?: SitesLifecycleController | undefined;
  /** This person's sort, pins and hidden sites. */
  listPrefs: SitesListPrefsState<TPrefs>;
  /** The host's list-view hook (REQUIRED): sorts and filters the cards by `listPrefs`. */
  useSiteListViewHook: UseSitesListViewHook<TPrefs, TList>;
  /** The host's empty-state lead and "New site" URL. */
  emptyState: SitesEmptyStateCopy;
  t: Translate;
}

/** The grid itself. A plain function returning JSX rather than a ternary written in
 *  {@link AllSitesTab}'s own body — that component's cyclomatic count would otherwise carry this
 *  branch on top of the `.map()`, the same split the host's deployment screen makes for
 *  the identical gate. */
function sitesGridOrEmpty<TPrefs, TList extends SitesListView>(props: AllSitesTabProps<TPrefs, TList>) {
  if (props.policy.resolveSitesEmpty({ sites: props.sites })) return <SitesEmptyState emptyState={props.emptyState} t={props.t} />;
  if (!props.listPrefs.ready) return null;
  return <SitesGrid {...props} />;
}

/** Why the remembered choices are not being kept, in the server's words, or nothing. */
function SiteListPrefsNotice({ listPrefs, t }: { listPrefs: Pick<SitesListPrefsState<unknown>, "loadError" | "saveError">; t: Translate }) {
  if (listPrefs.loadError !== null) {
    return <div className="jini-notice jini-notice-error">{interpolate({ template: t("Your saved list choices could not be loaded: {reason}. Changes apply until you reload."), vars: { reason: listPrefs.loadError } })}</div>;
  }
  if (listPrefs.saveError !== null) {
    return <div className="jini-notice jini-notice-error">{interpolate({ template: t("Your list choices could not be saved: {reason}. They apply until you reload."), vars: { reason: listPrefs.saveError } })}</div>;
  }
  return null;
}

function SitesGrid<TPrefs, TList extends SitesListView>(props: AllSitesTabProps<TPrefs, TList>) {
  const { sites, listPrefs, t, policy } = props;
  const list = props.useSiteListViewHook({ items: policy.resolveSiteListItems({ sites }), prefs: listPrefs.prefs, onPrefsChange: listPrefs.onPrefsChange });
  // Folder names are unique under `sites/` (they ARE the directory entries), so they disambiguate
  // one card's controls from another's — same reasoning as every other list on this workstream.
  const rowHandles = policy.resolveSitesRowHandles({ sites });
  const handleOf = new Map(sites.map((site, index) => [site.name, rowHandles[index]]));
  const { SiteListToolbar } = props.cardKit;
  return (
    // One wrapper so the page's section gap stays above the toolbar, not between it and its cards.
    <div>
      <SiteListPrefsNotice listPrefs={listPrefs} t={t} />
      <SiteListToolbar
        list={list}
        copy={{
          views: t("Which sites to show"),
          pinnedRecent: t("Recent + Pinned"),
          all: interpolate({ template: t("Show all ({count})"), vars: { count: String(list.allCount) } }),
          hidden: interpolate({ template: t("Hidden ({count})"), vars: { count: String(list.hiddenCount) } }),
          sortBy: t("Sort by"),
          recent: t("Most recent"),
          oldest: t("Oldest"),
          name: t("A-Z"),
        }}
      />
      {list.visible.length === 0 ? <p className="jini-sites-empty-lead">{t("Every site is hidden. Open Hidden to bring one back.")}</p> : null}
      <div className="jini-sites-grid" role="group" aria-label={t("Sites")}>
        {list.visible.map(({ site }) => {
          const handle = handleOf.get(site.name);
          if (handle === undefined) throw new Error(`site ${site.name} has no card handle`);
          return <SiteCardView
            key={site.name}
            site={site}
            snapshot={props.snapshot}
            handle={handle}
            switchingEnabled={props.switchingEnabled}
            activatingName={props.activatingName}
            onActivate={props.onActivate}
            localSites={props.localSites}
            list={list}
            bindings={props}
            t={t}
          />;
        })}
      </div>
    </div>
  );
}

export function AllSitesTab<TPrefs, TList extends SitesListView>(props: AllSitesTabProps<TPrefs, TList>) {
  return (
    <>
      <CreatedSiteNotice createdName={props.createdName} createdTokens={props.createdTokens ?? null} createdAdminLogin={props.createdAdminLogin} t={props.t} />
      {sitesGridOrEmpty(props)}
    </>
  );
}
