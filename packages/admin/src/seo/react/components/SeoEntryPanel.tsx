import { agentHandle } from "@jini-ai/core/agent-handles";
import { InfoTip } from "../../../react/kit.js";
import { useSeoCopy } from "../hooks/SeoPorts.hooks.js";
import { useWiredSeoEntryPanel } from "../hooks/use-seo-entry-panel.hooks.js";
import { useSeoEntrySection } from "../hooks/use-seo-entry-section.hooks.js";
import type { SeoEntryPanelController } from "../../models.js";
import { SeoSection } from "./SeoSection.js";
import { EntryPicker } from "./EntryPicker.js";
import { AnalyzePanel } from "./AnalyzePanel.js";
import { SeoEntrySearchFields, SeoEntrySocialFields } from "./SeoEntryFields.js";
import type { SeoCopy } from "./SeoEntryFields.js";

export interface SeoEntryPanelProps {
  locale: string;
  entryId: string;
  useSeoEntryPanelHook?: typeof useWiredSeoEntryPanel;
  useSeoCopyHook?: typeof useSeoCopy;
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
// 2026-10-15: now 27 — the X fields' placeholders (the live social preview value) add two more
// flat `??` fallbacks of exactly that kind.
// 2026-10-20: exemption retired under the ≤10/≤10 bar — the head row, the "Search appearance"
// group, the "Social preview" group and its X disclosure are now their own components below, each
// scoring ≤10. The fallback chains themselves are unchanged and still read in form order.
function SeoEntryPanel({ locale, entryId, useSeoEntryPanelHook = useWiredSeoEntryPanel, useSeoCopyHook = useSeoCopy }: SeoEntryPanelProps) {
  const t = useSeoCopyHook();
  const { resolved, analysis, loadError, saving, saveError, notice, fieldValue, setField, save, touched, ogImageInherited = false } = useSeoEntryPanelHook({ entryId });

  if (loadError) return <div className="jini-notice jini-notice-error">{loadError}</div>;
  if (!resolved) return <div className="jini-notice">{t({ locale: locale, key: "Loading entry SEO…" })}</div>;
  const fields = { locale, t, resolved, fieldValue, setField };

  return (
    <div className="jini-seo-entry-panel">
      <SeoEntryHead locale={locale} t={t} saving={saving} touched={touched} save={save} />
      {notice ? <div className="jini-notice">{notice}</div> : null}
      {saveError ? (
        <div className="jini-notice jini-notice-error" role="alert">
          {saveError}
        </div>
      ) : null}

      <SeoEntrySearchFields {...fields} />

      <SeoEntrySocialFields {...fields} ogImageInherited={ogImageInherited} />

      {analysis ? <AnalyzePanel locale={locale} analysis={analysis} /> : null}
    </div>
  );
}

/** Sticky heading row: title, the ⓘ explanation and Save (disabled while saving or with nothing touched). */
function SeoEntryHead({ locale, t, saving, touched, save }: Pick<SeoEntryPanelController, "saving" | "touched" | "save"> & { locale: string; t: SeoCopy }) {
  return (
    <>
      {/* Heading, explanation and Save share one sticky row (2026-10-15, owner: "the UI for
          ?tab=entries is horrible" — Save sat lost under eleven fields). The post editor keeps its
          own action row pinned the same way. */}
      {/* The inner bar is what paints: `.jini-seo-entry-head` is the sticky scroll-state container,
          and a container query can only style its descendants — so the bottom edge that appears
          only while the row is pinned (owner, 2026-10-15) lives on this child. */}
      <div className="jini-seo-entry-head">
        <div className="jini-seo-entry-head-bar">
          <h3>{t({ locale: locale, key: "Per-entry overrides" })}</h3>
          {/* Two `t()` calls, not one longer string: the first sentence's English text IS its i18n key
              and is translated in all 21 locales (`seo-i18n.ts`), so extending it would orphan every
              one of those translations. The second sentence is a new English-only key that falls
              through to itself — the disclosed, additive trade `react/hooks/SeoPage.hooks.ts`'s header
              already makes for the tab labels. It exists because a field's two empty states used to
              be indistinguishable AND unescapable: emptying a box stored `""` as a real override,
              which `seo.ts` resolves ahead of the site default, so the operator had no way back.
              Shown as an ⓘ tip rather than a loose paragraph above the form (owner, 2026-10-15). */}
          <InfoTip
            label={`${t({ locale: locale, key: "Fields show the currently-effective value (author override, or site default, or derived from the entry). Only fields you change here are saved as overrides." })} ${t({ locale: locale, key: "Empty a field and save to remove its override — the entry falls back to the site default." })}`}
          />
          <span className="jini-seo-entry-head-actions">
            <button
              type="button"
              className="jini-btn"
              onClick={save}
              disabled={saving || Object.keys(touched).length === 0}
              {...agentHandle({ handle: "seo-entry-save-overrides" }, { role: "button", label: "Save this entry's SEO overrides" })}
            >
              {saving ? t({ locale: locale, key: "Saving…" }) : t({ locale: locale, key: "Save overrides" })}
            </button>
          </span>
        </div>
      </div>
    </>
  );
}

export interface SeoEntrySectionProps {
  locale: string;
  useSeoEntrySectionHook?: typeof useSeoEntrySection;
  useSeoCopyHook?: typeof useSeoCopy;
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
export function SeoEntrySection({ locale, useSeoEntrySectionHook = useSeoEntrySection, useSeoCopyHook = useSeoCopy }: SeoEntrySectionProps) {
  const t = useSeoCopyHook();
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
