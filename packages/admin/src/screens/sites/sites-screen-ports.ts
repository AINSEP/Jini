/**
 * @file What the Sites list and Trash screens read from the host, and the host collaborators they
 * render through. Types only: the listing DTOs, the card policy, the lifecycle controller, the card
 * kit and the list-view hook all stay in the host and reach the screens as props. Methods (not
 * function properties) on purpose, so the host binds its own narrower DTO types to these structural
 * shapes without a cast.
 */
import type { ComponentType, ReactNode } from "react";
import type { Translate } from "@jini-ai/core/text";
import type { RowMenuItem } from "../../react/components/RowMenu/RowMenu.js";

/** The fields of a listed site the screens and the host policy's subtitle rule read. */
export interface SitesScreenSite { name: string; displayName: string; createdAt: string }
/** One recoverable site in Trash. */
export interface SitesScreenTrashedSite { id: string; name: string; displayName: string }
/** The fields of the host's listing snapshot the screens read themselves. */
export interface SitesScreenSnapshot {
  localManagementEnabled?: boolean;
  trash?: readonly SitesScreenTrashedSite[];
  previewVersions?: Record<string, number>;
}

/** The host's local-sites controller: busy name, permanent-delete selection, and the one write. */
export interface SitesLifecycleController {
  busyName: string | null;
  checked: Record<string, boolean>;
  toggleChecked(id: string, checked: boolean): void;
  run(id: string, action: string): Promise<unknown> | void;
}

/** The one visible lifecycle button a card carries, decided by the host's policy. */
export interface SitesCardLifecycle { action: string; labelKey: string; className: string; disabled: boolean }
/** A card's controls: lifecycle button, Open URL, the host's menu actions, and an optional note. */
export interface SitesCardControls { lifecycle: SitesCardLifecycle | null; openUrl: string | null; menu: unknown; noteKey?: string | undefined }
/** The status pill: the host's tone class name (mapped to the card's tone here) and its label. */
export interface SitesStatusPill { toneClass: string; label: string }

/** Trash card rules the host owns. */
export interface SiteTrashPolicy {
  resolveSiteSubtitle(site: SitesScreenTrashedSite): string | null;
  resolveTrashCardActions(args: { id: string; checked: Record<string, boolean>; busyName: string | null }): { selected: boolean; restoreDisabled: boolean; deleteDisabled: boolean };
}

/** Every product rule the All sites tab renders: which actions apply, which pill, which badge. */
export interface AllSitesPolicy {
  resolveSitesEmpty(args: { sites: readonly SitesScreenSite[] }): boolean;
  resolveSitesRowHandles(args: { sites: readonly SitesScreenSite[] }): string[];
  resolveSiteListItems(args: { sites: readonly SitesScreenSite[] }): SitesListEntry[];
  resolveSiteCardView(args: { site: SitesScreenSite; snapshot: SitesScreenSnapshot; switchingEnabled: boolean; activatingName: string | null; busyName: string | null; managed: boolean }): SitesCardControls;
  buildSiteCardMenuItems(args: { site: SitesScreenSite; menu: unknown; onActivate: (name: string) => void; controller?: SitesLifecycleController | undefined; t: Translate }, extra: { hide?: { label: string; onSelect: () => void } }): RowMenuItem[];
  resolveSiteStatusPill(args: { site: SitesScreenSite; snapshot: SitesScreenSnapshot; t: Translate }): SitesStatusPill;
  resolveSiteRunningTitle(args: { site: SitesScreenSite; t: Translate }): string | undefined;
  resolveSiteCardMeta(args: { site: SitesScreenSite; snapshot: SitesScreenSnapshot; activatingName: string | null; t: Translate }): string | null;
  resolveSiteIsDefault(args: { site: SitesScreenSite; snapshot: SitesScreenSnapshot }): boolean;
  resolveSiteCardTitle(site: SitesScreenSite): string;
  resolveSiteSubtitle(site: SitesScreenSite): string | null;
  resolveSiteRegistrationBadge(args: { site: SitesScreenSite; snapshot: SitesScreenSnapshot }): { labelKey: string; titleKey: string } | null;
}

/** One card in the shape the host's list view sorts: the folder name is the id. */
export interface SitesListEntry { id: string; name: string; createdAt: string; site: SitesScreenSite }

/** The list view the injected hook returns; `TList` is the host's full controller type. */
export interface SitesListView {
  visible: readonly { site: SitesScreenSite }[];
  allCount: number;
  hiddenCount: number;
  isPinned(id: string): boolean;
  togglePin(id: string): void;
  isHidden(id: string): boolean;
  toggleHidden(id: string): void;
}

/** The person's remembered list choices, loaded and saved by the host. */
export interface SitesListPrefsState<TPrefs> {
  prefs: TPrefs;
  ready: boolean;
  onPrefsChange: (next: TPrefs) => void;
  loadError: string | null;
  saveError: string | null;
}

/** The list toolbar's copy. */
export interface SitesListToolbarCopy {
  views: string; pinnedRecent: string; all: string; hidden: string; sortBy: string; recent: string; oldest: string; name: string;
}

/** Card tones the host's shared card draws. */
export type SitesCardTone = "neutral" | "running" | "busy" | "warning" | "danger";

/** The host's shared site-card components (frame, pin, status, toolbar). */
export interface SitesCardKit<TList> {
  SiteCard: ComponentType<{
    name: string; title?: string; nameDetail?: ReactNode; nameExtra?: ReactNode; previewSrc?: string | null;
    onPreviewError?: () => void; menu?: ReactNode; details?: ReactNode; status?: ReactNode; notes?: ReactNode; actions?: ReactNode;
  }>;
  SiteCardPin: ComponentType<{ pinned: boolean; label: string; onToggle: () => void }>;
  SiteCardStatus: ComponentType<{ label: ReactNode; tone?: SitesCardTone; title?: string | undefined }>;
  SiteListToolbar: ComponentType<{ list: TList; copy: SitesListToolbarCopy }>;
}

/** The host's list-view hook (sort, filter, pins, hidden). */
export type UseSitesListViewHook<TPrefs, TList extends SitesListView> = (args: { items: SitesListEntry[]; prefs: TPrefs; onPrefsChange: (next: TPrefs) => void }) => TList;
/** The host's card-preview hook; `urlFor` is the host's preview address. */
export type UseSitesCardPreviewHook = (args: { site: { name: string }; snapshot: { previewVersions?: Record<string, number> }; urlFor: (args: { name: string; version: number }) => string }) => { src: string | null; onError: () => void };
