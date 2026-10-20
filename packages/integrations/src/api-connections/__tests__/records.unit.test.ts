/**
 * @file Unit tests for the record-store helpers: every write bumps the revision so a second
 * writer holding the same read loses with `storage-conflict` instead of silently overwriting, and
 * a service only ever loads records of its own plugin connection in the caller's workspace.
 */
import { describe, expect, it } from 'vitest';
import { blankRecord, loadOwnedRecord, writeRecord } from '../records.js';
import { KEY, connectedRecord, seedRecord, unitDeps } from './fixtures/unit-deps.js';

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => { throw new Error('expected a refusal'); }, (error: unknown) => error);
}

describe('writeRecord', () => {
  it('stores the patch with the next revision and a fresh update time', async () => {
    const deps = unitDeps();
    await seedRecord(deps, connectedRecord({ updatedAt: '2026-10-19T00:00:00.000Z' }));
    const current = (await deps.records.read({ key: KEY }))!;
    const written = await writeRecord(deps, current, { status: 'reconnect-required' });
    expect([written.revision, written.updatedAt, (await deps.records.read({ key: KEY }))?.status])
      .toEqual([2, '2026-10-20T10:00:00.000Z', 'reconnect-required']);
  });

  it('refuses a second write made from the same read, keeping the first', async () => {
    const deps = unitDeps();
    await seedRecord(deps, connectedRecord());
    const current = (await deps.records.read({ key: KEY }))!;
    await writeRecord(deps, current, { status: 'reconnect-required' });
    expect(await caught(writeRecord(deps, current, { status: 'disconnected' }))).toMatchObject({ code: 'storage-conflict' });
    expect((await deps.records.read({ key: KEY }))?.status).toBe('reconnect-required');
  });

  it('creates a first record from the blank record (revision 0 means absent)', async () => {
    const deps = unitDeps();
    const written = await writeRecord(deps, blankRecord(deps, { key: KEY, workspaceId: 'ws-1' }), { status: 'reconnect-required' });
    expect([written.revision, written.pluginId, written.connectionId]).toEqual([1, 'acme-office', 'account']);
  });
});

describe('loadOwnedRecord', () => {
  it('loads a record of this plugin connection in the caller workspace', async () => {
    const deps = unitDeps();
    await seedRecord(deps, connectedRecord());
    expect((await loadOwnedRecord(deps, { connectionRef: KEY, workspaceId: 'ws-1' })).key).toBe(KEY);
  });

  it('refuses a record of another connection id of the same plugin', async () => {
    const deps = unitDeps();
    await seedRecord(deps, connectedRecord({ connectionId: 'other' }));
    expect(await caught(loadOwnedRecord(deps, { connectionRef: KEY, workspaceId: 'ws-1' }))).toMatchObject({ code: 'connection-not-found' });
  });

  it('refuses a ref with no record', async () => {
    expect(await caught(loadOwnedRecord(unitDeps(), { connectionRef: KEY, workspaceId: 'ws-1' }))).toMatchObject({ code: 'connection-not-found' });
  });
});
