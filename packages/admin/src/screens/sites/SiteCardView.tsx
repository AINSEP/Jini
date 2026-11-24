import { interpolate, type Translate } from '@jini-ai/core/text';
import { Icon } from "../../react/kit.js";
import { RowMenu } from "../../react/components/RowMenu/RowMenu.js";
import type {
  AllSitesPolicy, SitesCardControls, SitesCardKit, SitesCardTone, SitesLifecycleController, SitesListView,
  SitesScreenSite, SitesScreenSnapshot, UseSitesCardPreviewHook,
} from "./sites-screen-ports.js";

/** What one card needs from the tab: the host's policy, card kit, preview hook and address. */
export interface SiteCardBindings<TList extends SitesListView> {
  policy: AllSitesPolicy;
  cardKit: SitesCardKit<TList>;
  useSiteCardPreviewHook: UseSitesCardPreviewHook;
  previewUrlFor: (args: { name: string; version: number }) => string;
}

/** The card's "this folder is not really a site" badge, or nothing. */
function SiteCardFlag({ site, snapshot, policy, t }: { site: SitesScreenSite; snapshot: SitesScreenSnapshot; policy: AllSitesPolicy; t: Translate }) {
  const registration = policy.resolveSiteRegistrationBadge({ site, snapshot });
  if (registration === null) return null;
  return (
    // A glyph beside the words (2026-09-06 status-strip pass, the host's "Sites — the
    // card's status strip" styles): this line used to render in the same pill chrome as the state
    // badge in the head, so the two read as competing states. The icon is what makes it a
    // footnote about the folder rather than a second status; `aria-hidden` inside the
    // component, since the text beside it already says the same thing.
    <span className="jini-status jini-status-warning jini-site-card-flag" title={t(registration.titleKey)}>
      <Icon name="flag-triangle" size={14} strokeWidth={1.5} />
      {t(registration.labelKey)}
    </span>
  );
}

/** The serving card's one sentence about Stop, or nothing. */
function SiteCardServingNote({ noteKey, t }: { noteKey?: string | undefined; t: Translate }) {
  if (noteKey === undefined) return null;
  return <p className="jini-field-hint">{t(noteKey)}</p>;
}

/** The status pill's tone class → the shared card's status tone. */
const STATUS_TONES: Record<string, SitesCardTone> = { "status-ok": "running", "status-warning": "warning", "status-error": "danger", "status-neutral": "neutral" };

/** The default star, or nothing. */
function SiteCardDefaultStar({ site, snapshot, policy, t }: { site: SitesScreenSite; snapshot: SitesScreenSnapshot; policy: AllSitesPolicy; t: Translate }) {
  if (!policy.resolveSiteIsDefault({ site, snapshot })) return null;
  return <span className="jini-site-card-default" role="img" aria-label={t("Opens by default")} title={t("Opens by default")}><Icon name="star-filled" size={14} strokeWidth={1.5} /></span>;
}

/** The second line under the name, or nothing. */
function SiteCardSubtitle({ site, policy }: { site: SitesScreenSite; policy: AllSitesPolicy }) {
  const subtitle = policy.resolveSiteSubtitle(site);
  return subtitle === null ? null : <p className="jini-site-card-display-name">{subtitle}</p>;
}

export interface SiteCardViewProps<TList extends SitesListView> {
  site: SitesScreenSite;
  snapshot: SitesScreenSnapshot;
  handle: string;
  switchingEnabled: boolean;
  activatingName: string | null;
  onActivate: (name: string) => void;
  localSites?: SitesLifecycleController | undefined;
  list: Pick<SitesListView, "isPinned" | "togglePin" | "isHidden" | "toggleHidden">;
  bindings: SiteCardBindings<TList>;
  t: Translate;
}

/** One site's card — compact, and carrying the whole truth about that site.
 *
 *  The folder name (the technical identifier every write on this screen takes) is the dominant
 *  element; the status says whichever card is genuinely live.
 *  The absolute path is a hover tooltip on the card itself rather than a visible line, which is
 *  what the owner asked for and what buys back the vertical space. */
export function SiteCardView<TList extends SitesListView>({ site, snapshot, handle, switchingEnabled, activatingName, onActivate, localSites, list, bindings, t }: SiteCardViewProps<TList>) {
  const { policy, cardKit: { SiteCard: SiteCardFrame, SiteCardPin, SiteCardStatus } } = bindings;
  const pill = policy.resolveSiteStatusPill({ site, snapshot, t });
  const preview = bindings.useSiteCardPreviewHook({ site, snapshot, urlFor: bindings.previewUrlFor });
  const view = policy.resolveSiteCardView({
    site, snapshot, switchingEnabled, activatingName, busyName: localSites?.busyName ?? null, managed: localSites !== undefined,
  });
  const hidden = list.isHidden(site.name);
  const pinned = list.isPinned(site.name);
  const items = policy.buildSiteCardMenuItems({ site, menu: view.menu, onActivate, controller: localSites, t }, {
    hide: { label: t(hidden ? "Show in list" : "Hide from list"), onSelect: () => list.toggleHidden(site.name) },
  });
  // Tile, then name | menu, details | status, then the buttons: the layout and why each part sits
  // where it does are in the shared `SiteCard`.
  return (
    <SiteCardFrame
      name={site.name}
      title={policy.resolveSiteCardTitle(site)}
      nameDetail={<SiteCardSubtitle site={site} policy={policy} />}
      nameExtra={<SiteCardDefaultStar site={site} snapshot={snapshot} policy={policy} t={t} />}
      previewSrc={preview.src}
      onPreviewError={preview.onError}
      menu={(
        <>
          <SiteCardPin pinned={pinned} label={interpolate({ template: t(pinned ? "Unpin {name}" : "Pin {name}"), vars: { name: site.name } })} onToggle={() => list.togglePin(site.name)} />
          <RowMenu items={items} triggerLabel={interpolate({ template: t("More actions for {name}"), vars: { name: site.name } })} agentHandle={`${handle}-menu`} />
        </>
      )}
      details={policy.resolveSiteCardMeta({ site, snapshot, activatingName, t })}
      status={<SiteCardStatus label={pill.label} tone={STATUS_TONES[pill.toneClass] ?? "neutral"} title={policy.resolveSiteRunningTitle({ site, t })} />}
      notes={<><SiteCardFlag site={site} snapshot={snapshot} policy={policy} t={t} /><SiteCardServingNote noteKey={view.noteKey} t={t} /></>}
      actions={<SiteCardActions site={site} view={view} controller={localSites} t={t} />}
    />
  );
}

/** The card's action row — one visible lifecycle action at the left and Open at the right edge; the
 *  menu with everything else sits beside the name. Only rendering: `resolveSiteCardView` decides
 *  which actions apply, and the controller owns every confirmation. Each control's accessible name
 *  carries the site's name, so a screen reader (or an agent reading the accessibility tree) can tell
 *  one card's Start from another's. */
function SiteCardActions({ site, view, controller, t }: {
  site: SitesScreenSite; view: SitesCardControls; controller?: SitesLifecycleController | undefined; t: Translate;
}) {
  const lifecycle = view.lifecycle;
  return (
    <div className="jini-site-card__actions">
      {lifecycle === null ? null : (
        <button type="button" className={lifecycle.className} disabled={lifecycle.disabled}
          aria-label={`${t(lifecycle.labelKey)} ${site.name}`} onClick={() => void controller?.run(site.name, lifecycle.action)}>
          {t(lifecycle.labelKey)}
        </button>
      )}
      {view.openUrl === null ? null : (
        <a className="jini-btn-secondary jini-site-card-open" href={view.openUrl} target="_blank" rel="noopener noreferrer"
          aria-label={interpolate({ template: t("Open {name} in a new tab"), vars: { name: site.name } })}>
          {t("Open")}<span aria-hidden="true">↗</span>
        </a>
      )}
    </div>
  );
}
