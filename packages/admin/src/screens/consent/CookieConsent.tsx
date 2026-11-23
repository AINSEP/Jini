import { agentHandle } from "@jini-ai/core/agent-handles";
import type { ConsentFieldProblem, ConsentSettingsView } from "@jini-ai/core/contracts/site/cookie-consent-react";

import type { ComponentType, CSSProperties } from "react";
import { TabBar, useAdminKit, type AdminThemeColors, type TabBarTab } from "../../react/kit.js";
import { navigate } from "../../shell/lib/router.js";
import { ConsentOverviewTab } from "./ConsentOverviewTab.js";
import type { ConsentTranslation } from "./consent-i18n.js";
import { canResetConsentCss, consentStatusKey, resolveConsentTabId, type ConsentErrors, type ConsentTabId } from "./rules.js";
import type { ConsentEditorLimits, ConsentRevisionsPort } from "./settings.hooks.js";
import { useConsentPage, useConsentPreview, useConsentPreviewScale, useConsentReadiness, type ConsentPageController, type ConsentPreviewScale } from "./use-consent-page.hooks.js";
import { type Translate } from '@jini-ai/core/text';

/**
 * @file Administration → Cookie Consent (`/admin/consent?tab=overview|banner|look|rules`). Edits
 * autosave as a draft revision; the live site changes only on Publish. The fields and the sandboxed
 * preview are Jini's (`@jini-ai/cookie-consent/react`), supplied by the host as {@link ConsentScreenUi};
 * this file binds them to the revisions API. The host loads `consent-settings.css`.
 */

/** The props this page passes to every consent field section (a subset of the engine's own). */
export interface ConsentScreenFieldsProps {
  value: ConsentSettingsView;
  onChange(required: { patch: Partial<ConsentSettingsView> }, optional?: Record<string, never>): void;
  problems: readonly ConsentFieldProblem[];
  dictionary: Readonly<Record<string, string>>;
  disabled: boolean;
  limits: ConsentEditorLimits["textLimits"] | undefined;
}

/** The consent engine's React sections, preview frame and preview geometry. The host passes them
 * (this package does not depend on the engine); shapes list only what this page passes. */
export interface ConsentScreenUi {
  BannerFields: ComponentType<ConsentScreenFieldsProps & { bannerModes: ConsentEditorLimits["bannerModes"] }>;
  LookFields: ComponentType<ConsentScreenFieldsProps & { placements: readonly string[] | undefined; lightColors: AdminThemeColors }>;
  RulesFields: ComponentType<ConsentScreenFieldsProps & { regionModes: ConsentEditorLimits["regionModes"] | undefined }>;
  PreviewFrame: ComponentType<{ html: string | null; status: string; dictionary: Readonly<Record<string, string>> }>;
  /** The desktop page width the preview scales down from, in px. */
  previewDesktopWidth: number;
  previewScale: ConsentPreviewScale;
}

export interface CookieConsentProps {
  hooks?: { useConsentPage: typeof useConsentPage; useConsentReadiness: typeof useConsentReadiness };
  /** The `?tab=` query value from `panels.tsx`; unknown or absent opens Overview. */
  tabId?: string | null;
  /** The host's revisions port over its authenticated admin API. */
  port: ConsentRevisionsPort;
  /** The host's hook binding its admin locale to `consentTranslation`. */
  useTranslate: () => ConsentTranslation;
  /** How the host's request layer reads a failure. */
  errors: ConsentErrors;
  ui: ConsentScreenUi;
  /** Test-only debounce overrides. */
  delays?: { autosaveMs?: number; previewMs?: number };
}

const TAB_LABELS: Readonly<Record<ConsentTabId, string>> = { overview: "Overview", banner: "Banner", look: "Look & Position", rules: "Rules" };

function consentDelayOptions({ delayMs }: { delayMs: number | undefined }, _options = {}) {
  return delayMs === undefined ? {} : { delayMs };
}

function tabsFor(t: Translate): TabBarTab[] {
  return (Object.keys(TAB_LABELS) as ConsentTabId[]).map((id) => ({
    id, label: t(TAB_LABELS[id]), handle: `consent-tab-${id}`, handleLabel: `Switch to the ${TAB_LABELS[id]} tab of Cookie Consent`,
  }));
}

function PublishBar({ page, t }: { page: ConsentPageController; t: Translate }) {
  return (
    <div className="page-actions jini-consent-publish">
      <span className="jini-consent-save-status" role="status">{t(consentStatusKey({ saveState: page.saveState, hasUnpublished: page.hasUnpublished, everPublished: page.everPublished }))}</span>
      <button
        type="button"
        className="btn-primary"
        disabled={!page.canPublish}
        onClick={() => { void page.publish(); }}
        {...agentHandle({ handle: "consent-publish" }, { role: "button", label: "Publish the cookie consent draft to the live site" })}
      >
        {page.publishing ? t("Publishing…") : t("Publish")}
      </button>
    </div>
  );
}

function Notices({ page, t }: { page: ConsentPageController; t: Translate }) {
  return (
    <>
      {page.saveState === "conflict" && (
        <div className="notice warning" role="alert">
          {t("Someone else changed this. Reload to see it.")}{" "}
          <button type="button" className="btn-secondary" onClick={page.reload}>{t("Reload")}</button>
        </div>
      )}
      {page.saveError && page.saveState === "error" && <p className="notice error" role="alert">{page.saveError}</p>}
      {page.publishError && <p className="notice error" role="alert">{page.publishError}</p>}
    </>
  );
}

/** Puts the site's default banner style back into Custom CSS. The server pre-fills an empty field
 * with that default, so this appears only after the owner has changed it. Like any edit it only
 * autosaves a draft; the live banner changes on Publish. */
function ResetStyle({ page, t, disabled }: { page: ConsentPageController; t: Translate; disabled: boolean }) {
  const defaultCss = page.editor?.defaults?.customCss;
  if (!defaultCss || !canResetConsentCss({ customCss: page.value?.customCss, defaultCss })) return null;
  return (
    <div className="jini-consent-css-reset">
      <button
        type="button"
        className="btn-secondary"
        disabled={disabled}
        onClick={() => page.onChange({ patch: { customCss: defaultCss } })}
        {...agentHandle({ handle: "consent-reset-css" }, { role: "button", label: "Put the default cookie banner style back into Custom CSS" })}
      >
        {t("Reset to default")}
      </button>
    </div>
  );
}

/** Preview-only diagnostics; publish eligibility uses the saved draft's blocking problems. */
function CssWarnings({ warnings, enabled, t }: { warnings: ConsentFieldProblem[]; enabled: boolean; t: Translate }) {
  if (!enabled || warnings.length === 0) return null;
  return <div className="notice warning jini-consent-css-warnings" role="status">
    <p>{t("Some styles were skipped. You can still publish.")}</p>
    <ul>{warnings.map((warning, index) => <li key={`${warning.code}:${index}`}>{warning.message}</li>)}</ul>
  </div>;
}

function ConsentPreviewPane({ page, preview, fit, translation, ui }: {
  page: ConsentPageController;
  ui: ConsentScreenUi;
  preview: ReturnType<typeof useConsentPreview>;
  fit: ReturnType<typeof useConsentPreviewScale>;
  translation: ConsentTranslation;
}) {
  const value = page.value;
  if (!value) throw new Error("cookie consent preview has no loaded settings");
  return (
    <div className="card jini-consent-preview-pane" ref={fit.ref} style={{ "--consent-preview-scale": fit.scale, "--consent-preview-desktop-width": `${ui.previewDesktopWidth}px` } as CSSProperties}>
      {preview.error && <p className="notice error" role="alert">{preview.error}</p>}
      {/* "My own" and "None" render no Jini banner, so its skipped styles are noise there. */}
      <CssWarnings warnings={preview.warnings} enabled={Boolean(page.editor?.bannerModes) && (value.bannerMode ?? "jini") === "jini"} t={translation.t} />
      <ui.PreviewFrame html={preview.html} status={translation.t("Loading preview…")} dictionary={translation.dictionary} />
    </div>
  );
}

function EditorTab({ tab, page, port, translation, delays, errors, ui, hooks = { useConsentPreview, useConsentPreviewScale, useAdminKit } }: { tab: Exclude<ConsentTabId, "overview">; page: ConsentPageController; port: ConsentRevisionsPort; translation: ConsentTranslation; delays: CookieConsentProps["delays"]; errors: ConsentErrors; ui: ConsentScreenUi; hooks?: { useConsentPreview: typeof useConsentPreview; useConsentPreviewScale: typeof useConsentPreviewScale; useAdminKit: typeof useAdminKit }; }) {
  const preview = hooks.useConsentPreview({ port, config: tab === "rules" ? null : page.value, t: translation.t, errors }, consentDelayOptions({ delayMs: delays?.previewMs }));
  const fit = hooks.useConsentPreviewScale({ previewScale: ui.previewScale });
  const lightColors = hooks.useAdminKit().theme.defaultAdminTheme.light;
  const value = page.value;
  if (!value) throw new Error("cookie consent editor has no loaded settings");
  const { textLimits, regionModes, bannerModes, placements } = page.editor ?? {};
  const fields = { value, onChange: page.onChange, problems: page.problems, dictionary: translation.dictionary, disabled: page.saveState === "conflict", limits: textLimits };
  if (tab === "rules") {
    return (
      <div className="jini-consent-editor">
        <div className="card"><ui.RulesFields {...fields} regionModes={regionModes} /></div>
        <section className="card jini-consent-card" aria-label={translation.t("Fixed rules")}>
          <h2 className="card-title">{translation.t("Fixed rules")}</h2>
          <ul className="jini-consent-fixed-rules">
            <li>{translation.t("Global Privacy Control always turns off analytics and marketing.")}</li>
            <li>{translation.t("Choices are kept for 180 days, then visitors are asked again.")}</li>
            <li>{translation.t("Static exports can't store choices. Keep the banner on a live server.")}</li>
          </ul>
        </section>
      </div>
    );
  }
  return (
    <div className="jini-consent-editor jini-consent-editor-with-preview">
      <div className="card">
        {tab === "banner" ? <ui.BannerFields {...fields} bannerModes={bannerModes} /> : <ui.LookFields {...fields} placements={placements} lightColors={lightColors} />}
        {tab === "look" && <ResetStyle page={page} t={translation.t} disabled={fields.disabled} />}
      </div>
      <ConsentPreviewPane page={page} preview={preview} fit={fit} translation={translation} ui={ui} />
    </div>
  );
}

function ConsentTabContent({ activeTab, page, port, translation, delays, readiness, errors, ui }: {
  activeTab: ConsentTabId;
  errors: ConsentErrors;
  ui: ConsentScreenUi;
  page: ConsentPageController;
  port: ConsentRevisionsPort;
  translation: ConsentTranslation;
  delays: CookieConsentProps["delays"];
  readiness: ReturnType<typeof useConsentReadiness>;
}) {
  const { t } = translation;
  return <>
    {page.loadError && <p className="notice error" role="alert">{page.loadError}</p>}
    {!page.value && !page.loadError && <p className="card-lead">{t("Loading…")}</p>}
    {page.value && activeTab === "overview" && (
      <ConsentOverviewTab liveEnabled={page.liveEnabled} hasUnpublished={page.hasUnpublished} readiness={readiness.readiness} readinessError={readiness.error} t={t} />
    )}
    {page.value && activeTab !== "overview" && <EditorTab tab={activeTab} page={page} port={port} translation={translation} delays={delays} errors={errors} ui={ui} />}
  </>;
}

export function CookieConsent({ tabId, port, useTranslate, errors, ui, delays, hooks = { useConsentPage, useConsentReadiness } }: CookieConsentProps) {
  const translation = useTranslate();
  const { t } = translation;
  const page = hooks.useConsentPage({ port, t, errors }, consentDelayOptions({ delayMs: delays?.autosaveMs }));
  const activeTab = resolveConsentTabId({ tabId });
  // Overview re-checks after each publication and whenever it is reopened on a newer draft.
  const readiness = hooks.useConsentReadiness({ port, refresh: `${page.publishedCount}:${activeTab === "overview" ? page.draftId : ""}`, t, errors });
  return (
    <div className="page jini-consent-page">
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{t("Administration")}</p>
          <h1 className="page-title">{t("Cookie Consent")}</h1>
          <p className="page-description">{t("The banner visitors see, and what waits for their choice.")}</p>
        </div>
        {page.value && <PublishBar page={page} t={t} />}
      </div>
      <Notices page={page} t={t} />
      <TabBar ariaLabel={t("Cookie Consent")} tabs={tabsFor(t)} activeId={activeTab} onChange={(next) => navigate({ routePath: `/consent?tab=${next}` }, { replace: true })} containerHandle="consent-tab-bar" />
      <ConsentTabContent activeTab={activeTab} page={page} port={port} translation={translation} delays={delays} readiness={readiness} errors={errors} ui={ui} />
    </div>
  );
}
