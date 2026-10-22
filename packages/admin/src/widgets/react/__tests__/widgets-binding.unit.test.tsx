import { Suspense } from 'react';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchQueryProvider } from '@jini-ai/ui/fetch-query';
import { createAdmin } from '../../../core/module/index.js';
import { AdminApiError } from '../../../core/transport/errors.js';
import { createMemoryWidgetsApi, type MemoryWidgetsSeed } from '../../adapters/memory.js';
import type { AdminWidgetsPort } from '../../ports.js';
import type { AdminWidget } from '../../models.js';
import { widgets, useWidgetsOptions, useWidgetsPorts, type WidgetsModulePageProps } from '../index.js';
import { staleVersionMessage as instanceStaleMessage } from '../hooks/use-widget-instance-editor.hooks.js';
import { staleVersionMessage as regionStaleMessage } from '../hooks/use-widget-region-editor.hooks.js';
import { widgetTypes, defaultConfig } from './fixtures/catalog.js';

afterEach(cleanup);

/** The lazy page modules are large; their first dynamic import can outlast the default wait. */
const LAZY = { timeout: 15000 };

const widget: AdminWidget = { id: 'w1', workspaceId: 'fake-ws', slug: 'footer-text', title: 'Footer text', status: 'active', widgetType: 'text', config: { body: 'hi' }, updatedAt: 'then', version: 1 };
const slots = {
  ConfigFields: ({ widgetType }: { widgetType: string }) => <p>{`config for ${widgetType}`}</p>,
  AddControl: ({ triggerLabel }: { triggerLabel: string }) => <button type="button">{triggerLabel}</button>,
};

function mount({ api, page, props }: { api: AdminWidgetsPort; page: 'library' | 'editor' | 'regions' | 'region'; props: Partial<WidgetsModulePageProps> }) {
  const feature = widgets({ slots, widgetTypes, defaultConfig });
  const admin = createAdmin({ modules: [feature], ports: { widgetsApi: api } });
  const description = admin.describe().pages.find(p => p.id.endsWith(`.${page}`))!;
  const { Page, tabs } = feature.react.pages[page];
  render(
    <FetchQueryProvider>
      <feature.react.Provider admin={admin}>
        <Suspense fallback="loading">
          <Page tabs={tabs} description={description} {...props} />
        </Suspense>
      </feature.react.Provider>
    </FetchQueryProvider>,
  );
}

function memory(seed: MemoryWidgetsSeed = {}) {
  return createMemoryWidgetsApi({ widgets: [widget], ...seed });
}

describe('widgets module pages', { timeout: 30000 }, () => {
  it('opens the editor from route params and lists every place the widget is used', async () => {
    const whereUsed = { w1: { count: 2, references: [{ kind: 'region', sourceEntryId: 'area-1', fieldPath: 'p' }, { kind: 'embed', sourceEntryId: 'post-9', fieldPath: 'body' }] } };
    mount({ api: memory({ whereUsed }), page: 'editor', props: { params: { widgetId: 'w1' } } });
    expect(await screen.findByText('Used in 2 places:', {}, LAZY)).toBeInTheDocument();
    expect(screen.getByText(/Region area \(area-1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Inline embed \(post-9\)/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit widget' })).toBeInTheDocument();
  });

  it('shows no usage banner for a widget used nowhere', async () => {
    mount({ api: memory({ whereUsed: { w1: { count: 0, references: [] } } }), page: 'editor', props: { widgetId: 'w1' } });
    expect(await screen.findByRole('heading', { name: 'Edit widget' }, LAZY)).toBeInTheDocument();
    expect(screen.queryByText(/Used in/)).toBeNull();
  });

  it('lists bound regions on the regions page', async () => {
    const regions = [{ workspaceId: 'fake-ws', regionKey: 'footer', areaEntryId: 'a1', updatedAt: 'then', placementCount: 2 }];
    mount({ api: memory({ regions }), page: 'regions', props: {} });
    expect(await screen.findByText('footer', {}, LAZY)).toBeInTheDocument();
  });

  it('opens the editor from a direct widget id and words a single use in the singular', async () => {
    const whereUsed = { w1: { count: 1, references: [{ kind: 'region', sourceEntryId: 'area-1', fieldPath: 'p' }] } };
    mount({ api: memory({ whereUsed }), page: 'editor', props: { widgetId: 'w1' } });
    expect(await screen.findByText('Used in 1 place:', {}, LAZY)).toBeInTheDocument();
  });

  it('starts a new widget from a type param and shows the pending save', async () => {
    const api = memory();
    api.createWidget = () => new Promise(() => undefined);
    mount({ api, page: 'editor', props: { params: { widgetType: 'text' } } });
    expect(await screen.findByRole('heading', { name: 'New widget' }, LAZY)).toBeInTheDocument();
    expect(screen.queryByText(/Used in/)).toBeNull();
    // Interact only once the editor controller has mounted and seeded the type's default config.
    await screen.findByText('config for text');
    fireEvent.change(screen.getByPlaceholderText('Widget title'), { target: { value: 'Promo' } });
    await waitFor(() => expect(screen.getByPlaceholderText('Widget title')).toHaveValue('Promo'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
  });

  it('starts a new widget from a direct type prop', async () => {
    mount({ api: memory(), page: 'editor', props: { widgetType: 'text' } });
    expect(await screen.findByRole('heading', { name: 'New widget' }, LAZY)).toBeInTheDocument();
  });

  it('asks for a widget type when neither an id nor a type is supplied', async () => {
    mount({ api: memory(), page: 'editor', props: {} });
    expect(await screen.findByText('No widget type specified.', {}, LAZY)).toBeInTheDocument();
  });

  it('shows the load error, after a loading notice, when the widget cannot be read', async () => {
    const api = memory();
    let fail!: (error: Error) => void;
    api.getWidget = () => new Promise((_, reject) => { fail = reject; });
    mount({ api, page: 'editor', props: { widgetId: 'w1' } });
    expect(await screen.findByText('Loading widget…', {}, LAZY)).toBeInTheDocument();
    fail(new AdminApiError({ message: 'widget store offline', status: 503 }));
    expect(await screen.findByText(/widget store offline/)).toBeInTheDocument();
  });

  it('blocks the library with the first-load error', async () => {
    const api = memory();
    api.listWidgets = () => Promise.reject(new AdminApiError({ message: 'library offline', status: 503 }));
    mount({ api, page: 'library', props: {} });
    expect(await screen.findByText(/library offline/, {}, LAZY)).toBeInTheDocument();
  });

  it('loads the region named by route params, a direct prop, or none', async () => {
    for (const [props, expected] of [[{ params: { regionKey: 'footer' } }, 'footer'], [{ regionKey: 'sidebar' }, 'sidebar'], [{}, '']] as const) {
      const api = memory();
      const read = vi.spyOn(api, 'getWidgetRegion');
      mount({ api, page: 'region', props });
      await waitFor(() => expect(read).toHaveBeenCalledWith({ regionKey: expected }), LAZY);
      cleanup();
    }
  });
});

describe('widgets React scope', () => {
  it('refuses to resolve ports or options outside a widgets scope', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useWidgetsPorts())).toThrow('React scope unavailable: widgets');
    expect(() => renderHook(() => useWidgetsOptions())).toThrow('React options unavailable: widgets');
    error.mockRestore();
  });

  it('words stale-version conflicts in English by default or through the host translator', () => {
    expect(instanceStaleMessage()).toBe('This widget changed since you loaded it, refresh and try again.');
    expect(regionStaleMessage()).toBe('This region changed since you loaded it, refresh and try again.');
    expect(instanceStaleMessage({ t: key => `fr:${key}` })).toBe('fr:This widget changed since you loaded it, refresh and try again.');
  });
});
