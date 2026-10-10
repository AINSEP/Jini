import { createElement, type ComponentType, type ReactNode } from 'react';
import { render as renderOriginal, renderHook as renderHookOriginal, type RenderOptions } from '@testing-library/react';
import { FetchQueryProvider } from '@jini-ai/ui/fetch-query';
export * from '@testing-library/react';

/** Each rendered test tree owns one provider; rerenders retain it, independent tests do not. */
function scope(wrapper?: ComponentType<{ children: ReactNode }>) {
  return function QueryScope({ children }: { children: ReactNode }) {
    return createElement(FetchQueryProvider, { children: wrapper ? createElement(wrapper, { children }) : children });
  };
}
// Only the wrapper changes; retain Testing Library's query/container overloads.
export const render = ((ui: ReactNode, options?: RenderOptions) => renderOriginal(ui, { ...options, wrapper: scope(options?.wrapper) })) as typeof renderOriginal;
export const renderHook: typeof renderHookOriginal = (callback, options) => renderHookOriginal(callback, { ...options, wrapper: scope(options?.wrapper) });
