import { createElement, type ComponentType, type ReactNode } from 'react';
import type { AdminInstance, AdminModuleUi, ModulePageProps, TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { securityModule } from '../security.module.js';
import { englishSecurity, type SecurityTranslator } from '../messages.en.js';
import { SecurityPortsContext, SecurityTranslationContext, SecurityOwnerControlsContext, SecurityRootKeyHostContext, SecurityCredentialsHostContext, type SecurityCredentialsHost } from './hooks/SecurityPorts.hooks.js';
import type { SecurityRefreshSignal } from '../ports.js';
import type { CredentialDraftError, DescribeCredentialError } from '../credential-failure.js';
import type { OtherStoreLinks } from '../other-credentials.rules.js';
import { loadAccessTokensTab, loadRootKeyTab, loadSecurityPage } from './bindings.js';
import type { SecurityTabIcons } from './hooks/SecurityPage.hooks.js';
import type { DescribeRootKeyError, DescribeRootKeyRefusal } from '../rules.js';
import type { RevealClipboard } from '../controllers/root-key-reveal.js';
export { useSecurityPorts, useSecurityTranslation, useSecurityOwnerControls } from './hooks/SecurityPorts.hooks.js';
export type { SecurityTranslator } from '../messages.en.js';
export type { SecurityTabIcons } from './hooks/SecurityPage.hooks.js';
export type { SecurityChipField, SecurityChipFieldProps, SecurityChipFieldOption } from './components/chip-field.js';
import type { SecurityChipField } from './components/chip-field.js';
export { useSecurityCredentialsHost, type SecurityCredentialsHost } from './hooks/SecurityPorts.hooks.js';
/** Root-key tab options, merged into that tab's params. Defaults are the stock behaviour:
 * generate shown, a preview required before start fresh, and no env-var name fallback.
 * `previewRequired: false` lets a failed preview still open the confirm step (DC-5); the exact
 * phrase is required either way. */
export interface SecurityRootKeyTabOptions {
  readonly generate?: 'shown' | 'hidden';
  readonly defaultEnvVarName?: string;
  readonly previewRequired?: boolean;
}
/** Access Tokens tab options, merged into that tab's params. `pluginsHref` is the host's own plugins page,
 * linked from the empty-hosting hint; omit it and the hint has no link. */
export interface SecurityAccessTokensTabOptions { readonly pluginsHref?: string }
export interface SecurityModuleOptions {
  readonly accessTokensTab?: SecurityAccessTokensTabOptions;
  readonly t?: SecurityTranslator;
  readonly rootKeyScopeNotice?: string;
  readonly rootKeyTab?: SecurityRootKeyTabOptions;
  readonly tabIcons?: SecurityTabIcons;
  /** Reads a failure's server code and public detail (for example from the host's API error). The
   * module reads only the code: never a `detail` or raw `Error.message`, which may echo the key. */
  readonly describeError?: DescribeRootKeyError;
  /** Approved, translated copy for a refusal code; `undefined` (or no describer) shows fixed copy. */
  readonly describeRefusal?: DescribeRootKeyRefusal;
  /** SEC-13: deep links to the screen that owns each other store (product routes stay in the host). */
  readonly otherStores?: OtherStoreLinks;
  /** SEC-14 (OD-3 d): the host's content-refresh subscription; both credential controllers reload on it. */
  readonly refreshSignal?: SecurityRefreshSignal;
  /** SEC-14: the host's publication callback for a credential change made on this page. */
  readonly onCredentialsChanged?: SecurityCredentialsHost['onCredentialsChanged'];
  /** SEC-14: actionable, translated copy for a failed credential write. Submitted secrets are cut out of it. */
  readonly describeCredentialError?: DescribeCredentialError;
  /** SEC-14: the host's draft token check (the host binds `credentialDraftError` to its validator and locale copy). */
  readonly credentialDraftError?: CredentialDraftError;
}
/** The host injects the renderer helpers; this module states the contract and imports no implementation. */
type ModuleUi<Page, Tab> = AdminModuleUi<Page, Tab, ComponentType<{ admin: AdminInstance; children: ReactNode }>>;
function rootKeyParams({ rootKeyScopeNotice, rootKeyTab = {} }: Pick<SecurityModuleOptions, 'rootKeyScopeNotice' | 'rootKeyTab'>, _optional: Record<string, never> = {}) {
  return { ...(rootKeyScopeNotice ? { scopeNotice: rootKeyScopeNotice } : {}), ...rootKeyTab };
}
function withRootKeyParams({ params }: { params: Readonly<Record<string, unknown>> }, _optional: Record<string, never> = {}) {
  const { pages } = securityModule, { tabs } = pages.secrets;
  return { ...securityModule, pages: { ...pages, secrets: { ...pages.secrets, tabs: { ...tabs, 'root-key': { ...tabs['root-key'], params } } } } };
}
/** One stable value per module, so the credential controllers are not rebuilt on every Provider render. */
function credentialsHostOf({ options: o }: { options: Pick<SecurityModuleOptions, 'otherStores' | 'refreshSignal' | 'onCredentialsChanged' | 'describeCredentialError' | 'credentialDraftError'> }, _optional: Record<string, never> = {}): SecurityCredentialsHost {
  return { ...(o.otherStores ? { otherStores: o.otherStores } : {}), ...(o.refreshSignal ? { refreshSignal: o.refreshSignal } : {}), ...(o.onCredentialsChanged ? { onCredentialsChanged: o.onCredentialsChanged } : {}), ...(o.describeCredentialError ? { describeError: o.describeCredentialError } : {}), ...(o.credentialDraftError ? { draftError: o.credentialDraftError } : {}) };
}
/** Merges the Access Tokens tab options into that tab's params (K3: the host's plugins page stays a host value). */
function withAccessTokensParams<M extends ReturnType<typeof withRootKeyParams>>({ module, params }: { module: M; params: Readonly<Record<string, unknown>> }, _optional: Record<string, never> = {}): M {
  const { pages } = module, { tabs } = pages.secrets;
  return { ...module, pages: { ...pages, secrets: { ...pages.secrets, tabs: { ...tabs, 'access-tokens': { ...tabs['access-tokens'], params } } } } };
}
/** One security module per admin scope. Tabs load on demand; host icons reach the page through its
 * lazy wrapper, and the host translator through a context so a locale change never remounts a tab.
 * `ChipField` (required, SEC-10/11) is the host's multiple-choice chip field for "Works for"; the module names no kit slot for it.
 * @example security({ ui: reactModuleUi, ChipField: HostChipField, clipboard: hostClipboard }, { rootKeyTab: { generate: 'hidden' }, tabIcons })
 */
export function security<Page, Tab>(
  { ui, ChipField, clipboard }: {
    ui: ModuleUi<Page, Tab>; ChipField: SecurityChipField;
    /** REQUIRED: the clipboard Copy writes to (the host binds its browser clipboard); Jini reads no ambient one. A denied write is silent. */
    clipboard: RevealClipboard;
  },
  { t = englishSecurity, rootKeyScopeNotice, rootKeyTab, tabIcons, describeError, describeRefusal, accessTokensTab, ...credentials }: SecurityModuleOptions = {},
) {
  // Scope membership uses object identity, so bind and return this same per-admin module.
  const module = withAccessTokensParams({ module: withRootKeyParams({ params: rootKeyParams({ ...(rootKeyScopeNotice ? { rootKeyScopeNotice } : {}), ...(rootKeyTab ? { rootKeyTab } : {}) }) }), params: { ...accessTokensTab } });
  const react = ui.bindReact({ module, views: { secrets: {
    page: () => loadSecurityPage({ tabIcons }),
    tabs: { 'access-tokens': () => loadAccessTokensTab({ ChipField }), 'root-key': () => loadRootKeyTab({}) },
  } } }, { context: SecurityPortsContext });
  const ScopeProvider = react.Provider;
  // One stable value per module, so the root-key controller is not rebuilt on every Provider render.
  const rootKeyHost = { ...(describeError ? { describeError } : {}), ...(describeRefusal ? { describeRefusal } : {}), clipboard };
  const credentialsHost = credentialsHostOf({ options: credentials });
  /** A live translator override keeps locale changes inside the existing scope: rebuilding the
   * module would remount the tabs and dispose their controllers.
   * `ownerControls` is the host's owner account settings, rendered once above the tabs while the
   * page is visible; it stays mounted across tab changes.
   * @example createElement(feature.react.Provider, { admin, t: hostTranslator, ownerControls, children })
   */
  function Provider({ admin, children, t: currentTranslation = t, ownerControls = null }: { admin: AdminInstance; children: ReactNode } & { t?: SecurityTranslator; ownerControls?: ReactNode }) {
    return createElement(SecurityTranslationContext.Provider, { value: currentTranslation },
      createElement(SecurityOwnerControlsContext.Provider, { value: ownerControls },
        createElement(SecurityRootKeyHostContext.Provider, { value: rootKeyHost },
          createElement(SecurityCredentialsHostContext.Provider, { value: credentialsHost }, createElement(ScopeProvider, { admin, children })))));
  }
  return Object.assign(module, { react: { ...react, Provider } });
}
