import type { ComponentProps, ReactNode, RefObject } from "react";
import type { SettingsDialogTab, MemoryEntrySummary, MemoryExtractionRecord, MemoryConfigFlagKey, PrivacyConsentState } from "../../react/kit.js";
import type { SettingsUiProps } from "./SettingsUi.js";
import { interpolate, type Translate } from "@jini-ai/core/text";
import type { createSettingsUiTranslators } from "./SettingsUi.hooks.js";
import { UserInterfaceSettingsPanel } from "./UserInterfaceSettingsPanel.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { memoryPanelDictionaries } from "./settings-memory-i18n.js";
import { t as tInterfaceCopy } from "./settings-interface-i18n.js";

export type SettingsUiView = Pick<SettingsUiProps, "hooks" | "kit" | "deps"> & {
  s: ReturnType<SettingsUiProps["hooks"]["useSettingsUiHook"]>; tabId: string | null; settingsLocale: string;
  t: Translate; tCap: ReturnType<typeof createSettingsUiTranslators>["tCap"]; tExecution: Translate;
  executionPolicy: ReturnType<SettingsUiProps["hooks"]["useSettingsExecutionHook"]>;
  agentPresentation: ReturnType<SettingsUiProps["hooks"]["useAiAgentPresentationHook"]>;
  adminCredential: ReturnType<SettingsUiProps["hooks"]["useAdminExecutionCredentialHook"]>;
  settingsRootRef: RefObject<HTMLDivElement | null>;
  themeBoundary: ReturnType<SettingsUiProps["hooks"]["useAdminThemeBoundaryHook"]>;
};

type NotificationsPreferences = NonNullable<SettingsUiView["s"]["notifications"]["value"]>;

/** Shared 16px icon frame, so a tab's glyph can be written as bare path data. */
function TabIcon({ children }: { children: ReactNode }, _optional = {}) {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      {children}
    </svg>
  );
}


const EMPTY_MEMORY_ENTRIES: MemoryEntrySummary[] = [];
const EMPTY_MEMORY_EXTRACTIONS: MemoryExtractionRecord[] = [];


const MEMORY_HOOK_FLAGS: Record<MemoryConfigFlagKey, boolean> = {
  chatExtractionEnabled: true,
  profileEnabled: true,
  rewriteEnabled: true,
  verifyEnabled: true,
};

/** Every action slot of the embedded Memory panel. That panel is display-only on this screen (no
 *  memory store is wired here: entries and extractions are always the empty constants), so a
 *  toggle, filter, refresh or clear changes nothing and calls nothing. One shared no-op instead of
 *  nine inline ones, so the read-only intent is stated once. */
const READ_ONLY_MEMORY_ACTION = (): void => {};

export function settingsUiTabs(props: SettingsUiView, _optional = {}): SettingsDialogTab[] {
  return [executionTab(props), instructionsTab(props), notificationsTab(props), privacyTab(props), languageTab(props), interfaceTab(props), memoryTab(props), workspaceTab(props), aboutTab(props)];
}

function executionTab(props: SettingsUiView, _optional = {}): SettingsDialogTab {
  const { t, tExecution, executionPolicy, agentPresentation, adminCredential, kit, hooks, deps } = props;
  return ({
      id: "execution",
      label: tExecution("AI agent"),
      title: tExecution("AI agent"),
      subtitle: t(executionPolicy.subtitleKey),
      icon: (
        <TabIcon>
          {/* Robot = the AI agent; adapted from lucide `bot`, ISC. */}
          <path d="M9 6V3H6" />
          <rect x="3" y="6" width="12" height="9" rx="1.5" />
          <path d="M1.5 10.5h1.5" />
          <path d="M15 10.5h1.5" />
          <path d="M6.75 9.75v1.5" />
          <path d="M11.25 9.75v1.5" />
        </TabIcon>
      ),
      panel: <SettingsExecutionPanel kit={kit} hooks={hooks} deps={deps} adminCredential={adminCredential} agentPresentation={agentPresentation} executionPolicy={executionPolicy} tExecution={tExecution} />,
    });
}

function instructionsTab(props: SettingsUiView, _optional = {}): SettingsDialogTab {
  const { s, t, kit, deps } = props;
  const { InstructionsTab } = kit;
  return ({
      id: "instructions",
      label: t("Instructions"),
      title: t("Custom instructions"),
      subtitle: t("Applied to every assistant conversation in this workspace."),
      icon: (
        <TabIcon>
          <path d="M4 3h10v12H4z" />
          <path d="M6.5 6.5h5M6.5 9h5M6.5 11.5h3" />
        </TabIcon>
      ),
      panel: (
        <InstructionsTab
          value={s.instructions.value as string}
          // The tab reports an all-empty textarea as `undefined` rather than
          // `''`; the slice is typed on the stored shape, which is a string.
          onChange={(next) => s.instructions.onChange(next ?? deps.DEFAULT_INSTRUCTIONS)}
          description="Extra instructions applied to every conversation in this workspace, in addition to any per-request instructions."
          agentHandle="settings-instructions"
        />
      ),
    });
}

function notificationsTab(props: SettingsUiView, _optional = {}): SettingsDialogTab {
  const { s, t, kit } = props;
  const { NotificationsTab } = kit;
  return ({
      id: "notifications",
      label: t("Notifications"),
      title: t("Notifications"),
      subtitle: t("How you're told a task finished. Saved per operator, not per workspace."),
      icon: (
        <TabIcon>
          <path d="M9 3a4 4 0 0 0-4 4v3l-1.5 2.5h11L13 10V7a4 4 0 0 0-4-4z" />
          <path d="M7.5 13.5a1.5 1.5 0 0 0 3 0" />
        </TabIcon>
      ),
      panel: (
        <NotificationsTab
          preferences={s.notifications.value as NotificationsPreferences}
          // This tab emits a PATCH, not a whole object (unlike `PrivacyTab`
          // next door, which emits full state). Merging here rather than
          // teaching the slice about patches keeps the slice's diff base and
          // the stored shape the same type.
          onChange={(patch) =>
            s.notifications.onChange({ ...(s.notifications.value as NotificationsPreferences), ...patch })
          }
          agentHandle="settings-notifications"
        />
      ),
    });
}

function privacyTab(props: SettingsUiView, _optional = {}): SettingsDialogTab {
  const { s, settingsLocale, t, tCap, kit, hooks, deps } = props;
  const { PrivacyTab, BrowserAgentSettingsPanel } = kit;
  return ({
      id: "privacy",
      label: t("Privacy"),
      title: t("Privacy"),
      subtitle: tCap({ key: "Product analytics consent." }),
      icon: (
        <TabIcon>
          <path d="M9 2.5 14 4.5v4c0 3.2-2.1 6-5 7-2.9-1-5-3.8-5-7v-4z" />
          <path d="M6.75 8.75 8.5 10.5l3-3.25" />
        </TabIcon>
      ),
      // These controls were inert while no collection path existed, so they could not imply that
      // consent affected nonexistent delivery. Product analytics now needs that metrics decision.
      // Operational errors follow their provider plugin; the separate core.analytics privacy
      // controls govern site analytics rather than this operator's product-analytics consent.
      panel: (
        <div className="settings-ui-inert-wrap">
          <BrowserAgentSettingsPanel locale={settingsLocale} t={deps.webMcpT} useBrowserAgentSettingsHook={hooks.useAdminBrowserAgentSettings} />
          {/* The policy is said once, in PrivacyTab's footer; a second note above it said the same. */}
          <PrivacyTab state={s.privacy.value as PrivacyConsentState} onChange={s.privacy.onChange} agentHandle="settings-privacy"
            labels={{ metricsLabel: t("Product analytics"), metricsHint: t("Usage events sent to your configured analytics provider."),
              consentFooter: t("Product analytics requires metrics consent. Error reporting follows its provider plugin.") }} />
        </div>
      ),
    });
}

function languageTab(props: SettingsUiView, _optional = {}): SettingsDialogTab {
  const { s, t, kit, deps } = props;
  const { LanguageTab, I18nProvider } = kit;
  return ({
      id: "language",
      label: t("Language"),
      title: t("Language"),
      // Real translation as of this pass: picking Español actually switches
      // this settings panel's tab content (see `SettingsLocaleSync` and the
      // `I18nProvider` mount below). Scoped honestly in the subtitle itself —
      // see `ADMIN_LOCALES`'s doc comment for exactly what is and isn't
      // covered.
      subtitle: t("Admin interface language. Applies to this settings panel's tab content only."),
      icon: (
        <TabIcon>
          <circle cx="9" cy="9" r="6.5" />
          <path d="M2.5 9h13M9 2.5c1.8 2 2.7 4.2 2.7 6.5S10.8 13.5 9 15.5c-1.8-2-2.7-4.2-2.7-6.5S7.2 4.5 9 2.5z" />
        </TabIcon>
      ),
      panel: (
        <LanguageTab
          locales={deps.ADMIN_LOCALES}
          selectedLocale={s.language.value as string}
          onSelectLocale={s.language.onChange}
          agentHandle="settings-language"
        />
      ),
    });
}

function interfaceTab(props: SettingsUiView, _optional = {}): SettingsDialogTab {
  const { s, settingsLocale, hooks } = props;
  return ({
      // Owner, 2026-10-06: per-operator admin chrome preferences (`core.interface`). Copy lives in
      // `settings-interface-i18n.ts`; the panel's own doc covers what the one switch controls.
      id: "interface",
      label: tInterfaceCopy({ locale: settingsLocale, key: "User Interface" }),
      title: tInterfaceCopy({ locale: settingsLocale, key: "User Interface" }),
      subtitle: tInterfaceCopy({ locale: settingsLocale, key: "How the admin's controls behave for you. Saved per operator." }),
      icon: (
        <TabIcon>
          <rect x="2.5" y="3" width="13" height="12" rx="2" />
          <path d="M2.5 6.5h13" />
          <circle cx="12" cy="11.5" r="1.5" />
        </TabIcon>
      ),
      panel: <UserInterfaceSettingsPanel slice={s.interface} locale={settingsLocale} useUserInterfaceTabHook={hooks.useUserInterfaceTab} agentHandle={agentHandle} />,
    });
}

function memoryTab(props: SettingsUiView, _optional = {}): SettingsDialogTab {
  const { t } = props;
  return ({
      id: "memory",
      label: t("Memory"),
      title: t("Memory"),
      subtitle: t("Saved facts and context for future chats."),
      icon: (
        <TabIcon>
          <circle cx="9" cy="9" r="6.5" />
          <path d="M9 5.5V9l3 2" />
        </TabIcon>
      ),

      panel: settingsMemoryPanel(props),
    });
}

function settingsMemoryPanel(props: SettingsUiView, _optional = {}) {
  const { s, settingsLocale, tCap, kit, deps } = props;
  const { I18nProvider, MemorySettingsPanel } = kit;
  return (
        <div className="settings-ui-inert-wrap">
          <p className="settings-ui-inert-note" role="note">
            {tCap({
              key: deps.memoryUnavailableNote,
            })}
          </p>
          <div className="settings-ui-inert-control" inert>
            {/* Nested provider: the outer one's dictionaries lack every memory-panel key (see
                `settings-memory-i18n.ts`). Keyed on the locale so a change remounts it with the new
                `initialLocale`. */}
            <I18nProvider
              key={settingsLocale}
              initialLocale={settingsLocale}
              dictionaries={memoryPanelDictionaries({ locale: settingsLocale })}
              syncDocumentAttributes={false}
            >
            <MemorySettingsPanel
              enabled
              onToggleEnabled={READ_ONLY_MEMORY_ACTION}
              topTab={s.memoryTopTab}
              onTopTabChange={s.setMemoryTopTab}
              agentHandle="settings-memory"
              savedMemory={settingsMemoryRecords(props)}
              howItWorks={{
                enabled: true,
                hookFlags: MEMORY_HOOK_FLAGS,
                onToggleHook: READ_ONLY_MEMORY_ACTION,
              }}
            />
            </I18nProvider>
          </div>
        </div>
      );
}

function settingsMemoryRecords(props: SettingsUiView, _optional = {}): ComponentProps<SettingsUiView["kit"]["MemorySettingsPanel"]>["savedMemory"] {
  const { deps } = props;
  return {
                entries: EMPTY_MEMORY_ENTRIES,
                filtered: EMPTY_MEMORY_ENTRIES,
                visibleExtractions: EMPTY_MEMORY_EXTRACTIONS,
                filter: "all",
                onFilterChange: READ_ONLY_MEMORY_ACTION,
                unifiedMemoryCount: 0,
                onClearExtractions: READ_ONLY_MEMORY_ACTION,
                onRefreshExtractions: READ_ONLY_MEMORY_ACTION,
                isRefreshing: false,
                previewId: null,
                previewBody: null,
                nowClock: deps.now(),
                onOpenPreview: READ_ONLY_MEMORY_ACTION,
                onStartEdit: READ_ONLY_MEMORY_ACTION,
                onDeleteEntry: READ_ONLY_MEMORY_ACTION,
                onDeleteExtraction: READ_ONLY_MEMORY_ACTION,
  };
}

      // SPEC-044's OQ-04, resolved 2026-09-10 (owner call): folded in from a standalone top-level
      // nav row — see this file's own header (the "One tab ARRIVED here" section) and
      // `panels.tsx`'s comment on the retired `workspace` panel for the full history and the
      // `/admin/workspace` -> `/admin/settings?tab=workspace` redirect that keeps old links
      // working.
      //
      // Placed last, immediately before About: every other tab here configures how the ASSISTANT
      // behaves or how this OPERATOR experiences the dialog (execution, instructions,
      // notifications, privacy, language, interface, memory) — this one is the only tab
      // that is about the INSTALL's own identity, closer in kind to About's version/runtime facts
      // than to any operator preference above it. Not inserted earlier in that run (e.g. ahead of
      // Language) for the same reason: nothing about Workspace configures another tab's behavior,
      // so there is no ordering dependency forcing it earlier, only this one thematic affinity to
      // the tab already at the end.
      //
      // Label/title/subtitle reuse `workspace-i18n.ts`'s own `t(locale, key)` translator
      // (`tWorkspace`) rather than re-translating the same three strings into
      // `settings-capabilities-i18n.ts`: `"Workspace"` and its identity-summary subtitle are
      // already translated there, across the same 21 admin locales `admin-nav-i18n.ts` covers, from
      // when this screen's own `<h1>`/`<p className="page-description">` used them as a standalone
      // page. Two dictionaries carrying the same three English source strings would drift the
      // moment either changed.
      // `useWorkspaceHook` unset — production callers get the real `useWiredWorkspace()`
      // (`WorkspaceProps.useWorkspaceHook`'s own default), the same as every other mount of this
      // component. Self-contained: it manages its own fetch/save/error state and does not read from
      // or write into `s` (`SettingsUiController`) — see this file's header for why it isn't one of
      // the `useSettingsSlice` tabs.
      //
      // `showPageHeader={false}`: this tab's own `title`/`subtitle` above ARE `Workspace.tsx`'s
      // kicker-free header content (same "Workspace" title, same identity-summary sentence, by
      // construction — both come from the one `tWorkspace(...)` call above), so
      // `SettingsDialogShell` already renders that content once, in its own chrome, before this
      // panel mounts at all. See `WorkspaceProps.showPageHeader`'s own doc for why the fix is a
      // prop rather than a CSS rule, and why it drops the whole header block rather than only the
      // title.
function workspaceTab(props: SettingsUiView, _optional = {}): SettingsDialogTab {
  const { settingsLocale, kit, deps } = props;
  const { Workspace } = kit;
  return ({
      id: "workspace",
      label: deps.tWorkspace({ locale: settingsLocale, key: "Workspace" }),
      title: deps.tWorkspace({ locale: settingsLocale, key: "Workspace" }),
      subtitle: deps.tWorkspace({ locale: settingsLocale, key: "This site's identity — its name, URL slug, and creation date." }),
      // Unchanged from the retired nav row's own icon — a card/panel with a header bar, read as
      // "this install's own identity card", distinct from every `TabIcon` glyph around it.
      icon: (
        <TabIcon>
          <rect x="2.5" y="2.5" width="13" height="13" rx="2" />
          <path d="M2.5 7h13" />
        </TabIcon>
      ),
      panel: <Workspace showPageHeader={false} />,
    });
}

function aboutTab(props: SettingsUiView, _optional = {}): SettingsDialogTab {
  const { t, tCap, kit } = props;
  const { AboutPanel } = kit;
  return ({
      id: "about",
      label: t("Info"),
      title: t("Info"),
      subtitle: t("Version and runtime details."),
      icon: (
        <TabIcon>
          <circle cx="9" cy="9" r="6.5" />
          <path d="M9 6.2h.01M8.3 8.5h1v4h1" />
        </TabIcon>
      ),
      panel: <AboutPanel t={t} tCap={tCap} />,
    });
}


function SettingsExecutionPanel({ adminCredential, agentPresentation, executionPolicy, tExecution, hooks, kit, deps }: Pick<SettingsUiView, "adminCredential" | "agentPresentation" | "executionPolicy" | "tExecution" | "hooks" | "kit" | "deps">, _optional = {}) {
  const { AdminByokMigrationPrompt, AdminByokKeyFooter, AdminByokSettingsFooter, ExecutionTab } = kit;
  const { useAdminLocale } = hooks;
  const { DEFAULT_PROVIDER_PRESETS, SETTINGS_EXECUTION_PRODUCT_VARS, createProbeErrorDescriber, resolveAdminByokFooterStatusLine, createAdminByokKeyPanelTranslator } = deps;
  return (
<>
          <AdminByokMigrationPrompt useAdminLocaleHook={useAdminLocale} createTranslator={createAdminByokKeyPanelTranslator} controller={adminCredential} />
          {agentPresentation.warning && <p className="notice warning" role="status" aria-live="polite">{agentPresentation.warning}</p>}
          {executionPolicy.note && <p className="jini-field-hint" role="status">{executionPolicy.note}</p>}
          <ExecutionTab
            presets={DEFAULT_PROVIDER_PRESETS}
            config={executionPolicy.config}
            onConfigChange={executionPolicy.onConfigChange}
            localCliUnavailableReason={executionPolicy.unavailableReason}
            port={agentPresentation.port}
            // Bridge presence identifies the desktop host; a deployed server runs elsewhere.
            localCliScopeLabel={interpolate({ template: tExecution(agentPresentation.scopeCopy), vars: SETTINGS_EXECUTION_PRODUCT_VARS })}
            ariaLabel={tExecution("AI agent")}
            // The admin's own BYOK credential is encrypted server-side and write-only
            // (2026-08-05) — these four keep the shared `ByokProviderForm` honest about
            // that: an empty key field is not a missing value when one is already stored,
            // the masked placeholder answers "which key", and the two footers are the ONLY
            // controls that can persist anything. They write DISJOINT patches — the key
            // footer writes the key, the form footer writes protocol/base URL/model/max
            // tokens — so neither can claim the other's work. See
            // `hooks/use-admin-execution-credential.hooks.ts`. The next two match
            // `AiAssistant.tsx`'s `AdminExecutionMode` mount: `canDiscoverModels` keeps a provider
            // switch from probing with a key saved for another endpoint, and `describeProbeError`
            // words the server's endpoint-pin refusals in plain language.
            apiKeyStoredExternally={adminCredential.apiKeyStoredExternally}
            apiKeyPlaceholder={adminCredential.apiKeyPlaceholder}
            canDiscoverModels={adminCredential.canDiscoverModels}
            describeProbeError={createProbeErrorDescriber({ t: tExecution })}
            apiKeyFooter={<AdminByokKeyFooter useAdminLocaleHook={useAdminLocale} createTranslator={createAdminByokKeyPanelTranslator} resolveByokFooterStatusLine={resolveAdminByokFooterStatusLine} controller={adminCredential} t={tExecution} />}
            formFooter={<AdminByokSettingsFooter useAdminLocaleHook={useAdminLocale} createTranslator={createAdminByokKeyPanelTranslator} controller={adminCredential} t={tExecution} />}
            agentHandle="settings-ai-agent"
          />
        </>
  );
}
