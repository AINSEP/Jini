import { createContext, useContext, type ReactNode } from 'react';
import type { SecurityApiPort, OtherCredentialsPort, RootKeyPort } from '../../ports.js';
import { AdminConfigError } from '@jini-ai/core/admin-runtime';
import { englishSecurity, type SecurityTranslator } from '../../messages.en.js';
import type { DescribeRootKeyError, DescribeRootKeyRefusal } from '../../rules.js';
import type { RevealClipboard } from '../../controllers/root-key-reveal.js';
import type { SecurityRefreshSignal } from '../../ports.js';
import type { CredentialDraftError, DescribeCredentialError } from '../../credential-failure.js';
import type { OtherStoreLinks } from '../../other-credentials.rules.js';
export interface SecurityPorts { readonly securityApi: SecurityApiPort; readonly otherCredentials?: OtherCredentialsPort; readonly rootKey?: RootKeyPort }
const refuse = async (): Promise<never> => { throw new Error('Unavailable'); };
/** Stand-ins for optional ports the host did not supply. Hooks always run, so a tab still builds
 * its controller; these keep it inert: nothing to list, every other call refused. */
export const unavailableRootKey: RootKeyPort = { status: refuse, generate: refuse, importToken: refuse, previewStartFresh: refuse, startFresh: refuse };
export const noOtherCredentials: OtherCredentialsPort = { async list() { return []; }, replace: refuse, remove: refuse };
export const SecurityPortsContext = createContext<SecurityPorts | null>(null);
export function useSecurityPorts(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) { const ports = useContext(SecurityPortsContext); if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: security'] });
  return ports; }
/** The live host translator. The module Provider sets it, so a locale change relabels in place. */
export const SecurityTranslationContext = createContext<SecurityTranslator>(englishSecurity);
export function useSecurityTranslation(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): SecurityTranslator {
  return useContext(SecurityTranslationContext);
}
/** The host's owner account controls (for example authenticator, recovery and passkey settings).
 * The module Provider sets it; the page renders it once above its tabs. */
export const SecurityOwnerControlsContext = createContext<ReactNode>(null);
export function useSecurityOwnerControls(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): ReactNode {
  return useContext(SecurityOwnerControlsContext);
}
/** What the host supplies the root-key tab: its error code reader, approved copy per refusal code,
 * and the clipboard. Unset describers mean fixed copy; an unset clipboard makes Copy a silent no-op. */
export interface SecurityRootKeyHost {
  readonly describeError?: DescribeRootKeyError; readonly describeRefusal?: DescribeRootKeyRefusal; readonly clipboard?: RevealClipboard;
}
/** What the host supplies the credential controllers and views (SEC-13/14): deep links to each other
 * store's own screen, its content-refresh subscription, a publication callback for a credential change
 * made here, an actionable failure describer and a draft token check. Every field is optional. */
export interface SecurityCredentialsHost {
  readonly otherStores?: OtherStoreLinks; readonly refreshSignal?: SecurityRefreshSignal;
  readonly onCredentialsChanged?: (required: Record<string, never>, optional?: Record<string, never>) => void; readonly describeError?: DescribeCredentialError;
  readonly draftError?: CredentialDraftError;
}
export const SecurityCredentialsHostContext = createContext<SecurityCredentialsHost>({});
export function useSecurityCredentialsHost(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): SecurityCredentialsHost {
  return useContext(SecurityCredentialsHostContext);
}
export const SecurityRootKeyHostContext = createContext<SecurityRootKeyHost>({});
export function useSecurityRootKeyHost(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): SecurityRootKeyHost {
  return useContext(SecurityRootKeyHostContext);
}
