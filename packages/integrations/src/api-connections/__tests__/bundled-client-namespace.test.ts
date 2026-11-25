/**
 * @file `createBundledClientNamespaceReader`: only selected (bundled) ids are read or projected.
 * An installed plugin cannot select client-setting names, so an unselected id must resolve to
 * `undefined` without its manifest ever being read — the host's own prefix then applies.
 */
import { describe, expect, it, vi } from 'vitest';

import { createBundledClientNamespaceReader } from '../bundled-client-namespace.js';

/** A reader over fixed manifests whose two callbacks are spies. */
function fixture(manifests: Record<string, unknown>, projected: string | undefined) {
  const readManifest = vi.fn(({ pluginId }: { readonly pluginId: string }) => manifests[pluginId] ?? null);
  const readClientNamespace = vi.fn((_required: { readonly value: unknown }) => projected);
  const read = createBundledClientNamespaceReader({ pluginIds: new Set(['selected']), readManifest, readClientNamespace });
  return { read, readManifest, readClientNamespace };
}

describe('createBundledClientNamespaceReader', () => {
  it('reads and projects a selected manifest exactly once', async () => {
    const manifest = { name: 'selected' };
    const { read, readManifest, readClientNamespace } = fixture({ selected: manifest }, 'VENDORX_');
    await expect(read({ pluginId: 'selected' })).resolves.toBe('VENDORX_');
    expect(readManifest).toHaveBeenCalledTimes(1);
    expect(readManifest).toHaveBeenCalledWith({ pluginId: 'selected' });
    expect(readClientNamespace).toHaveBeenCalledTimes(1);
    expect(readClientNamespace).toHaveBeenCalledWith({ value: manifest });
  });

  it('never reads or projects an unselected (installed) id', async () => {
    const { read, readManifest, readClientNamespace } = fixture({ installed: { name: 'installed' } }, 'EVIL_');
    await expect(read({ pluginId: 'installed' })).resolves.toBeUndefined();
    expect(readManifest).not.toHaveBeenCalled();
    expect(readClientNamespace).not.toHaveBeenCalled();
  });

  it('does not project a null (unreadable) manifest', async () => {
    const { read, readManifest, readClientNamespace } = fixture({}, 'VENDORX_');
    await expect(read({ pluginId: 'selected' })).resolves.toBeUndefined();
    expect(readManifest).toHaveBeenCalledTimes(1);
    expect(readClientNamespace).not.toHaveBeenCalled();
  });

  it('passes an undefined projection through unchanged', async () => {
    const { read, readClientNamespace } = fixture({ selected: { name: 'selected' } }, undefined);
    await expect(read({ pluginId: 'selected' })).resolves.toBeUndefined();
    expect(readClientNamespace).toHaveBeenCalledTimes(1);
  });
});
