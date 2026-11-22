import { createElement, useEffect, useMemo, useRef, type ComponentType, type ReactNode } from 'react';
import { render as renderOriginal, renderHook as renderHookOriginal, type RenderOptions } from '@testing-library/react';
import { FetchQueryProvider, useCachedLoader, useFetchMutation, useFetchQuery, useFetchQueryScope, useInvalidate } from '@jini-ai/ui/fetch-query';
import { ConfirmDialog, useConfirmController } from '@jini-ai/ui-kit/react';
import { nativeKit, useNativeDialog } from '@jini-ai/ui-kit/react/native';
import { AdminKitProvider, type AdminKit } from '../../../react/kit.js';
import { useController } from '../../../core/react/use-controller.js';
import { AdminApiError } from '@jini-ai/core/admin-runtime';
import { createHttpFormsApi, createHttpFormsTrash, type FormsTransportPort } from '../../adapters/http.js';
import { createMemoryFormsApi } from '../../adapters/memory.js';
import { FormsControllerContext, FormsPortsContext, FormsOptionsContext, type FormsReactOptions } from '../hooks/FormsPorts.hooks.js';
import { translateForms } from '../../messages.en.js';
import { fakeFormsCatalog } from '../../__tests__/fakes/forms-catalog.js';

export { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
export { ApiError } from '../../__tests__/harness.js';

const formsKit: AdminKit = {
  components: {
    ...nativeKit, ConfirmDialog,
    InfoTip: ({ label }) => <span title={label} />,
    Lightbox: () => { throw new Error('Forms tests do not supply Lightbox'); },
    WidgetSelect: () => { throw new Error('Forms tests do not supply WidgetSelect'); },
    TabBar: () => { throw new Error('Forms tests do not supply TabBar'); },
    HtmlEditor: () => { throw new Error('Forms tests do not supply HtmlEditor'); },
    ErrorNotice: () => { throw new Error('Forms tests do not supply ErrorNotice'); },
    Icon: () => { throw new Error('Forms tests do not supply Icon'); },
  },
  hooks: {
    useAgentHandle: ({ agentHandle }) => agentHandle === false ? undefined : agentHandle ?? 'fake-handle',
    useDirtyGuard: ({ current, original }, options) => {
      const isDirty = original !== null && JSON.stringify(current) !== JSON.stringify(original);
      return { isDirty, confirmLeave: (_required = {}, { unsavedBeyondTracked = false } = {}) =>
        (!isDirty && !unsavedBeyondTracked) || (options?.host ?? window).confirm('You have unsaved changes. Leave without saving?') };
    },
    useSettlementGeneration: () => {
      const generation = useRef(0);
      return useMemo(() => ({ next: () => ++generation.current, isCurrent: ({ generation: value }: { generation: number }) => value === generation.current }), []);
    },
    useFocusTrap: ({ containerRef }, { active = true } = {}) => {
      useEffect(() => {
        const container = containerRef.current;
        if (!active || !container) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key !== 'Tab') return;
          const items = Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
          const edge = event.shiftKey ? items[0] : items[items.length - 1];
          if (!edge || document.activeElement !== edge) return;
          event.preventDefault();
          (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
        };
        container.addEventListener('keydown', onKeyDown);
        return () => container.removeEventListener('keydown', onKeyDown);
      }, [containerRef, active]);
    },
    useConfirmController, useNativeDialog,
    useT: () => { throw new Error('Forms tests do not supply useT'); },
  },
  query: { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate, useFetchQueryScope },
  get mediaProviders(): never { throw new Error('Forms tests do not supply mediaProviders'); },
  get theme(): never { throw new Error('Forms tests do not supply theme'); },
  get values(): never { throw new Error('Forms tests do not supply values'); },
  get chat(): never { throw new Error('Forms tests do not supply chat'); },
};

function scope(wrapper?: ComponentType<{ children: ReactNode }>) {
  return function FormsScope({ children }: { children: ReactNode }) {
    const inner = wrapper ? createElement(wrapper, { children }) : children;
    return <AdminKitProvider kit={formsKit}><FetchQueryProvider><FormsControllerContext.Provider value={useController}>{inner}</FormsControllerContext.Provider></FetchQueryProvider></AdminKitProvider>;
  };
}

export const render = ((ui: ReactNode, options?: RenderOptions) => renderOriginal(ui, { ...options, wrapper: scope(options?.wrapper) })) as typeof renderOriginal;
export const renderHook: typeof renderHookOriginal = (callback, options) => renderHookOriginal(callback, { ...options, wrapper: scope(options?.wrapper) });

export function FormsTestProvider({ children, options = {} }: { children: ReactNode; options?: FormsReactOptions }) {
  const ports = useMemo(() => {
    const transport: FormsTransportPort = {
      async request<T>({ path, method, body }: Parameters<FormsTransportPort['request']>[0], optional: Parameters<FormsTransportPort['request']>[1] = {}): Promise<T> {
        const response = await globalThis.fetch(`/api/admin/v1${path}`, {
          method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...optional,
        });
        const result = await response.json();
        if (!response.ok) throw new AdminApiError({ message: String(result.error ?? `request failed (${response.status})`), status: response.status }, { code: result.code, body: result });
        return result as T;
      },
      url: ({ path }) => `/api/admin/v1${path}`,
    };
    return {
      formsApi: { ...createHttpFormsApi({ transport, basePath: '/workspaces/workspace-local/forms' }), listFormProviders: async () => createMemoryFormsApi({}).listFormProviders!({}) },
      formsCatalog: fakeFormsCatalog(),
      formsTrash: createHttpFormsTrash({ transport, basePath: '/workspaces/workspace-local/trash/items' }),
      formsNavigation: { navigate: ({ base, routePath }: { base: string; routePath: string }) => window.history.pushState(null, '', `${base}${routePath}`) },
    };
  }, []);
  return <FormsPortsContext.Provider value={ports}><FormsOptionsContext.Provider value={options}>{children}</FormsOptionsContext.Provider></FormsPortsContext.Provider>;
}
/** Injected German fixture: these tests assert formatting/copy, not host dictionary wiring. */
export function germanT(key: string): string {
  return ({ 'Created / Updated': 'Erstellt / Aktualisiert', 'Created {created} · Updated {updated}': 'Erstellt {created} · Aktualisiert {updated}', 'Created {date}': 'Erstellt {date}', 'Updated {date}': 'Aktualisiert {date}' } as Record<string, string>)[key] ?? key;
}
export const t = ({ locale, key }: { locale: string; key: string }) => locale === 'de' ? germanT(key) : translateForms(key);
