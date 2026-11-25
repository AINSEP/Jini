import type { ComponentType } from "react";
import type { agentHandle } from "@jini-ai/core/agent-handles";
import type { resolveActiveTabId } from "@jini-ai/core/text";
import type { SourceControlTabBarProps } from "../../source-control/react/SourceControl.js";
import { OverviewTab, type OverviewTabProps } from "./OverviewTab.js";
import { DockerfileTab, type DockerfileTabProps } from "./DockerfileTab.js";
import { HistoryIcon, LayersIcon, OverviewIcon, StaticSiteIcon } from "./deployment-visuals.js";

/**
 * @file The Deployment panel (`/admin/deployment`) — four tabs: Overview, Static Site,
 * Dockerfile, History. Replaces the earlier `PlaceholderTabs` stub (Home/GitHub/AWS), which was
 * shaped for the self-hosted-developer audience while the panel's `soon`-scaffolded copy still
 * described the not-yet-built hosted-SaaS product — see `development/docs/deployment/
 * deployment-constraints.md` §9 for that history. The owner has since decided self-hosted-for-
 * developers ships first, which is what these four tabs are built for.
 *
 * `TabBar` (`@jini-ai/ui/tab-strip`), not `@jini-ai/ui`'s `SettingsDialogShell` — this is a
 * full-page screen, not a dialog-shaped surface. `SettingsDialogShell` bundles its own vertical
 * sidebar plus a kicker/title/subtitle header, which is the right shape for Settings' 13 tabs but
 * would fight this screen's own `.page-header` the same way `PlaceholderTabs`'s doc comment
 * describes a past `--page-flow` mismatch. `TabBar` is the horizontal, headerless primitive
 * `Pages.tsx`/`ThemeExplore.tsx`-adjacent screens already use for exactly this "one page, several
 * flat tabs" shape.
 *
 * `?tab=` deep-linking follows `SettingsUi.tsx`'s own pattern: `panels.tsx` passes `ctx.query.get
 * ("tab")` in as `tabId`, an unrecognized or absent value falls back to the first tab ("overview")
 * rather than rendering nothing, and switching tabs calls `navigate(..., { replace: true })` so the
 * URL stays a correct deep link without growing the back-button history one entry per click.
 *
 * Each tab is its own top-level component/file (`OverviewTab.tsx`, `StaticSiteTab.tsx`, etc.) — kept
 * separate from the start per this app's per-scope ESLint complexity gate, rather than one large
 * component with four inline branches.
 */

const DEPLOYMENT_TAB_IDS = ["overview", "static-site", "dockerfile", "history"] as const;
type DeploymentTabId = (typeof DEPLOYMENT_TAB_IDS)[number];

/** Falls back to the first tab for an absent or unrecognized `?tab=` value. Delegates to the
 *  shared `../../lib/resolve-active-tab-id` guard `Security.tsx`/`SourceControl.tsx`/
 *  `Database.tsx`/`Themes.tsx` all use — same reason `SettingsUi.tsx`'s `requestedTabId` and
 *  `WidgetInstanceEditor`'s `?type=` both apply their own guard (a stale link or a typo must not
 *  blank the panel). */
function resolveDeploymentTabId({ tabId, resolveActiveTabId }: { tabId: string | null | undefined; resolveActiveTabId: DeploymentProps["resolveActiveTabId"] }, _options = {}): DeploymentTabId {
  return resolveActiveTabId({ tabId: tabId, validIds: DEPLOYMENT_TAB_IDS, defaultId: "overview" });
}

/** Dispatches the one active tab's panel as a flat if-chain — same shape `ThemeExplore.tsx`'s
 *  `ThemeExploreMainPane`/`Database.tsx`'s `migrateForwardStep` use for the identical complexity-gate
 *  reason: a component's OWN cyclomatic/cognitive score counts a ternary or `&&` written directly in
 *  its JSX, not one delegated to a plain function like this.
 *  @complexity O(1) — four mutually exclusive branches, no iteration. */
function deploymentTabPanel(activeTabId: DeploymentTabId, { StaticSiteTab, HistoryTab, overview, dockerfile }: Pick<DeploymentProps, "StaticSiteTab" | "HistoryTab" | "overview" | "dockerfile">) {
  if (activeTabId === "overview") return <OverviewTab {...overview} />;
  if (activeTabId === "static-site") return <StaticSiteTab />;
  if (activeTabId === "dockerfile") return <DockerfileTab {...dockerfile} />;
  return <HistoryTab />;
}

export interface DeploymentProps {
  useAdminLocaleHook(): string;
  t(required: { locale: string; key: string }, optional?: Record<string, never>): string;
  onTabChange(required: { nextTabId: string }, optional?: Record<string, never>): void;
  TabBar: ComponentType<SourceControlTabBarProps>;
  StaticSiteTab: ComponentType;
  HistoryTab: ComponentType;
  overview: OverviewTabProps;
  dockerfile: DockerfileTabProps;
  agentHandle: typeof agentHandle;
  resolveActiveTabId: typeof resolveActiveTabId;
  lineIcon: { viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: "round"; strokeLinejoin: "round"; "aria-hidden": true };
  /** The `?tab=` query value from `panels.tsx`'s `deployment` route (`URLSearchParams.get` returns
   *  `null` when the param is absent). See {@link resolveDeploymentTabId}. */
  tabId?: string | null;
}

export function Deployment(props: DeploymentProps) {
  const { useAdminLocaleHook, t, onTabChange, TabBar, agentHandle, resolveActiveTabId, lineIcon } = props;
  // No hook file of its own — this shell owns no fetch/state (each tab owns its own), matching
  // `Database.tsx`'s own carve-out for a top-level screen with nothing to inject.
  const locale = useAdminLocaleHook();
  const activeTabId = resolveDeploymentTabId({ tabId: props.tabId, resolveActiveTabId });

  const tabs: SourceControlTabBarProps["tabs"] = [
    {
      id: "overview",
      label: t({ locale: locale, key: "Overview" }),
      icon: <OverviewIcon size={16} lineIcon={lineIcon} />,
      handle: "deployment-tab-overview",
      handleLabel: "Switch to the Overview tab — instance diagnostics and the Static vs. Full Site comparison",
    },
    {
      id: "static-site",
      label: t({ locale: locale, key: "Static Site" }),
      icon: <StaticSiteIcon size={16} lineIcon={lineIcon} />,
      handle: "deployment-tab-static-site",
      handleLabel: "Switch to the Static Site tab — export a read-only copy of this site's published pages",
    },
    {
      id: "dockerfile",
      label: t({ locale: locale, key: "Dockerfile" }),
      icon: <LayersIcon size={16} lineIcon={lineIcon} />,
      handle: "deployment-tab-dockerfile",
      handleLabel: "Switch to the Dockerfile tab — view, edit and save the repo-root Dockerfile",
    },
    {
      id: "history",
      label: t({ locale: locale, key: "History" }),
      icon: <HistoryIcon size={16} lineIcon={lineIcon} />,
      handle: "deployment-tab-history",
      handleLabel: "Switch to the History tab — past builds and deploys",
    },
  ];

  return (
    <div className="page">
      <div
        className="page-header"
        {...agentHandle({ handle: "deployment-header" }, {
          role: "region",
          label: "Deployment panel header — choose how this site gets published",
        })}
      >
        <div className="page-header-text">
          <p className="page-kicker">{t({ locale: locale, key: "Operations" })}</p>
          <h1 className="page-title">{t({ locale: locale, key: "Deployment" })}</h1>
          <p className="page-description">
            {t({ locale: locale, key: "Choose how this site gets published, and see what self-hosting it involves." })}
          </p>
        </div>
      </div>
      <TabBar
        ariaLabel={t({ locale: locale, key: "Deployment" })}
        tabs={tabs}
        activeId={activeTabId}
        onChange={(nextTabId) => onTabChange({ nextTabId })}
        containerHandle="deployment-tab-bar"
      />
      {deploymentTabPanel(activeTabId, props)}
    </div>
  );
}
