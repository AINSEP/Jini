import { useEffect, type ComponentType, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { ByokConfig, ExecutionConfig, ExecutionPort, ProviderPreset } from "@jini-ai/core/contracts/execution";
import { type Translate } from "@jini-ai/core/text";
import type { I18nProviderProps, KitDictionaries, SettingsDialogShellProps, SettingsDialogTab, SettingsSlice, SaveState as KitSaveState, PrivacyConsentState, MemoryEntrySummary, MemoryExtractionRecord, MemoryConfigFlagKey, ExecutionCredentialController, ExecutionCredentialView } from "../../react/kit.js";
import type { InterfaceConfig } from "../../core/settings-tabs.js";
import type { createAdminByokKeyPanelTranslator } from "../../shell/components/AdminByokKeyPanel.hooks.js";
import { createSettingsUiTranslators } from "./SettingsUi.hooks.js";
import { aiAgentPanelDictionaries, t as translateAgentPresentation } from "./settings-execution-i18n.js";
import { describeSaveStatus, resolveByokConfig } from "./rules.js";
import { settingsUiTabs, type SettingsUiView } from "./SettingsUiTabs.js";
import type { BrowserAgentSettingsPanel } from "../webmcp/BrowserAgentSettingsPanel.js";
import type { UserInterfaceSettingsPanel } from "./UserInterfaceSettingsPanel.js";

type NotificationsPreferences = { soundEnabled: boolean; successSoundId: string; failureSoundId: string; desktopEnabled: boolean };

export interface SettingsUiProps {
  tabId?: string | null;
  hooks: {
    useAdminThemeBoundaryHook: (required: Record<string, never>, optional: Record<string, never>) => { "data-theme"?: string; style?: CSSProperties };
    useSettingsUiHook: () => {
      memoryTopTab: "memories" | "how"; setMemoryTopTab: (tab: "memories" | "how") => void;
      port: ExecutionPort; execution: SettingsSlice<ExecutionConfig>; instructions: SettingsSlice<string>;
      notifications: SettingsSlice<NotificationsPreferences>; privacy: SettingsSlice<PrivacyConsentState>;
      language: SettingsSlice<string>; interface: SettingsSlice<InterfaceConfig>;
      loading: boolean; loadError: string | null; save: KitSaveState;
    };
    useSettingsActiveTabScrollHook: (required: { ready: boolean; tabId: string | null }) => RefObject<HTMLDivElement | null>;
    useSettingsLocaleSyncHook: (required: { locale: string }) => void;
    useExecutionPolicy: (required: { config: ExecutionConfig; locale: string }) => {
      config: ExecutionConfig; allowed: boolean; readAllowedForSend: () => Promise<boolean>;
      visibility: string; note: string | null; preserveChange: (next: ExecutionConfig) => ExecutionConfig; subtitleKey: string;
    };
    useSettingsExecutionHook: (required: { config: ExecutionConfig | null; onChange: (next: ExecutionConfig) => void; locale: string }, optional: { usePolicy: SettingsUiProps["hooks"]["useExecutionPolicy"] }) => {
      config: ExecutionConfig; onConfigChange: (next: ExecutionConfig) => void; subtitleKey: string;
      visibility: string; note: string | null; unavailableReason: string | undefined;
    };
    useAiAgentPresentationHook: (required: { port: ExecutionPort; config: ExecutionConfig | null; locale: string; desktop: boolean; defaultLocalAgentId: string;
      translate: (required: { locale: string; key: string }) => string; scopeKeys: { desktopKey: string; serverKey: string };
    }) => { port: ExecutionPort; scopeCopy: string; warning: string | null };
    useAdminExecutionCredentialHook: (required: { byok: ByokConfig; onByokChange: (byok: ByokConfig) => void }) => ExecutionCredentialController<ExecutionCredentialView>;
    useAdminLocale: () => string;
    useUserInterfaceTab: Parameters<typeof UserInterfaceSettingsPanel<SettingsSlice<InterfaceConfig>>>[0]["useUserInterfaceTabHook"];
    useAdminBrowserAgentSettings: Parameters<typeof BrowserAgentSettingsPanel>[0]["useBrowserAgentSettingsHook"];
  };
  kit: {
    I18nProvider: ComponentType<I18nProviderProps>;
    SettingsDialogShell: ComponentType<Omit<SettingsDialogShellProps, "activeTabId"> & { activeTabId: string | undefined }>;
    ExecutionTab: ComponentType<{ presets: readonly ProviderPreset[]; config: ExecutionConfig; onConfigChange: (next: ExecutionConfig) => void;
      localCliUnavailableReason: string | undefined; port: ExecutionPort; localCliScopeLabel: string; ariaLabel: string;
      apiKeyStoredExternally: boolean; apiKeyPlaceholder: string | undefined; canDiscoverModels: boolean;
      describeProbeError: (error: unknown) => string; apiKeyFooter: ReactNode; formFooter: ReactNode; agentHandle: string;
    }>;
    InstructionsTab: ComponentType<{ value: string; onChange: (next: string | undefined) => void; description: string; agentHandle: string }>;
    NotificationsTab: ComponentType<{ preferences: NotificationsPreferences; onChange: (patch: Partial<NotificationsPreferences>) => void; agentHandle: string }>;
    PrivacyTab: ComponentType<{ state: PrivacyConsentState; onChange: (next: PrivacyConsentState) => void; agentHandle: string;
      labels: { metricsLabel: string; metricsHint: string; consentFooter: string };
    }>;
    LanguageTab: ComponentType<{ locales: readonly { code: string; label: string; nativeLabel?: string }[]; selectedLocale: string; onSelectLocale: (locale: string) => void; agentHandle: string }>;
    MemorySettingsPanel: ComponentType<{ enabled: boolean; onToggleEnabled: (next: boolean) => void; topTab: "memories" | "how"; onTopTabChange: (tab: "memories" | "how") => void; agentHandle: string;
      savedMemory: { entries: MemoryEntrySummary[]; filtered: MemoryEntrySummary[]; visibleExtractions: MemoryExtractionRecord[]; filter: "all";
        onFilterChange: () => void; unifiedMemoryCount: number; onClearExtractions: () => void; onRefreshExtractions: () => void;
        isRefreshing: boolean; previewId: null; previewBody: null; nowClock: number; onOpenPreview: () => void; onStartEdit: () => void;
        onDeleteEntry: () => void; onDeleteExtraction: () => void;
      };
      howItWorks: { enabled: boolean; hookFlags: Record<MemoryConfigFlagKey, boolean>; onToggleHook: () => void };
    }>;
    Workspace: ComponentType<{ showPageHeader: boolean }>;
    AboutPanel: ComponentType<{ t: Translate; tCap: (required: { key: string }, optional?: Record<string, never>) => string }>;
    AdminByokMigrationPrompt: ComponentType<{ controller: ReturnType<SettingsUiProps["hooks"]["useAdminExecutionCredentialHook"]>;
      useAdminLocaleHook: () => string; createTranslator: typeof createAdminByokKeyPanelTranslator }>;
    AdminByokKeyFooter: ComponentType<{ controller: ReturnType<SettingsUiProps["hooks"]["useAdminExecutionCredentialHook"]>;
      useAdminLocaleHook: () => string; createTranslator: typeof createAdminByokKeyPanelTranslator;
      resolveByokFooterStatusLine: SettingsUiProps["deps"]["resolveAdminByokFooterStatusLine"]; t: Translate }>;
    AdminByokSettingsFooter: ComponentType<{ controller: ReturnType<SettingsUiProps["hooks"]["useAdminExecutionCredentialHook"]>;
      useAdminLocaleHook: () => string; createTranslator: typeof createAdminByokKeyPanelTranslator; t: Translate }>;
  };
  deps: {
    SETTINGS_DIALOG_DICTIONARIES: KitDictionaries;
    ADMIN_LOCALES: readonly { code: string; label: string; nativeLabel?: string }[];
    DEFAULT_INSTRUCTIONS: string; DEFAULT_EXECUTION_CONFIG: ExecutionConfig;
    tApp: (required: { locale: string; key: string }) => string;
    tCapability: (required: { locale: string; key: string }) => string;
    tWorkspace: (required: { locale: string; key: string }) => string;
    navigate: (required: { routePath: string }, optional: { replace: boolean }) => void;
    createSettingsTabChange: (required: Record<string, never>) => (nextTabId: string) => void;
    DEFAULT_PROVIDER_PRESETS: readonly ProviderPreset[];
    isDesktopAdmin: (required: Record<string, never>) => boolean;
    defaultLocalAgentId: string; scopeKeys: { desktopKey: string; serverKey: string };
    SETTINGS_EXECUTION_PRODUCT_VARS: Readonly<Record<string, string>>;
    createProbeErrorDescriber: (required: { t: Translate }) => (error: unknown) => string;
    resolveAdminByokFooterStatusLine: (required: { status: KitSaveState["status"]; isStored: boolean }, optional?: { storedKeyIsForOtherEndpoint?: boolean; t?: Translate }) => string | null;
    webMcpT: (required: { locale: string; key: string }) => string;
    memoryUnavailableNote: string; localCliDataAttribute: string;
    legacySkillsPath: string; legacyAppearancePath: string; now: () => number;
  };
}

type SettingsUiController = ReturnType<SettingsUiProps["hooks"]["useSettingsUiHook"]>;

/**
 * Bridges the `core.language.locale` setting to the mounted `I18nProvider`'s active locale.
 * Renders nothing; see `hooks/use-settings-locale-sync.hooks.ts` for the full rationale (an
 * uncontrolled `initialLocale` prop that only applies at mount).
 *
 * @complexity O(1) — one equality check per render, no iteration.
 * @overallScore 100
 */
function SettingsLocaleSync({
  locale,
  useSettingsLocaleSyncHook,
}: {
  locale: string;
  /** Dependency injection seam for tests — same convention as `PostsProps.usePostsHook`. */
  useSettingsLocaleSyncHook: SettingsUiProps["hooks"]["useSettingsLocaleSyncHook"];
}, _optional = {}) {
  useSettingsLocaleSyncHook({ locale });
  return null;
}

function resolveTabId({ override }: { override: string | null | undefined }, _options = {}): string | null {
  return override ?? null;
}

export function SettingsUi({ hooks, kit, deps, ...props }: SettingsUiProps, _optional = {}) {
  const { useAdminThemeBoundaryHook, useSettingsUiHook, useSettingsActiveTabScrollHook, useSettingsExecutionHook, useAiAgentPresentationHook, useAdminExecutionCredentialHook } = hooks;
  const themeBoundary = useAdminThemeBoundaryHook({}, {});
  const tabId = resolveTabId({ override: props.tabId });
  useEffect(() => {
    if (props.tabId === "skills") deps.navigate({ routePath: deps.legacySkillsPath }, { replace: true });
    if (props.tabId === "appearance") deps.navigate({ routePath: deps.legacyAppearancePath }, { replace: true });
  }, [props.tabId]);
  const s: SettingsUiController = useSettingsUiHook();
  const settingsRootRef = useSettingsActiveTabScrollHook({ ready: !s.loading, tabId });

  const settingsLocale = s.language.value as string;
  const { t, tCap, tExecution } = createSettingsUiTranslators({
    settingsLocale, dialogDictionaries: deps.SETTINGS_DIALOG_DICTIONARIES, translateApp: deps.tApp, translateCapability: deps.tCapability,
  });

  const executionPolicy = useSettingsExecutionHook({ config: s.execution.value as ExecutionConfig | null, onChange: s.execution.onChange, locale: settingsLocale }, { usePolicy: hooks.useExecutionPolicy });

  const agentPresentation = useAiAgentPresentationHook({
    port: s.port, config: executionPolicy.config, locale: settingsLocale,
    desktop: deps.isDesktopAdmin({}), defaultLocalAgentId: deps.defaultLocalAgentId, translate: translateAgentPresentation, scopeKeys: deps.scopeKeys,
  });

  // Called unconditionally, ahead of the loading gate below (rules of hooks) — `resolveByokConfig`
  // falls back to `DEFAULT_EXECUTION_CONFIG.byok` while `s.execution.value` is still `null`, which
  // is harmless: the credential hook's own effects don't read `byok` until an explicit Save/migrate
  // press, and the tab this feeds isn't rendered until past the gate anyway. Pulled out to `rules.ts`
  // (2026-09-04, complexity-ceiling pass) — see `resolveByokConfig`'s own doc comment.
  const adminCredential = useAdminExecutionCredentialHook({
    byok: resolveByokConfig({ executionConfig: s.execution.value as ExecutionConfig | null, defaultByok: deps.DEFAULT_EXECUTION_CONFIG.byok }),
    onByokChange: (byok) => s.execution.onChange({ ...(s.execution.value as ExecutionConfig), byok }),
  });

  return <SettingsUiLoaded hooks={hooks} kit={kit} deps={deps} s={s} tabId={tabId} settingsLocale={settingsLocale}
    t={t} tCap={tCap} tExecution={tExecution} executionPolicy={executionPolicy} agentPresentation={agentPresentation}
    adminCredential={adminCredential} settingsRootRef={settingsRootRef} themeBoundary={themeBoundary} />;
}

function SettingsUiLoaded(props: SettingsUiView, _optional = {}) {
  const { s, t } = props;
  // Every slice starts `null` and settles independently. Gate on the whole set
  // so tabs don't pop in one at a time as their namespaces resolve.
  if (s.loading) {
    return (
      <div className="settings-ui-section">
        <p className="muted">{t("Loading settings…")}</p>
      </div>
    );
  }

  const tabs = settingsUiTabs(props);
  return <SettingsUiPage {...props} tabs={tabs} />;
}

    /**
     * `initialLocale` is safe to read straight from the slice here: this
     * whole function already returned the "Loading settings…" placeholder
     * above until every slice (including `language`) resolved, so
     * `language.value` is never null at this point — no detection race.
     * `dictionaries` is upstream's shipped EN+ES pair (`@jini-ai/ui`'s
     * `SETTINGS_DIALOG_DICTIONARIES`); `fallbackLocale="en"` is already the
     * default, named here for clarity since it's load-bearing (a key missing
     * from `es` renders real English, never a raw key — see
     * `dictionaries.test.tsx` upstream). `syncDocumentAttributes={false}`:
     * the admin shell owns `<html lang/dir>` via `useAdminDocumentLocale` and
     * its live `core.language` subscription. Keeping this nested provider
     * from writing the document avoids competing locale owners.
     */
function SettingsUiPage(props: SettingsUiView & { tabs: SettingsDialogTab[] }, _optional = {}) {
  const { s, tabs, tabId, t, executionPolicy, settingsRootRef, themeBoundary, hooks, kit, deps } = props;
  const { I18nProvider } = kit;
  return (
    <I18nProvider
      initialLocale={s.language.value as string}
      dictionaries={aiAgentPanelDictionaries({ dictionaries: deps.SETTINGS_DIALOG_DICTIONARIES, locales: deps.ADMIN_LOCALES })}
      fallbackLocale="en"
      syncDocumentAttributes={false}
    >
      <SettingsLocaleSync useSettingsLocaleSyncHook={hooks.useSettingsLocaleSyncHook} locale={s.language.value as string} />
      {/* `settings-page` is THIS screen's own hook for `styles/settings.css` — five screens share
          `settings-ui-section` (Agent Plugins, Authentication, AI Assistant, the placeholder tabs,
          and this one), so anything meant for the Settings page alone must not select on the
          shared class. Classic is pinned; Glass follows the document — see above `return`. */}
      <div ref={settingsRootRef} className="settings-ui-section settings-page" {...themeBoundary} {...{ [deps.localCliDataAttribute]: executionPolicy.visibility }}>
        {s.loadError ? (
          <p className="settings-ui-load-error" role="alert">
            {t("Could not load saved settings (")}{s.loadError}{t("). Showing defaults — edits will still save.")}
          </p>
        ) : null}

        {/* Inline is the only render mode now: two sidebars (admin, then
            settings) and the panel, in the admin's own content column. The
            modal render this page used to also mount on `s.modalOpen` is
            gone — see the "Top-right chrome" comment above `saveStatus`. */}
        <SettingsUiShell kit={kit} deps={deps} tabs={tabs} tabId={tabId} save={s.save} t={t} />
      </div>
    </I18nProvider>
  );
}

  /**
   * Top-right chrome. Lives in the shell's own `chromeExtra` slot rather than
   * in a banner above it, so the page is exactly what it looks like: the admin
   * sidebar, the settings sidebar, and the panel — no third strip of header
   * competing with the shell's own title.
   *
   * This used to also carry an "Open as dialog" button that mounted a second,
   * modal `SettingsDialogShell` over this same page (removed 2026-09-19 —
   * owner's call: the modal overlay was never wanted, only the inline page
   * is). `s.modalOpen`/`s.setModalOpen` went with it — see
   * `use-settings-ui.hooks.ts`'s header.
   */
function SettingsUiShell({ tabs, tabId, save, t, kit, deps }: { tabs: SettingsDialogTab[]; tabId: string | null; save: SettingsUiController["save"]; t: ReturnType<typeof createSettingsUiTranslators>["t"]; kit: SettingsUiProps["kit"]; deps: SettingsUiProps["deps"] }, _optional = {}) {
  const { SettingsDialogShell } = kit;
  const { createSettingsTabChange } = deps;
  const requestedTabId = tabId && tabs.some((tab) => tab.id === tabId) ? tabId : undefined;

  const handleTabChange = createSettingsTabChange({});

  const saveStatus = (
    <span
      className={`settings-ui-save is-${save.status}`}
      role={save.status === "error" ? "alert" : "status"}
    >
      {t(describeSaveStatus(save))}
    </span>
  );

  return (
        <SettingsDialogShell
          tabs={tabs}
          presentation="inline"
          className="jini-tabbed-dialog--inline"
          fullscreenEnabled={false}
          chromeExtra={saveStatus}
          activeTabId={requestedTabId}
          onActiveTabIdChange={handleTabChange}
        />
  );
}

export function bindSettingsUi({ hooks, kit, deps }: Pick<SettingsUiProps, "hooks" | "kit" | "deps">, _optional = {}) {
  return function BoundSettingsUi(props: Pick<SettingsUiProps, "tabId">, _optional = {}) {
    return <SettingsUi {...props} hooks={hooks} kit={kit} deps={deps} />;
  };
}
