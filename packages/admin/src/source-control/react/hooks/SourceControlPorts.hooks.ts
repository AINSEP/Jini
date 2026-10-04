import { createContext, useContext } from 'react';
import type { SourceControlApiPort } from '../../ports.js';
import type { CredentialManagementPort } from '../../../contracts/credential-management.js';
import { AdminConfigError } from '../../../core/module/index.js';
export interface SourceControlPorts { readonly sourceControlApi: SourceControlApiPort; readonly sourceControlNavigation?: CredentialManagementPort }
export const SourceControlPortsContext = createContext<SourceControlPorts | null>(null);
export function useSourceControlPorts(_required: Record<string, never> = {}, _optional = {}) { const ports = useContext(SourceControlPortsContext); if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: source-control'] }); return ports; }
