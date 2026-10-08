import { createContext, useContext } from 'react';
import { AdminConfigError } from '../../../core/module/index.js';
import type { AdminRedirectsPort } from '../../../core/ports/redirects.js';
import type { RedirectsEventsPort } from '../../ports.js';
export interface RedirectsPorts { readonly redirectsApi: AdminRedirectsPort; readonly redirectsEvents?: RedirectsEventsPort }
export const RedirectsPortsContext = createContext<RedirectsPorts | null>(null);
/** The module binding supplies scoped ports, never a process-global API client. */
export function useRedirectsPorts(_required: Record<string, never> = {}, _optional = {}): RedirectsPorts {
  const ports = useContext(RedirectsPortsContext);
  if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: redirects'] });
  return ports;
}
