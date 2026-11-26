import { agentHandle } from "@jini-ai/core/agent-handles";
import type { MediaTabId, MediaTabsController } from "./hooks/use-media-tabs.hooks.js";
import { resolveMediaTabs, resolveMediaTabChange } from "./media-tabs.hooks.js";
import type { MediaProps } from "./Media.js";

/** Tab bar (OD-parity pass, 2026-08-08), `?tab=` deep-linked — see `use-media-tabs.hooks.ts`
          for the URL-sync convention. Drawn by the shared `@jini-ai/ui/tab-strip` since 2026-09-06
          (owner: "give the tabs icons … every other tab row in this admin already pairs an icon
          with its label — match that"): the same underline-and-icon primitive Roles, Source
          Control, Database, Sites, Themes and Pages use, replacing the pill row this screen used
          to draw itself (`media.css`'s retired `.media-tabs`). Tabs, ids, order, the translated
          labels and every per-tab agent handle are unchanged — `Media.hooks.tsx`'s
          `resolveMediaTabs` builds them from the same `MEDIA_TABS` list.
          "External Providers" JOINED this screen 2026-09-10 (owner-approved nav restructure, second
          pass) — it spent one day as the "Media" tab on `features/providers/Providers.tsx` before
          landing here for good; see that file's own header for the full move history. It is the
          fourth, LAST tab — "all"/"images"/"videos" are the three content-filter tabs an operator
          reaches for far more often, and read as one group with this one set apart. */
/**
/**
 * The page header and tab bar every `Media` tab shares — extracted so `Media`'s own early return
 * on the External Providers tab (see that function's own comment) does not have to duplicate this
 * markup between two `return` statements. `children` is whichever tab body is active: either
 * `MediaLibraryPanel`'s grid or `ExternalProvidersPanel`.
 */
export function MediaPageShell({
  t,
  activeTab,
  setActiveTab,
  tabCounts,
  children, kit }: {
  t: (key: string) => string;
  activeTab: MediaTabId;
  setActiveTab: MediaTabsController["setActiveTab"];
  /** Per-tab item counts (owner ask, 2026-09-26) — see `resolveMediaTabs`'s own doc for how an
   *  absent id renders no badge at all. */
  tabCounts: Partial<Record<MediaTabId, number>>;
  children: React.ReactNode;
} & Pick<MediaProps, "kit">, _optional = {}) {
  const { Icon, TabBar, PublishSectionButton } = kit;
  return (
    <div className="page">
      <div
        className="page-header"
        {...agentHandle({ handle: "media-header" }, { role: "region", label: "Media header — page title" })}
      >
        <div className="page-header-text">
          <p className="page-kicker">{t("Content")}</p>
          <h1 className="page-title">{t("Media")}</h1>
          <p className="page-description">{t("Upload and manage image and video assets used across the site.")}</p>
        </div>
        <div className="page-actions">
          <PublishSectionButton section="media" />
        </div>
      </div>

      <TabBar
        ariaLabel={t("Media")}
        tabs={resolveMediaTabs({ t, Icon }, { counts: tabCounts })}
        activeId={activeTab}
        onChange={resolveMediaTabChange({ setActiveTab })}
      />

      {children}
    </div>
  );
}

