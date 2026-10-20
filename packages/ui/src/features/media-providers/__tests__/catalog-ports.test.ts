import { createElement } from 'react';
import { MediaProvidersTab } from '../react/components/MediaProvidersTab.js';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DEFAULT_MEDIA_PROVIDER_CATALOG } from '../constants.js';
import { DEFAULT_BASE_URL_BY_PROTOCOL } from '../../execution/constants.js';
import { useMediaProvidersTab } from '../react/hooks/useMediaProvidersTab.js';
import type { MediaProviderCatalogPolicy, MediaProvidersPort } from '../ports.js';
import type { MediaProviderMap } from '../types.js';
import { findProvider, VENDOR_API_BASE_URLS, mediaProviderCatalogPolicy, DEFAULT_MEDIA_PROVIDER_CATALOG as VENDOR_MEDIA_CATALOG } from '@jini-ai/integrations/media-providers/catalog';

// The adapter implements the shared UI contract without a dependency on React or UI.
const vendorPolicy: MediaProviderCatalogPolicy = mediaProviderCatalogPolicy;
it('keeps vendor defaults explicit and generic defaults empty', () => {
  expect(DEFAULT_BASE_URL_BY_PROTOCOL.openai).toBe('');
  expect(DEFAULT_MEDIA_PROVIDER_CATALOG).toEqual([]);
  expect(VENDOR_MEDIA_CATALOG.find(entry => entry.id === 'nanobanana')?.defaultBaseUrl).toBe(VENDOR_API_BASE_URLS.google);
  expect(VENDOR_MEDIA_CATALOG.some(entry => entry.id === 'nano-banana')).toBe(false);
  for (const entry of VENDOR_MEDIA_CATALOG) expect(entry.defaultBaseUrl).toBe(findProvider({ id: entry.id })?.defaultBaseUrl);
});

// Real hook + port fake: legacy local/server ids normalize, and pending edits survive reload and save.
it('accepts old persisted ids through load, edits, reload and save', async () => {
  let saved: MediaProviderMap | undefined;
  const port: MediaProvidersPort = {
    fetchMediaProviders: async () => ({ 'nano-banana': { apiKeyConfigured: true } }),
    saveMediaProviders: async providers => { saved = providers; return { 'nano-banana': { apiKeyConfigured: true, model: providers.nanobanana?.model ?? '' } }; },
  };
  const { result, unmount } = renderHook(() => useMediaProvidersTab({ catalogPolicy: vendorPolicy, port, initialProviders: { 'nano-banana': { model: 'old' } } }));
  try {
    await waitFor(() => expect(result.current.load.status).toBe('ok'));
    expect(result.current.providers['nano-banana']).toBeUndefined();
    act(() => result.current.updateProvider('nano-banana', { model: 'new' }));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.load.status).toBe('ok'));
    expect(result.current.providers.nanobanana?.model).toBe('new');
    act(() => result.current.saveChanges());
    await waitFor(() => expect(result.current.save.status).toBe('saved'));
    expect(saved).toEqual({ nanobanana: { apiKeyConfigured: true, model: 'new' } });
    expect(result.current.providers).toEqual({ nanobanana: { apiKeyConfigured: true, model: 'new' } });
  } finally { unmount(); }
});


it('uses the host policy rather than imposing vendor aliases on another catalog', async () => {
  const catalogPolicy = {
    canonicalMediaProviderId: ({ id }: { id: string }) => id,
    normalizeMediaProviderMap: <T,>({ providers }: { providers: Readonly<Record<string, T>> }) => ({ ...providers }),
  };
  const port: MediaProvidersPort = {
    fetchMediaProviders: async () => null,
    saveMediaProviders: async providers => providers,
  };
  const { result, unmount } = renderHook(() => useMediaProvidersTab({
    port, catalogPolicy, initialProviders: { 'nano-banana': { model: 'host-model' } },
  }));
  try {
    await waitFor(() => expect(result.current.load.status).toBe('unreachable'));
    expect(result.current.providers).toEqual({ 'nano-banana': { model: 'host-model' } });
    act(() => result.current.updateProvider('nano-banana', { model: 'edited' }));
    expect([...result.current.pendingProviderIds]).toEqual(['nano-banana']);
    act(() => result.current.saveChanges());
    await waitFor(() => expect(result.current.save.status).toBe('saved'));
    expect(result.current.providers).toEqual({ 'nano-banana': { model: 'edited' } });
  } finally { unmount(); }
});

it('merges alias collisions with canonical precedence and preserves unknown providers', async () => {
  const extension = { apiKeyConfigured: true };
  const port: MediaProvidersPort = {
    fetchMediaProviders: async () => null,
    saveMediaProviders: async providers => providers,
  };
  const { result, unmount } = renderHook(() => useMediaProvidersTab({
    port, catalogPolicy: vendorPolicy,
    initialProviders: {
      nanobanana: { model: 'canonical' },
      'nano-banana': { model: 'stale-alias' },
      'host-extension': extension,
    },
  }));
  try {
    await waitFor(() => expect(result.current.load.status).toBe('unreachable'));
    expect(result.current.providers).toEqual({ nanobanana: { model: 'canonical' }, 'host-extension': extension });
    expect(result.current.providers['host-extension']).toBe(extension);
  } finally { unmount(); }
});

it('serializes alias edits and clears using the live canonical map for queued saves', async () => {
  const writes: Array<{ providers: MediaProviderMap; resolve: (saved: MediaProviderMap) => void }> = [];
  const port: MediaProvidersPort = {
    fetchMediaProviders: async () => ({ 'nano-banana': { apiKeyConfigured: true } }),
    saveMediaProviders: providers => new Promise(resolve => { writes.push({ providers, resolve }); }),
  };
  const { result, unmount } = renderHook(() => useMediaProvidersTab({ port, catalogPolicy: vendorPolicy }));
  try {
    await waitFor(() => expect(result.current.load.status).toBe('ok'));
    act(() => result.current.updateProvider('nano-banana', { model: 'first' }));
    act(() => result.current.saveChanges());
    expect(writes.map(write => write.providers)).toEqual([{ nanobanana: { apiKeyConfigured: true, model: 'first' } }]);
    act(() => result.current.updateProvider('nano-banana', { model: 'second' }));
    act(() => result.current.saveChanges());
    expect(writes).toHaveLength(1);
    await act(async () => writes[0]!.resolve({ 'nano-banana': { apiKeyConfigured: true, model: 'first' } }));
    expect(writes.map(write => write.providers)).toEqual([
      { nanobanana: { apiKeyConfigured: true, model: 'first' } },
      { nanobanana: { apiKeyConfigured: true, model: 'second' } },
    ]);
    act(() => result.current.clearProvider('nano-banana'));
    expect(writes).toHaveLength(2);
    await act(async () => writes[1]!.resolve({ 'nano-banana': { apiKeyConfigured: true, model: 'second' } }));
    expect(writes[2]!.providers).toEqual({});
    expect(result.current.providers).toEqual({});
    await act(async () => writes[2]!.resolve({}));
    expect(result.current.save.status).toBe('saved');
    expect(result.current.providers).toEqual({});
    expect([...result.current.pendingProviderIds]).toEqual([]);
  } finally { unmount(); }
});


it('uses the same policy for rendered catalog IDs, pinned IDs and credential state', async () => {
  const port: MediaProvidersPort = {
    fetchMediaProviders: async () => ({ 'nano-banana': { apiKeyConfigured: true, apiKeyTail: '4321' } }),
    saveMediaProviders: async providers => providers,
  };
  render(createElement(MediaProvidersTab, {
    port, catalogPolicy: vendorPolicy,
    catalog: [{ id: 'nano-banana', label: 'Banana' }, { id: 'extension', label: 'A Host Extension' }],
    pinnedProviderIds: ['nano-banana'], agentHandle: 'media',
  }));
  await screen.findByText('Saved (••••4321)');
  expect(screen.getByLabelText('Banana API key').getAttribute('data-agent-element')).toBe('media-nanobanana-api-key');
  const headings = screen.getAllByText(/^(Banana|A Host Extension)$/).map(element => element.textContent);
  expect(headings).toEqual(['Banana', 'A Host Extension']);
});
