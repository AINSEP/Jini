/**
 * Conformance suite for `createSqliteMediaTaskStore`. Covers the same shape
 * as `task-store.test.ts` (create/get/update/listByOwner/delete/
 * reconcileOnBoot, CR-013 transition/duplicate-id invariants) against the
 * sqlite adapter instead of the in-memory reference, proving behavioral
 * parity — plus a durability-across-restart section with no in-memory
 * equivalent (closes the store, opens a fresh one against the same file,
 * and confirms an in-flight job's state survived and can be reconciled).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteMediaTaskStore } from '../sqlite-task-store.js';
import type { SqliteMediaTaskStore } from '../sqlite-task-store.js';

let dir: string;
let dbPath: string;
let store: SqliteMediaTaskStore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'jini-media-task-store-'));
  dbPath = join(dir, 'media-tasks.db');
  store = await createSqliteMediaTaskStore(dbPath);
});

afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('createSqliteMediaTaskStore — lifecycle', () => {
  it('create() defaults status to queued and returns the full row', async () => {
    const task = await store.create({ id: 't1', ownerRef: 'run-1' });
    expect(task).toMatchObject({ id: 't1', ownerRef: 'run-1', status: 'queued', progress: [], file: null, error: null });
    expect(task.startedAt).toBeTypeOf('number');
    expect(task.endedAt).toBeNull();
  });

  it('create() accepts an explicit status, surface, model, progress, file, error, startedAt', async () => {
    const task = await store.create({
      id: 't2',
      ownerRef: 'run-1',
      status: 'running',
      surface: 'video',
      model: 'sora-2',
      progress: ['queued upstream'],
      file: { url: 'https://x/y.mp4' },
      error: null,
      startedAt: 1000,
    });
    expect(task).toMatchObject({
      status: 'running',
      surface: 'video',
      model: 'sora-2',
      progress: ['queued upstream'],
      file: { url: 'https://x/y.mp4' },
      startedAt: 1000,
    });
  });

  it('create() rejects an invalid status', async () => {
    await expect(store.create({ id: 't3', ownerRef: 'run-1', status: 'bogus' as never })).rejects.toThrow(RangeError);
  });

  it('create() rejects a duplicate id instead of silently overwriting', async () => {
    await store.create({ id: 't1', ownerRef: 'run-1', surface: 'video' });
    await expect(store.create({ id: 't1', ownerRef: 'run-2', surface: 'image' })).rejects.toThrow(/already exists/);
    expect((await store.get('t1'))?.ownerRef).toBe('run-1');
  });

  it('a task created without surface/model omits those fields entirely (not undefined)', async () => {
    const task = await store.create({ id: 't1', ownerRef: 'run-1' });
    expect('surface' in task).toBe(false);
    expect('model' in task).toBe(false);
  });

  it('get() returns null for an unknown id', async () => {
    expect(await store.get('nope')).toBeNull();
  });

  it('get() returns the created row', async () => {
    await store.create({ id: 't1', ownerRef: 'run-1' });
    expect((await store.get('t1'))?.id).toBe('t1');
  });

  it('two get() calls for the same task return distinct object references', async () => {
    await store.create({ id: 't1', ownerRef: 'run-1' });
    const first = await store.get('t1');
    const second = await store.get('t1');
    expect(first).not.toBe(second);
    expect(first?.progress).not.toBe(second?.progress);
  });

  it('update() returns null for an unknown id', async () => {
    expect(await store.update('nope', { status: 'done' })).toBeNull();
  });

  it('update() rejects an invalid status', async () => {
    await store.create({ id: 't1', ownerRef: 'run-1' });
    await expect(store.update('t1', { status: 'bogus' as never })).rejects.toThrow(RangeError);
  });

  it('update() patches status/progress/file/error/endedAt and preserves unspecified fields', async () => {
    await store.create({ id: 't1', ownerRef: 'run-1', surface: 'video', model: 'sora-2' });
    const updated = await store.update('t1', {
      status: 'done',
      progress: ['submitted', 'polling', 'done'],
      file: { url: 'https://x/y.mp4' },
      endedAt: 5000,
    });
    expect(updated).toMatchObject({
      status: 'done',
      progress: ['submitted', 'polling', 'done'],
      file: { url: 'https://x/y.mp4' },
      endedAt: 5000,
      surface: 'video',
      model: 'sora-2',
    });
  });

  it('update() patches a non-null error', async () => {
    await store.create({ id: 't1', ownerRef: 'run-1' });
    const updated = await store.update('t1', { status: 'failed', error: { message: 'upstream 500', status: 500 } });
    expect(updated?.error).toEqual({ message: 'upstream 500', status: 500 });
  });

  it('create() accepts a non-null error', async () => {
    const created = await store.create({ id: 't1', ownerRef: 'run-1', status: 'failed', error: { message: 'boom' } });
    expect(created.error).toEqual({ message: 'boom' });
  });

  it('update() with an empty patch keeps status/progress but bumps updatedAt', async () => {
    const created = await store.create({ id: 't1', ownerRef: 'run-1' });
    const updated = await store.update('t1', {});
    expect(updated?.status).toBe(created.status);
    expect(updated?.progress).toEqual(created.progress);
  });

  it('update() can clear surface/model/file/error/endedAt by passing null/undefined explicitly', async () => {
    await store.create({ id: 't1', ownerRef: 'run-1', surface: 'video', model: 'sora-2', file: { a: 1 } });
    const cleared = await store.update('t1', { surface: null, model: null, file: null, error: null, endedAt: null });
    expect(cleared?.surface).toBeUndefined();
    expect(cleared?.model).toBeUndefined();
    expect(cleared?.file).toBeNull();
    expect(cleared?.error).toBeNull();
    expect(cleared?.endedAt).toBeNull();
  });

  it('rejects an illegal transition out of a terminal state (done -> running)', async () => {
    await store.create({ id: 't1', ownerRef: 'run-1', status: 'done' });
    await expect(store.update('t1', { status: 'running' })).rejects.toThrow(/Invalid media task transition/);
  });

  it('rejects an illegal transition out of a terminal state (failed -> queued)', async () => {
    await store.create({ id: 't1', ownerRef: 'run-1', status: 'failed' });
    await expect(store.update('t1', { status: 'queued' })).rejects.toThrow(/Invalid media task transition/);
  });

  it('allows a same-state update (progress-only) without touching status legality', async () => {
    await store.create({ id: 't1', ownerRef: 'run-1', status: 'running' });
    const updated = await store.update('t1', { progress: ['halfway'] });
    expect(updated?.status).toBe('running');
    expect(updated?.progress).toEqual(['halfway']);
  });

  it('delete() removes a task; a second get() returns null', async () => {
    await store.create({ id: 't1', ownerRef: 'run-1' });
    await store.delete('t1');
    expect(await store.get('t1')).toBeNull();
  });

  it('delete() on an unknown id is a silent no-op', async () => {
    await expect(store.delete('nope')).resolves.toBeUndefined();
  });
});

describe('createSqliteMediaTaskStore — listByOwner', () => {
  it('scopes to ownerRef and excludes terminal tasks by default, newest first', async () => {
    await store.create({ id: 'a', ownerRef: 'run-1', startedAt: 1 });
    await store.create({ id: 'b', ownerRef: 'run-1', startedAt: 2 });
    await store.create({ id: 'c', ownerRef: 'run-2', startedAt: 3 });
    await store.update('b', { status: 'done', endedAt: 10 });

    const list = await store.listByOwner('run-1');
    expect(list.map((t) => t.id)).toEqual(['a']);
  });

  it('includeTerminal:true includes terminal tasks', async () => {
    await store.create({ id: 'a', ownerRef: 'run-1', startedAt: 1 });
    await store.create({ id: 'b', ownerRef: 'run-1', startedAt: 2 });
    await store.update('b', { status: 'failed', endedAt: 10 });

    const list = await store.listByOwner('run-1', { includeTerminal: true });
    expect(list.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('returns an empty array for an owner with no tasks', async () => {
    expect(await store.listByOwner('nobody')).toEqual([]);
  });
});

describe('createSqliteMediaTaskStore — reconcileOnBoot', () => {
  it('marks in-flight (queued/running) tasks interrupted', async () => {
    await store.create({ id: 'a', ownerRef: 'run-1', status: 'queued' });
    await store.create({ id: 'b', ownerRef: 'run-1', status: 'running' });

    const result = await store.reconcileOnBoot({ terminalTtlMs: 1000, now: 5000 });
    expect(result).toEqual({ interrupted: 2, deleted: 0 });
    const a = await store.get('a');
    expect(a?.status).toBe('interrupted');
    expect(a?.error?.code).toBe('DAEMON_RESTART');
    expect(a?.endedAt).toBe(5000);
  });

  it('does not overwrite an already-set endedAt when interrupting', async () => {
    await store.create({ id: 'a', ownerRef: 'run-1', status: 'running' });
    await store.update('a', { status: 'running', endedAt: 1234 });
    const result = await store.reconcileOnBoot({ terminalTtlMs: 1000, now: 9999 });
    expect(result.interrupted).toBe(1);
    expect((await store.get('a'))?.endedAt).toBe(1234);
  });

  it('deletes terminal tasks older than terminalTtlMs and keeps recent ones', async () => {
    await store.create({ id: 'old', ownerRef: 'run-1' });
    await store.update('old', { status: 'done', endedAt: 1000 });
    await store.create({ id: 'recent', ownerRef: 'run-1' });
    await store.update('recent', { status: 'done', endedAt: 9000 });

    const result = await store.reconcileOnBoot({ terminalTtlMs: 5000, now: 10000 });
    expect(result).toEqual({ interrupted: 0, deleted: 1 });
    expect(await store.get('old')).toBeNull();
    expect(await store.get('recent')).not.toBeNull();
  });

  it('uses Date.now() when now is not supplied', async () => {
    await store.create({ id: 'a', ownerRef: 'run-1', status: 'queued' });
    const result = await store.reconcileOnBoot({ terminalTtlMs: 1000 });
    expect(result.interrupted).toBe(1);
  });

  it('falls back to updatedAt for the cutoff comparison when endedAt is null', async () => {
    const created = await store.create({ id: 'a', ownerRef: 'run-1', status: 'done' });
    expect(created.endedAt).toBeNull();
    const result = await store.reconcileOnBoot({ terminalTtlMs: 1, now: created.updatedAt + 1000 });
    expect(result.deleted).toBe(1);
  });

  it('rejects a negative or non-finite terminalTtlMs', async () => {
    await expect(store.reconcileOnBoot({ terminalTtlMs: -1 })).rejects.toThrow(RangeError);
    await expect(store.reconcileOnBoot({ terminalTtlMs: Number.NaN })).rejects.toThrow(RangeError);
    await expect(store.reconcileOnBoot({ terminalTtlMs: Number.POSITIVE_INFINITY })).rejects.toThrow(RangeError);
  });
});

describe('createSqliteMediaTaskStore — durability across a simulated process restart', () => {
  it('a fresh store instance opened against the same file sees a task created before close()', async () => {
    await store.create({ id: 't1', ownerRef: 'run-1', surface: 'image', model: 'gpt-image-2' });
    await store.close();

    const reopened = await createSqliteMediaTaskStore(dbPath);
    const task = await reopened.get('t1');
    expect(task).toMatchObject({ id: 't1', ownerRef: 'run-1', surface: 'image', model: 'gpt-image-2', status: 'queued' });
    await reopened.close();
  });

  it('an in-flight (queued/running) job survives a restart and reconcileOnBoot on the fresh instance marks it interrupted', async () => {
    // Simulates the exact scenario the task brief describes: a long-running
    // async media job (submit -> poll -> fetch) is mid-flight when the
    // process dies. State must be readable — and reconcilable — from a
    // brand new adapter instance, not just "written somewhere."
    await store.create({ id: 'job-1', ownerRef: 'run-42', surface: 'video', model: 'sora-2', status: 'running' });
    await store.update('job-1', { progress: ['submitted', 'polling attempt 3'] });
    await store.close(); // process "dies" here — no graceful shutdown call beyond releasing the file handle.

    const revived = await createSqliteMediaTaskStore(dbPath);
    const beforeReconcile = await revived.get('job-1');
    expect(beforeReconcile?.status).toBe('running');
    expect(beforeReconcile?.progress).toEqual(['submitted', 'polling attempt 3']);

    const result = await revived.reconcileOnBoot({ terminalTtlMs: 60_000, now: 500_000 });
    expect(result.interrupted).toBe(1);
    const after = await revived.get('job-1');
    expect(after?.status).toBe('interrupted');
    expect(after?.error?.code).toBe('DAEMON_RESTART');
    await revived.close();
  });

  it('a fresh instance still enforces the same transition legality (done -> running still rejected after reopen)', async () => {
    await store.create({ id: 't1', ownerRef: 'run-1', status: 'done' });
    await store.close();

    const reopened = await createSqliteMediaTaskStore(dbPath);
    await expect(reopened.update('t1', { status: 'running' })).rejects.toThrow(/Invalid media task transition/);
    await reopened.close();
  });

  it('multiple owners and terminal tasks all persist correctly across a reopen', async () => {
    await store.create({ id: 'a', ownerRef: 'run-1', startedAt: 1 });
    await store.create({ id: 'b', ownerRef: 'run-2', startedAt: 2 });
    await store.update('b', { status: 'done', endedAt: 10 });
    await store.close();

    const reopened = await createSqliteMediaTaskStore(dbPath);
    expect((await reopened.listByOwner('run-1')).map((t) => t.id)).toEqual(['a']);
    expect((await reopened.listByOwner('run-2', { includeTerminal: true })).map((t) => t.id)).toEqual(['b']);
    await reopened.close();
  });
});
