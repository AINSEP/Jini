/** TEST-ONLY: renders with the REAL ui-kit implementations bound into ui's kit, as Tovu binds them
 *  (apps/admin/src/integrations/jini-kits.ts `uiKit`). Moving tests to fake-ui-kit.tsx is R5's job. */
import { createElement, type ComponentType, type ReactNode } from 'react';
import { render as renderOriginal, renderHook as renderHookOriginal, type RenderOptions } from '@testing-library/react';
import { SecretInput, useOverlayContainer, useSecretReveal } from '@jini-ai/ui-kit/react';
import { UiKitProvider, type UiKit } from '@jini-ai/ui/react-kit';

export * from '@testing-library/react';

export const testUiKit = { components: { SecretInput }, hooks: { useOverlayContainer, useSecretReveal } } satisfies UiKit;

function scope(wrapper?: ComponentType<{ children: ReactNode }>) {
  return function UiKitScope({ children }: { children: ReactNode }) {
    return createElement(UiKitProvider, { kit: testUiKit, children: wrapper ? createElement(wrapper, { children }) : children });
  };
}

export const render = ((ui: ReactNode, options?: RenderOptions) => renderOriginal(ui, { ...options, wrapper: scope(options?.wrapper) })) as typeof renderOriginal;
export const renderHook: typeof renderHookOriginal = (callback, options) => renderHookOriginal(callback, { ...options, wrapper: scope(options?.wrapper) });
