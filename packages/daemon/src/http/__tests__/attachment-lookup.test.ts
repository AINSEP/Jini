/**
 * `registerAttachmentLookupRoutes` + `createRemoteAttachmentLookup` against a real disk store, on an
 * ephemeral 127.0.0.1 port, behind the host's own strict bearer middleware.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireStrictBearerToken } from '@jini-ai/http-kit';
import { AttachmentRejectedError, createDiskAttachmentStore, type AttachmentStore } from '../attachments.js';
import { registerAttachmentLookupRoutes } from '../attachment-lookup-routes.js';
import { createRemoteAttachmentLookup } from '../../remote-attachment-lookup.js';

const TOKEN = 'daemon-token';
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
  vi.restoreAllMocks();
});

async function setup(): Promise<{ baseUrl: string; store: AttachmentStore }> {
  const root = await mkdtemp(resolve(tmpdir(), 'jini-attachment-lookup-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const store = await createDiskAttachmentStore({ uploadDirectory: root });
  cleanups.push(() => store.dispose());
  const app = express();
  app.use(requireStrictBearerToken({ tokenEnvVar: 'DAEMON_TOKEN', env: { DAEMON_TOKEN: TOKEN } }));
  registerAttachmentLookupRoutes({ app, store });
  const server = http.createServer(app);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanups.push(() => new Promise<void>((done) => { server.closeAllConnections?.(); server.close(() => done()); }));
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, store };
}

async function stage(store: AttachmentStore, batchId: string, name: string, ownerId: string) {
  const batchDirectory = await store.createBatchDirectory({ batchId });
  const path = resolve(batchDirectory, name);
  await writeFile(path, 'contents', { mode: 0o600 });
  return store.register({ input: { batchId, path, name, kind: 'file', size: 8, ownerId } });
}

describe('remote attachment lookup', () => {
  it('proxies resolveForRun and listPendingForOwner to the store and returns its own results', async () => {
    const { baseUrl, store } = await setup();
    const lookup = createRemoteAttachmentLookup({ baseUrl, token: TOKEN });
    const pending = await stage(store, 'batch-lookup-1', 'a.txt', 'owner-1');

    await expect(lookup.listPendingForOwner({ ownerId: 'owner-1' })).resolves.toEqual(await store.listPendingForOwner({ ownerId: 'owner-1' }));
    const resolved = await lookup.resolveForRun({ ref: pending.path, runId: 'run-A' });
    expect(resolved).toEqual(await store.resolveForRun({ ref: pending.path, runId: 'run-A' }));
    expect(resolved).toMatchObject({ name: 'a.txt', kind: 'file' });
    await expect(lookup.listPendingForOwner({ ownerId: 'owner-1' }, { runId: 'run-A' })).resolves.toEqual(await store.listPendingForOwner({ ownerId: 'owner-1' }, { runId: 'run-A' }));
    await expect(lookup.resolveForRun({ ref: 'attachment:never-uploaded', runId: 'run-A' })).resolves.toBeUndefined();
  });

  it("returns the store's non-disclosing rejection for another run's ref, as the same class", async () => {
    const { baseUrl, store } = await setup();
    const lookup = createRemoteAttachmentLookup({ baseUrl, token: TOKEN });
    const pending = await stage(store, 'batch-lookup-2', 'b.txt', 'owner-1');
    await store.resolveForRun({ ref: pending.path, runId: 'run-A' });

    const rejection = (promise: Promise<unknown>) => promise.then(() => { throw new Error('expected a rejection'); }, (e: unknown) => e as AttachmentRejectedError);
    const local = await rejection(store.resolveForRun({ ref: pending.path, runId: 'run-B' }));
    const remote = await rejection(lookup.resolveForRun({ ref: pending.path, runId: 'run-B' }));
    expect(remote).toBeInstanceOf(AttachmentRejectedError);
    expect([remote.reason, remote.message]).toEqual([local.reason, local.message]);
    expect(remote.reason).toBe('attachment-unknown-or-claimed');
  });

  it('a missing daemon token gives 401', async () => {
    const { baseUrl } = await setup();
    const lookup = createRemoteAttachmentLookup({ baseUrl, token: '' });
    await expect(lookup.listPendingForOwner({ ownerId: 'owner-1' })).rejects.toThrow(/HTTP 401/);
    await expect(createRemoteAttachmentLookup({ baseUrl, token: 'wrong' }).resolveForRun({ ref: 'r', runId: 'run' })).rejects.toThrow(/HTTP 401/);
  });

  it('answers 400 for a malformed lookup and a redacted 500 for a store fault', async () => {
    const { baseUrl, store } = await setup();
    const post = (body: unknown) => new Promise<{ status: number; text: string }>((done, fail) => {
      const payload = JSON.stringify(body);
      const req = http.request(new URL('/internal/attachment-lookup', baseUrl), { method: 'POST', agent: false, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' } }, (res) => {
        let text = '';
        res.on('data', (chunk) => { text += String(chunk); });
        res.on('end', () => done({ status: res.statusCode ?? 0, text }));
      });
      req.on('error', fail);
      req.end(payload);
    });
    expect((await post({ op: 'resolveForRun', ref: 'r' })).status).toBe(400);
    expect((await post({ op: 'listPendingForOwner', ownerId: 'o', runId: '' })).status).toBe(400);
    expect((await post({ op: 'deleteUnclaimed' })).status).toBe(400);
    vi.spyOn(store, 'listPendingForOwner').mockRejectedValue(new Error('disk at /secret/path'));
    const fault = await post({ op: 'listPendingForOwner', ownerId: 'o' });
    expect(fault.status).toBe(500);
    expect(fault.text).not.toContain('/secret/path');
  });
});
