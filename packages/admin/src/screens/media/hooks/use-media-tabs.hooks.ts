import { navigate } from "../../../shell/lib/router.js";

export type MediaTabId = "all" | "images" | "videos" | "external-providers" | "trash";

/** The subset of {@link MediaTabId} that reaches the media-grid rendering path
 *  (`filterMediaByTab`, `MediaGridOrEmpty`, `MediaLibraryPanel` in `Media.tsx`) — everything except
 *  "external-providers", which renders a provider-credentials panel with no grid, no filter, and no
 *  concept of "empty" in the grid's sense. `Media.tsx`'s own early return on
 *  `activeTab === "external-providers"` is what narrows `MediaTabId` down to this type for the rest
 *  of that component's body; this alias exists so every function further down the grid-rendering
 *  path can declare that narrower contract directly instead of re-widening to the full tab set and
 *  needing a redundant `"external-providers"` branch nothing would ever reach. */
export type MediaContentTabId = Exclude<MediaTabId, "external-providers">;

/** "External Providers" (2026-09-10, owner call — supersedes the same-day first pass that briefly
 *  put this tab on `features/providers/Providers.tsx` as "Media"): credentials for outside media
 *  generation services belong beside the media they generate, not beside MCP/webhook plumbing. Last
 *  in the list — an operator reaches for All/Images/Videos far more often than provider credentials,
 *  and the three content tabs read as one group with this one set apart. */
export const MEDIA_TABS: readonly { id: MediaTabId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "images", label: "Images" },
  { id: "videos", label: "Videos" },
  { id: "external-providers", label: "External Providers" },
  // Trash (owner, 2026-10-23: "trashed media as its own tab … removed from All, Images, Videos").
  // Last, after the existing tabs, as asked. Reuses the row menu's own "Trash" label key.
  { id: "trash", label: "Trash" },
];

const MEDIA_TAB_IDS = MEDIA_TABS.map((tab) => tab.id) as readonly string[];

export interface MediaTabsController {
  activeTab: MediaTabId;
  setActiveTab: (tab: MediaTabId) => void;
}

/** Falls back to "all" for an absent or unrecognized `?tab=` value — same "don't trust a raw
 *  query value" guard `Deployment.tsx`'s `resolveActiveTabId`/`SettingsUi.tsx`'s `requestedTabId`
 *  both apply, for the same reason (a stale link or a typo must not blank the panel).
 *  Exported (2026-09-06) so `Media.hooks.tsx`'s `resolveMediaTabChange` can run `TabBar`'s
 *  string id through the same guard instead of a cast; behavior unchanged.
 *  @complexity O(1) — fixed-size id list, not caller-controlled. */
export function resolveActiveTab({ tabId }: { tabId: string | null | undefined }, _optional: Record<string, never> = {}): MediaTabId {
  return tabId && MEDIA_TAB_IDS.includes(tabId) ? (tabId as MediaTabId) : "all";
}

/**
 * Active-tab state for the Media page's tab bar, `?tab=` deep-linked — same convention
 * `Deployment.tsx`'s `resolveActiveTabId`/`handleTabChange` and `SettingsUi.tsx`'s
 * `requestedTabId`/`handleTabChange` both use: the active tab lives in the URL, not component
 * state, so `/admin/media?tab=videos` is both bookmarkable and survives a refresh.
 *
 * No port: purely local UI state derived from a prop plus a `navigate()` call, so there is
 * nothing to inject a dependency for — `Media.tsx` takes this hook itself as an overridable prop
 * (`useMediaTabsHook`, defaulted to this hook) rather than through a `useWiredX()` pair, the same
 * no-port, overridable-hook-prop treatment Jini's shared `Lightbox` gives `useLightbox`
 * (`useLightboxHook`), which the media lightbox now uses, for the identical reason.
 *
 * @param tabId - The `?tab=` query value from `panels.tsx`'s `media` route (`URLSearchParams.get`
 * returns `null` when the param is absent).
 * @returns Tab-bar state: the active tab id (resolved against `MEDIA_TABS`) and a setter that
 * writes the new id into the URL via `navigate(..., { replace: true })`, matching `Deployment`'s
 * own reasoning for `replace` — switching tabs should not grow the back-button history one entry
 * per click.
 */
export function useMediaTabs(tabId?: string | null): MediaTabsController {
  const activeTab = resolveActiveTab({ tabId });
  function setActiveTab(tab: MediaTabId) {
    navigate({ routePath: `/media?tab=${tab}` }, { replace: true });
  }
  return { activeTab, setActiveTab };
}
