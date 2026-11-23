import type { ComponentType } from "react";
import { createPortal } from "react-dom";
import type { AdminNavGroup } from "@jini-ai/core/contracts/site/nav";
import type { SitesSidebarNavArgs, SitesSidebarNavOptions, SitesSidebarNavView } from "../hooks/use-sites-sidebar-nav.hooks.js";

/** The host's bound sites-label hook (`useSitesSidebarNav` from `shell/hooks/use-sites-sidebar-nav.hooks`). */
export type UseSitesSidebarNavHook = (required: SitesSidebarNavArgs, optional?: SitesSidebarNavOptions) => SitesSidebarNavView;

/** The admin sidebar's nav list (`@jini-ai/admin/react`'s `Sidebar.Nav`). */
export type SitesSidebarNavList = ComponentType<{ groups: readonly AdminNavGroup[]; soonLabel?: string | undefined }>;

/** `useSidebar` and `SidebarNav` are injected (the host passes `@jini-ai/admin/react`'s), so this browser entry never reaches the react domain. */
export interface SitesSidebarNavProps extends Pick<SitesSidebarNavArgs, "port" | "useSitesSnapshot" | "translateNavLabel" | "useSidebar"> {
  SidebarNav: SitesSidebarNavList;
  groups: readonly AdminNavGroup[]; locale: string; soonLabel?: string;
  options?: SitesSidebarNavOptions;
  useSitesSidebarNavHook: UseSitesSidebarNavHook;
}

/** The shared sidebar renders the row; only its visible Sites label is supplied by this adapter.
 *  The hook takes every host collaborator as a required field; the host passes them in as props.
 *  Styling: the host's `jini-sites-*` rules. */
export function SitesSidebarNav({ useSitesSidebarNavHook, SidebarNav, ...props }: SitesSidebarNavProps) {
  const view = useSitesSidebarNavHook(
    { groups: props.groups, locale: props.locale, port: props.port, useSitesSnapshot: props.useSitesSnapshot, translateNavLabel: props.translateNavLabel, useSidebar: props.useSidebar },
    props.options ?? {},
  );
  return <>
    <SidebarNav groups={view.groups} soonLabel={props.soonLabel} />
    {view.target && view.siteName ? createPortal(
      // The shared span retains the complete accessible name; this split duplicate is visual only.
      <span className="jini-sites-label" aria-hidden="true">
        <span className="jini-sites-prefix">{view.prefix}</span>
        <span className="jini-sites-name" ref={view.nameRef} title={view.title}>{view.siteName}</span>
        <span className="jini-sites-suffix">{view.suffix}</span>
      </span>, view.target,
    ) : null}
  </>;
}
