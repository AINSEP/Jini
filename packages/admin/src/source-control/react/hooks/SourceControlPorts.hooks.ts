import { createContext, useContext } from 'react';
import type { SourceControlApiPort } from '../../ports.js';
import type { CredentialManagementPort } from '../../../contracts/credential-management.js';
import { AdminConfigError } from '@jini-ai/core/admin-runtime';
import type { UseAdminController } from '@jini-ai/core/contracts/admin-module';
export interface SourceControlPorts { readonly sourceControlApi: SourceControlApiPort; readonly sourceControlNavigation?: CredentialManagementPort }
export const SourceControlPortsContext = createContext<SourceControlPorts | null>(null);
export function useSourceControlPorts(_required: Record<string, never> = {}, _optional = {}) { const ports = useContext(SourceControlPortsContext); if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: source-control'] });
  return ports; }
/** The controller hook the host injects through the module factory (owner answer 2026-11-17, J4:
 * injected, never imported). The factory's Provider supplies it; outside it a hook fails loudly. */
export const SourceControlControllerContext = createContext<UseAdminController | null>(null);
function controllerMissing(): never {
  throw new AdminConfigError({ issues: ['Controller hook unavailable: source-control'] });
}
export const useSourceControlController: UseAdminController = (required, optional = {}) => {
  const useController = useContext(SourceControlControllerContext) ?? controllerMissing;
  return useController(required, optional);
};
