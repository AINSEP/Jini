import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DEFAULT_MEDIA_PROVIDER_CATALOG } from '../constants.js';
import { DEFAULT_BASE_URL_BY_PROTOCOL } from '../../execution/constants.js';
import { useMediaProvidersTab } from '../react/hooks/useMediaProvidersTab.js';
import type { MediaProvidersPort } from '../ports.js';
import type { MediaProviderMap } from '../types.js';
import { findProvider, VENDOR_API_BASE_URLS } from '@jini-ai/integrations/media-providers/catalog';

// hwb #13: UI entries have canonical dispatch ids, and all endpoint defaults come from that owner.
it('projects the shared catalog into UI presets without divergent ids or endpoint values', () => {
  expect(DEFAULT_BASE_URL_BY_PROTOCOL.openai).toBe(VENDOR_API_BASE_URLS.openai);
  expect(DEFAULT_MEDIA_PROVIDER_CATALOG.find(entry => entry.id === 'nanobanana')?.defaultBaseUrl).toBe(VENDOR_API_BASE_URLS.google);
  expect(DEFAULT_MEDIA_PROVIDER_CATALOG.some(entry => entry.id === 'nano-banana')).toBe(false);
  for (const entry of DEFAULT_MEDIA_PROVIDER_CATALOG) expect(entry.defaultBaseUrl).toBe(findProvider({ id: entry.id })?.defaultBaseUrl);
});

// Real hook + port fake: legacy local/server ids normalize, and pending edits survive reload and save.
it('accepts old persisted ids through load, edits, reload and save', async () => {
  let saved: MediaProviderMap | undefined;
  const port: MediaProvidersPort = {
    fetchMediaProviders: async () => ({ 'nano-banana': { apiKeyConfigured: true } }),
    saveMediaProviders: async providers => { saved = providers; return { 'nano-banana': { apiKeyConfigured: true, model: providers.nanobanana?.model ?? '' } }; },
  };
  const { result, unmount } = renderHook(() => useMediaProvidersTab({ port, initialProviders: { 'nano-banana': { model: 'old' } } }));
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
