import type { ReactNode } from "react";
import { useSeoTabs } from "../hooks/SeoPage.hooks.js";
import type { SeoTabController, SeoTabId } from "../hooks/SeoPage.hooks.js";
import type { SeoCopy } from "../components/SeoEntryFields.js";


import { TabBar } from "../../../react/kit.js";
import { useSeoCopy, useSeoOptions } from "../hooks/SeoPorts.hooks.js";
import { useWiredSeo } from "../hooks/use-seo.hooks.js";
import { useSeoPageActions } from "../hooks/SeoPage.hooks.js";
import { SitemapModal } from "../components/SitemapModal.js";

import { SeoEntrySection } from "../components/SeoEntryPanel.js";
import { SeoSitemapTab } from "../tabs/SeoSitemapTab.js";
import { SeoDefaultsTab } from "../tabs/SeoDefaultsTab.js";








/**
 * `SeoSettingsScreen` (SPEC-008 ui.spec.md §2.4) — the site-wide `seo.*` settings form +
 * `SitemapRegenerateButton` (§2.6). Coordinator-authored 2026-07-13, post-session-limit resume.
 * Markup only.
 *
 * State and API calls live in one hook per component: `hooks/use-seo.hooks.ts` (top-level
 * defaults form + sitemap button), `hooks/use-entry-picker.hooks.ts`, `hooks/use-seo-entry-panel
 * .hooks.ts`, `hooks/use-seo-entry-section.hooks.ts`. The issue-severity sort lives in `rules.ts`.
 *
 * SPEC-037 REQ-06/07/08: `SeoEntryPanel` closes the deferred per-entry gap this file's own header
 * used to disclose — a standalone entry picker (dropdown over `listPosts`/`listPages`, cheaper
 * than threading a new panel through `PostEditor.tsx`, per REQ-06's own "implementer's choice")
 * plus a partial-override edit form and a read-only analyze view. `RobotsRuleEditor` (§2.5) is
 * still a minimal textarea-per-rule form (unchanged from the original disclosed scope note).
 *
 * Copy comes from the module's injected t function. Legacy locale props remain render-contract
 * metadata only; the host retains its dictionaries and passes the bound translator through the module.
 * Host publish behavior is injected as headerActions, and media selection uses its existing slot
 * or the shared mediaPickerToken service. The original rationale is archived in SOURCE-RATIONALE.
 *
 * ## Tabs (2026-09-06)
 *
 * The three sections above are now three `?tab=` tabs — Site defaults, Sitemap, Pages & posts —
 * built on the shared `@jini-ai/ui/tab-strip` that `Deployment.tsx`, `Sites.tsx`, `Themes.tsx`,
 * `Security.tsx`, `SourceControl.tsx` and `Database.tsx` already use. Nothing new was written for
 * the tab mechanism: the shell was ALREADY extracted (`@jini-ai/ui/tab-strip` for the strip,
 * `packages/ui/src/features/panel-kit/helpers/resolve-active-tab-id.ts` for the `?tab=` guard), so this screen reuses it rather than
 * becoming a third implementation. The reasoning for the grouping, the tab NAMES, and the one
 * cut that was considered and rejected all live in `react/hooks/SeoPage.hooks.ts`'s header.
 *
 * Everything below the shell is unchanged markup, only relocated: `SeoDefaultsTab` holds the form
 * verbatim (with two field-group headings added, which it never had), `SeoSitemapTab` holds the
 * sitemap actions plus a new state line, and the Pages & posts panel IS the existing
 * `SeoEntrySection`, rendered directly rather than wrapped in a new component that would add
 * nothing.
 * No component was split or merged, so `SeoEntryPanel` — the one function in this file carrying a
 * recorded complexity exemption (`development/scripts/admin-complexity-debt.json`, keyed by
 * `{rule, file, reason}`) — stays in THIS file at its recorded measurement. Moving it to a tab
 * file of its own, the way `Deployment.tsx` gives each tab a file, would have made its debt entry
 * name a path that no longer exists and required adding a NEW entry for the new file, growing a
 * baseline that JSON's own instructions say must only shrink. One file, top-level components: the
 * ESLint gate scores functions independently of which file they sit in, so the ceiling is
 * satisfied either way — only the organizational preference differs, and the debt key decides it.
 *
 * Superseded by the JM2-pre split (2026-11-18): that debt key is gone with the file's size debt, so
 * `SeoEntryPanel`, `SeoSection`, `EntryPicker`, `AnalyzePanel` and the entry form groups now live in
 * `react/components/`, and the two tab bodies in `react/tabs/`. This file keeps only the shell.
 *
 * ## Out of the cards (2026-09-06, same day)
 *
 * Owner, on the screen the section above describes: "for seo can you take the stuff out of the
 * cards?" Every panel here was a `.card` (Site defaults, Sitemap) or a `.notice` (the two
 * per-entry panels) and is now content laid directly on the page, held together by `SeoSection`'s
 * heading rail and one hairline per seam. `styles/seo.css`'s header carries the measurements and
 * the full reasoning, including why the card was never what grouped the three field groups.
 *
 * Two claims in the paragraph above are now stale and are corrected here rather than rewritten in
 * place, since the tab conversion's own reasoning is still the reason the tabs exist: the defaults
 * form has THREE field-group headings, not two ("Social sharing" was split out in the same
 * commit), and those groups are `SeoSection`s rather than `.field-group` divs. What has NOT
 * changed is the constraint that matters — all seven fields still live in one `<form>`, submitted
 * as one `FormData`, with nothing about them conditional.
 */

/** What the two site-wide tab panels need from `useWiredSeo()`. Named as one object rather than
 *  passed as six loose props for the same reason `Roles.tsx`'s `RoleCreateFormController` documents:
 *  none of these is meaningful without the others, so naming the group is what lets a test hand a
 *  panel a controller instead of assembling one out of parts. */


/** Dispatches the one active tab's panel as a flat if-chain — a plain function rather than a
 *  ternary written directly in `Seo`'s JSX, which would be counted against that component's own
 *  complexity. Same split `Deployment.tsx`'s `deploymentTabPanel` and `Sites.tsx`'s `sitesTabPanel`
 *  make for the identical gate.
 *  @complexity O(1) — three mutually exclusive branches, no iteration. */

export interface SeoProps {
  /** The `?tab=` query value from `panels.tsx`'s `seo` route (`URLSearchParams.get` returns `null`
   *  when the param is absent). Guarded by `resolveSeoTabId`, so a stale link or a typo opens Site
   *  defaults rather than a blank panel. */
  tabId?: string | null | undefined;
  /** Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   *  for `useCustomSelect`. Defaulted to the real hook, so production callers (`panels.tsx`) pass
   *  nothing and behave exactly as before. */
  useSeoHook?: typeof useWiredSeo;
  useSeoCopyHook?: typeof useSeoCopy;
  useSeoOptionsHook?: typeof useSeoOptions;
  useSeoPageActionsHook?: typeof useSeoPageActions;
  useSeoTabsHook?: typeof useSeoTabs;
  onTabChange?: ((required: { tab: string }, optional?: Record<string, never>) => void) | undefined;
}

/** Page title block and the host's header slot. */
function SeoPageHeader({ locale, headerActions, t }: { locale: string; headerActions: ReactNode; t: SeoCopy }) {
  return (
    <div className="jini-page-header">
      <div className="jini-page-header-text">
        <p className="jini-page-kicker">{t({ locale: locale, key: "Marketing" })}</p>
        <h1 className="jini-page-title">SEO</h1>
        <p className="jini-page-description">
          {t({ locale: locale, key: "Site-wide defaults for meta titles, descriptions, social previews, and robots directives." })}
        </p>
      </div>
      <div className="jini-page-actions">
        {headerActions}
      </div>
    </div>
  );
}

/** Load/save/regenerate outcomes of the whole screen. */
function SeoBanners({ error, notice }: { error: string | null; notice: string | null }) {
  // Both banners stay on the SHELL, above the tab strip, not inside a panel: `error` and
  // `notice` come from `useWiredSeo()` and describe the screen's own load/save/regenerate
  // outcomes, which are not owned by whichever tab happens to be open. A save confirmation
  // rendered inside the Site defaults panel would also be the one thing on the screen that
  // silently disappears when the operator switches tabs.
  return (
    <>
          {error ? <div className="jini-notice jini-notice-error">{error}</div> : null}
    {notice ? <div className="jini-notice">{notice}</div> : null}
    </>
  );
}

/** The sitemap modal, mounted only while the shell says it is open. */
function SeoSitemapModalSlot({ open, locale, sitemapEnabled, saving, regenerateSitemap, closeSitemapModal }: {
  open: boolean; locale: string; sitemapEnabled: boolean; saving: boolean; regenerateSitemap: () => Promise<boolean>; closeSitemapModal: () => void;
}) {
  // The sitemap modal stays on the shell rather than inside `SeoSitemapTab`: it is a portal-
  // shaped overlay over the whole page, and `sitemapModalOpen`/`closeSitemapModal` are shell
  // state from `useWiredSeo()`. Unchanged from before the tab conversion.
  return (
    <>
          {open ? (
      <SitemapModal
        locale={locale}
        sitemapEnabled={sitemapEnabled}
        regenerating={saving}
        onRegenerate={regenerateSitemap}
        onClose={closeSitemapModal}
      />
    ) : null}
    </>
  );
}

export function Seo({
  tabId, onTabChange, useSeoHook = useWiredSeo, useSeoCopyHook = useSeoCopy, useSeoOptionsHook = useSeoOptions,
  useSeoPageActionsHook = useSeoPageActions, useSeoTabsHook = useSeoTabs,
}: SeoProps = {}) {
  const t = useSeoCopyHook();
  const { headerActions } = useSeoOptionsHook();
  const { changeTab } = useSeoPageActionsHook({ onTabChange });
  const {
    settings,
    error,
    saving,
    notice,
    save,
    defaultOgImage,
    setDefaultOgImage,
    regenerateSitemap,
    sitemapModalOpen,
    openSitemapModal,
    closeSitemapModal,
    locale,
  } = useSeoHook();

  // Locale is a context-backed hook; it must run on the loading/error renders too.
  const { activeTabId, tabs } = useSeoTabsHook({ tabId });
  if (error && !settings) return <div className="jini-page"><div className="jini-notice jini-notice-error">{error}</div></div>;
  if (!settings) return <div className="jini-page"><div className="jini-notice">{t({ locale: locale, key: "Loading SEO settings…" })}</div></div>;

  const controller: SeoTabController = {
    locale,
    settings,
    saving,
    save,
    defaultOgImage,
    setDefaultOgImage,
    regenerateSitemap,
    openSitemapModal,
  };

  return (
    <div className="jini-page jini-seo-page">
      <SeoPageHeader locale={locale} headerActions={headerActions} t={t} />
      <SeoBanners error={error} notice={notice} />

      <TabBar
        ariaLabel="SEO"
        tabs={tabs}
        activeId={activeTabId}
        onChange={changeTab}
        containerHandle="seo-tab-bar"
      />
      {seoTabPanel({ activeTabId, controller })}

      <SeoSitemapModalSlot open={sitemapModalOpen} locale={locale} sitemapEnabled={settings.sitemapEnabled} saving={saving} regenerateSitemap={regenerateSitemap} closeSitemapModal={closeSitemapModal} />
    </div>
  );
}

/** Panel selection is presentation dispatch; this never changes the defaults form's field set. */
function seoTabPanel(
  { activeTabId, controller }: { activeTabId: SeoTabId; controller: SeoTabController },
  _optional: Record<string, never> = {},
) {
  if (activeTabId === 'sitemap') return <SeoSitemapTab controller={controller} />;
  if (activeTabId === 'entries') return <SeoEntrySection locale={controller.locale} />;
  return <SeoDefaultsTab controller={controller} />;
}

export { Seo as SeoPage };
export default Seo;
