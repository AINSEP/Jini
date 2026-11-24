import { createElement, type ComponentType } from 'react';
import type { ModulePageProps, TabViewProps } from '@jini-ai/core/contracts/admin-module';
import type { SecurityTabIcons } from './hooks/SecurityPage.hooks.js';
import type { SecurityChipField } from './components/chip-field.js';
import { useSecurityPorts, useSecurityTranslation, useSecurityOwnerControls, useSecurityRootKeyHost } from './hooks/SecurityPorts.hooks.js';
type TabbedPageProps = ModulePageProps<ComponentType<TabViewProps>>;
/** The module's view bindings. Views import no hook: each one (chrome, ports, controller) is bound
 * here and reaches the view as a required input, so a test or host can swap any of them. */
export async function loadSecurityPage({ tabIcons }: { tabIcons?: SecurityTabIcons | undefined }, _optional: Record<string, never> = {}) {
  const [{ SecurityPage }, { useSecurityPage }] = await Promise.all([import('./pages/SecurityPage.js'), import('./hooks/SecurityPage.hooks.js')]);
  const hooks = { useSecurityTranslationHook: useSecurityTranslation, useSecurityOwnerControlsHook: useSecurityOwnerControls };
  const useSecurityPageHook = (props: TabbedPageProps & { tabIcons?: SecurityTabIcons }) => useSecurityPage(props, hooks);
  return { default: (props: TabbedPageProps) => createElement(SecurityPage, { ...props, ...(tabIcons ? { tabIcons } : {}), useSecurityPageHook }) };
}
export async function loadRootKeyTab(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const [{ RootKeyTab }, { useRootKeyTab }, { useController }] = await Promise.all([import('./tabs/RootKeyTab.js'), import('./hooks/RootKeyTab.hooks.js'), import('../../core/react/use-controller.js')]);
  const hooks = { useSecurityPortsHook: useSecurityPorts, useSecurityTranslationHook: useSecurityTranslation, useRootKeyHostHook: useSecurityRootKeyHost, useControllerHook: useController };
  const useRootKeyTabHook = (props: TabViewProps) => useRootKeyTab(props, hooks);
  return { default: (props: TabViewProps) => createElement(RootKeyTab, { ...props, useRootKeyTabHook }) };
}
/** The Access Tokens tab with its view-model, editor and Shared Keys hooks bound as required inputs, and
 * the host's chip field (`ChipField`, a required feature-owned slot) passed through to the editor. */
export async function loadAccessTokensTab({ ChipField }: { ChipField: SecurityChipField }, _optional: Record<string, never> = {}) {
  const [{ AccessTokensTab }, { useAccessTokensTab }, { useCredentialEditor }, { useSharedKeysDialog }] = await Promise.all([import('./tabs/AccessTokensTab.js'), import('./hooks/AccessTokensTab.hooks.js'), import('./hooks/CredentialEditor.hooks.js'), import('./hooks/SharedKeysDialog.hooks.js')]);
  const hooks = { useAccessTokensTabHook: useAccessTokensTab, useCredentialEditorHook: useCredentialEditor, useSharedKeysDialogHook: useSharedKeysDialog };
  return { default: (props: TabViewProps) => createElement(AccessTokensTab, { ...props, ...hooks, ChipField }) };
}
