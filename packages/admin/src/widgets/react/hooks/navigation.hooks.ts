import { useCallback } from 'react';
import type { WidgetsNavigationPort } from '../../ports.js';
/** Adapt the existing shell port; absent navigation leaves normal anchors available. */
export function useWidgetsNavigate({ navigation, navigationBase }: { navigation?: WidgetsNavigationPort | undefined; navigationBase: string }, _optional: Record<string, never> = {}) {
  return useCallback((path: string, options?: { replace?: boolean }) => { navigation?.navigate({ base: navigationBase, routePath: path }, options); }, [navigation, navigationBase]);
}
