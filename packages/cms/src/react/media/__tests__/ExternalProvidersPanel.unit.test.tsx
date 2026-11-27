import { createContext, useContext, type ComponentProps } from 'react';
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ExternalProvidersPanel } from '../ExternalProvidersPanel.js';

type Props = Parameters<typeof ExternalProvidersPanel>[0];
type ProviderProps = ComponentProps<Props['kit']['I18nProvider']>;
type TabProps = ComponentProps<Props['kit']['MediaProvidersTab']>;

it('shows only host-supplied providers when the catalog arrives and localizes them within the host theme', () => {
  const settingsLocale = createContext('unbound');
  const I18nProvider = vi.fn(({ initialLocale, children }: ProviderProps) =>
    <settingsLocale.Provider value={initialLocale}>{children}</settingsLocale.Provider>);
  const MediaProvidersTab = vi.fn(({ catalog }: TabProps) => {
    const locale = useContext(settingsLocale);
    return <ul aria-label={locale === 'fr' ? 'Fournisseurs' : 'Providers'}>{catalog.map(provider => <li key={provider.id}>{provider.label}</li>)}</ul>;
  });
  const fetchMediaProviders = async () => ({});
  const saveMediaProviders = async () => ({});
  const mediaProvidersPort = { fetchMediaProviders, saveMediaProviders };
  const mediaProviderCatalogPolicy: Props['mediaProviderCatalogPolicy'] = {
    canonicalMediaProviderId: ({ id }) => id,
    normalizeMediaProviderMap: ({ providers }) => ({ ...providers }),
  };
  const useAdminThemeBoundaryHook = vi.fn(() => ({ 'data-theme': 'glass', 'data-color-scheme': 'dark' }));
  const pinnedProviderIds = ['studio'];
  const dictionaries = { fr: { Providers: 'Fournisseurs' } };
  const props = { locale: 'fr', useAdminThemeBoundaryHook, mediaProvidersPort, mediaProviderCatalogPolicy, pinnedProviderIds,
    kit: { I18nProvider, MediaProvidersTab, SETTINGS_DIALOG_DICTIONARIES: dictionaries } };
  const view = render(<ExternalProvidersPanel {...props} catalog={null} />);
  expect(view.getByRole('list', { name: 'Fournisseurs' }).closest('.media-providers-panel')).toHaveAttribute('data-color-scheme', 'dark');
  expect(view.queryAllByRole('listitem')).toEqual([]);
  expect(MediaProvidersTab.mock.calls.map(([given]) => given)).toEqual([
    { port: mediaProvidersPort, catalog: [], catalogPolicy: mediaProviderCatalogPolicy, pinnedProviderIds },
  ]);

  const catalog = [{ id: 'studio', label: 'Studio photo' }, { id: 'narrator', label: 'Studio audio' }];
  view.rerender(<ExternalProvidersPanel {...props} catalog={catalog} />);
  expect(view.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Studio photo', 'Studio audio']);
  expect(MediaProvidersTab.mock.calls.at(-1)?.[0]).toEqual({ port: mediaProvidersPort, catalog, catalogPolicy: mediaProviderCatalogPolicy, pinnedProviderIds });
  expect(I18nProvider.mock.calls.at(-1)?.[0]).toMatchObject({
    initialLocale: 'fr', dictionaries, fallbackLocale: 'en', syncDocumentAttributes: false,
  });
  expect(useAdminThemeBoundaryHook.mock.calls).toEqual([[{}, {}], [{}, {}]]);
});
