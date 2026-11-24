import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { AdminNavGroup } from "@jini-ai/core/contracts/site/nav";
import type { SitesPort } from "@jini-ai/core/contracts/site/hooks-sites-port-hooks";

/** The host's cached Sites read (its fetch-query + boot scope); only the live site name is read. */
export type UseSitesSnapshotHook = (
  required: { port: Pick<SitesPort, "listSites"> },
  optional: { enabled?: boolean },
) => { readonly data?: { readonly currentSite: { readonly name: string } } | null };

/** The host's sidebar label translator (Jini ships the nav dictionary; the host binds the callable). */
export type TranslateNavLabel = (required: { locale: string; key: string }) => string;

/** Host collaborators the hook needs; all required, so the engine never reaches a host default. */
export interface SitesSidebarNavArgs {
  groups: readonly AdminNavGroup[];
  locale: string;
  port: Pick<SitesPort, "listSites">;
  useSitesSnapshot: UseSitesSnapshotHook;
  translateNavLabel: TranslateNavLabel;
  /** The admin Sidebar context hook (`@jini-ai/admin/react`'s `useSidebar`); injected so this browser entry never reaches the react domain. */
  useSidebar: () => { collapsed: boolean };
}

export interface SitesSidebarNavOptions {
  doc?: Document;
  /** Read browser layout by default; tests inject exact dimensions without module mocks. */
  measure?: (element: HTMLElement) => { scrollWidth: number; clientWidth: number };
}

function measureSiteName(element: HTMLElement) {
  return { scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
}

export interface SitesSidebarNavView {
  groups: readonly AdminNavGroup[];
  siteName: string;
  prefix: string;
  suffix: string;
  target: HTMLElement | null;
  nameRef: RefObject<HTMLSpanElement | null>;
  title: string | undefined;
}

function formatSitesSidebarLabel(
  { siteName, locale, translateNavLabel }: { siteName: string; locale: string; translateNavLabel: TranslateNavLabel },
  _optional: object,
) {
  const plain = translateNavLabel({ locale, key: "Sites" });
  const pattern = translateNavLabel({ locale, key: "Sites ({siteName})" });
  const [prefix = "", suffix = ""] = pattern.split("{siteName}");
  const label = siteName ? `${prefix}${siteName}${suffix}` : plain;
  return { prefix, suffix, label };
}

/**
 * CMS Sites label adapter over Jini's sidebar and the Sites screen's shared query cache.
 * The shared row still owns its icon, route, accessible name and rail tooltip. A portal supplies
 * only the split visual label because this installed Sidebar has no label-only rendering slot.
 * @returns Markup-ready label parts, portal target, and a native tooltip only for measured overflow.
 * @complexity O(n) in the supplied nav items; one cached Sites read, no per-item requests.
 */
export function useSitesSidebarNav(
  { groups, locale, port, useSitesSnapshot, translateNavLabel, useSidebar }: SitesSidebarNavArgs,
  { doc = document, measure = measureSiteName }: SitesSidebarNavOptions = {},
): SitesSidebarNavView {
  const { collapsed } = useSidebar();
  const enabled = groups.some((group) => group.items.some((item) => item.id === "sites"));
  const list = useSitesSnapshot({ port }, { enabled });
  // currentSite is the live binding, even for an unlisted site; persistedSiteName awaits restart.
  const siteName = enabled ? list.data?.currentSite.name ?? "" : "";
  const { prefix, suffix, label } = formatSitesSidebarLabel({ siteName, locale, translateNavLabel }, {});
  const labelledGroups = groups.map((group) => ({ ...group, items: group.items.map((item) => item.id === "sites" ? { ...item, label } : item) }));
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  const hasName = Boolean(siteName);

  useEffect(() => {
    const nav = doc.getElementById("admin-sidebar");
    if (!nav || !hasName) { setTarget(null); return undefined; }
    // No row class is added here: React rewrites the shared row's className on every active change.
    // The effect below marks the portal target with an unmanaged attribute React leaves alone.
    const discover = () => setTarget(nav.querySelector<HTMLElement>('a.cms-item[href$="/sites"]'));
    discover();
    // Permission/locale changes can replace the shared row without remounting this adapter.
    const observer = new MutationObserver(discover);
    observer.observe(nav, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [doc, hasName]);

  // Mark before measuring/painting the split label; cleanup restores the shared label on removal.
  useLayoutEffect(() => {
    if (!target) return undefined;
    target.setAttribute("data-cms-sites-split", "");
    return () => target.removeAttribute("data-cms-sites-split");
  }, [target]);

  useLayoutEffect(() => {
    const element = nameRef.current;
    if (!element) { setTruncated(false); return undefined; }
    const update = () => {
      const { scrollWidth, clientWidth } = measure(element);
      setTruncated(scrollWidth > clientWidth);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(element);
    doc.defaultView?.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      doc.defaultView?.removeEventListener("resize", update);
    };
  }, [target, siteName, collapsed, doc, measure]);

  return { groups: labelledGroups, siteName, prefix, suffix, target, nameRef, title: truncated ? siteName : undefined };
}
