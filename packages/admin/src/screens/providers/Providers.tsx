import type { ComponentType, CSSProperties, ReactNode } from "react";
import type { AdminWebhookSubscriptionResponse } from "@jini-ai/core/contracts/site/cms-integrations";
import type { TabBarProps, SourceConfigDependencies } from "../../react/kit.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { resolveActiveTabId } from "@jini-ai/core/text";
import { providersTabs } from "./ProvidersTabs.js";
import { ProvidersTabBody } from "./ProvidersTabBody.js";
import { useProviders } from "./hooks/use-providers.hooks.js";

/**
 * @file The Integrations page (`/admin/addons/integrations`) — every outside connection this install has,
 * in both directions, in one place.
 *
 * ## Why these belong together (owner call, 2026-09-10)
 *
 * External MCP was one of the Settings page's thirteen tabs, reachable only by knowing to open
 * Settings and scroll a sidebar of unrelated concerns (Instructions, Privacy, Dialog appearance,
 * About). It is not a setting in the sense the rest of that page is — it is connections to
 * third-party systems, each holding a credential, each able to fail independently of anything Tovu
 * itself does. (A Composio tab lived here too until 2026-09-27, when Composio became the `composio`
 * agent plugin, connected through External MCP like any other remote server.)
 *
 * MCP Server and Webhooks joined this SAME screen on 2026-09-10 (second pass, owner call) — moved
 * here verbatim from `features/integrations/DeveloperApi.tsx`, which this change retires. That page
 * used to be its own nav row ("APIs & Webhooks") holding the mirror-image direction: OTHER TOOLS
 * reaching Tovu (MCP Server, an MCP client connecting IN) or Tovu reaching OUT to a subscriber
 * (Webhooks). The owner's call was that four rows under one "Add-Ons" group had grown one row too
 * many for what is really one concern — "this install's outside connections" — split only by
 * direction of travel, not by whether the connection needs its own top-level nav slot. Collapsing
 * the two rows into one, with direction expressed as tabs instead of nav rows, is what this file
 * does. `panels.tsx`'s own comment on the `providers`/`integrations` panels has the full history;
 * `DeveloperApi.tsx`'s retirement (its render logic moved here, its own file deleted) is recorded on
 * the `integrations` panel entry there, including what happens to its old bare `/admin/integrations`
 * URL.
 *
 * Media joined this screen once already (2026-09-10, first pass) and LEFT it the same day (second
 * pass) — not a Settings tab originally, but its own tab on the Media screen
 * (`features/media/Media.tsx`, `?tab=media-providers`), moved here briefly, then moved to the Media
 * screen for good as "External Providers" (owner call: media generation credentials belong beside
 * the media they generate, not beside MCP/webhook plumbing). See `features/media/Media.tsx`'s own
 * header for where it lives now — `media-provider-catalog.ts`/`media-providers-port.ts` moved WITH
 * it, into `features/media/`.
 *
 * ## Naming
 *
 * The nav row is "Integrations", never "MCP" or "Connectors" — the owner's call. "MCP" appears only
 * as a TAB label here, where the page around it supplies the context an operator needs.
 *
 * ## The `I18nProvider` below is load-bearing, not decoration
 *
 * `ExternalMcpSettingsPanel` and `IntegrationsTab` both resolve their own copy
 * through `@jini-ai/ui`'s `useT()`, which reads `I18nContext` from an ANCESTOR. On the Settings page
 * that ancestor was `SettingsUi`'s own `<I18nProvider>`; on the old `/admin/integrations` page it was
 * `DeveloperApi.tsx`'s own copy of this same provider. Mounting these components here WITHOUT one
 * would not throw and would not warn — `useI18n` falls through to `PASSTHROUGH_CONTEXT`, so every
 * string silently renders its raw English key and the regression is invisible in every non-English
 * locale until an operator reports it. Hence the provider, fed the same dictionaries and the same
 * `core.language.locale` value the Settings page fed it.
 *
 * `initialLocale` comes from `useAdminLocale()` rather than a `useSettingsSlice` mount: it reads
 * the same `core.language.locale` key, re-fetches on the same settings-refresh bus, and does not
 * drag in the six unrelated namespaces `useSettingsUi` would (see `hooks/use-providers.hooks.ts`).
 * `syncDocumentAttributes={false}` for the same reason `SettingsUi` sets it — only these tab bodies
 * are translated through this dictionary, so claiming a document-wide `<html lang>` here would
 * misinform assistive tech about the rest of the admin shell.
 *
 * Classic's light pin on this file's own page root (below) covers every tab body mounted under it,
 * including the MCP Server tab's `IntegrationsTab` — `DeveloperApi.tsx` needed its OWN nested
 * `data-theme="light"` wrapper around that one tab specifically because its page root had none; this
 * page's root already sets it for the whole screen, so that per-tab wrapper does not need to be
 * carried over.
 */

/** Tab ids are independent of tab LABELS, the same way panel ids are independent of nav labels
 *  throughout `panels.tsx`. `webhooks`/`mcp-server` are carried over unchanged from
 *  `DeveloperApi.tsx`'s own `DEVELOPER_API_TAB_IDS` — see this file's header for why those two tabs
 *  are here now. Order is the owner's explicit call (2026-09-10, second pass): External MCP first,
 *  then the two absorbed tabs in their original relative order (MCP Server,
 *  Webhooks) — see {@link resolveProvidersTabId} for the default. "Always allow" (2026-09-28, owner
 *  call) sits right after External MCP: it lists that tab's servers' tools the chat approval card no
 *  longer asks about. */
export interface ProvidersProps {
  tabId?: string | null;
  hooks: {
    useAdminThemeBoundary: (required: Record<string, never>, optional: Record<string, never>) => { "data-theme"?: string; style?: CSSProperties };
    useAdminLocale: () => string;
    useProvidersHook: () => { externalMcp: { dependencies: SourceConfigDependencies; restartRequired: boolean } };
    useIntegrationsHook: () => {
      subscriptions: AdminWebhookSubscriptionResponse[] | null; error: string | null;
      formOpen: boolean; setFormOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
      label: string; setLabel: (label: string) => void;
      targetUrl: string; setTargetUrl: (targetUrl: string) => void;
      topics: string; setTopics: (topics: string) => void;
      saving: boolean; formError: string | null;
      pendingDelete: AdminWebhookSubscriptionResponse | null;
      setPendingDelete: (subscription: AdminWebhookSubscriptionResponse | null) => void;
      deleting: boolean; onCreate: (e: React.FormEvent) => Promise<void>;
      onTogglePause: (subscription: AdminWebhookSubscriptionResponse) => Promise<void>;
      onDelete: () => Promise<void>;
      t: (required: { key: string }, optional?: Record<string, never>) => string;
      locale: string;
    };
  };
  kit: {
    TabBar: ComponentType<TabBarProps>;
    I18nProvider: ComponentType<{ initialLocale: string; dictionaries: Record<string, Record<string, string>>; fallbackLocale: string; syncDocumentAttributes: boolean; children: ReactNode }>;
    ExternalMcpSettingsPanel: ComponentType<{ dependencies: SourceConfigDependencies; showTitle: boolean; saveStatusLabel: string | undefined }>;
    AlwaysAllowPanel: ComponentType;
    McpServer: ComponentType;
    Webhooks: ComponentType<{ useIntegrationsHook: ProvidersProps["hooks"]["useIntegrationsHook"] }>;
    ComingSoonPanel: ComponentType<{ label: string; note: string; children: ReactNode }>;
  };
  deps: {
    dictionaries: Record<string, Record<string, string>>;
    t: (required: { locale: string; key: string }) => string;
    tIntegrations: (required: { locale: string; key: string }) => string;
    restartLabel: (required: { locale: string }) => string;
    mcpServerHandleLabel: string;
    onTabChange: (required: { nextTabId: string }) => void;
  };
}

const PROVIDERS_TAB_IDS = ["external-mcp", "always-allow", "mcp-server", "webhooks"] as const;
type ProvidersTabId = (typeof PROVIDERS_TAB_IDS)[number];

/** Falls back to the External MCP tab (first in {@link PROVIDERS_TAB_IDS}) for an absent or
 *  unrecognized `?tab=` value — same "fall back to the first tab" convention `DeveloperApi.tsx`'s
 *  own resolver followed, delegating to the shared `../../lib/resolve-active-tab-id` guard
 *  `Security.tsx`/`Deployment.tsx`/`Database.tsx`/`Themes.tsx` all use — a stale bookmark or a typo
 *  must open on a real tab, never a blank panel. The retired `/admin/integrations` page's own
 *  redirect (`panels.tsx`'s `integrations` panel) points at `?tab=webhooks` explicitly, so that
 *  URL's pre-merge default screen is preserved regardless of what this function's own default is. */
function resolveProvidersTabId({ tabId }: { tabId: string | null | undefined }, _options: Record<string, never> = {}): ProvidersTabId {
  return resolveActiveTabId({ tabId: tabId, validIds: PROVIDERS_TAB_IDS, defaultId: "external-mcp" });
}


export function Providers({ hooks, ...props }: ProvidersProps, _optional = {}) {
  const themeBoundary = hooks.useAdminThemeBoundary({}, {});
  const locale = hooks.useAdminLocale();
  const p = hooks.useProvidersHook();
  return <ProvidersView {...props} hooks={hooks} p={p} locale={locale} themeBoundary={themeBoundary} />;
}

export function bindProviders({ hooks, kit, deps }: Pick<ProvidersProps, "kit" | "deps"> & {
  hooks: Omit<ProvidersProps["hooks"], "useProvidersHook"> & {
    useExternalMcp: () => ReturnType<ProvidersProps["hooks"]["useProvidersHook"]>["externalMcp"];
  };
}, _optional = {}) {
  const { useExternalMcp } = hooks;
  function useWiredProviders(): ReturnType<ProvidersProps["hooks"]["useProvidersHook"]> {
    return useProviders({ useExternalMcp });
  }
  return function BoundProviders({ hooks: overrides, useProvidersHook, useIntegrationsHook, ...props }: {
    tabId?: string | null; hooks?: Partial<ProvidersProps["hooks"]>;
    useProvidersHook?: ProvidersProps["hooks"]["useProvidersHook"];
    useIntegrationsHook?: ProvidersProps["hooks"]["useIntegrationsHook"];
  }, _optional = {}) {
    return <Providers {...props} kit={kit} deps={deps} hooks={{ ...hooks, ...overrides,
      useProvidersHook: useProvidersHook ?? useWiredProviders,
      useIntegrationsHook: useIntegrationsHook ?? hooks.useIntegrationsHook }} />;
  };
}

function ProvidersView(props: ProvidersProps & {
  p: ReturnType<ProvidersProps["hooks"]["useProvidersHook"]>;
  locale: string;
  themeBoundary: ReturnType<ProvidersProps["hooks"]["useAdminThemeBoundary"]>;
}) {
  const { p, locale, themeBoundary, kit, deps } = props;
  const { I18nProvider, TabBar } = kit;
  const { t, onTabChange: navigateProvidersTab } = deps;
  const activeTabId = resolveProvidersTabId({ tabId: props.tabId });

  const tabs = providersTabs({ locale, deps });

  return (
    <I18nProvider
      initialLocale={locale}
      dictionaries={deps.dictionaries}
      fallbackLocale="en"
      syncDocumentAttributes={false}
    >
      {/* Classic's light pin is REQUIRED, not cosmetic — the same trap `Media.tsx`,
          `AiAssistant.tsx` and `PlaceholderTabs.tsx` each document at their own mounts of
          `@jini-ai/ui/settings-dialog.css` content: with no `data-theme` ancestor the stylesheet
          falls through to its `@media (prefers-color-scheme: dark)` variant, so these tab bodies
          would render dark on any OS set to dark mode while the rest of the (light-only) admin
          shell stays light. Now covers the MCP Server tab too (see this file's header) — one
          ancestor for every themed tab body on this page. Glass follows the document scheme
          through the shared theme controller at that same ancestor. */}
      <div className="page providers-page" {...themeBoundary}>
        <div
          className="page-header"
          {...agentHandle({ handle: "providers-header" }, {
            role: "region",
            label: "Integrations panel header — this install's outside connections in both directions: services it connects out to, and tools that connect in",
          })}
        >
          <div className="page-header-text">
            <p className="page-kicker">{t({ locale: locale, key: "Add-Ons" })}</p>
            <h1 className="page-title">{t({ locale: locale, key: "Integrations" })}</h1>
            <p className="page-description">
              {t({ locale: locale, key: "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks." }
              )}
            </p>
          </div>
        </div>
        <TabBar
          ariaLabel={t({ locale: locale, key: "Integrations" })}
          tabs={tabs}
          activeId={activeTabId}
          onChange={(nextTabId) => navigateProvidersTab({ nextTabId })}
          containerHandle="providers-tab-bar"
        />

        <ProvidersTabBody {...props} p={p} locale={locale} activeTabId={activeTabId} />
      </div>
    </I18nProvider>
  );
}
