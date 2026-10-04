import { expect, it, vi } from 'vitest';
import { createMemorySourceControlApi } from '../adapters/memory.js';
import { createSourceControlController } from '../controllers/source-control.controller.js';
import { runSourceControlApiConformance } from '../conformance/source-control-api.conformance.js';
import type { SourceControlProvider, SourceControlCredential } from '../models.js';
const providers: readonly SourceControlProvider[] = [{ id: 'git', label: 'Git host', credential: { tokenField: 'accessToken', fields: [{ name: 'accessToken', label: 'Access token', secret: true }, { name: 'username', label: 'Username', required: true }] } }, { id: 'other', label: 'Other host' }];
const permissions = ['source-control.read', 'source-control.credentials.write'];
const row: SourceControlCredential = { id: 'saved', providerId: 'git', label: 'Personal', configured: true, isDefault: true, createdAt: 'first', updatedAt: 'first' };
it('runs the API contract against memory', async () => { expect(await runSourceControlApiConformance({ api: createMemorySourceControlApi({ providers: [{ id: 'git', label: 'Git' }] }), providerId: 'git' })).toHaveLength(15); });
it('creates and replaces the default credential retaining its name and clearing all drafts', async () => {
  const api = createMemorySourceControlApi({ providers, credentials: [row] }); const put = vi.spyOn(api, 'update'); const controller = createSourceControlController({ api, permissions });
  await controller.load({}); controller.setToken({ providerId: 'git', value: ' new secret ' });
  expect(await controller.save({ providerId: 'git' })).toBe(false);
  controller.setField({ providerId: 'git', name: 'username', value: ' person ' });
  expect(await controller.save({ providerId: 'git' })).toBe(true);
  expect(put).toHaveBeenCalledWith({ id: 'saved', patch: { connection: { providerId: 'git', token: 'new secret', username: 'person' } } }, { signal: expect.any(AbortSignal) });
  expect(controller.getSnapshot().credentials[0]?.label).toBe('Personal');
  expect(controller.getSnapshot().drafts.git).toEqual({ token: '', values: {}, saving: false, error: null });
  controller.setToken({ providerId: 'other', value: 'fresh' }); expect(await controller.save({ providerId: 'other' })).toBe(true);
  expect(controller.getSnapshot().credentials.find(r => r.providerId === 'other')?.label).toBe('default');
});
it('defaults denied, allows reads without writes and refuses saved unlisted providers', async () => {
  const api = createMemorySourceControlApi({ credentials: [row] }); const list = vi.spyOn(api, 'list');
  const denied = createSourceControlController({ api }); await denied.load({}); denied.setToken({ providerId: 'git', value: 'secret' });
  expect(list).not.toHaveBeenCalled(); expect(await denied.save({ providerId: 'git' })).toBe(false);
  const read = createSourceControlController({ api, permissions: ['source-control.read'] }); await read.load({}); read.setToken({ providerId: 'git', value: 'secret' });
  expect(read.getSnapshot().credentials).toEqual([row]); expect(read.getSnapshot().drafts).toEqual({}); expect(await read.save({ providerId: 'git' })).toBe(false);
  const writable = createSourceControlController({ api, permissions }); await writable.load({}); writable.setToken({ providerId: 'git', value: 'secret' }); expect(await writable.save({ providerId: 'git' })).toBe(false);
});
it('a catalog failure still lists saved connections and cannot erase healthy prior providers', async () => {
  const api = createMemorySourceControlApi({ providers, credentials: [row] }); const controller = createSourceControlController({ api, permissions }); await controller.load({});
  vi.spyOn(api, 'providers').mockRejectedValue(new Error('private secret')); await controller.load({});
  expect(controller.getSnapshot().credentials).toEqual([row]); expect(controller.getSnapshot().providers).toEqual(providers); expect(controller.getSnapshot().catalogError).toBe('Provider catalog unavailable');
  const fresh = createSourceControlController({ api, permissions }); await fresh.load({}); expect(fresh.getSnapshot().credentials).toEqual([row]); expect(fresh.getSnapshot().providers).toEqual([]);
});
it('blocks duplicate saves while different rows remain independent', async () => {
  const api = createMemorySourceControlApi({ providers }); const create = api.create; let resolve!: (row: SourceControlCredential) => void;
  const spy = vi.spyOn(api, 'create').mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const controller = createSourceControlController({ api, permissions }); await controller.load({}); controller.setToken({ providerId: 'git', value: 'secret' }); controller.setField({ providerId: 'git', name: 'username', value: 'person' });
  const pending = controller.save({ providerId: 'git' }); expect(await controller.save({ providerId: 'git' })).toBe(false);
  controller.setToken({ providerId: 'other', value: 'other secret' }); expect(await controller.save({ providerId: 'other' })).toBe(true);
  resolve(await create({ label: 'default', connection: { providerId: 'git', token: 'secret', username: 'person' } })); expect(await pending).toBe(true);
  expect(spy).toHaveBeenCalledTimes(2); expect(controller.getSnapshot().credentials).toHaveLength(2);
});
it('disposal aborts in-flight work and ignores late responses', async () => {
  const api = createMemorySourceControlApi({ providers }); let resolve!: (rows: readonly SourceControlCredential[]) => void; let signal: AbortSignal | undefined;
  vi.spyOn(api, 'list').mockImplementation((_r, o) => { signal = o?.signal; return new Promise(r => { resolve = r; }); });
  const controller = createSourceControlController({ api, permissions }); const load = controller.load({}); controller.dispose({}); resolve([row]); await load;
  expect(signal?.aborted).toBe(true); expect(controller.getSnapshot().credentials).toEqual([]);
});
it('load refresh cannot overwrite an accepted save with a stale snapshot', async () => {
  const api = createMemorySourceControlApi({ providers }); const controller = createSourceControlController({ api, permissions }); await controller.load({});
  let resolve!: (rows: readonly SourceControlCredential[]) => void; vi.spyOn(api, 'list').mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const load = controller.load({}); controller.setToken({ providerId: 'other', value: 'secret' }); expect(await controller.save({ providerId: 'other' })).toBe(true); resolve([]); await load;
  expect(controller.getSnapshot().credentials).toHaveLength(1); expect(controller.getSnapshot().loading).toBe(false);
});
it('disposes an in-flight save, clears its secrets, and ignores the late success', async () => {
  const api = createMemorySourceControlApi({ providers }); let resolve!: (row: SourceControlCredential) => void; let signal: AbortSignal | undefined;
  vi.spyOn(api, 'create').mockImplementation((_r, options) => { signal = options?.signal; return new Promise(r => { resolve = r; }); });
  const controller = createSourceControlController({ api, permissions }); await controller.load({}); controller.setToken({ providerId: 'other', value: 'private draft' });
  const saving = controller.save({ providerId: 'other' }); controller.dispose({}); expect(signal?.aborted).toBe(true); expect(controller.getSnapshot().drafts).toEqual({}); resolve({ ...row, providerId: 'other' }); expect(await saving).toBe(false); expect(controller.getSnapshot().credentials).toEqual([]);
});
it('save failures stay row-local and never display server secret details', async () => {
  const api = createMemorySourceControlApi({ providers }); vi.spyOn(api, 'create').mockRejectedValueOnce({ code: 'VALIDATION', message: 'secret draft', detail: 'secret draft' });
  const controller = createSourceControlController({ api, permissions }); await controller.load({}); controller.setToken({ providerId: 'other', value: 'secret draft' });
  expect(await controller.save({ providerId: 'other' })).toBe(false); expect(controller.getSnapshot().drafts.other?.error).toBe('Check the required credential fields.'); expect(controller.getSnapshot().drafts.other?.saving).toBe(false);
});
it('retains server order when replacing the defensive first-row default', async () => {
  const api = createMemorySourceControlApi({ providers, credentials: [{ ...row, isDefault: false }, { ...row, id: 'second', label: 'Second', isDefault: false }] });
  const controller = createSourceControlController({ api, permissions }); await controller.load({}); controller.setToken({ providerId: 'git', value: 'replacement' }); controller.setField({ providerId: 'git', name: 'username', value: 'person' }); expect(await controller.save({ providerId: 'git' })).toBe(true);
  expect(controller.getSnapshot().credentials.map(r => r.id)).toEqual(['saved', 'second']);
});
