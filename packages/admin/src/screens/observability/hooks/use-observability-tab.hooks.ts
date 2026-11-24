import { useEffect, useRef } from "react";
import type { AdminKitHooks, AdminKitValues, SettingsDialogTab } from "../../../react/kit.js";

/** The host's route navigation, injected so this hook never imports a shell router. */
export type ObservabilityTabNavigate = (required: { routePath: string }, optional: { replace?: boolean }) => void;

/** Everything the page's tab adapter needs from its host; none of it is imported here. */
export interface ObservabilityTabArgs {
  tabs: readonly SettingsDialogTab[];
  tabId?: string | null | undefined;
  /** The host's tabbed-dialog state hook (the UI library's, bound in the host's kit). */
  useTabbedDialogHook: AdminKitHooks["useTabbedDialog"];
  /** The host's admin-kit values read; only the tab rules are used. */
  useAdminKitValuesHook: (required?: Record<string, never>, optional?: Record<string, never>) => Pick<AdminKitValues, "findActiveTab" | "resolveInitialActiveTabId">;
  /** The host's navigation; the tab change replaces the current history entry. */
  navigate: ObservabilityTabNavigate;
}

/** Adapt Jini's tab owner to this page's URL and translated header copy.
 * Invalid or unavailable deep links use the shell's first tab; tab panels stay lazy.
 * @complexity O(n) in the bounded tab list, O(1) retained state.
 */
export function useObservabilityTab({ tabs, tabId, useTabbedDialogHook, useAdminKitValuesHook, navigate }: ObservabilityTabArgs, _optional: Record<string, never> = {}) {
  const { findActiveTab, resolveInitialActiveTabId } = useAdminKitValuesHook();
  const requestedTabId = resolveInitialActiveTabId({ tabs }, { initialTabId: tabId });
  const controller = useTabbedDialogHook({ tabs, initialActiveTabId: requestedTabId ?? undefined });
  const selectRef = useRef(controller.setActiveTabId);
  selectRef.current = controller.setActiveTabId;
  useEffect(() => {
    if (requestedTabId !== null) selectRef.current(requestedTabId);
  }, [requestedTabId]);
  const activeTabId = resolveInitialActiveTabId({ tabs }, { initialTabId: controller.activeTabId });
  return {
    activeTabId: activeTabId ?? undefined,
    subtitle: findActiveTab({ tabs, activeTabId })?.subtitle,
    onTabChange: ({ nextTabId }: { nextTabId: string }, _optional = {}) => {
      controller.setActiveTabId(nextTabId);
      navigate({ routePath: `/observability?tab=${encodeURIComponent(nextTabId)}` }, { replace: true });
    },
  };
}
