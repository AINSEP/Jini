import { createElement, type ComponentType, type ReactNode } from 'react';
import { render as renderOriginal, renderHook as renderHookOriginal, type RenderOptions } from '@testing-library/react';
import { AdminKitProvider } from '@jini-ai/admin/react/kit';
import { fakeAdminKit } from '@jini-ai/admin/react/testing-kit';
import { FetchQueryProvider } from '@jini-ai/ui/fetch-query';
import { UiKitProvider, type UiKit } from '@jini-ai/ui/react-kit';
import { SecretInput, useOverlayContainer, useSecretReveal } from '@jini-ai/ui-kit/react';
export * from '@testing-library/react';

// Wave B C9 made both kits injected: admin screens and ui selects/secret inputs throw without their provider at the root.
// ui gets the real ui-kit bindings (as ui's own support does); admin gets its plain-element fake kit.
const uiKit = { components: { SecretInput }, hooks: { useOverlayContainer, useSecretReveal } } satisfies UiKit;
const adminKit = fakeAdminKit();

/** Each rendered test tree owns one provider; rerenders retain it, independent tests do not. */
function scope(wrapper?: ComponentType<{ children: ReactNode }>) {
  return function QueryScope({ children }: { children: ReactNode }) {
    const inner = wrapper ? createElement(wrapper, { children }) : children;
    return createElement(UiKitProvider, {
      kit: uiKit,
      children: createElement(AdminKitProvider, { kit: adminKit, children: createElement(FetchQueryProvider, { children: inner }) }),
    });
  };
}
// Only the wrapper changes; retain Testing Library's query/container overloads.
export const render = ((ui: ReactNode, options?: RenderOptions) => renderOriginal(ui, { ...options, wrapper: scope(options?.wrapper) })) as typeof renderOriginal;
export const renderHook: typeof renderHookOriginal = (callback, options) => renderHookOriginal(callback, { ...options, wrapper: scope(options?.wrapper) });
