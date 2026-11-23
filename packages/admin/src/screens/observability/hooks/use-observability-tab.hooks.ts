import { useEffect, useRef } from "react";
import { useAdminKitValues, useTabbedDialog, type SettingsDialogTab } from "../../../react/kit.js";
import { navigate as navigateShell } from "../../../shell/lib/router.js";

/** Adapt Jini's tab owner to this page's URL and translated header copy.
 * Invalid or unavailable deep links use the shell's first tab; tab panels stay lazy.
 * @complexity O(n) in the bounded tab list, O(1) retained state.
 */
export function useObservabilityTab({ tabs, tabId }: {
  tabs: readonly SettingsDialogTab[]; tabId?: string | null;
}, { navigate = navigateShell }: { navigate?: typeof navigateShell } = {}) {
  const { findActiveTab, resolveInitialActiveTabId } = useAdminKitValues();
  const requestedTabId = resolveInitialActiveTabId({ tabs }, { initialTabId: tabId });
  const controller = useTabbedDialog({ tabs, initialActiveTabId: requestedTabId ?? undefined });
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
