import { createContext, useContext } from 'react';
import type { SecurityApiPort, OtherCredentialsPort, RootKeyPort } from '../../ports.js';
import { AdminConfigError } from '../../../core/module/index.js';
export interface SecurityPorts { readonly securityApi: SecurityApiPort; readonly otherCredentials?: OtherCredentialsPort; readonly rootKey?: RootKeyPort }
const refuse = async (): Promise<never> => { throw new Error('Unavailable'); };
/** Stand-ins for optional ports the host did not supply. Hooks always run, so a tab still builds
 * its controller; these keep it inert: nothing to list, every other call refused. */
export const unavailableRootKey: RootKeyPort = { status: refuse, generate: refuse, importToken: refuse, previewStartFresh: refuse, startFresh: refuse };
export const noOtherCredentials: OtherCredentialsPort = { async list() { return []; }, replace: refuse, remove: refuse };
export const SecurityPortsContext = createContext<SecurityPorts | null>(null);
export function useSecurityPorts(_required: Record<string, never> = {}, _optional = {}) { const ports = useContext(SecurityPortsContext); if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: security'] }); return ports; }
