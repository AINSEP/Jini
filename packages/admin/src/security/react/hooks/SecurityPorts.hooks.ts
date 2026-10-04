import { createContext, useContext } from 'react';
import type { SecurityApiPort, OtherCredentialsPort, RootKeyPort } from '../../ports.js';
import { AdminConfigError } from '../../../core/module/index.js';
export interface SecurityPorts { readonly securityApi: SecurityApiPort; readonly otherCredentials?: OtherCredentialsPort; readonly rootKey?: RootKeyPort }
export const SecurityPortsContext = createContext<SecurityPorts | null>(null);
export function useSecurityPorts(_required: Record<string, never> = {}, _optional = {}) { const ports = useContext(SecurityPortsContext); if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: security'] }); return ports; }
