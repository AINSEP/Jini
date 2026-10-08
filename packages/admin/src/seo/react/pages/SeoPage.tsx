import { useAnalyzePanel, useSeoDefaults, useSeoTabs, seoTabPanel } from "../hooks/SeoPage.hooks.js";
import type { ReactNode } from "react";
import type { SeoTabController } from "../hooks/SeoPage.hooks.js";

import { agentHandle } from "@jini-ai/agentic";

import { TabBar } from "@jini-ai/ui/tab-strip";
import { useSeoCopy, useSeoOptions } from "../hooks/SeoPorts.hooks.js";
import { actionLabel, orEmpty } from "../../rules.js";
import { useWiredEntryPicker } from "../hooks/use-entry-picker.hooks.js";
import { useWiredSeoEntryPanel } from "../hooks/use-seo-entry-panel.hooks.js";
import { useSeoEntrySection } from "../hooks/use-seo-entry-section.hooks.js";
import { useWiredSeo } from "../hooks/use-seo.hooks.js";
import {
  useSeoPageActions,
  sitemapStateLabel,
} from "../hooks/SeoPage.hooks.js";
import { MediaRefField } from "../components/MediaRefField.js";
import { SitemapModal } from "../components/SitemapModal.js";

import type { SeoEntryAnalysis, SeoSettings, SeoSettingsPatch } from "../../models.js";

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
 * metadata only; Tovu retains its dictionaries and passes the bound translator through the module.
 * Host publish behavior is injected as headerActions, and media selection uses its existing slot
 * or the shared mediaPickerToken service. The original rationale is archived in SOURCE-RATIONALE.
 *
 * ## Tabs (2026-09-06)
 *
 * The three sections above are now three `?tab=` tabs — Site defaults, Sitemap, Pages & posts —
 * built on the shared `@jini-ai/ui/tab-strip` that `Deployment.tsx`, `Sites.tsx`, `Themes.tsx`,
 * `Security.tsx`, `SourceControl.tsx` and `Database.tsx` already use. Nothing new was written for
 * the tab mechanism: the shell was ALREADY extracted (`@jini-ai/ui/tab-strip` for the strip,
 * `lib/resolve-active-tab-id.ts` for the `?tab=` guard), so this screen reuses it rather than
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

export interface SeoSectionProps {
  title: string;
  children: ReactNode;
}

/**
 * One titled group on this screen — title in the left rail, controls in the right column. Markup
 * only; every visual decision and the reasoning for the rail lives in `styles/seo.css`'s header.
 *
 * This is the 1:1 replacement for the `<div className="field-group"><h2 className="card-title">`
 * pair `56e87ae0` introduced, and the swap is deliberately structure-preserving: the section body
 * carries `.field-group`'s exact `flex-column` + `--space-4` gap, so the fields inside are laid
 * out identically and NOTHING becomes conditional. That matters more here than anywhere else in
 * this file — `SeoDefaultsTab` submits via `new FormData(e.currentTarget)`, so a field that stops
 * being mounted is simply absent from the payload and silently saves as blank. A wrapper element
 * cannot unmount anything, and `Seo.unit.test.tsx`'s "keeps every defaults field inside ONE form"
 * pins all seven names, in order, against exactly that.
 *
 * Fixed `<h2>` rather than a `level` prop: both callers are top-level groups under the page `H1`,
 * and the one heading on this screen that is genuinely subordinate — `SeoEntryPanel`'s "Per-entry
 * overrides", which sits INSIDE the "Per-entry SEO" section — keeps its own `<h3>` and is not
 * routed through here.
 */
function SeoSection({ title, children }: SeoSectionProps) {
  return (
    <section className="jini-seo-section">
      <div className="jini-seo-section-head">
        <h2 className="jini-seo-section-title">{title}</h2>
      </div>
      <div className="jini-seo-section-body">{children}</div>
    </section>
  );
}

export interface EntryPickerProps {
  locale: string;
  entryId: string;
  onChange: (entryId: string) => void;
  /** Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   *  for `useCustomSelect`. */
  useEntryPickerHook?: typeof useWiredEntryPicker;
}

/** Dropdown over every post + page, sourced from the already-existing `listPosts`/`listPages`
 * routes — cheapest entry-selection UX available given what's already built (REQ-06). */
function EntryPicker({ locale, entryId, onChange, useEntryPickerHook = useWiredEntryPicker }: EntryPickerProps) {
  const t = useSeoCopy();
  const { entries, error } = useEntryPickerHook();

  if (error) return <div className="jini-notice jini-notice-error">{error}</div>;
  if (!entries) return <div className="jini-notice">{t({ locale: locale, key: "Loading entries…" })}</div>;

  /* The "Entry" caption is no longer painted (owner, 2026-09-06: "you can actually just get rid of
     'Entry'") — the placeholder option already says "Choose an entry…", so the visible word was
     saying it twice, and with no gap between the two it read as one smashed-together control.
     It stays a REAL label rather than becoming a placeholder-only select: this is the exact
     `<label class="a11y-label-wrap">` + `.visually-hidden` idiom `styles/editor.css` documents for
     the four controls a previous accessibility pass found unnamed — including, by name, a
     `<select>` with no accessible name at all. `display: contents` drops the wrapper's own box, so
     the select keeps the section body's sizing exactly as if the label were not there.
     The i18n key is unchanged and still passed through `t`, so nothing dangles. */
  return (
    <label className="jini-a11y-label-wrap">
      <span className="jini-visually-hidden">{t({ locale: locale, key: "Entry" })}</span>
      <select
        className="jini-select"
        value={entryId}
        onChange={(e) => onChange(e.target.value)}
        {...agentHandle({ handle: "seo-entry-picker" }, {
          role: "field",
          label: "Choose which page or post to edit or analyze SEO for",
        })}
      >
        <option value="">{t({ locale: locale, key: "Choose an entry…" })}</option>
        {entries.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.title} ({entry.status})
          </option>
        ))}
      </select>
    </label>
  );
}

/** Read-only score + issues view (REQ-07) — exact field names read off `SeoAnalysis`/`SeoIssue`
 * (`src/seo/types.ts`), not guessed. No state of its own — only the severity sort, which lives in
 * `rules.ts` as `sortIssuesBySeverity`. */
function AnalyzePanel(props: { locale: string; analysis: SeoEntryAnalysis }) {
  const t = useSeoCopy();
  const { locale } = props;
  const { sortedIssues } = useAnalyzePanel({ analysis: props.analysis });

  return (
    <div className="jini-seo-analyze-panel">
      <h3>{t({ locale: locale, key: "Analysis" })}</h3>
      <p>
        {t({ locale: locale, key: "Score:" })} <strong>{props.analysis.score}</strong>
      </p>
      {sortedIssues.length === 0 ? (
        <p className="jini-muted-cell">{t({ locale: locale, key: "No issues." })}</p>
      ) : (
        <ul>
          {sortedIssues.map((issue, i) => (
            <li key={`${issue.code}-${i}`}>
              <span className={`jini-status jini-status-${issue.severity === "error" ? "failure" : issue.severity === "warning" ? "unavailable" : "success"}`}>
                {issue.severity}
              </span>{" "}
              <code>{issue.code}</code>
              {issue.field ? <span className="jini-muted-cell"> ({issue.field})</span> : null} — {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface SeoEntryPanelProps {
  locale: string;
  entryId: string;
  useSeoEntryPanelHook?: typeof useWiredSeoEntryPanel;
}

/** Per-entry overrides edit form (REQ-06). Pre-fills from `getSeoEntry`'s resolved meta, but
 * tracks which fields the user actually touched so `putSeoEntry` only ever sends a genuine
 * partial patch — matching the resolved-vs-override distinction `SeoExtFields` implies (an
 * untouched field must not turn into a persisted override equal to today's resolved default). */
// EXEMPTION (complexity ceiling, 2026-08-06, updated for the ≤9/≤9 bar): ESLint scores this
// component's cyclomatic complexity at 25 against a 9 ceiling, but its cognitive complexity is 6
// (also under 9). That gap between the two is the signature of a
// measurement artifact, not real branching: eleven form fields each read as
// `fieldValue(key, resolved.X ?? default) ?? default`, and ESLint's cyclomatic rule counts every
// `??` as its own decision point — twenty of the twenty-five come from those fallback chains alone,
// none of which nest inside one another or inside each other's control flow (which is exactly what
// keeps cognitive complexity low). The other five points are ordinary flat conditionals (notice,
// saveError, the disabled expression, the Save button's label, the analysis panel) already under
// the ceiling on their own. There is nothing to extract: splitting the eleven fields into their own
// components would still evaluate the same fallback chains, just spread across more functions, for
// no complexity benefit and a real loss of "one form, one place to read its fields."
function SeoEntryPanel({ locale, entryId, useSeoEntryPanelHook = useWiredSeoEntryPanel }: SeoEntryPanelProps) {
  const t = useSeoCopy();
  const { resolved, analysis, loadError, saving, saveError, notice, fieldValue, setField, save, touched } = useSeoEntryPanelHook({ entryId });

  if (loadError) return <div className="jini-notice jini-notice-error">{loadError}</div>;
  if (!resolved) return <div className="jini-notice">{t({ locale: locale, key: "Loading entry SEO…" })}</div>;

  return (
    <div className="jini-seo-entry-panel">
      <h3>{t({ locale: locale, key: "Per-entry overrides" })}</h3>
      {/* Two `t()` calls in one paragraph, not one longer string: the first sentence's English text
          IS its i18n key and is translated in all 21 locales (`seo-i18n.ts`), so extending it would
          orphan every one of those translations. The second sentence is a new English-only key that
          falls through to itself — the disclosed, additive trade `react/hooks/SeoPage.hooks.ts`'s header already
          makes for the tab labels. It exists because a field's two empty states used to be
          indistinguishable AND unescapable: emptying a box stored `""` as a real override, which
          `seo.ts` resolves ahead of the site default, so the operator had no way back. */}
      <p className="jini-muted-cell">
        {t({ locale: locale, key: "Fields show the currently-effective value (author override, or site default, or derived from the entry). Only fields you change here are saved as overrides." })}{" "}
        {t({ locale: locale, key: "Empty a field and save to remove its override — the entry falls back to the site default." })}
      </p>
      {notice ? <div className="jini-notice">{notice}</div> : null}
      {saveError ? (
        <div className="jini-notice jini-notice-error" role="alert">
          {saveError}
        </div>
      ) : null}

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
      <label>
        {t({ locale: locale, key: "OG title" })}
        <input
          className="jini-input"
          value={fieldValue("ogTitle", resolved.openGraph.title) ?? ""}
          onChange={(e) => setField("ogTitle", e.target.value)}
          {...agentHandle({ handle: "seo-entry-og-title" }, { role: "field", label: "This entry's Open Graph title override" })}
        />
      </label>
      <label>
        {t({ locale: locale, key: "OG description" })}
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
        label={t({ locale: locale, key: "OG image" })}
        value={fieldValue("ogImage", resolved.openGraph.image ?? "") ?? ""}
        onChange={(value) => setField("ogImage", value)}
        agentHandle="seo-entry-og-image"
      />
      <label>
        {t({ locale: locale, key: "Twitter title" })}
        <input
          className="jini-input"
          value={fieldValue("twitterTitle", resolved.twitter.title) ?? ""}
          onChange={(e) => setField("twitterTitle", e.target.value)}
          {...agentHandle({ handle: "seo-entry-twitter-title" }, { role: "field", label: "This entry's Twitter card title override" })}
        />
      </label>
      <label>
        {t({ locale: locale, key: "Twitter description" })}
        <input
          className="jini-input"
          value={fieldValue("twitterDescription", resolved.twitter.description ?? "") ?? ""}
          onChange={(e) => setField("twitterDescription", e.target.value)}
          {...agentHandle({ handle: "seo-entry-twitter-description" }, { role: "field", label: "This entry's Twitter card description override" })}
        />
      </label>
      <MediaRefField
        locale={locale}
        id="seo-entry-twitter-image"
        label={t({ locale: locale, key: "Twitter image" })}
        value={fieldValue("twitterImage", resolved.twitter.image ?? "") ?? ""}
        onChange={(value) => setField("twitterImage", value)}
        agentHandle="seo-entry-twitter-image"
      />

      <span className="jini-editor-actions">
        <button
          type="button"
          className="jini-btn jini-btn-secondary"
          onClick={save}
          disabled={saving || Object.keys(touched).length === 0}
          {...agentHandle({ handle: "seo-entry-save-overrides" }, { role: "button", label: "Save this entry's SEO overrides" })}
        >
          {saving ? t({ locale: locale, key: "Saving…" }) : t({ locale: locale, key: "Save overrides" })}
        </button>
      </span>

      {analysis ? <AnalyzePanel locale={locale} analysis={analysis} /> : null}
    </div>
  );
}

export interface SeoEntrySectionProps {
  locale: string;
  useSeoEntrySectionHook?: typeof useSeoEntrySection;
}

/** Section wrapper (REQ-06/07) — entry picker over the per-entry edit + analyze panels. This IS the
 *  "Pages & posts" tab panel; it kept its name and its markup, because nothing about it changed
 *  except that a tab now selects it.
 *
 *  The `<h2>` stays, and deliberately so — dropping it as "redundant with the tab label" was tried
 *  and reverted. A tab label is not a heading: `TabBar` emits `role="tab"` buttons, which do not
 *  appear in a screen reader's heading list at all, so removing this left the whole panel with `H1`
 *  and nothing else — the exact regression `deployment/HistoryTab.tsx`'s own comment records
 *  measuring live on its tab. It is also not a duplicate: the tab reads "Pages & posts" (what you
 *  pick from), the heading reads "Per-entry SEO" (what you are editing). */
export function SeoEntrySection({ locale, useSeoEntrySectionHook = useSeoEntrySection }: SeoEntrySectionProps, _optional: Record<string, never> = {}) {
  const t = useSeoCopy();
  const { entryId, setEntryId } = useSeoEntrySectionHook();

  return (
    <div
      className="jini-seo-panel jini-seo-panel--full jini-seo-entry-section"
      {...agentHandle({ handle: "seo-per-entry" }, {
        role: "region",
        label: "Per-entry SEO overrides — pick one entry and edit or analyze its metadata",
      })}
    >
      <SeoSection title={t({ locale: locale, key: "Per-entry SEO" })}>
        <EntryPicker locale={locale} entryId={entryId} onChange={setEntryId} />
        {entryId ? <SeoEntryPanel locale={locale} key={entryId} entryId={entryId} /> : null}
      </SeoSection>
    </div>
  );
}

/** What the two site-wide tab panels need from `useWiredSeo()`. Named as one object rather than
 *  passed as six loose props for the same reason `Roles.tsx`'s `RoleCreateFormController` documents:
 *  none of these is meaningful without the others, so naming the group is what lets a test hand a
 *  panel a controller instead of assembling one out of parts. */


/**
 * The "Site defaults" tab — the site-wide `seo.*` settings form, moved here verbatim from `Seo`'s
 * own body.
 *
 * ONE addition beyond relocation: the two `.field-group`s now carry headings ("Search appearance",
 * "Crawling"). They are the grouping an operator already thinks in — every SEO tool they have used
 * separates what search/social show from whether to be indexed at all — and the form had no
 * internal hierarchy whatsoever before, just seven controls in a row. Expressing it as headings
 * INSIDE one tab rather than as more tabs is deliberate and load-bearing: see `react/hooks/SeoPage.hooks.ts`'s
 * header for why splitting this form across panels would silently blank fields on save.
 *
 * The submit handler is now one call to `buildSeoSettingsPatch` (`react/hooks/SeoPage.hooks.ts`) rather than seven
 * inline `??`/`||` field reads — same fields, same fallbacks, same payload, just not written in the
 * `.tsx`.
 */
export function SeoDefaultsTab({ controller }: { controller: SeoTabController }, _optional: Record<string, never> = {}) {
  const t = useSeoCopy();
  const { locale, settings, saving, defaultOgImage, setDefaultOgImage } = controller;
  const { submit } = useSeoDefaults({ save: controller.save });

  return (
    <form
      className="jini-seo-panel jini-seo-panel--full"
      {...agentHandle({ handle: "seo-defaults-form" }, {
        role: "form",
        label: "Site-wide SEO defaults — title template, meta description, social image, robots",
      })}
      onSubmit={submit}
    >
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

      {/* Its own group, not a tail on "Search appearance". These two fields are what a link to this
          site looks like when it is PASTED somewhere — a different question from what a search
          result looks like, and the split every SEO tool an operator has already used makes. The
          form previously ran all four together in one unlabelled `.field-group`, so the OG image
          read as a search-result setting. */}
      <SeoSection title={t({ locale: locale, key: "Social sharing" })}>
        <MediaRefField
          locale={locale}
          id="seo-default-og-image"
          name="defaultOgImage"
          label={t({ locale: locale, key: "Default Open Graph / Twitter image" })}
          value={defaultOgImage}
          onChange={setDefaultOgImage}
          agentHandle="seo-default-og-image"
        />
        <div className="jini-field">
          <label className="jini-field-label" htmlFor="seo-twitter-site">
            {t({ locale: locale, key: "Twitter @site handle" })}
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
    </form>
  );
}

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
export function SeoSitemapTab({ controller }: { controller: SeoTabController }, _optional: Record<string, never> = {}) {
  const t = useSeoCopy();
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
  onTabChange?: ((required: { tab: string }, optional?: Record<string, never>) => void) | undefined;
}

export function Seo({ tabId, onTabChange, useSeoHook = useWiredSeo }: SeoProps = {}, _optional: Record<string, never> = {}) {
  const t = useSeoCopy();
  const { headerActions } = useSeoOptions();
  const { changeTab } = useSeoPageActions({ onTabChange });
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
  const { activeTabId, tabs } = useSeoTabs({ tabId });
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
      <div className="jini-page-header">
        <div className="jini-page-header-text">
          <p className="jini-page-kicker">{t({ locale: locale, key: "Marketing" })}</p>
          <h1 className="jini-page-title">SEO</h1>
          <p className="jini-page-description">
            {t({ locale: locale, key: "Site-wide defaults for meta titles, descriptions, Open Graph/Twitter cards, and robots directives." })}
          </p>
        </div>
        <div className="jini-page-actions">
          {headerActions}
        </div>
      </div>
      {/* Both banners stay on the SHELL, above the tab strip, not inside a panel: `error` and
          `notice` come from `useWiredSeo()` and describe the screen's own load/save/regenerate
          outcomes, which are not owned by whichever tab happens to be open. A save confirmation
          rendered inside the Site defaults panel would also be the one thing on the screen that
          silently disappears when the operator switches tabs. */}
      {error ? <div className="jini-notice jini-notice-error">{error}</div> : null}
      {notice ? <div className="jini-notice">{notice}</div> : null}

      <TabBar
        ariaLabel="SEO"
        tabs={tabs}
        activeId={activeTabId}
        onChange={changeTab}
        containerHandle="seo-tab-bar"
      />
      {seoTabPanel({ activeTabId, controller, components: { SeoDefaultsTab, SeoSitemapTab, SeoEntrySection } })}

      {/* The sitemap modal stays on the shell rather than inside `SeoSitemapTab`: it is a portal-
          shaped overlay over the whole page, and `sitemapModalOpen`/`closeSitemapModal` are shell
          state from `useWiredSeo()`. Unchanged from before the tab conversion. */}
      {sitemapModalOpen ? (
        <SitemapModal
          locale={locale}
          sitemapEnabled={settings.sitemapEnabled}
          regenerating={saving}
          onRegenerate={regenerateSitemap}
          onClose={closeSitemapModal}
        />
      ) : null}
    </div>
  );
}

export { Seo as SeoPage };
export default Seo;
