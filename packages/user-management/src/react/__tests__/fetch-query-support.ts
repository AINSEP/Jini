import { createElement, type ComponentType, type ReactNode } from 'react';
import { render as renderOriginal, renderHook as renderHookOriginal, type RenderOptions } from '@testing-library/react';
import { AdminKitProvider } from '@jini-ai/admin/react/kit';
import { fakeAdminKit } from '@jini-ai/admin/react/testing-kit';
import { RowMenu, ConfirmDialog as AdminConfirmDialog } from '@jini-ai/admin/react';
import { SecretInput as UiSecretInput } from '@jini-ai/ui';
import { InfoTip } from '@jini-ai/ui/admin-widgets';
import { FetchQueryProvider, useCachedLoader, useFetchMutation, useFetchQuery, useFetchQueryScope, useInvalidate } from '@jini-ai/ui/fetch-query';
import { useAsyncAction } from '@jini-ai/ui/panel-kit';
import { UiKitProvider, type UiKit } from '@jini-ai/ui/react-kit';
import { SecretInput, useOverlayContainer, useSecretReveal } from '@jini-ai/ui-kit/react';
import { UserManagementKitProvider, type UserManagementKit } from '../kit.js';
export * from '@testing-library/react';

// Wave B C9 made both kits injected: admin screens and ui selects/secret inputs throw without their provider at the root.
// ui gets the real ui-kit bindings (as ui's own support does); admin gets its plain-element fake kit.
const uiKit = { components: { SecretInput }, hooks: { useOverlayContainer, useSecretReveal } } satisfies UiKit;
// query is ui's real fetch-query binding (as a host wires it), so hooks still fetch under FetchQueryProvider instead of the fake's canned data.
const adminKit = fakeAdminKit({ query: { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate, useFetchQueryScope } });

// The host's own binding (Tovu's `userManagementKit`): the real ui/admin implementations, so a test rendered through
// this file is an integration test of the page over the real components. Pure page tests use `renderWithUmKit` and the fake.
// `ConfirmDialog` is admin's (body, confirmLabel, tone); `SecretInput` is ui's i18n-aware wrapper, not ui-kit's.
export const realUmKit: UserManagementKit = {
  components: { SecretInput: UiSecretInput, InfoTip, RowMenu, ConfirmDialog: AdminConfirmDialog },
  hooks: { useFetchQuery, useFetchMutation, useAsyncAction, useCachedLoader, useInvalidate },
};

/** Each rendered test tree owns one provider; rerenders retain it, independent tests do not. */
function scope(wrapper?: ComponentType<{ children: ReactNode }>) {
  return function QueryScope({ children }: { children: ReactNode }) {
    const inner = wrapper ? createElement(wrapper, { children }) : children;
    return createElement(UiKitProvider, {
      kit: uiKit,
      children: createElement(AdminKitProvider, { kit: adminKit, children: createElement(FetchQueryProvider, {
        children: createElement(UserManagementKitProvider, { kit: realUmKit, children: inner }) }) }),
    });
  };
}
// Only the wrapper changes; retain Testing Library's query/container overloads.
export const render = ((ui: ReactNode, options?: RenderOptions) => renderOriginal(ui, { ...options, wrapper: scope(options?.wrapper) })) as typeof renderOriginal;
export const renderHook: typeof renderHookOriginal = (callback, options) => renderHookOriginal(callback, { ...options, wrapper: scope(options?.wrapper) });
