import type { SeoTabController } from "../hooks/SeoPage.hooks.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { useSeoCopy } from "../hooks/SeoPorts.hooks.js";
import { actionLabel } from "../../rules.js";
import { sitemapStateLabel } from "../hooks/SeoPage.hooks.js";
import { SeoSection } from "../components/SeoSection.js";

/**
 * The "Sitemap" tab — the two sitemap actions, moved here verbatim, plus one line this screen never
 * had: whether a sitemap is being published at all.
 *
 * That line is the reason this is a tab rather than a footnote on Site defaults. The switch
 * ("Sitemap enabled") cannot move here — it belongs to the defaults form's `FormData` submit, see
 * `react/hooks/SeoPage.hooks.ts`'s header — so without a state read, an operator who had sitemaps switched off
 * would find a Regenerate button that appears live and reports success while publishing nothing.
 * Reporting the state instead of duplicating the control keeps exactly one switch on the screen.
 *
 * Wrapped in a `.card` like the defaults form beside it, rather than left as loose text on the
 * page — rendered side by side the uncontained version read as an unfinished panel next to a
 * carded one. The heading is "Cached sitemap", not "Sitemap": it names what the card acts on
 * without restating the tab label, the same way `deployment/OverviewTab.tsx`'s cards are titled.
 * It also has to exist at all — a `role="tab"` button is not in a screen reader's heading list, so
 * a panel with no `<h2>` leaves that reader nothing but the page `H1`.
 */
export function SeoSitemapTab({ controller, useSeoCopyHook = useSeoCopy }: { controller: SeoTabController; useSeoCopyHook?: typeof useSeoCopy }) {
  const t = useSeoCopyHook();
  const { locale, settings, saving, regenerateSitemap, openSitemapModal } = controller;

  return (
    <div
      className="jini-seo-panel jini-seo-panel--full"
      {...agentHandle({ handle: "seo-sitemap" }, {
        role: "region",
        label: "Sitemap — force a rebuild of the cached sitemap",
      })}
    >
      <SeoSection title={t({ locale: locale, key: "Cached sitemap" })}>
        <p className="jini-card-lead">{sitemapStateLabel({ sitemapEnabled: settings.sitemapEnabled }, { t: key => t({ locale, key }) })}</p>
        <p>{t({ locale: locale, key: "Rebuild the sitemap now to include the latest published content." })}</p>
        <span className="jini-editor-actions">
          <button
            className="jini-btn jini-btn-secondary"
            disabled={saving}
            onClick={regenerateSitemap}
            {...agentHandle({ handle: "seo-regenerate-sitemap" }, {
              role: "button",
              label: "Rebuild the cached sitemap now, bypassing the cache",
            })}
          >
            {actionLabel({ pending: saving, pendingLabel: t({ locale: locale, key: "Working…" }), idleLabel: t({ locale: locale, key: "Regenerate sitemap" }) })}
          </button>
          <button
            type="button"
            className="jini-btn jini-btn-secondary"
            onClick={openSitemapModal}
            {...agentHandle({ handle: "seo-view-sitemap" }, {
              role: "button",
              label: "Open a modal showing the sitemap's URLs, or its raw XML",
            })}
          >
            {t({ locale: locale, key: "View sitemap" })}
          </button>
        </span>
      </SeoSection>
    </div>
  );
}
