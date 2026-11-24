import { useCallback } from "react";
import type { AdminRestorePoint } from "../../core/ports/database.js";

import { resolveActiveTabId } from '@jini-ai/core/text';
const RECOVERY_TAB_IDS = ["restore-points", "restore"] as const;

/** The admin router's navigate, injected so this hook does not reach across into the shell. Pass a
 *  stable object (module-level const): the returned handlers are memoized on it. */
export interface RecoveryNavigationPort {
  navigate(target: { routePath: string }, options: { replace?: boolean }): void;
}

/** Navigation is a feature-local adapter: the shared Jini shell owns presentation, and the
 * Recovery route owns the selected restore point and URL. No create/restore API calls here. */
export function useRecoveryNavigation(
  { tabId, setSelected, port }: {
    tabId?: string | null | undefined;
    setSelected: (point: AdminRestorePoint | null) => void;
    port: RecoveryNavigationPort;
  },
  _options: Record<string, never> = {},
) {
  // A stale link or typo must open the list rather than blank the panel. Same shared guard
  // Database uses; the shell's controlled prop must never receive a raw query value.
  const activeTabId = resolveActiveTabId({ tabId: tabId, validIds: RECOVERY_TAB_IDS, defaultId: "restore-points" });
  const onTabChange = useCallback((nextTabId: string) => {
    const next = resolveActiveTabId({ tabId: nextTabId, validIds: RECOVERY_TAB_IDS, defaultId: "restore-points" });
    port.navigate({ routePath: `/recovery?tab=${next}` }, { replace: true });
  }, [port]);

  // Selecting a row and backing out both navigate explicitly, rather than deriving the active
  // tab from selected: the two sections remain independently reachable through ?tab=.
  const onSelectPoint = useCallback((point: AdminRestorePoint) => {
    setSelected(point);
    port.navigate({ routePath: "/recovery?tab=restore" }, { replace: true });
  }, [port, setSelected]);
  const onBackFromFlow = useCallback(() => {
    setSelected(null);
    port.navigate({ routePath: "/recovery?tab=restore-points" }, { replace: true });
  }, [port, setSelected]);

  return { activeTabId, onTabChange, onSelectPoint, onBackFromFlow };
}
