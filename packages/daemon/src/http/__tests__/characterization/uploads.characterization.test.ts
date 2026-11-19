import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiskAttachmentStore } from '../../attachments.js';
import { type AttachmentStore } from '../../attachment-types.js';
import { INTERNAL_FAILURE_MARKER, startRouteHarness, type RouteHarness } from './harness.js';
import { FOREIGN_ORIGIN } from './probes.js';

/**
 * The attachment upload and cleanup routes, recorded from today's code on a real socket, mounted
 * where a host mounts them: below the blanket JSON parser. The store is the real disk store over
 * a temporary directory, so "stored" means bytes in a file and "tidied" means the file is gone.
 */

const MAX_ATTACHMENT_BYTES = 4096;
/** Every byte value, so a text decode anywhere on the way shows as changed bytes. */
const ALL_BYTES = Uint8Array.from({ length: 256 }, (_unused, index) => index);

let root: string;
let store: AttachmentStore;
let harness: RouteHarness;
const released = vi.fn();
const acquireActivity = vi.fn(() => released);
/** Replaced by a test that needs the store's first step to wait or fail. */
let beforeStoring: () => Promise<void> = async () => undefined;

async function storedFiles(directory = root): Promise<{ path: string; bytes: Buffer }[]> {
  const found: { path: string; bytes: Buffer }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await storedFiles(path));
    else found.push({ path, bytes: await readFile(path) });
  }
  return found;
}

/** The uploaded files only: the store keeps a small JSON description beside each one. */
const uploadsOnDisk = async (): Promise<Buffer[]> => (await storedFiles()).filter((file) => !file.path.endsWith('.json')).map((file) => file.bytes);

function upload({ name = 'file.bin', batch = 'batch-upload-1', body = ALL_BYTES, contentType = 'application/octet-stream', origin }: { name?: string; batch?: string; body?: Uint8Array | string; contentType?: string; origin?: string } = {}): Promise<Response> {
  return harness.fetch(new Request(`http://harness.invalid/api/attachments?${new URLSearchParams({ batch, name }).toString()}`, {
    method: 'POST',
    headers: { 'content-type': contentType, ...(origin ? { origin } : {}) },
    body,
  }));
}

// A fresh store per test: the store counts what each batch holds, so tests must not share one.
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jini-upload-characterization-'));
  const disk = await createDiskAttachmentStore({ uploadDirectory: root });
  store = { ...disk, pruneExpired: async (...args: Parameters<AttachmentStore['pruneExpired']>) => { await beforeStoring(); return disk.pruneExpired(...args); } };
  harness = await startRouteHarness({}, { familyDeps: { attachments: {
    store, acquireActivity, maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
    maxConcurrentUploads: undefined, maxCleanupPaths: undefined, requireSameOrigin: undefined, resolveOwnerId: undefined,
  } } });
});
afterEach(async () => {
  // The route gives its activity slot back after it has answered; wait for that before the next test counts.
  await vi.waitFor(() => { expect(released.mock.calls.length).toBe(acquireActivity.mock.calls.length); });
  beforeStoring = async () => undefined;
  acquireActivity.mockClear();
  released.mockClear();
  await harness.close();
  await store.dispose();
  await rm(root, { recursive: true, force: true });
});

describe('upload (POST /api/attachments)', () => {
  it('stores a binary body byte for byte, including every byte from 0x80 up', async () => {
    const response = await upload();
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const answer = await response.json() as { attachment: Record<string, unknown> };
    expect(answer).toEqual({ attachment: { path: expect.stringMatching(/^attachment:[a-f0-9-]{36}$/), name: 'file.bin', kind: 'file', size: 256 } });
    const files = await uploadsOnDisk();
    expect(files).toHaveLength(1);
    expect(files[0]!.equals(Buffer.from(ALL_BYTES))).toBe(true);
  });

  it('a body the JSON parser above already read is refused as a host mistake, and nothing is stored', async () => {
    const before = harness.internalErrors.length;
    const response = await upload({ body: '{"looks":"like json"}', contentType: 'application/json' });
    expect(response.status).toBe(500);
    const answer = await response.json() as { error: { code: string; message: string; requestId?: string } };
    expect(answer.error.code).toBe('INTERNAL_ERROR');
    expect(answer.error.message).not.toContain('already consumed');
    expect(harness.internalErrors).toHaveLength(before + 1);
    expect(harness.internalErrors.at(-1)).toMatchObject({ source: 'attachment-upload', error: expect.objectContaining({ reason: 'attachment-body-consumed' }) });
    expect(await uploadsOnDisk()).toEqual([]);
  });

  it.each([
    ['exactly at the limit', MAX_ATTACHMENT_BYTES, 201, 1],
    ['one byte over the limit', MAX_ATTACHMENT_BYTES + 1, 413, 0],
  ])('a body %s answers %i', async (_label, bytes, status, kept) => {
    const response = await upload({ body: new Uint8Array(bytes).fill(0xab) });
    expect(response.status).toBe(status);
    if (status === 413) expect(await response.json()).toEqual({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Each attachment must be 4096 bytes or smaller' } });
    // A refused upload leaves no partial file and no batch directory behind.
    expect(await uploadsOnDisk()).toHaveLength(kept);
    if (kept === 0) expect(await readdir(root)).toEqual([]);
  });

  it('an empty body is refused and leaves nothing behind', async () => {
    const response = await upload({ body: new Uint8Array(0) });
    expect(response.status).toBe(400);
    expect(await readdir(root)).toEqual([]);
  });

  it('a fifth upload while four are in progress is refused with 429; the four finish, and the slots are free again', async () => {
    let letThrough: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { letThrough = resolve; });
    let waiting = 0;
    beforeStoring = async () => { waiting += 1; await gate; };
    const inProgress = [1, 2, 3, 4].map((index) => upload({ name: `slow-${index}.bin` }));
    await vi.waitFor(() => { expect(waiting).toBe(4); });
    beforeStoring = async () => undefined;
    const fifth = await upload({ name: 'fifth.bin' });
    expect(fifth.status).toBe(429);
    expect(await fifth.json()).toEqual({ error: { code: 'RATE_LIMITED', message: 'Too many attachment uploads are in progress' } });
    letThrough();
    expect((await Promise.all(inProgress)).map((response) => response.status)).toEqual([201, 201, 201, 201]);
    expect((await upload({ name: 'after.bin' })).status).toBe(201);
  });

  it('a slot is given back when an upload fails: five failures in a row do not use up the four slots', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await upload({ body: new Uint8Array(MAX_ATTACHMENT_BYTES + 1) })).status).toBe(413);
    }
    expect((await upload()).status).toBe(201);
  });

  it('a store failure is answered as a 500 with a request ID and without the failure text', async () => {
    const before = harness.internalErrors.length;
    beforeStoring = async () => { throw new Error(INTERNAL_FAILURE_MARKER); };
    const response = await upload();
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain(INTERNAL_FAILURE_MARKER);
    expect((JSON.parse(text) as { error: { requestId: string } }).error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(harness.internalErrors).toHaveLength(before + 1);
    beforeStoring = async () => undefined;
    expect((await upload()).status).toBe(201);
  });

  it.each([
    ['a stored upload', () => upload(), 201],
    ['a refused foreign origin', () => upload({ origin: FOREIGN_ORIGIN }), 403],
    ['a refused oversized body', () => upload({ body: new Uint8Array(MAX_ATTACHMENT_BYTES + 1) }), 413],
    ['a failing store', () => { beforeStoring = async () => { throw new Error(INTERNAL_FAILURE_MARKER); }; return upload(); }, 500],
  ])('the host is told the daemon is busy for the whole of %s, and told once that it is over', async (_label, send, status) => {
    const response = await send();
    expect(response.status).toBe(status);
    await response.text();
    expect(acquireActivity).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => { expect(released).toHaveBeenCalledTimes(1); });
  });

  it('a foreign origin is refused before a byte is stored', async () => {
    const response = await upload({ origin: FOREIGN_ORIGIN });
    expect(response.status).toBe(403);
    expect(await readdir(root)).toEqual([]);
  });
});

describe('cleanup (DELETE /api/attachments)', () => {
  const cleanup = (body: unknown): Promise<Response> => harness.fetch(new Request('http://harness.invalid/api/attachments', {
    method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));

  it('removes the named uploads and answers 204 with no body and no content type', async () => {
    const stored = await (await upload()).json() as { attachment: { path: string } };
    expect(await uploadsOnDisk()).toHaveLength(1);
    const response = await cleanup({ batchId: 'batch-upload-1', paths: [stored.attachment.path] });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('content-type')).toBeNull();
    expect(await uploadsOnDisk()).toEqual([]);
    expect(released).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['no batch', { paths: [] }],
    ['paths that are not a list', { batchId: 'batch-upload-1', paths: 'attachment:x' }],
    ['more than ten paths', { batchId: 'batch-upload-1', paths: Array.from({ length: 11 }, (_unused, index) => `attachment:${index}`) }],
  ])('a request with %s is refused with 400 and removes nothing', async (_label, body) => {
    await upload();
    const response = await cleanup(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'BAD_REQUEST', message: 'Invalid attachment cleanup request' } });
    expect(await uploadsOnDisk()).toHaveLength(1);
  });
});
