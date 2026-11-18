import { FormsControllerContext } from '../hooks/FormsPorts.hooks.js';
import { useController } from '../../../core/react/use-controller.js';
import { createFormCollectionRegistry, describeFormCollectionProviders } from '@jini-ai/cms/forms';
import { useMemo, type ReactNode } from 'react';
import { FetchQueryProvider } from '@jini-ai/ui/fetch-query';
import { createHttpTransport } from '../../../core/transport/http.js';
import { AdminApiError } from '@jini-ai/core/admin-runtime';
import { createAdminShellNavigation } from '../../../browser/shell-navigation.js';
import { createHttpFormsApi, createHttpFormsTrash, type FormsTransportPort } from '../../adapters/http.js';
import { FormsPortsContext, FormsOptionsContext } from '../hooks/FormsPorts.hooks.js';
import type { FormsReactOptions } from '../hooks/FormsPorts.hooks.js';
import { translateForms } from '../../messages.en.js';
import { fakeFormsCatalog } from '../../__tests__/fakes/forms-catalog.js';
/** Constructor bridge is test harness only, retaining the original error assertions. */
export class ApiError extends AdminApiError {
  constructor(message: string, status: number, code?: string, body?: Record<string, unknown>) {
    super({ message, status }, { code, body });
  }
}
export function FormsTestProvider({ children, options = {} }: { children: ReactNode; options?: FormsReactOptions }) {
  const ports = useMemo(() => {
    const host = createHttpTransport({ baseUrl: '/api/admin/v1', fetch: ({ url }, init) => globalThis.fetch(url, init) });
    const transport: FormsTransportPort = {
      request: ({ path, method, body }, optional = {}) => host.request({ path }, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...optional }),
      url: ({ path }) => `/api/admin/v1${path}`,
    };
    return { formsApi: { ...createHttpFormsApi({ transport, basePath: '/workspaces/workspace-local/forms' }), listFormProviders: async () => describeFormCollectionProviders({ providers: createFormCollectionRegistry({}) }) }, formsCatalog: fakeFormsCatalog(), formsTrash: createHttpFormsTrash({ transport, basePath: '/workspaces/workspace-local/trash/items' }), formsNavigation: createAdminShellNavigation({ location: window.location, window, document }) };
  }, []);
  return <FetchQueryProvider><FormsControllerContext.Provider value={useController}><FormsPortsContext.Provider value={ports}><FormsOptionsContext.Provider value={options}>{children}</FormsOptionsContext.Provider></FormsPortsContext.Provider></FormsControllerContext.Provider></FetchQueryProvider>;
}
/** Injected German fixture: these tests assert formatting/copy, not host dictionary wiring. */
export function germanT(key: string): string {
  return ({ 'Created / Updated': 'Erstellt / Aktualisiert', 'Created {created} · Updated {updated}': 'Erstellt {created} · Aktualisiert {updated}', 'Created {date}': 'Erstellt {date}', 'Updated {date}': 'Aktualisiert {date}' } as Record<string, string>)[key] ?? key;
}
export const t = ({ locale, key }: { locale: string; key: string }) => locale === 'de' ? germanT(key) : translateForms(key);
