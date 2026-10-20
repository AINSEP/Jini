/**
 * Shared characterization pins for every `MediaTaskStore` adapter. Both the
 * in-memory reference and the sqlite adapter must behave identically, so the
 * same pins run against each (`describeMediaTaskStorePins(...)` is called from
 * `task-store.test.ts` and `sqlite-task-store.test.ts`). Not a test file on its
 * own: it has no `.test.` infix, so vitest only runs it through those callers.
 */
import { describe, expect, it } from 'vitest';
import type { MediaTaskStore } from '../task-store.js';

export interface MediaTaskStorePinsArgs {
  readonly label: string;
  /** Returns the store under test; the caller owns setup and cleanup. */
  readonly getStore: () => MediaTaskStore;
}

export function describeMediaTaskStorePins({ label, getStore }: MediaTaskStorePinsArgs): void {
  describe(`${label} — refactor pins`, () => {
    it('create() rejects an invalid status with a message naming it', async () => {
      await expect(getStore().create({ id: 'x', ownerRef: 'o', status: 'bogus' as never })).rejects.toThrow('Invalid media task status: "bogus"');
    });

    it('create() rejects a duplicate id with a message naming it', async () => {
      await getStore().create({ id: 'dup', ownerRef: 'o' });
      await expect(getStore().create({ id: 'dup', ownerRef: 'o' })).rejects.toThrow('media task "dup" already exists');
    });

    it('create() defaults startedAt to the creation time and sets updatedAt = createdAt', async () => {
      const task = await getStore().create({ id: 'a', ownerRef: 'o' });
      expect(task.startedAt).toBe(task.createdAt);
      expect(task.updatedAt).toBe(task.createdAt);
    });

    it('create() snapshots the file payload (later caller mutation does not leak in)', async () => {
      const file = { url: 'u', meta: { n: 1 } };
      await getStore().create({ id: 'a', ownerRef: 'o', file });
      file.meta.n = 2;
      expect((await getStore().get('a'))?.file).toEqual({ url: 'u', meta: { n: 1 } });
    });

    it('update() checks the status enum before the transition graph', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o', status: 'done' });
      await expect(getStore().update('a', { status: 'bogus' as never })).rejects.toThrow('Invalid media task status: "bogus"');
    });

    it('update() names both ends of an illegal transition', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o', status: 'running' });
      await expect(getStore().update('a', { status: 'queued' })).rejects.toThrow('Invalid media task transition: "running" -> "queued"');
    });

    it('update() rejects leaving interrupted', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o', status: 'interrupted' });
      await expect(getStore().update('a', { status: 'done' })).rejects.toThrow('Invalid media task transition: "interrupted" -> "done"');
    });

    it('update() allows queued straight to a terminal state', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o' });
      expect((await getStore().update('a', { status: 'failed' }))?.status).toBe('failed');
    });

    it('update() leaves the stored row untouched when the transition is rejected', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o', status: 'done', progress: ['p'] });
      await expect(getStore().update('a', { status: 'running', progress: ['q'] })).rejects.toThrow('"done" -> "running"');
      expect((await getStore().get('a'))?.progress).toEqual(['p']);
    });

    it('update() sets surface and model when given strings', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o', surface: 'image', model: 'm1' });
      const next = await getStore().update('a', { surface: 'video', model: 'm2' });
      expect(next).toMatchObject({ surface: 'video', model: 'm2' });
    });

    it('update() keeps surface and model when the patch omits them', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o', surface: 'image', model: 'm1' });
      const next = await getStore().update('a', { progress: ['x'] });
      expect(next).toMatchObject({ surface: 'image', model: 'm1' });
    });

    it('update() replaces progress with an explicit empty array', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o', progress: ['one'] });
      expect((await getStore().update('a', { progress: [] }))?.progress).toEqual([]);
    });

    it('update() keeps file, error and endedAt when the patch omits them', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o', file: { f: 1 }, error: { message: 'e' } });
      await getStore().update('a', { endedAt: 7 });
      const next = await getStore().update('a', { progress: ['x'] });
      expect(next).toMatchObject({ file: { f: 1 }, error: { message: 'e' }, endedAt: 7 });
    });

    it('update() snapshots a patched file payload', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o' });
      const file = { n: 1 };
      await getStore().update('a', { file });
      file.n = 2;
      expect((await getStore().get('a'))?.file).toEqual({ n: 1 });
    });

    it('update() never changes id, ownerRef, startedAt or createdAt', async () => {
      const created = await getStore().create({ id: 'a', ownerRef: 'o', startedAt: 5 });
      const next = await getStore().update('a', { status: 'running' });
      expect(next).toMatchObject({ id: 'a', ownerRef: 'o', startedAt: 5, createdAt: created.createdAt });
    });

    it('reconcileOnBoot() keeps a terminal task whose endedAt equals the cutoff exactly (strict <)', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o' });
      await getStore().update('a', { status: 'done', endedAt: 5000 });
      expect(await getStore().reconcileOnBoot({ terminalTtlMs: 5000, now: 10000 })).toEqual({ interrupted: 0, deleted: 0 });
    });

    it('reconcileOnBoot() deletes a terminal task one ms past the cutoff', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o' });
      await getStore().update('a', { status: 'failed', endedAt: 4999 });
      expect(await getStore().reconcileOnBoot({ terminalTtlMs: 5000, now: 10000 })).toEqual({ interrupted: 0, deleted: 1 });
    });

    it('reconcileOnBoot() does not delete a task it just interrupted, even with an old endedAt', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o', status: 'running' });
      await getStore().update('a', { endedAt: 1 });
      expect(await getStore().reconcileOnBoot({ terminalTtlMs: 0, now: 10000 })).toEqual({ interrupted: 1, deleted: 0 });
      expect(await getStore().get('a')).toMatchObject({ status: 'interrupted', endedAt: 1, updatedAt: 10000 });
    });

    it('reconcileOnBoot() overwrites an in-flight task error with the restart error', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o', error: { message: 'old' } });
      await getStore().reconcileOnBoot({ terminalTtlMs: 0, now: 10 });
      expect((await getStore().get('a'))?.error).toEqual({ message: 'media task interrupted by daemon restart', code: 'DAEMON_RESTART' });
    });

    it('reconcileOnBoot() accepts terminalTtlMs 0', async () => {
      await getStore().create({ id: 'a', ownerRef: 'o', status: 'done' });
      expect((await getStore().reconcileOnBoot({ terminalTtlMs: 0, now: Date.now() + 1 })).deleted).toBe(1);
    });

    it('reconcileOnBoot() names the bad terminalTtlMs value', async () => {
      await expect(getStore().reconcileOnBoot({ terminalTtlMs: -1 })).rejects.toThrow('Invalid terminalTtlMs: -1 must be a non-negative finite number');
      await expect(getStore().reconcileOnBoot({ terminalTtlMs: Number.NaN })).rejects.toThrow('Invalid terminalTtlMs: NaN must be a non-negative finite number');
    });
  });
}
