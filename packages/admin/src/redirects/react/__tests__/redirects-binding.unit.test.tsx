import { Suspense, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchQueryProvider } from '@jini-ai/ui/fetch-query';
import { createAdmin } from '../../../core/module/index.js';
import { AdminConfigError } from '../../../core/module/index.js';
import { AdminApiError } from '../../../core/transport/errors.js';
import type { AdminRedirectCreateInput, AdminRedirectsPort } from '../../../core/ports/redirects.js';
import { createMemoryRedirectsApi } from '../../adapters/memory.js';
import type { RedirectsEventsPort } from '../../ports.js';
import { translateRedirectsEn } from '../../messages.en.js';
import { redirectsModule } from '../../redirects.module.js';
import { redirects as redirectsFeature, useRedirects, useRedirectsPorts } from '../index.js';
import { RedirectsPortsContext } from '../hooks/RedirectsPorts.hooks.js';
import { RedirectsOptionsContext, useRedirectsOptions } from '../hooks/RedirectsOptions.hooks.js';
import { useWiredHitCountCell, useWiredImportRedirectsForm, useWiredRedirects } from '../hooks/wired.hooks.js';
import { HitCountCell } from '../components/HitCountCell.js';
import { ImportRedirectsForm } from '../components/ImportRedirectsForm.js';
import { RedirectsPage } from '../pages/RedirectsPage.js';

afterEach(cleanup);

type HitCountState = ReturnType<typeof useWiredHitCountCell>;
type ImportFormState = ReturnType<typeof useWiredImportRedirectsForm>;

const rule: AdminRedirectCreateInput = { matchType: 'exact', fromPattern: '/old', toTarget: '/new', statusCode: 301 };

async function seededApi(): Promise<AdminRedirectsPort> {
  const api = createMemoryRedirectsApi({});
  await api.createRedirect(rule);
  return api;
}

function mountListPage(api: AdminRedirectsPort, options?: Parameters<typeof redirectsFeature>[1], live?: Parameters<typeof redirectsFeature>[1]) {
  const feature = redirectsFeature({}, options);
  // The React binding scopes ports by the shared `redirectsModule` identity (the factory returns a
  // copy), so that singleton is what the host registers.
  const admin = createAdmin({ modules: [redirectsModule], ports: { redirectsApi: api } }, { permissions: ['admin.redirects.manage'] });
  const { Page, tabs } = feature.react.pages.list;
  return render(
    <FetchQueryProvider>
      <feature.react.Provider admin={admin} {...(live ? { options: live } : {})}>
        <Suspense fallback="loading">
          <Page tabs={tabs} description={admin.describe().pages[0]!} />
        </Suspense>
      </feature.react.Provider>
    </FetchQueryProvider>,
  );
}

describe('redirects React binding', () => {
  it('mounts the lazy list page and cancelling a delete keeps the rule', async () => {
    const api = await seededApi();
    const tombstone = vi.spyOn(api, 'tombstoneRedirect');
    mountListPage(api);
    expect(await screen.findByText('/old')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for redirect rule from "/old"' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByText('Delete the redirect rule from "/old"?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Delete the redirect rule from "/old"?')).toBeNull());
    expect(tombstone).not.toHaveBeenCalled();
    expect(screen.getByText('/old')).toBeInTheDocument();
  });

  it('prefers live host options over the factory defaults', async () => {
    const api = await seededApi();
    const live = (key: string, vars?: Record<string, string | number>) => key === 'From' ? 'Origin' : translateRedirectsEn(key, vars);
    mountListPage(api, { t: (key, vars) => translateRedirectsEn(key, vars) }, { t: live });
    expect(await screen.findByRole('columnheader', { name: 'Origin' })).toBeInTheDocument();
  });

  it('blocks the screen with the load error when the first list read fails', async () => {
    const api = await seededApi();
    api.listRedirects = () => Promise.reject(new AdminApiError({ message: 'redirects backend offline', status: 503 }));
    mountListPage(api);
    expect(await screen.findByText(/redirects backend offline/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

function scope({ api, events, children }: { api: AdminRedirectsPort; events?: RedirectsEventsPort; children: ReactNode }) {
  return (
    <FetchQueryProvider>
      <RedirectsPortsContext.Provider value={{ redirectsApi: api, ...(events ? { redirectsEvents: events } : {}) }}>
        {children}
      </RedirectsPortsContext.Provider>
    </FetchQueryProvider>
  );
}

describe('redirects wired hooks', () => {
  it('refetches the list whenever the host events port signals a change', async () => {
    const api = await seededApi();
    let notify: () => void = () => undefined;
    const unsubscribe = vi.fn();
    const events: RedirectsEventsPort = { subscribe: (listener) => { notify = listener; return unsubscribe; } };
    const { result, unmount } = renderHook(() => useWiredRedirects(), { wrapper: ({ children }) => scope({ api, events, children }) });
    await waitFor(() => expect(result.current.redirects).toHaveLength(1));
    await api.createRedirect({ ...rule, fromPattern: '/other' });
    act(() => notify());
    await waitFor(() => expect(result.current.redirects).toHaveLength(2));
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('labels each failed import item with its index and error code', async () => {
    const api = await seededApi();
    const { result } = renderHook(() => useWiredImportRedirectsForm({ t: translateRedirectsEn, locale: 'en' }), { wrapper: ({ children }) => scope({ api, children }) });
    expect(result.current.failedLabel({ index: 3, code: 'REDIRECT_VALIDATION_ERROR', message: 'bad' })).toBe('Item 3 (REDIRECT_VALIDATION_ERROR)');
  });

  it('refuses to run outside a redirects scope', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useRedirectsPorts())).toThrow(AdminConfigError);
    error.mockRestore();
  });

  it('resolves a create made before the controller mounts as not saved, without writing', async () => {
    const api = await seededApi();
    const create = vi.spyOn(api, 'createRedirect');
    let firstRender: ReturnType<typeof useRedirects> | undefined;
    renderHook(() => { const state = useRedirects({ api }); firstRender ??= state; return state; }, { wrapper: ({ children }) => scope({ api, children }) });
    const form = new FormData(); form.set('fromPattern', '/x'); form.set('toTarget', '/y');
    await expect(firstRender!.createRedirect(form)).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('routes localized messages through the host slot when one is supplied', () => {
    const renderMessage = vi.fn(({ key }: { key: string }) => `host:${key}`);
    const { result } = renderHook(() => useRedirectsOptions(), {
      wrapper: ({ children }) => <RedirectsOptionsContext.Provider value={{ slots: { renderMessage } }}>{children}</RedirectsOptionsContext.Provider>,
    });
    expect(result.current.renderMessage({ key: 'importRulesLabel' })).toBe('host:importRulesLabel');
    expect(result.current.locale).toBe('en');
  });

  it('renders the English delete body even when no pattern variable is supplied', () => {
    const { result } = renderHook(() => useRedirectsOptions(), {
      wrapper: ({ children }) => <RedirectsOptionsContext.Provider value={{}}>{children}</RedirectsOptionsContext.Provider>,
    });
    render(<>{result.current.renderMessage({ key: 'deleteRedirectBody' })}</>);
    expect(screen.getByText('Delete the redirect rule from ""?')).toBeInTheDocument();
  });
});

describe('redirects leaf components', () => {
  it('shows a hit-count load failure instead of the load button', () => {
    const useHitCountCellHook = (): HitCountState => ({ error: new AdminApiError({ message: 'hits unavailable', status: 500 }), data: undefined, isFetching: false, request: vi.fn(), t: translateRedirectsEn });
    render(<HitCountCell redirectId="r1" t={translateRedirectsEn} useHitCountCellHook={useHitCountCellHook} />);
    expect(screen.getByText(/hits unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('tags the lazy hits button with the row handle so an agent can load one row', () => {
    const request = vi.fn();
    const useHitCountCellHook = (): HitCountState => ({ error: null, data: undefined, isFetching: false, request, t: translateRedirectsEn });
    render(<HitCountCell redirectId="r1" t={translateRedirectsEn} agentHandleBase="redirects-row-r1" useHitCountCellHook={useHitCountCellHook} />);
    const button = screen.getByRole('button', { name: 'Load hits' });
    expect(button).toHaveAttribute('data-agent-element', 'redirects-row-r1-load-hits');
    fireEvent.click(button);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('leaves the hits button untagged when the row has no handle base', () => {
    const useHitCountCellHook = (): HitCountState => ({ error: null, data: undefined, isFetching: false, request: vi.fn(), t: translateRedirectsEn });
    render(<HitCountCell redirectId="r1" t={translateRedirectsEn} useHitCountCellHook={useHitCountCellHook} />);
    expect(screen.getByRole('button', { name: 'Load hits' })).not.toHaveAttribute('data-agent-element');
  });

  it('renders rows whose injected state carries no agent handles without tagging their hits buttons', async () => {
    const api = await seededApi();
    const useRedirectsHook = () => ({ ...useWiredRedirects(), rowMenuHandles: [] });
    render(scope({ api, children: <RedirectsPage useRedirectsHook={useRedirectsHook} /> }));
    expect(await screen.findByText('/old')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load hits' })).not.toHaveAttribute('data-agent-element');
  });

  it('reports an import parse error and lists each failed item without a created list', () => {
    const failedLabel = (failure: { index: number; code: string }) => `Item ${failure.index} (${failure.code})`;
    const useImportRedirectsFormHook = (): ImportFormState => ({
      raw: '[]', error: 'Rules must be a JSON array', importing: false, submit: vi.fn(async () => undefined), changeRaw: vi.fn(),
      setRaw: vi.fn(), t: translateRedirectsEn, locale: 'en',
      rulesLabel: 'Rules', resultSummary: '0 created, 1 failed.', createdText: 'Created', failedLabel,
      result: { created: [], failed: [{ index: 0, code: 'REDIRECT_VALIDATION_ERROR', message: 'regex is not supported' }] },
    });
    render(<ImportRedirectsForm t={translateRedirectsEn} locale="en" useImportRedirectsFormHook={useImportRedirectsFormHook} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Rules must be a JSON array');
    expect(screen.getByText('0 created, 1 failed.')).toBeInTheDocument();
    expect(screen.getByText('Item 0 (REDIRECT_VALIDATION_ERROR)')).toBeInTheDocument();
    expect(screen.getByText(/regex is not supported/)).toBeInTheDocument();
    expect(screen.queryByText('Created')).toBeNull();
  });
});
