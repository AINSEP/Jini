import { agentHandle } from "@jini-ai/core/agent-handles";
import type { SeoTabController } from "../hooks/SeoPage.hooks.js";
import type { useSeoCopy } from "../hooks/SeoPorts.hooks.js";
import { actionLabel, orEmpty } from "../../rules.js";
import { MediaRefField } from "../components/MediaRefField.js";
import { SeoSection } from "../components/SeoSection.js";

/** Title template and default meta description. */
export function SeoSearchAppearanceSection({ locale, settings, t }: Pick<SeoTabController, "locale" | "settings"> & { t: ReturnType<typeof useSeoCopy> }) {
  return (
    <SeoSection title={t({ locale: locale, key: "Search appearance" })}>
      <div className="jini-field">
        <label className="jini-field-label" htmlFor="seo-title-template">
          {t({ locale: locale, key: "Title template (must contain %s)" })}
        </label>
        <input
          className="jini-input"
          id="seo-title-template"
          name="titleTemplate"
          defaultValue={settings.titleTemplate}
          {...agentHandle({ handle: "seo-title-template" }, {
            role: "field",
            label: "Site-wide title template; %s is replaced by the page's own title",
          })}
        />
      </div>
      <div className="jini-field">
        <label className="jini-field-label" htmlFor="seo-default-description">
          {t({ locale: locale, key: "Default meta description" })}
        </label>
        <textarea
          className="jini-textarea"
          id="seo-default-description"
          name="defaultDescription"
          defaultValue={orEmpty({ value: settings.defaultDescription })}
          {...agentHandle({ handle: "seo-default-description" }, {
            role: "field",
            label: "Fallback meta description for pages that set none of their own",
          })}
        />
      </div>
    </SeoSection>
  );
}

/** Default preview image and the X/Twitter handle. */
export function SeoSocialPreviewSection({ locale, settings, defaultOgImage, setDefaultOgImage, t }: Pick<SeoTabController, "locale" | "settings" | "defaultOgImage" | "setDefaultOgImage"> & { t: ReturnType<typeof useSeoCopy> }) {
  // Its own group, not a tail on "Search appearance". These two fields are what a link to this
  // site looks like when it is PASTED somewhere — a different question from what a search
  // result looks like, and the split every SEO tool an operator has already used makes. The
  // form previously ran all four together in one unlabelled `.field-group`, so the OG image
  // read as a search-result setting.
  return (
    <SeoSection
      title={t({ locale: locale, key: "Social preview" })}
      tip={t({ locale: locale, key: "Used by Facebook, LinkedIn, Slack, Discord, iMessage, WhatsApp and X/Twitter" })}
    >
      <MediaRefField
        locale={locale}
        id="seo-default-og-image"
        name="defaultOgImage"
        label={t({ locale: locale, key: "Default preview image" })}
        value={defaultOgImage}
        onChange={setDefaultOgImage}
        agentHandle="seo-default-og-image"
      />
      <div className="jini-field">
        <label className="jini-field-label" htmlFor="seo-twitter-site">
          {t({ locale: locale, key: "X/Twitter @handle" })}
        </label>
        <input
          className="jini-input"
          id="seo-twitter-site"
          name="twitterSite"
          defaultValue={orEmpty({ value: settings.twitterSite })}
          {...agentHandle({ handle: "seo-twitter-site" }, {
            role: "field",
            label: "The site's Twitter @handle, used in Twitter card metadata",
          })}
        />
      </div>
    </SeoSection>
  );
}

/** Default noindex, nofollow and the sitemap switch. */
export function SeoCrawlingSection({ locale, settings, t }: Pick<SeoTabController, "locale" | "settings"> & { t: ReturnType<typeof useSeoCopy> }) {
  return (
    <SeoSection title={t({ locale: locale, key: "Crawling" })}>
      <label className="jini-form-checkbox-field">
        <input
          className="jini-input"
          type="checkbox"
          name="noindex"
          defaultChecked={settings.defaultRobots.noindex}
          {...agentHandle({ handle: "seo-default-noindex" }, {
            role: "checkbox",
            label: "Ask search engines not to index pages by default",
          })}
        />
        {t({ locale: locale, key: "Default noindex" })}
      </label>
      <label className="jini-form-checkbox-field">
        <input
          className="jini-input"
          type="checkbox"
          name="nofollow"
          defaultChecked={settings.defaultRobots.nofollow}
          {...agentHandle({ handle: "seo-default-nofollow" }, {
            role: "checkbox",
            label: "Ask search engines not to follow links by default",
          })}
        />
        {t({ locale: locale, key: "Default nofollow" })}
      </label>
      <label className="jini-form-checkbox-field">
        <input
          className="jini-input"
          type="checkbox"
          name="sitemapEnabled"
          defaultChecked={settings.sitemapEnabled}
          {...agentHandle({ handle: "seo-sitemap-enabled" }, {
            role: "checkbox",
            label: "Whether this site publishes a sitemap at all",
          })}
        />
        {t({ locale: locale, key: "Sitemap enabled" })}
      </label>
    </SeoSection>
  );
}

/** The Save settings button. */
export function SeoSaveActions({ locale, saving, t }: Pick<SeoTabController, "locale" | "saving"> & { t: ReturnType<typeof useSeoCopy> }) {
  return (
    <div className="jini-editor-actions jini-form-actions jini-seo-actions">
      <button
        className="jini-btn"
        type="submit"
        disabled={saving}
        {...agentHandle({ handle: "seo-save-settings" }, {
          role: "button",
          label: "Save the site-wide SEO defaults above",
        })}
      >
        {actionLabel({ pending: saving, pendingLabel: t({ locale: locale, key: "Saving…" }), idleLabel: t({ locale: locale, key: "Save settings" }) })}
      </button>
    </div>
  );
}
