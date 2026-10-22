import { describe, expect, it } from 'vitest';
import { createInMemoryStorageProvider } from '../storage.js';

describe('createInMemoryStorageProvider', () => {
  it('put/get round-trips bytes', async () => {
    const storage = createInMemoryStorageProvider({});
    const data = new Uint8Array([1, 2, 3]);
    const meta = await storage.put({ key: 'a.bin', data });
    expect(meta.key).toBe('a.bin');
    expect(meta.size).toBe(3);
    expect(meta.contentType).toBeUndefined();
    expect(await storage.get({ key: 'a.bin' })).toEqual(data);
  });

  it('put accepts an optional contentType', async () => {
    const storage = createInMemoryStorageProvider({});
    const meta = await storage.put({ key: 'a.png', data: new Uint8Array([1]) }, { contentType: 'image/png' });
    expect(meta.contentType).toBe('image/png');
  });

  it('put overwrites an existing key', async () => {
    const storage = createInMemoryStorageProvider({});
    await storage.put({ key: 'a.bin', data: new Uint8Array([1]) });
    await storage.put({ key: 'a.bin', data: new Uint8Array([2, 2]) });
    expect(await storage.get({ key: 'a.bin' })).toEqual(new Uint8Array([2, 2]));
  });

  it('get returns null for an unknown key', async () => {
    const storage = createInMemoryStorageProvider({});
    expect(await storage.get({ key: 'nope' })).toBeNull();
  });

  it('returned bytes are a copy, not a live reference to internal state', async () => {
    const storage = createInMemoryStorageProvider({});
    const data = new Uint8Array([1, 2, 3]);
    await storage.put({ key: 'a.bin', data });
    data[0] = 99;
    const stored = await storage.get({ key: 'a.bin' });
    expect(stored?.[0]).toBe(1);
    stored![0] = 42;
    expect((await storage.get({ key: 'a.bin' }))?.[0]).toBe(1);
  });

  it('delete removes an object; a second get returns null', async () => {
    const storage = createInMemoryStorageProvider({});
    await storage.put({ key: 'a.bin', data: new Uint8Array([1]) });
    await storage.delete({ key: 'a.bin' });
    expect(await storage.get({ key: 'a.bin' })).toBeNull();
  });

  it('delete on an unknown key is a silent no-op', async () => {
    const storage = createInMemoryStorageProvider({});
    await expect(storage.delete({ key: 'nope' })).resolves.toBeUndefined();
  });

  it('list with no prefix returns every object sorted by key', async () => {
    const storage = createInMemoryStorageProvider({});
    await storage.put({ key: 'b.bin', data: new Uint8Array([1]) });
    await storage.put({ key: 'a.bin', data: new Uint8Array([1]) });
    const list = await storage.list({}, {});
    expect(list.map((m) => m.key)).toEqual(['a.bin', 'b.bin']);
  });

  it('list filters by prefix', async () => {
    const storage = createInMemoryStorageProvider({});
    await storage.put({ key: 'images/a.png', data: new Uint8Array([1]) });
    await storage.put({ key: 'docs/a.pdf', data: new Uint8Array([1]) });
    const list = await storage.list({}, { prefix: 'images/' });
    expect(list.map((m) => m.key)).toEqual(['images/a.png']);
  });

  it('list on an empty store returns []', async () => {
    const storage = createInMemoryStorageProvider({});
    expect(await storage.list({}, {})).toEqual([]);
  });
});
