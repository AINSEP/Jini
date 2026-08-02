import { describe, expect, it } from 'vitest';

// Through the barrel — a symbol missing from `index.ts` fails here rather
// than at some host's build.
import { createFakeMediaProvidersPort } from '../../../features/media-providers/dependencies.js';

describe('createFakeMediaProvidersPort', () => {
  it('resolves an empty map by default — reached, manages nothing', async () => {
    const port = createFakeMediaProvidersPort();
    await expect(port.fetchMediaProviders()).resolves.toEqual({});
  });

  it('resolves seeded providers', async () => {
    const port = createFakeMediaProvidersPort({ providers: { a: { apiKeyConfigured: true } } });
    await expect(port.fetchMediaProviders()).resolves.toEqual({ a: { apiKeyConfigured: true } });
  });

  /**
   * The distinction this whole port exists to preserve: `unreachable: true`
   * must resolve `null`, never fall back to the seeded/default `{}`. A fake
   * that collapsed the two would let a test believe reconciliation works
   * when it was never actually exercising the "daemon down" branch.
   */
  it('resolves null — not {} — when unreachable, regardless of seeded providers', async () => {
    const port = createFakeMediaProvidersPort({ providers: { a: { apiKey: 'sk-1' } }, unreachable: true });
    const result = await port.fetchMediaProviders();
    expect(result).toBeNull();
    expect(result).not.toEqual({});
  });

  it('save persists and is reflected by a subsequent fetch', async () => {
    const port = createFakeMediaProvidersPort();
    const saved = await port.saveMediaProviders({ a: { apiKey: 'sk-1' } });
    expect(saved).toEqual({ a: { apiKey: 'sk-1' } });
    await expect(port.fetchMediaProviders()).resolves.toEqual({ a: { apiKey: 'sk-1' } });
  });

  it('save resolves a copy, not the same reference passed in', async () => {
    const port = createFakeMediaProvidersPort();
    const input = { a: { apiKey: 'sk-1' } };
    const saved = await port.saveMediaProviders(input);
    expect(saved).not.toBe(input);
  });

  it('save rejects with saveError instead of persisting', async () => {
    const port = createFakeMediaProvidersPort({ saveError: 'disk full' });
    await expect(port.saveMediaProviders({ a: { apiKey: 'sk-1' } })).rejects.toThrow('disk full');
    // The rejected save must not have landed — a subsequent fetch still sees
    // the pre-save state (empty, since none was seeded).
    await expect(port.fetchMediaProviders()).resolves.toEqual({});
  });

  it('simulates latency when latencyMs > 0', async () => {
    const port = createFakeMediaProvidersPort({ latencyMs: 5 });
    const start = Date.now();
    await port.fetchMediaProviders();
    expect(Date.now() - start).toBeGreaterThanOrEqual(4);
  });

  it('simulates latency on a rejected save too', async () => {
    const port = createFakeMediaProvidersPort({ saveError: 'slow failure', latencyMs: 5 });
    const start = Date.now();
    await expect(port.saveMediaProviders({})).rejects.toThrow('slow failure');
    expect(Date.now() - start).toBeGreaterThanOrEqual(4);
  });
});
