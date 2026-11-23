import type { ComponentType } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { I18nProvider, SettingsDialogShell, type AdminKitValues, type SettingsDialogTab } from "../../react/kit.js";

import { AlertIcon, GaugeIcon, PulseIcon, QueriesIcon } from "./observability-visuals.js";
import type { ObservabilityStatusController } from "./hooks/use-observability-status.hooks.js";
import type { QueriesTabController } from "./hooks/use-queries-tab.hooks.js";
import { RecentErrorsPanel, type RecentErrorItemHook, type RecentServerErrorsHook } from "./recent-errors-panel.js";
import { ToolGapsPanel, type ToolGapsRead } from "./tool-gaps-panel.js";
import { QueriesPanel, type QueryCachePanel } from "./queries-panel.js";

import { type Translate } from '@jini-ai/core/text';
const OTEL_DOCS_URL = "https://opentelemetry.io/docs/";

/** Copy that names the product carries a `{product}` placeholder; the host's product name fills it. */
function withProduct({ text, productName }: { text: string; productName: string }, _optional: Record<string, never> = {}): string {
  return text.split("{product}").join(productName);
}

/**
 * The ON/OFF status card the Overview tab shows once the status read has settled. Split out of
 * {@link OverviewPanel} under the complexity ceiling.
 */
function ObservabilityStatusCard({
  status,
  t,
  productName,
}: {
  status: NonNullable<ObservabilityStatusController["status"]>;
  t: Translate;
  productName: string;
}) {
  return (
    <div
      className={`jini-observability-status-card jini-observability-status-card--${status.enabled ? "on" : "off"}`}
      role="status"
      {...agentHandle({ handle: "observability-status" }, { role: "status", label: "Current OpenTelemetry status" })}
    >
      <span className="jini-observability-status-dot" aria-hidden="true" />
      <div>
        <p className="jini-observability-status-headline">
          {status.enabled
            ? t("OpenTelemetry is ON — traces are being recorded.")
            : t("OpenTelemetry is OFF (the default) — nothing is being recorded.")}
        </p>
        <p className="jini-field-hint">
          {status.enabled
            ? `${t("Reporting under the service name")} "${status.serviceName}".`
            : withProduct({ text: t(
                "No provider endpoint is configured on this server, so {product} is running its safe, no-op default: requests are handled normally and nothing is sent anywhere.",
              ), productName })}
        </p>
      </div>
    </div>
  );
}

type AcceptedProvider = NonNullable<ObservabilityStatusController["testResult"]>["providers"][number];
type ProviderExport = NonNullable<NonNullable<NonNullable<ObservabilityStatusController["status"]>["providers"]>[number]["lastExport"]>;

/** `providerId (signal, signal)` for one provider that accepted the diagnostic locally. */
function acceptedProviderText(provider: AcceptedProvider, t: Translate): string {
  return `${provider.providerId} (${provider.signals.map(signal => t(signal)).join(", ")})`;
}

/** ` (ErrorClass, HTTP 503)` after a failed export; empty when there is no error class. */
function exportFailureSuffix(lastExport: ProviderExport): string {
  if (!lastExport.errorClass) return "";
  const status = lastExport.statusCode ? ", HTTP " + lastExport.statusCode : "";
  return ` (${lastExport.errorClass}${status})`;
}

function ObservabilityDiagnostics({ controller }: { controller: ObservabilityStatusController }) {
  const { status, t } = controller;
  return <>
    {status?.canSendTestError && controller.sendTestError ? (
      <button type="button" className="jini-button" disabled={controller.sendingTestError}
        onClick={() => { void controller.sendTestError?.(); }}
        {...agentHandle({ handle: "observability-send-test-error" }, { role: "button", label: "Send test error" })}>
        {t(controller.sendingTestError ? "Sending test error…" : "Send test error")}
      </button>
    ) : null}
    {controller.testError ? <p role="alert">{controller.testError}</p> : null}
    {controller.testResult ? <p role="status">
      {controller.testResult.providers.length
        ? `${t("Accepted locally by")}: ${controller.testResult.providers.map(provider => acceptedProviderText(provider, t)).join("; ")}.`
        : t("No provider accepted the diagnostic yet.")}
      {" "}{t("Remote delivery is confirmed by export status and your provider. Analytics requires telemetry consent.")}
    </p> : null}
  </>;
}

/**
 * Overview tab: explains OpenTelemetry in plain language for an operator who does not already
 * know what it is, then reports this install's REAL current state — read from
 * `platform/observability/config.ts` via `GET .../system/observability-status`
 * (`useWiredObservabilityStatus`), never a mock. See that hook's own header for the one GET this
 * makes on mount.
 * Now: the config and `useWiredObservabilityStatus` are the host's; this screen calls the
 * host-bound `useObservabilityStatus`.
 */
function OverviewPanel({ controller, productName }: { controller: ObservabilityStatusController; productName: string }) {
  const { status, error, t } = controller;

  return (
    <section className="jini-settings-section" aria-label={t("Observability Overview")}>
      <p className="jini-observability-lede">
        {withProduct({ text: t(
          "OpenTelemetry is the open standard {product} uses to report what the server is doing — how long requests take, and which ones fail — to a monitoring tool you run or subscribe to. {product} never sends this data anywhere on its own.",
        ), productName })}
      </p>
      <p className="jini-observability-lede">
        {withProduct({ text: t(
          'A "provider" is that monitoring tool — for example a metrics service or a tracing service. Turning this on means pointing {product} at the provider’s own collector address (and, for most providers, a key) so it knows where to send what it records. Until that is configured, {product} keeps recording nothing, at no cost.',
        ), productName })}
      </p>

      {error ? (
        <p className="jini-observability-alert" role="alert">
          {error}
        </p>
      ) : null}
      {!status && !error ? <p role="status">{t("Checking current status…")}</p> : null}

      {status ? <ObservabilityStatusCard status={status} t={t} productName={productName} /> : null}
      {status?.providers?.map(provider => (
        <p className="jini-field-hint" key={provider.providerId}>
          {provider.providerId}: {provider.exportEnabled === false ? t("Export disabled in this runtime") : provider.lastExport
            ? <><span>{t(provider.lastExport.outcome === "ok" ? "Last export succeeded" : "Last export failed")}</span> — <time dateTime={provider.lastExport.at}>{new Date(provider.lastExport.at).toLocaleString()}</time>
              {exportFailureSuffix(provider.lastExport)}</>
            : t("No export result yet")}
        </p>
      ))}
      {controller.refresh ? <button type="button" className="jini-button" onClick={controller.refresh}>{t("Refresh")}</button> : null}
      <ObservabilityDiagnostics controller={controller} />

      <p className="jini-field-hint">
        <a
          href={OTEL_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          {...agentHandle({ handle: "observability-otel-docs-link" }, { role: "link", label: "Open the OpenTelemetry documentation" })}
        >
          {t("Read the OpenTelemetry documentation")}
        </a>
      </p>
    </section>
  );
}

/**
 * Providers tab: an honest not-yet-built state, explicitly modeled on `AgentPlugins.tsx`'s own
 * `MarketplacePanel` (same designed-empty-state tone, same reasoning) — see that component's own
 * header for why a plain "not built yet" beats a functional-looking form that does nothing.
 *
 * Deliberately no input, no "Connect" button, and no saved-credential list: nothing in the host can
 * fetch, save, or send to a monitoring endpoint yet (owner's own words in the host's todo list,
 * 2026-09-09: "let's set that up with another subagent"). Building the appearance of
 * that feature here would be worse than stating plainly that it isn't built.
 */
function ProvidersPanel({ t, productName }: { t: Translate; productName: string }) {
  return (
    <section className="jini-settings-section" aria-label={t("Observability Providers")}>
      <div className="jini-observability-providers-empty" role="note">
        <span className="jini-observability-providers-glyph">
          <GaugeIcon size={28} />
        </span>
        <h3>{t("No provider connected yet")}</h3>
        <p>{withProduct({ text: t("Monitoring integrations are planned. {product} does not fetch, configure, or send data to any provider yet."), productName })}</p>
        <p className="jini-field-hint">{t("Until then, the Overview tab reports whether OpenTelemetry itself is on or off.")}</p>
      </div>
    </section>
  );
}

/** The host's theme boundary: `data-*` attributes (e.g. `data-theme`) spread onto the screen's wrapper. */
export type ObservabilityThemeBoundaryHook = (required: Record<string, never>, optional: Record<string, never>) => Readonly<Record<string, string | undefined>>;

/** The host's tab-to-URL adapter: resolves the deep-linked tab and navigates on change. */
export type ObservabilityTabHook = (required: { tabs: readonly SettingsDialogTab[]; tabId?: string | null | undefined }) => {
  activeTabId?: string | undefined;
  subtitle?: string | undefined;
  onTabChange: (required: { nextTabId: string }) => void;
};

/** The host's admin-kit values read; this screen needs only the settings-dialog dictionaries. */
export type ObservabilityKitValuesHook = (required?: Record<string, never>, optional?: Record<string, never>) => Pick<AdminKitValues, "SETTINGS_DIALOG_DICTIONARIES">;

/**
 * The host's page-layout classes, bound by the host so its own page chrome (header spacing, the
 * shell's page-flow modifier) applies. This screen's markup carries only `jini-*` classes itself.
 */
export interface ObservabilityLayoutClassNames {
  /** The page wrapper. */
  page: string;
  /** The page header block above the shell. */
  header: string;
  /** The header's text column. */
  headerText: string;
  kicker: string;
  title: string;
  description: string;
  /** The wrapper around the inline settings shell. */
  section: string;
}

export interface ObservabilityProps {
  tabId?: string | null | undefined;
  /** The product name the `{product}` placeholders in this screen's copy resolve to. */
  productName: string;
  /** Overview tab state, bound by the host to its port, locale, translator and error describer. */
  useObservabilityStatusHook: () => ObservabilityStatusController;
  /** Same seam for the Recent errors tab; called only when that tab is open. */
  useRecentServerErrorsHook: RecentServerErrorsHook;
  /** One Recent errors row's expand/copy state (the host's copy-feedback hook). */
  useRecentErrorItemHook: RecentErrorItemHook;
  /** Adapter/owner visibility seam; the panel itself mounts only on tab selection. */
  useQueriesTabHook: () => QueriesTabController;
  /** The live cache panel the Queries tab embeds. */
  QueryCachePanel: QueryCachePanel;
  /** Replaces the whole Queries tab body (tests); defaults to {@link QueriesPanel}. */
  QueriesPanelComponent?: ComponentType<{ readOnly: boolean; t: Translate }>;
  /** The host-bound tool-gap read. */
  readToolGaps: ToolGapsRead;
  useAdminThemeBoundaryHook: ObservabilityThemeBoundaryHook;
  useObservabilityTabHook: ObservabilityTabHook;
  /** The host's admin-kit values read (its `useAdminKitValues`). */
  useAdminKitValuesHook: ObservabilityKitValuesHook;
  /** The host's page-layout classes; see {@link ObservabilityLayoutClassNames}. */
  layoutClassNames: ObservabilityLayoutClassNames;
}

/** The owner-only Queries tab, present only when the host's visibility hook allows it. */
function queriesTabs({ queriesTab, t, QueryCachePanel, QueriesPanelComponent }: {
  queriesTab: QueriesTabController; t: Translate; QueryCachePanel: QueryCachePanel;
  QueriesPanelComponent: ObservabilityProps["QueriesPanelComponent"];
}, _optional: Record<string, never> = {}): SettingsDialogTab[] {
  if (!queriesTab.visible) return [];
  return [{
    id: "queries",
    label: t("Queries"),
    icon: <QueriesIcon />,
    title: t("Observability"),
    subtitle: t("The live data cache for this admin session."),
    panel: QueriesPanelComponent
      ? <QueriesPanelComponent readOnly={queriesTab.readOnly} t={t} />
      : <QueriesPanel readOnly={queriesTab.readOnly} t={t} Panel={QueryCachePanel} />,
  }];
}

/**
 * Operations > Observability. A `SettingsDialogShell`-shaped page with three tabs: Overview (real,
 * API-backed OpenTelemetry status), Recent errors (captured server error lines, gap A-04) and
 * Providers (an honest not-yet-built placeholder) — see
 * `development/todos.md`'s "Observability admin page" entry (owner, 2026-09-09) for the scope this
 * first pass deliberately stops at. The owner-only Queries tab (2026-10-09) adds live
 * in-process cache tooling only for a TanStack host, loaded when that tab opens.
 *
 * Header structure (2026-09-13, owner report: the title "needs to be more to the top left...
 * should look more like Secrets as far as the spacing" — screenshots `12-observability-header.png`
 * vs. `13-secrets-header-spacing-reference.png`): renders its own `.page-header` — the exact
 * kicker/title/description markup `Security.tsx` (Secrets) and `AiAssistant.tsx` already use —
 * ABOVE the shell, and opts the shell itself into `settings-ui-section--page-flow` (see that
 * modifier's own comment in `styles.css`). That modifier does two things this page needs together:
 * it hides the shell's OWN kicker/title/subtitle strip (`.jini-tabbed-dialog-head`), which used to
 * sit 24px right and ~24px down from where Secrets' title sits — exactly the dialog chrome's own
 * `padding: 24px 24px 12px` — and it flattens the dialog's modal-styled border/shadow/background,
 * matching how Secrets' tab content has no card box around it either. A scoped padding override
 * was considered and rejected: zeroing just the head's padding would still leave the title sitting
 * inside the card's own rounded top-left corner, clipped against the curve, rather than flush
 * against the page the way Secrets' borderless header is. `AiAssistant.tsx` proves the combination
 * in production already — this is a second consumer of an existing pattern, not a new one.
 *
 * The page header reuses the active tab's translated subtitle. Its hook adapts Jini's tab state
 * to `?tab=` navigation; the controlled shell renders only that tab's panel.
 * Now: the todo list and `styles.css` are the host's; those page/header/section classes are bound
 * through `layoutClassNames`.
 */
export function Observability(props: ObservabilityProps) {
  // Host hooks are required props, called through `props` (never imported or defaulted).
  const { tabId, productName, useRecentServerErrorsHook, useRecentErrorItemHook, QueryCachePanel, QueriesPanelComponent, readToolGaps } = props;
  const themeBoundary = props.useAdminThemeBoundaryHook({}, {});
  const { SETTINGS_DIALOG_DICTIONARIES } = props.useAdminKitValuesHook({}, {});
  const controller = props.useObservabilityStatusHook();
  const queriesTab = props.useQueriesTabHook();
  const { t, locale } = controller;

  const tabs: SettingsDialogTab[] = [
    {
      id: "overview",
      label: t("Overview"),
      icon: <PulseIcon />,
      title: t("Observability"),
      subtitle: t("What OpenTelemetry is, and whether it's on right now."),
      panel: <OverviewPanel controller={controller} productName={productName} />,
    },
    {
      id: "recent-errors",
      label: t("Recent errors"),
      icon: <AlertIcon />,
      title: t("Observability"),
      subtitle: t("The newest errors this site's server logged."),
      panel: <RecentErrorsPanel useRecentServerErrorsHook={useRecentServerErrorsHook} useRecentErrorItemHook={useRecentErrorItemHook} />,
    },
    {
      id: "providers",
      label: t("Providers"),
      icon: <GaugeIcon />,
      title: t("Observability"),
      subtitle: t("Where a monitoring connection will live."),
      panel: <ProvidersPanel t={t} productName={productName} />,
    },
    {
      id: 'tool-gaps', label: t('Tool gaps'), icon: <AlertIcon />,
      title: t('Observability'), subtitle: t('Native CLI fallbacks recorded for the owner.'),
      panel: <ToolGapsPanel t={t} read={readToolGaps} />,
    },
    ...queriesTabs({ queriesTab, t, QueryCachePanel, QueriesPanelComponent }),
  ];

  const { activeTabId, onTabChange, subtitle } = props.useObservabilityTabHook({ tabs, tabId });
  const layout = props.layoutClassNames;
  return (
    <div className={`${layout.page} jini-observability-page`}>
      <div
        className={layout.header}
        {...agentHandle({ handle: "observability-header" }, {
          role: "region",
          label: "Observability panel header — what OpenTelemetry is, and whether it's on right now",
        })}
      >
        <div className={layout.headerText}>
          <p className={layout.kicker}>{t("Operations")}</p>
          <h1 className={`${layout.title} jini-observability-page-title`}><PulseIcon size={24} />{t("Observability")}</h1>
          <p className={layout.description}>
            {subtitle}
          </p>
        </div>
      </div>
      <I18nProvider initialLocale={locale} dictionaries={SETTINGS_DIALOG_DICTIONARIES} fallbackLocale="en" syncDocumentAttributes={false}>
        {/* Classic keeps its unverified-dark light pin; Glass follows the document scheme. */}
        <div className={`${layout.section} jini-observability-section`} {...themeBoundary}>
          <SettingsDialogShell
            tabs={tabs}
            {...(activeTabId === undefined ? {} : { activeTabId })}
            onActiveTabIdChange={(nextTabId) => onTabChange({ nextTabId })}
            presentation="inline"
            className="jini-tabbed-dialog--inline"
            fullscreenEnabled={false}
          />
        </div>
      </I18nProvider>
    </div>
  );
}
