import { describe, expect, it } from 'vitest';
import * as MediaProvidersBarrel from '../index.js';

describe('media-providers tab barrel', () => {
  it('exports the rules functions', () => {
    expect(typeof MediaProvidersBarrel.hasAnyConfiguredProvider).toBe('function');
    expect(typeof MediaProvidersBarrel.hasRecoverableFields).toBe('function');
    expect(typeof MediaProvidersBarrel.isEntryEmpty).toBe('function');
    expect(typeof MediaProvidersBarrel.isEntryPresent).toBe('function');
    expect(typeof MediaProvidersBarrel.isMarkerOnlyEntry).toBe('function');
    expect(typeof MediaProvidersBarrel.maskedKeyLabel).toBe('function');
    expect(typeof MediaProvidersBarrel.mergeDaemonProviders).toBe('function');
    expect(typeof MediaProvidersBarrel.resolveProviderBaseUrl).toBe('function');
    expect(typeof MediaProvidersBarrel.shouldSyncLocalProvidersToDaemon).toBe('function');
    expect(typeof MediaProvidersBarrel.sortProvidersByConfigured).toBe('function');
  });

  it('exports the port fake and every React binding', () => {
    expect(typeof MediaProvidersBarrel.createFakeMediaProvidersPort).toBe('function');
    expect(typeof MediaProvidersBarrel.MediaProvidersTab).toBe('function');
    expect(typeof MediaProvidersBarrel.useMediaProvidersTab).toBe('function');
  });

  it('exports the default provider catalog', () => {
    expect(Array.isArray(MediaProvidersBarrel.DEFAULT_MEDIA_PROVIDER_CATALOG)).toBe(true);
    expect(MediaProvidersBarrel.DEFAULT_MEDIA_PROVIDER_CATALOG.length).toBeGreaterThan(0);
  });
});
