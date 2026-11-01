// undici is a production dependency; adapter failures propagate without install advice.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const adapter = vi.hoisted(() => ({ createUndiciAssetCacheDispatcher: vi.fn() }));
vi.mock('../asset-cache.adapter.js', () => adapter);

import { createAssetCache, createAssetCacheDispatcher } from '../asset-cache.js';

function moduleNotFound(message: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = 'MODULE_NOT_FOUND';
  return error;
}

describe('createAssetCacheDispatcher', () => {
  beforeEach(() => {
    adapter.createUndiciAssetCacheDispatcher.mockReset();
  });

  it('preserves dispatcher construction failures without optional-install advice', () => {
    const failure = moduleNotFound("Cannot find module 'undici'");
    adapter.createUndiciAssetCacheDispatcher.mockImplementation(() => { throw failure; });
    expect(() => createAssetCacheDispatcher({})).toThrow(failure);
    expect(() => createAssetCache({ cacheDir: '/unused' })).toThrow(failure);
  });

  it('rethrows a MODULE_NOT_FOUND for a different module untouched', () => {
    const other = moduleNotFound("Cannot find module 'undici/lib/agent'");
    adapter.createUndiciAssetCacheDispatcher.mockImplementation(() => {
      throw other;
    });
    expect(() => createAssetCacheDispatcher({})).toThrow(other);
  });

  it('rethrows the undici message without the MODULE_NOT_FOUND code untouched', () => {
    const other = new Error("Cannot find module 'undici'");
    adapter.createUndiciAssetCacheDispatcher.mockImplementation(() => {
      throw other;
    });
    expect(() => createAssetCacheDispatcher({})).toThrow(other);
  });

  it('rethrows a non-Error throw untouched', () => {
    adapter.createUndiciAssetCacheDispatcher.mockImplementation(() => {
      throw 'agent exploded';
    });
    expect(() => createAssetCacheDispatcher({})).toThrow('agent exploded');
  });

  it('passes a lookup function to the adapter', () => {
    const agent = { close: vi.fn(async () => {}) };
    adapter.createUndiciAssetCacheDispatcher.mockReturnValue(agent);
    expect(createAssetCacheDispatcher({})).toBe(agent);
    expect(typeof adapter.createUndiciAssetCacheDispatcher.mock.calls[0]?.[0].lookup).toBe('function');
  });

  it('createAssetCache wires opts.lookupImpl into the default dispatcher lookup', async () => {
    const agent = { close: vi.fn(async () => {}) };
    adapter.createUndiciAssetCacheDispatcher.mockReturnValue(agent);
    const lookupImpl = vi.fn((_h: string, _o: unknown, cb: (e: Error | null, a?: unknown, f?: number) => void) =>
      cb(null, '10.0.0.1', 4),
    );
    createAssetCache({ cacheDir: '/unused', lookupImpl: lookupImpl as never });
    const lookup = adapter.createUndiciAssetCacheDispatcher.mock.calls[0]?.[0].lookup as (
      h: string,
      o: unknown,
      cb: (e: Error | null) => void,
    ) => void;
    const err = await new Promise<Error | null>((resolve) => lookup('h.example', {}, resolve));
    expect(lookupImpl).toHaveBeenCalledTimes(1);
    expect(err?.message).toBe('host resolves to a private address');
  });

  it('close() closes the default dispatcher it created', async () => {
    const agent = { close: vi.fn(async () => {}) };
    adapter.createUndiciAssetCacheDispatcher.mockReturnValue(agent);
    await createAssetCache({ cacheDir: '/unused' }).close?.();
    expect(agent.close).toHaveBeenCalledTimes(1);
  });
});
