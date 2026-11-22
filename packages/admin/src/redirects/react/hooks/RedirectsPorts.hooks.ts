import { createContext, useContext } from 'react';
import { AdminConfigError } from '@jini-ai/core/admin-runtime';
import type { AdminRedirectsPort } from '../../../core/ports/redirects.js';
import type { RedirectsEventsPort } from '../../ports.js';
import type { UseAdminController } from '@jini-ai/core/contracts/admin-module';
export interface RedirectsPorts { readonly redirectsApi: AdminRedirectsPort; readonly redirectsEvents?: RedirectsEventsPort }
export const RedirectsPortsContext = createContext<RedirectsPorts | null>(null);
/** The module binding supplies scoped ports, never a process-global API client. */
export function useRedirectsPorts(_required: Record<string, never> = {}, _optional = {}): RedirectsPorts {
  const ports = useContext(RedirectsPortsContext);
  if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: redirects'] });
  return ports;
}
/** The controller hook the host injects through the module factory (owner answer 2026-11-17, J4:
 * injected, never imported). The factory's Provider supplies it; outside it a hook fails loudly. */
export const RedirectsControllerContext = createContext<UseAdminController | null>(null);
function controllerMissing(): never {
  throw new AdminConfigError({ issues: ['Controller hook unavailable: redirects'] });
}
export const useRedirectsController: UseAdminController = (required, optional = {}) => {
  const useController = useContext(RedirectsControllerContext) ?? controllerMissing;
  return useController(required, optional);
};
