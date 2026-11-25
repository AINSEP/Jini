import type { ComponentType, ReactNode } from "react";
import type { AgentHandleProps } from "@jini-ai/core/agent-handles";

/**
 * @file The Source Control page (`/admin/source-control`) — a CONNECTION page, not git integration.
 * See `ProvidersTab.tsx`'s own header for the scope boundary: save a personal access token per
 * provider so the host can read (and later push to) repositories, nothing more yet.
 *
 * ## 2026-08-16 — page shell rebuilt on `TabBar`, superseding this file's own PREVIOUS "never a tab
 * bar" decision
 *
 * This file used to hold every provider row directly, under a doc comment arguing explicitly
 * against a tab bar: "three flat rows was the explicit brief... this page has no tab bar to begin
 * with." That was a real, considered decision the owner made the day before (2026-08-15) — a
 * same-week reversal, not drift or an agent's own judgment call — confirmed directly by the owner
 * after seeing this page next to `deployment/Deployment.tsx`. A future reader who finds a tab bar
 * here where a comment once forbade one should read THIS as the record of that reversal, not a sign
 * the old comment was ignored. The page read as a settings-dialog panel dropped onto a route, not a
 * page: it carried no `page-header`/`TabBar` shell at all, while its nearest neighbour,
 * `deployment/Deployment.tsx`, does. This file now mirrors `Deployment.tsx`'s shell exactly — same
 * `TabBar` (not `@jini-ai/ui`'s `SettingsDialogShell`, for the identical reason that file's own
 * header gives: a dialog-shaped shell bundling its own sidebar plus a kicker/title/subtitle header
 * fights a page's own `.page-header`), same {@link resolveSourceControlTabId} guard against a junk `?tab=`
 * value, same `navigate(..., { replace: true })` on tab switch so the URL stays a correct deep link
 * without growing back-button history one entry per click.
 *
 * The three provider rows themselves did NOT change — moved verbatim into `ProvidersTab.tsx`, this
 * page's one tab today. "Flat rows, not sub-tabs" is still true one level down: GitHub, GitLab, and
 * Bitbucket are still three parallel rows inside that one tab, never three tabs of their own — this
 * pass only wraps that existing content in the page-level shell every other built Operations screen
 * already has. Only one real tab exists because only one real thing is built here — commit history,
 * sync, diffing, and branch management are still a separate, not-yet-started feature (see
 * `ProvidersTab.tsx`'s header) — so {@link SOURCE_CONTROL_TAB_IDS} stays a list of one rather than
 * padding itself out with a disabled placeholder tab for a feature that has not been spec'd yet.
 * `panels.tsx`'s own "its own Operations entry, not a Deployment tab" reasoning is unaffected by any
 * of this — that argument was always about this page's place in the top-level nav, not about
 * whether it may have an internal tab bar of its own.
 */

const SOURCE_CONTROL_TAB_IDS = ["providers"] as const;
type SourceControlTabId = (typeof SOURCE_CONTROL_TAB_IDS)[number];

/** Falls back to the one tab for an absent or unrecognized `?tab=` value. Delegates to the shared
 *  injected guard `Deployment.tsx`/`Security.tsx`/`Database.tsx`/
 *  `Themes.tsx` all use, for the same reason (a stale link or a typo must not blank the panel).
 *  Kept as a real function rather than inlined even with one tab today: `Deployment.tsx` started
 *  at five tabs where this guard mattered immediately, and a second real tab landing here later
 *  should not have to reintroduce it. */
function resolveSourceControlTabId({ tabId, resolveActiveTabId }: { tabId: string | null | undefined; resolveActiveTabId: SourceControlProps["resolveActiveTabId"] }, _optional = {}): SourceControlTabId {
  return resolveActiveTabId({ tabId: tabId, validIds: SOURCE_CONTROL_TAB_IDS, defaultId: "providers" });
}

export interface SourceControlTabBarProps {
  tabs: readonly {
    id: string;
    label: string;
    icon?: ReactNode | undefined;
    handle?: string | undefined;
    handleLabel?: string | undefined;
  }[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  containerHandle?: string | undefined;
}

export interface SourceControlProps {
  /** The `?tab=` query value from `panels.tsx`'s `source-control` route (`URLSearchParams.get`
   *  returns `null` when the param is absent). See {@link resolveSourceControlTabId}. */
  tabId?: string | null | undefined;
  useAdminLocaleHook: (
    required: Record<string, never>, optional?: Record<string, never>,
  ) => string;
  t: (required: { locale: string; key: string }, optional?: Record<string, never>) => string;
  resolveActiveTabId: (
    required: { tabId: string | null | undefined; validIds: readonly "providers"[]; defaultId: "providers" },
    optional?: Record<string, never>,
  ) => "providers";
  TabBar: ComponentType<SourceControlTabBarProps>;
  onTabChange: (required: { nextTabId: string }, optional?: Record<string, never>) => void;
  providerIcon: ReactNode;
  providers: ReactNode;
  headerAttrs: AgentHandleProps;
  copy: { descriptionKey: string; providerTabHandleLabel: string };
}

export function SourceControl({
  useAdminLocaleHook, t, resolveActiveTabId, TabBar, onTabChange, providerIcon, providers, headerAttrs, copy, ...props }: SourceControlProps) {
  const locale = useAdminLocaleHook({});
  const activeTabId = resolveSourceControlTabId({ tabId: props.tabId, resolveActiveTabId });

  const tabs: SourceControlTabBarProps["tabs"] = [
    {
      id: "providers",
      label: t({ locale: locale, key: "Providers" }),
      icon: providerIcon,
      handle: "source-control-tab-providers",
      handleLabel: copy.providerTabHandleLabel,
    },
  ];

  return (
    <div className="page">
      <div
        className="page-header"
        {...headerAttrs}
      >
        <div className="page-header-text">
          <p className="page-kicker">{t({ locale: locale, key: "Operations" })}</p>
          <h1 className="page-title">{t({ locale: locale, key: "Source Control" })}</h1>
          <p className="page-description">
            {t({ locale: locale, key: copy.descriptionKey }
            )}
          </p>
        </div>
      </div>
      <TabBar
        ariaLabel={t({ locale: locale, key: "Source Control" })}
        tabs={tabs}
        activeId={activeTabId}
        onChange={(nextTabId) => onTabChange({ nextTabId })}
        containerHandle="source-control-tab-bar"
      />
      {/* `providers` is the only tab (SOURCE_CONTROL_TAB_IDS) and `activeTabId` always resolves to
          it, so its panel renders unconditionally; add a dispatch here alongside a second tab. */}
      {providers}
    </div>
  );
}
