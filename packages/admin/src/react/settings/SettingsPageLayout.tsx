import type { ReactNode, Ref } from "react";
import type { AdminKit, KitDictionaries, SaveState, SettingsDialogTab } from "../kit.js";
import type { Translate } from "@jini-ai/core/text";
import { describeSaveStatus } from "../../screens/settings/rules.js";

export interface SettingsPageLayoutProps {
  loading: boolean;
  locale: string | null;
  loadError: string | null;
  save: SaveState;
  tabId: string | null | undefined;
  tabs: Record<"execution" | "instructions" | "notifications" | "privacy" | "language" | "interface" | "memory" | "workspace" | "about", Omit<SettingsDialogTab, "id" | "icon">>;
  kit: Pick<AdminKit, "I18nProvider" | "SettingsDialogShell">;
  themeBoundary: { "data-theme": string; "data-color-scheme"?: string };
  rootRef: Ref<HTMLDivElement>;
  rootDataAttributes: Readonly<Record<`data-${string}`, string | number | boolean | undefined>>;
  dictionaries: KitDictionaries;
  fallbackLocale: string;
  useSettingsLocaleSyncHook: (required: { locale: string }) => void;
  onTabChange: (required: { tabId: string }, optional?: Record<string, never>) => void;
  copy: { t: Translate };
}

/** Shared 16px icon frame, so a tab's glyph can be written as bare path data. */
function TabIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      {children}
    </svg>
  );
}

/**
 * About tab body: version only, no updater surface.
 *
 * Deliberately NOT `@jini-ai/ui`'s own `AboutTab`, even though the dispatch
 * table names it as the drop-in to use. Reason, found while wiring it up:
 * `AboutTab`'s update-status row always renders `t(control.statusKey)`,
 * and every branch of `deriveAboutUpdateControl` (ui-core) sets `statusKey`
 * to a semantic dictionary id like `settings.updateStatusUnsupported` — never
 * to literal English, unlike this file's own tab labels. There is no
 * `UpdaterModel` state that produces a null status text, and
 * `showReleaseLink` is `true` in every reachable static state, so "omit the
 * updater surface entirely" (the dispatch's own instruction) cannot be done
 * through `AboutTab`'s props at all. Composing a minimal panel instead is
 * the smallest change that actually satisfies "version info only, no
 * updater" rather than papering over the raw-key display. Worth fixing
 * upstream: `ABOUT_UPDATE_KEYS` has no literal-English fallback path the way
 * every other tab's default labels do.
 *
 * Takes `t` as a prop rather than calling `useT()` itself: this module-scope
 * function isn't a descendant of the `I18nProvider` mounted in `SettingsUi`'s
 * own return value below (a component is never inside the context tree it
 * renders), so a `useT()` call here would silently resolve to context.tsx's
 * passthrough default instead of the real dictionary. See the `const t = ...`
 * comment inside `SettingsUi` for the full explanation.
 *
 * @complexity O(1) — fixed-shape render, no iteration, no branching.
 * @overallScore 100 — no branches, no I/O, no state.
 */
export function SettingsAboutPanel({ versionLabel, hint, t }: { versionLabel: string; hint: string; t: Translate }) {
  return (
    <section className="jini-settings-section">
      <div className="jini-settings-section-card">
        <div className="jini-field">
          <span className="jini-field-label">{t("Version")}</span>
          <strong>{versionLabel}</strong>
        </div>
        <p className="jini-hint">
          {hint}
        </p>
      </div>
    </section>
  );
}

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
  useSettingsLocaleSyncHook: SettingsPageLayoutProps["useSettingsLocaleSyncHook"];
}) {
  useSettingsLocaleSyncHook({ locale });
  return null;
}

function settingsExecutionTabs({ tabs }: Pick<SettingsPageLayoutProps, "tabs">): SettingsDialogTab[] {
  return [
    {
      ...tabs.execution,
      id: "execution",
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
    },
    {
      ...tabs.instructions,
      id: "instructions",
      icon: (
        <TabIcon>
          <path d="M4 3h10v12H4z" />
          <path d="M6.5 6.5h5M6.5 9h5M6.5 11.5h3" />
        </TabIcon>
      ),
    },
    {
      ...tabs.notifications,
      id: "notifications",
      icon: (
        <TabIcon>
          <path d="M9 3a4 4 0 0 0-4 4v3l-1.5 2.5h11L13 10V7a4 4 0 0 0-4-4z" />
          <path d="M7.5 13.5a1.5 1.5 0 0 0 3 0" />
        </TabIcon>
      ),
    },
  ];
}

function settingsPreferenceTabs({ tabs }: Pick<SettingsPageLayoutProps, "tabs">): SettingsDialogTab[] {
  return [
    {
      ...tabs.privacy,
      id: "privacy",
      icon: (
        <TabIcon>
          <path d="M9 2.5 14 4.5v4c0 3.2-2.1 6-5 7-2.9-1-5-3.8-5-7v-4z" />
          <path d="M6.75 8.75 8.5 10.5l3-3.25" />
        </TabIcon>
      ),
    },
    {
      ...tabs.language,
      id: "language",
      icon: (
        <TabIcon>
          <circle cx="9" cy="9" r="6.5" />
          <path d="M2.5 9h13M9 2.5c1.8 2 2.7 4.2 2.7 6.5S10.8 13.5 9 15.5c-1.8-2-2.7-4.2-2.7-6.5S7.2 4.5 9 2.5z" />
        </TabIcon>
      ),
    },
    {
      ...tabs.interface,
      id: "interface",
      icon: (
        <TabIcon>
          <rect x="2.5" y="3" width="13" height="12" rx="2" />
          <path d="M2.5 6.5h13" />
          <circle cx="12" cy="11.5" r="1.5" />
        </TabIcon>
      ),
    },
  ];
}

function settingsWorkspaceTabs({ tabs }: Pick<SettingsPageLayoutProps, "tabs">): SettingsDialogTab[] {
  return [
    {
      ...tabs.memory,
      id: "memory",
      icon: (
        <TabIcon>
          <circle cx="9" cy="9" r="6.5" />
          <path d="M9 5.5V9l3 2" />
        </TabIcon>
      ),
    },
    {
      ...tabs.workspace,
      id: "workspace",
      icon: (
        <TabIcon>
          <rect x="2.5" y="2.5" width="13" height="13" rx="2" />
          <path d="M2.5 7h13" />
        </TabIcon>
      ),
    },
    {
      ...tabs.about,
      id: "about",
      icon: (
        <TabIcon>
          <circle cx="9" cy="9" r="6.5" />
          <path d="M9 6.2h.01M8.3 8.5h1v4h1" />
        </TabIcon>
      ),
    },
  ];
}

export function SettingsPageLayout(props: SettingsPageLayoutProps) {
  const { loading, copy } = props;
  // Every slice starts `null` and settles independently. Gate on the whole set
  // so tabs don't pop in one at a time as their namespaces resolve.
  if (loading) {
    return (
      <div className="settings-ui-section">
        <p className="muted">{copy.t("Loading settings…")}</p>
      </div>
    );
  }
  return <SettingsPageLayoutContent {...props} />;
}

/**
 * `syncDocumentAttributes={false}`:
 * the admin shell owns `<html lang/dir>` via `useAdminDocumentLocale` and
 * its live `core.language` subscription. Keeping this nested provider
 * from writing the document avoids competing locale owners.
 */
function SettingsPageLayoutContent({ locale, loadError, save, tabId, tabs: inputs, kit, themeBoundary, rootRef, rootDataAttributes, dictionaries, fallbackLocale, useSettingsLocaleSyncHook, onTabChange, copy }: SettingsPageLayoutProps) {
  const { I18nProvider } = kit;
  const { t } = copy;
  const resolvedLocale = locale ?? fallbackLocale;
  const tabs = [...settingsExecutionTabs({ tabs: inputs }), ...settingsPreferenceTabs({ tabs: inputs }), ...settingsWorkspaceTabs({ tabs: inputs })];
  return (
    <I18nProvider initialLocale={resolvedLocale} dictionaries={dictionaries} fallbackLocale={fallbackLocale} syncDocumentAttributes={false}>
      <SettingsLocaleSync locale={resolvedLocale} useSettingsLocaleSyncHook={useSettingsLocaleSyncHook} />
      <div ref={rootRef} className="settings-ui-section settings-page" {...themeBoundary} {...rootDataAttributes}>
        {loadError ? (
          <p className="settings-ui-load-error" role="alert">
            {t("Could not load saved settings (")}{loadError}{t("). Showing defaults — edits will still save.")}
          </p>
        ) : null}
        <SettingsUiShell tabs={tabs} tabId={tabId} save={save} kit={kit} onTabChange={onTabChange} t={t} />
      </div>
    </I18nProvider>
  );
}
function SettingsUiShell({ tabs, tabId, save, kit, onTabChange, t }: Pick<SettingsPageLayoutProps, "tabId" | "save" | "kit" | "onTabChange"> & { tabs: SettingsDialogTab[]; t: Translate }) {
  const { SettingsDialogShell } = kit;
  const requestedTabId = tabId && tabs.some((tab) => tab.id === tabId) ? tabId : undefined;

  const handleTabChange = (tabId: string) => onTabChange({ tabId }, {});

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
          {...(requestedTabId === undefined ? {} : { activeTabId: requestedTabId })}
          onActiveTabIdChange={handleTabChange}
        />
  );
}
