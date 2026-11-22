import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { SecurityApiPort, OtherCredentialsPort, RootKeyPort } from '../../ports.js';
import { englishSecurity, type SecurityTranslator } from '../../messages.en.js';
import type { DescribeRootKeyError } from '../../controllers/root-key.controller.js';
import { AdminConfigError } from '@jini-ai/core/admin-runtime';
export interface SecurityPorts { readonly securityApi: SecurityApiPort; readonly otherCredentials?: OtherCredentialsPort; readonly rootKey?: RootKeyPort }
const refuse = async (): Promise<never> => { throw new Error('Unavailable'); };
/** Stand-ins for optional ports the host did not supply. Hooks always run, so a tab still builds
 * its controller; these keep it inert: nothing to list, every other call refused. */
export const unavailableRootKey: RootKeyPort = { status: refuse, generate: refuse, importToken: refuse, previewStartFresh: refuse, startFresh: refuse };
export const noOtherCredentials: OtherCredentialsPort = { async list() { return []; }, replace: refuse, remove: refuse };
export const SecurityPortsContext = createContext<SecurityPorts | null>(null);
export function useSecurityPorts(_required: Record<string, never> = {}, _optional = {}) { const ports = useContext(SecurityPortsContext); if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: security'] });
  return ports; }
/** Host chrome for the page: its translator, and tab glyphs. A context
 * rather than module data, so a locale change re-renders in place instead of rebuilding the scope. */
export interface SecurityChrome {
  readonly t: SecurityTranslator;
  readonly tabIcons: Partial<Record<'access-tokens' | 'root-key', ReactNode>>;
  /** Rendered once above the tabs, only when the page itself is visible. */
  readonly ownerControls?: ReactNode;
  /** Reads a root-key refusal's public code and detail from the host's error type. */
  readonly describeRootKeyError?: DescribeRootKeyError;
}
export const SecurityChromeContext = createContext<SecurityChrome>({ t: englishSecurity, tabIcons: {} });
export function useSecurityChrome(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): SecurityChrome {
  return useContext(SecurityChromeContext);
}
