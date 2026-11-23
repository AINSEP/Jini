import type { DashboardActivityRow } from "./dashboard-view.types.js";

import { agentHandle } from "@jini-ai/core/agent-handles";
import { Icon } from "../../react/kit.js";

/** The recent-activity panel's persisted open/closed state, from the host's disclosure hook. */
export interface PersistedDisclosure {
  open: boolean;
  toggle: () => void;
  /** DOM id for the collapsible body, so the header button can point `aria-controls` at it. */
  panelId: string;
}
import type { DashboardController, StatState } from "./hooks/use-dashboard.hooks.js";
import { commentsStatMeta, pagesStatMeta, postsStatMeta } from "./rules.js";

import { formatTimestamp, type Translate } from '@jini-ai/core/text';
import { VIEWER_TIME_ZONE } from "../../shell/lib/viewer-time-zone.js";
/**
 * @file Admin landing screen — markup only.
 *
 * State and the five concurrent fetches live in `hooks/use-dashboard.hooks.ts`; the activity-list
 * merge lives in `rules.ts`. What stays here is what actually renders: the stat cards, the
 * activity panel, and the appearance panel.
 *
 * Every seam is the host's: the controller hook, the live-site availability hook, the accordion's
 * persisted-disclosure hook, the Publish All action and every link (see `README.md`'s Wiring).
 * Classes are `jini-dash-*`/`jini-dashboard-page`; the host styles them. The page chrome classes
 * (`page-header`, `notice`, `btn-primary`, `empty-state`, …) are the shell's shared ones.
 */

/** Rows shown in the activity panel. Small enough to stay glanceable, large enough that a normal
 *  editing session shows more than the single post someone just touched. */
const ACTIVITY_LIMIT = 6;

/** Every href the screen renders. The host owns its routes; `activityRow` is usually `rules.ts`'s
 *  `activityRowHref`. */
export interface DashboardLinks {
  posts: string;
  pages: string;
  media: string;
  comments: string;
  themes: string;
  changePassword: string;
  /** The public site's home, opened in a new tab by "View site". */
  viewSite: string;
  activityRow: (row: DashboardActivityRow) => string;
}

export interface DashboardProps {
  /** The screen's controller — the host's `useWiredDashboard` (its port, locale and copy bound into
   *  `useDashboard`), or a test double. */
  useDashboardHook: () => DashboardController;
  /** `false` where there is nowhere to publish to (the live site itself). */
  usePublishToLiveAvailableHook: () => boolean;
  /** Open state of the "Recently updated" accordion; the host binds its own storage key. */
  useRecentActivityDisclosureHook: () => PersistedDisclosure;
  /** Publish All: opens the host's publish request with no pre-set criteria. */
  onPublishAll: () => void;
  links: DashboardLinks;
}

/** One row in the "Recently updated" activity list. */
function ActivityRow({ row, href, t }: { row: DashboardActivityRow; href: string; t: Translate }) {
  return (
    <div className="jini-dash-activity-row" key={row.id}>
      <a className="jini-dash-activity-title" href={href}>
        {row.title || t("Untitled")}
      </a>
      <span className="jini-dash-kind">{row.kind}</span>
      <span className="jini-dash-activity-time">{formatTimestamp({ iso: row.updatedAt }, { viewerTimeZone: VIEWER_TIME_ZONE })}</span>
    </div>
  );
}

/** The "Recently updated" panel's body — a flat if-chain over its four states (both-sources-
 *  failed / loading / empty / populated) rather than the nested ternary this replaces, which was
 *  most of `Dashboard`'s cognitive cost.
 *
 * Both sources failing is its own state, not "still loading". `setRecent` is only ever called from
 * a `.then()`, so if `listPosts` AND `listPages` both reject nothing will ever move `recent` off
 * `null` — the panel would sit on "Loading…" forever with no indication anything was wrong. That is
 * precisely the defect this file's header says exec-summary #5 fixed for the stat cards, and it
 * reached the panel because the panel has no error slot of its own. Derived from the two stat
 * errors rather than given a third error state: the panel has no independent fetch, so a separate
 * slot could disagree with the cards about what happened. A single failure deliberately still
 * renders — the surviving endpoint's rows are real and worth showing. */
function RecentActivityBody(props: {
  recent: DashboardActivityRow[] | null;
  activityRow: DashboardLinks["activityRow"];
  postsError: string | null;
  pagesError: string | null;
  t: Translate;
}) {
  const { t } = props;
  if (props.recent === null && props.postsError && props.pagesError) {
    return (
      <div className="jini-dash-panel-body">
        <p className="jini-dash-stat-meta is-error" role="alert">
          {t("Could not load recent activity.")} {props.postsError}
        </p>
      </div>
    );
  }
  if (props.recent === null) {
    return (
      <div className="jini-dash-panel-body">
        <p>{t("Loading…")}</p>
      </div>
    );
  }
  if (props.recent.length === 0) {
    return (
      <div className="empty-state">
        <p>{t("Nothing published or drafted yet.")}</p>
        <p className="page-description">{t("Create a post or page and it will show up here.")}</p>
      </div>
    );
  }
  return (
    <div className="jini-dash-activity">
      {props.recent.slice(0, ACTIVITY_LIMIT).map((row) => (
        <ActivityRow row={row} href={props.activityRow(row)} key={row.id} t={t} />
      ))}
    </div>
  );
}

/** The "Recently updated" card as an accordion (owner 2026-10-13: the dashboard was "a bit too
 *  busy"). Collapsed by default; the caret sits left of the title and points right when closed,
 *  down when open. Open state and its localStorage persistence live in
 *  the host's `useRecentActivityDisclosureHook`. The body stays mounted and is only `hidden`, so the
 *  button's `aria-controls` always names an element that exists. */
function RecentActivityPanel(props: {
  recent: DashboardActivityRow[] | null;
  postsError: string | null;
  pagesError: string | null;
  t: Translate;
  links: Pick<DashboardLinks, "posts" | "activityRow">;
  useRecentActivityDisclosureHook: DashboardProps["useRecentActivityDisclosureHook"];
}) {
  const { t } = props;
  // The host's disclosure hook is a required prop, called through `props` (never imported or defaulted).
  const { open, toggle, panelId } = props.useRecentActivityDisclosureHook();
  return (
    <div className={`jini-dash-panel${open ? "" : " is-collapsed"}`}>
      <div className="jini-dash-panel-head">
        <h2 className="jini-dash-panel-title">
          <button
            type="button"
            className="jini-dash-panel-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={toggle}
            {...agentHandle({ handle: "dashboard-recent-toggle" }, { role: "button", label: "Show or hide the recently updated list" })}
          >
            <span className="jini-dash-panel-caret" aria-hidden="true">
              <Icon name="chevron-right" size={14} />
            </span>
            {t("Recently updated")}
          </button>
        </h2>
        <a href={props.links.posts} {...agentHandle({ handle: "dashboard-all-posts" }, { role: "link", label: "Go to the full posts list" })}>
          {t("All posts")}
        </a>
      </div>
      <div id={panelId} hidden={!open}>
        <RecentActivityBody recent={props.recent} activityRow={props.links.activityRow} postsError={props.postsError} pagesError={props.pagesError} t={t} />
      </div>
    </div>
  );
}

/** The Appearance panel's body — active theme, or its own error. */
function AppearanceBody(props: { themeError: string | null; themeName: string | null; t: Translate }) {
  const { t } = props;
  if (props.themeError) {
    return (
      <p className="jini-dash-stat-meta is-error" role="alert">
        {props.themeError}
      </p>
    );
  }
  return (
    <>
      <p>
        {t("Active theme")}
        <br />
        <strong style={{ color: "var(--fg)", fontSize: "var(--text-md)" }}>{props.themeName ?? "…"}</strong>
      </p>
      <p>{t("Your public site is live and serving this theme.")}</p>
    </>
  );
}

/** The default-password nag — password-banner plan (2026-09-24), Slice 3. A compact one-row plain
 *  `.notice` (neutral surface, only the icon in `--warning`) rather than `.notice.warning`'s orange
 *  block — owner's call, "cap the width" and "make it subtle". `role="status"`: this renders on load rather than in response to an action, matching
 *  `SiteDirOverrideNotice`'s own `agentHandle` role. */
function DefaultPasswordBanner({ onDismiss, changePasswordHref, t }: { onDismiss: () => void; changePasswordHref: string; t: Translate }) {
  return (
    <div className="notice jini-dash-password-banner" {...agentHandle({ handle: "dashboard-password-banner" }, { role: "status", label: "Nag that the account is still on the default password" })}>
      <span className="jini-dash-password-banner-icon" aria-hidden="true">
        <Icon name="alert-triangle" size={16} />
      </span>
      <p>{t("It is recommended to change your password before deploying")}</p>
      <a
        className="jini-dash-password-banner-action"
        href={changePasswordHref}
        {...agentHandle({ handle: "dashboard-password-banner-change" }, { role: "link", label: "Go change your own password" })}
      >
        {t("Change password")}
      </a>
      <button
        type="button"
        className="jini-dash-password-banner-dismiss"
        aria-label={t("Dismiss")}
        title={t("Dismiss")}
        onClick={onDismiss}
        {...agentHandle({ handle: "dashboard-password-banner-dismiss" }, { role: "button", label: "Dismiss this nag for this browser" })}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

/** Site-key plan (2026-09-24) §A.6 — the site-key warning banner. Same `.notice.warning` full block
 *  the tab's own {@link SiteKeyScopeNotice}-equivalent uses for a genuinely urgent state (unlike
 *  the deliberately-subtler {@link DefaultPasswordBanner}): `showSiteKeyBanner` is only ever `true`
 *  for `missing-with-data`/`mismatch`/`invalid` (`rules.ts`'s `shouldShowSiteKeyBanner`) — states
 *  where saved credentials genuinely cannot be opened, not a routine nag. No dismiss control (a
 *  standing fact about the install's data, not a one-time reminder) and no extra CTA link — the
 *  Secrets → site key tab is already one click away in the sidebar, and adding a link here would
 *  mean adding yet another translated string for a banner that is meant to stay terse. `role=
 *  "status"`, same as `DefaultPasswordBanner`: it renders on load rather than in response to an
 *  action. */
function SiteKeyWarningBanner({ message }: { message: string }) {
  return (
    <div className="notice warning jini-dash-site-key-banner" {...agentHandle({ handle: "dashboard-site-key-banner" }, { role: "status", label: "Warns that this site's key can't open its saved credentials" })}>
      <span className="jini-dash-site-key-banner-icon" aria-hidden="true">
        <Icon name="alert-triangle" size={16} />
      </span>
      <p>{message}</p>
    </div>
  );
}

export function Dashboard(props: DashboardProps) {
  // Host hooks are required props, called through `props` (never imported or defaulted).
  const { useRecentActivityDisclosureHook, onPublishAll, links } = props;
  const {
    posts,
    published,
    pages,
    drafts,
    media,
    comments,
    themeName,
    themeError,
    recent,
    t,
    showDefaultPasswordBanner,
    dismissDefaultPasswordBanner,
    showSiteKeyBanner,
    siteKeyBannerMessage,
  } = props.useDashboardHook();
  // `false` on the live site, which has nowhere to publish to.
  const canPublish = props.usePublishToLiveAvailableHook();

  return (
    <div className="page jini-dashboard-page">
      {renderDashboardHeader({ t, canPublish, onPublishAll, viewSiteHref: links.viewSite })}

      {showSiteKeyBanner ? <SiteKeyWarningBanner message={siteKeyBannerMessage} /> : null}
      {showDefaultPasswordBanner ? <DefaultPasswordBanner onDismiss={dismissDefaultPasswordBanner} changePasswordHref={links.changePassword} t={t} /> : null}

      <div className="jini-dash-top">
        {renderDashboardStats({ t, posts, published, pages, drafts, media, comments, links })}
        <div className="jini-dash-panel">
          <div className="jini-dash-panel-head">
            <h2 className="jini-dash-panel-title">{t("Appearance")}</h2>
            <a href={links.themes} {...agentHandle({ handle: "dashboard-change-theme" }, { role: "link", label: "Go to Themes to change the active theme" })}>
              {t("Change")}
            </a>
          </div>
          <div className="jini-dash-panel-body">
            <AppearanceBody themeError={themeError} themeName={themeName} t={t} />
          </div>
        </div>
      </div>

      <div className="jini-dash-panels">
        <RecentActivityPanel recent={recent} postsError={posts.error} pagesError={pages.error} t={t} links={links}
          useRecentActivityDisclosureHook={useRecentActivityDisclosureHook} />
      </div>
    </div>
  );
}

function renderDashboardStats(
  { t, posts, published, pages, drafts, media, comments, links }:
    Pick<DashboardController, "t" | "posts" | "published" | "pages" | "drafts" | "media" | "comments"> & { links: DashboardLinks }
) {
  return (
    <div className="jini-dash-stats">
      <Stat
        href={links.posts}
        label={t("Posts")}
        state={posts}
        meta={postsStatMeta({ published, t })}
        agentHandleId="dashboard-stat-posts"
      />
      <Stat
        href={links.pages}
        label={t("Pages")}
        state={pages}
        meta={pagesStatMeta({ drafts, t })}
        agentHandleId="dashboard-stat-pages"
      />
      <Stat
        href={links.media}
        label={t("Media")}
        state={media}
        meta={t("items in the library")}
        agentHandleId="dashboard-stat-media"
      />
      <Stat
        href={links.comments}
        label={t("Comments")}
        state={comments}
        meta={commentsStatMeta({ pendingCount: comments.value, t })}
        agentHandleId="dashboard-stat-comments"
      />
    </div>
  );
}

function renderDashboardHeader(
  { t, canPublish, onPublishAll, viewSiteHref }:
    Pick<DashboardController, "t"> & { canPublish: boolean; onPublishAll: () => void; viewSiteHref: string }
) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <p className="page-kicker">{t("Overview")}</p>
        <h1 className="page-title">{t("Dashboard")}</h1>
        <p className="page-description">{t("Everything happening on this site at a glance.")}</p>
      </div>
      <div className="page-actions jini-dash-header-actions">
        {/* Orange/`.btn-primary`, left of "View site" on one row (owner 2026-10-06; it used to sit
            stacked under it) — a deliberate, meaningful action, not a nav link. The dialog it opens
            is the host's (`onPublishAll`). */}
        {canPublish ? (
          <button
            type="button"
            className="btn-primary"
            onClick={onPublishAll}
            {...agentHandle({ handle: "dashboard-publish-content" }, {
              role: "button",
              label: "Publish all content to the live site",
            })}
          >
            {t("Publish All")}
          </button>
        ) : null}
        <a
          className="btn-secondary"
          href={viewSiteHref}
          target="_blank"
          rel="noreferrer"
          {...agentHandle({ handle: "dashboard-view-site" }, { role: "link", label: "Open the public site in a new tab" })}
        >
          {t("View site ↗")}
        </a>
      </div>
    </div>
  );
}

function Stat(props: { href: string; label: string; state: StatState; meta: string; agentHandleId: string }) {
  const failed = props.state.error !== null;
  return (
    <a
      className="jini-dash-stat"
      href={props.href}
      {...agentHandle({ handle: props.agentHandleId }, { role: "link", label: `${props.label} stat card — go to ${props.href}` })}
    >
      <span className="jini-dash-stat-label">{props.label}</span>
      <span className={`jini-dash-stat-value${failed ? " is-error" : ""}`}>
        {failed ? "—" : (props.state.value ?? "…")}
      </span>
      <span className={`jini-dash-stat-meta${failed ? " is-error" : ""}`}>{failed ? props.state.error : props.meta}</span>
    </a>
  );
}
