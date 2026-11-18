import { agentHandle } from "@jini-ai/core/agent-handles";
import { InfoTip } from "../../../react/kit.js";
import { useSeoCopy } from "../hooks/SeoPorts.hooks.js";
import { xIsCustomized, xResolvedValue } from "../../rules.js";
import { MediaRefField } from "./MediaRefField.js";
import type { SeoEntryPanelController } from "../../models.js";

/** The translator `useSeoCopy` hands back, threaded to the entry form's parts. */
export type SeoCopy = ReturnType<typeof useSeoCopy>;

/** What every group of the entry form reads: the effective meta, plus the touched-field reader and setter. */
export type SeoEntryFieldsProps = Pick<SeoEntryPanelController, "fieldValue" | "setField"> & {
  locale: string;
  t: SeoCopy;
  resolved: NonNullable<SeoEntryPanelController["resolved"]>;
};

/** "Search appearance": title, description, canonical URL and the two robots checkboxes. */
export function SeoEntrySearchFields({ locale, t, resolved, fieldValue, setField }: SeoEntryFieldsProps) {
  return (
    <>
      {/* Group names reuse the Site defaults tab's headings, so an operator finds a field under the
          same name on both tabs. `fieldset` gives each group a name a screen reader announces. */}
      <fieldset className="jini-seo-entry-group">
        <legend>{t({ locale: locale, key: "Search appearance" })}</legend>
        <label>
          {t({ locale: locale, key: "Title" })}
          <input
            className="jini-input"
            value={fieldValue("title", resolved.title) ?? ""}
            onChange={(e) => setField("title", e.target.value)}
            {...agentHandle({ handle: "seo-entry-title" }, { role: "field", label: "This entry's SEO title override" })}
          />
        </label>
        <label>
          {t({ locale: locale, key: "Description" })}
          <textarea
            className="jini-textarea"
            value={fieldValue("description", resolved.description ?? "") ?? ""}
            onChange={(e) => setField("description", e.target.value)}
            {...agentHandle({ handle: "seo-entry-description" }, { role: "field", label: "This entry's SEO description override" })}
          />
        </label>
        <label>
          {t({ locale: locale, key: "Canonical URL" })}
          <input
            className="jini-input"
            value={fieldValue("canonical", resolved.canonical) ?? ""}
            onChange={(e) => setField("canonical", e.target.value)}
            {...agentHandle({ handle: "seo-entry-canonical" }, { role: "field", label: "This entry's canonical URL override" })}
          />
        </label>
        <div className="jini-seo-entry-checks">
          <label>
            <input
              className="jini-input"
              type="checkbox"
              checked={fieldValue("noindex", resolved.robots.noindex) ?? false}
              onChange={(e) => setField("noindex", e.target.checked)}
              {...agentHandle({ handle: "seo-entry-noindex" }, { role: "checkbox", label: "Override this entry's robots noindex directive" })}
            />
            {t({ locale: locale, key: "Noindex" })}
          </label>
          <label>
            <input
              className="jini-input"
              type="checkbox"
              checked={fieldValue("nofollow", resolved.robots.nofollow) ?? false}
              onChange={(e) => setField("nofollow", e.target.checked)}
              {...agentHandle({ handle: "seo-entry-nofollow" }, { role: "checkbox", label: "Override this entry's robots nofollow directive" })}
            />
            {t({ locale: locale, key: "Nofollow" })}
          </label>
        </div>
      </fieldset>
    </>
  );
}

/** "Social preview": the Open Graph fields plus the optional X/Twitter disclosure. */
export function SeoEntrySocialFields({ locale, t, resolved, fieldValue, setField, ogImageInherited }: SeoEntryFieldsProps & { ogImageInherited: false | "default" | "content" }) {
  return (
    <>
      {/* One generic "Social preview" (2026-10-15, owner: "is there a generic preview instead of
          twitter title and description … other platforms, not just twitter?"). Open Graph is what
          Facebook, LinkedIn, Slack, Discord, iMessage and WhatsApp read, and X falls back to it
          (`@jini-ai/cms` seo.ts: twitter override > OG override > page default), so the OG fields
          ARE the social preview and the twitter fields are an optional X-only customization. Same
          eleven fields and saved values as before; only the grouping and labels changed. */}
      <fieldset className="jini-seo-entry-group">
        <legend>
          {t({ locale: locale, key: "Social preview" })}
          <InfoTip label={t({ locale: locale, key: "Used by Facebook, LinkedIn, Slack, Discord, iMessage, WhatsApp and X/Twitter" })} />
        </legend>
        <label>
          {t({ locale: locale, key: "Preview title" })}
          <input
            className="jini-input"
            value={fieldValue("ogTitle", resolved.openGraph.title) ?? ""}
            onChange={(e) => setField("ogTitle", e.target.value)}
            {...agentHandle({ handle: "seo-entry-og-title" }, { role: "field", label: "This entry's Open Graph title override" })}
          />
        </label>
        <label>
          {t({ locale: locale, key: "Preview description" })}
          <input
            className="jini-input"
            value={fieldValue("ogDescription", resolved.openGraph.description ?? "") ?? ""}
            onChange={(e) => setField("ogDescription", e.target.value)}
            {...agentHandle({ handle: "seo-entry-og-description" }, { role: "field", label: "This entry's Open Graph description override" })}
          />
        </label>
        <MediaRefField
          locale={locale}
          id="seo-entry-og-image"
          label={t({ locale: locale, key: "Preview image" })}
          value={fieldValue("ogImage", resolved.openGraph.imageRef ?? resolved.openGraph.image ?? "") ?? ""}
          onChange={(value) => setField("ogImage", value)}
          inherited={ogImageInherited}
          agentHandle="seo-entry-og-image"
        />
        <SeoEntryXFields locale={locale} t={t} resolved={resolved} fieldValue={fieldValue} setField={setField} />
      </fieldset>
    </>
  );
}

/** The X/Twitter disclosure inside "Social preview". */
export function SeoEntryXFields({ locale, t, resolved, fieldValue, setField }: SeoEntryFieldsProps) {
  return (
    <>
      {/* Closed by default, open on load when an X override is in effect so it is never hidden.
          An X box that matches the social preview stays empty with the live preview value as its
          placeholder; typing there is what creates an X override. */}
      <details className="jini-seo-x-disclosure" open={xIsCustomized({ meta: resolved })}>
        <summary>{t({ locale: locale, key: "Customize for X/Twitter (optional)" })}</summary>
        <div className="jini-seo-x-fields">
          <label>
            {t({ locale: locale, key: "X/Twitter title" })}
            <input
              className="jini-input"
              value={fieldValue("twitterTitle", xResolvedValue({ key: "twitterTitle", meta: resolved })) ?? ""}
              placeholder={fieldValue("ogTitle", resolved.openGraph.title) ?? ""}
              onChange={(e) => setField("twitterTitle", e.target.value)}
              {...agentHandle({ handle: "seo-entry-twitter-title" }, { role: "field", label: "This entry's Twitter card title override" })}
            />
          </label>
          <label>
            {t({ locale: locale, key: "X/Twitter description" })}
            <input
              className="jini-input"
              value={fieldValue("twitterDescription", xResolvedValue({ key: "twitterDescription", meta: resolved })) ?? ""}
              placeholder={fieldValue("ogDescription", resolved.openGraph.description ?? "") ?? ""}
              onChange={(e) => setField("twitterDescription", e.target.value)}
              {...agentHandle({ handle: "seo-entry-twitter-description" }, { role: "field", label: "This entry's Twitter card description override" })}
            />
          </label>
          <MediaRefField
            locale={locale}
            id="seo-entry-twitter-image"
            label={t({ locale: locale, key: "X/Twitter image" })}
            value={fieldValue("twitterImage", xResolvedValue({ key: "twitterImage", meta: resolved })) ?? ""}
            emptyHint={t({ locale: locale, key: "Same as the preview image" })}
            onChange={(value) => setField("twitterImage", value)}
            agentHandle="seo-entry-twitter-image"
          />
        </div>
      </details>
    </>
  );
}
