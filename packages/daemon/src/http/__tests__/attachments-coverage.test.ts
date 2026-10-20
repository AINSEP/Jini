/**
 * Coverage-closing tests for `http/attachments.ts`: the branches `attachments.test.ts` does not
 * reach.
 *
 * - `hasAvifSignature`'s compatible-brand scan running to its 16-entry bound without a match.
 * - `ftypBoxEnd`'s short-body guard, which no `hasAvifSignature` call can reach (its `ftyp` tag
 *   check already requires 8 bytes) and so is exercised by a direct call — a bounds guard is kept,
 *   never deleted as "unreachable".
 * - `registerAttachmentRoutes`'s `catch` around the origin guard, for both `POST` and `DELETE`,
 *   driven by a host-injected `adapter.env` whose read throws (the environment `guardSameOrigin`
 *   actually reads). A malformed allowed-origins entry no longer throws — `configuredAllowedOrigins`
 *   drops and logs it — so a throwing env read is the remaining way to make the guard throw.
 * - A pin of the same-inode, same-size content swap that `isUnchangedAttachment` cannot see.
 */
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import express from 'express';
import type { AdapterContext } from '@jini-ai/http-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATTACHMENTS_ROUTE_PATH,
  createDiskAttachmentStore,
  ftypBoxEnd,
  hasAvifSignature,
  registerAttachmentRoutes,
  type AttachmentStore,
  type AttachmentsHttpDeps,
  type AttachmentsInternalErrorContext,
} from '../attachments.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
  vi.restoreAllMocks();
});

async function diskStore(): Promise<AttachmentStore> {
  const root = await mkdtemp(resolve(tmpdir(), 'jini-attachments-cov-'));
  cleanups.push(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const store = await createDiskAttachmentStore({ uploadDirectory: root });
  cleanups.push(() => store.dispose());
  return store;
}

/** An `ftyp` box whose declared size covers `compatibleBrands`, plus 8 trailing payload bytes. */
function ftypBytes(majorBrand: string, compatibleBrands: readonly string[]): Uint8Array {
  const boxLength = 16 + compatibleBrands.length * 4;
  const bytes = new Uint8Array(boxLength + 8);
  bytes.set([(boxLength >> 24) & 0xff, (boxLength >> 16) & 0xff, (boxLength >> 8) & 0xff, boxLength & 0xff], 0);
  bytes.set(new TextEncoder().encode('ftyp'), 4);
  bytes.set(new TextEncoder().encode(majorBrand), 8);
  compatibleBrands.forEach((brand, index) => bytes.set(new TextEncoder().encode(brand), 16 + index * 4));
  return bytes;
}

describe('hasAvifSignature — compatible-brand scan bound', () => {
  it('returns false once all 16 scanned compatible brands are non-AVIF', () => {
    const brands = Array.from({ length: 16 }, () => 'mp41');

    expect(hasAvifSignature({ body: ftypBytes('isom', brands) })).toBe(false);
  });

  it('does not look past the 16th compatible brand, even when the box declares more', () => {
    const brands = [...Array.from({ length: 16 }, () => 'mp41'), 'avif'];

    expect(hasAvifSignature({ body: ftypBytes('isom', brands) })).toBe(false);
  });

  it('still finds AVIF named as the 16th (last scanned) compatible brand', () => {
    const brands = [...Array.from({ length: 15 }, () => 'mp41'), 'avif'];

    expect(hasAvifSignature({ body: ftypBytes('isom', brands) })).toBe(true);
  });
});

describe('ftypBoxEnd', () => {
  it('returns 0 for a body too short to hold a box header and major brand', () => {
    expect(ftypBoxEnd({ body: Uint8Array.from([0, 0, 0, 0x40, 0x66, 0x74, 0x79]) })).toBe(0);
  });

  it('returns the declared box size when the body holds all of it', () => {
    expect(ftypBoxEnd({ body: ftypBytes('isom', ['mp41']) })).toBe(20);
  });

  it('clamps a size-inflating declaration to the bytes actually present', () => {
    const body = ftypBytes('isom', []);
    body.set([0xff, 0xff, 0xff, 0xff], 0);

    expect(ftypBoxEnd({ body })).toBe(body.length);
  });
});

/**
 * Mounts the routes with an `adapter.env` whose allowed-origins read throws: `guardSameOrigin` reads
 * the origin policy from `adapter.env` (not `process.env`), so `passesOriginGuard` throws inside the
 * route callback, ahead of either handler — the case the callbacks' `catch` exists for.
 */
/** A host env whose allowed-origins entry throws on read, standing in for any guard-internal throw. */
function throwingEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  Object.defineProperty(env, 'JINI_ALLOWED_ORIGINS', {
    enumerable: true,
    get() {
      throw new Error('origin policy unavailable');
    },
  });
  return env;
}

async function throwingGuardHarness(): Promise<{ url: string; sink: ReturnType<typeof vi.fn<(context: AttachmentsInternalErrorContext) => void>> }> {
  const store = await diskStore();
  const sink = vi.fn<(context: AttachmentsInternalErrorContext) => void>();
  const deps: AttachmentsHttpDeps = { store, onInternalError: sink };
  const adapter: AdapterContext = {
    allowedOriginsEnvVar: 'JINI_ALLOWED_ORIGINS',
    webPortEnvVar: 'JINI_WEB_PORT',
    bindHostEnvVar: 'JINI_BIND_HOST',
    env: throwingEnv(),
    resolvedPortRef: { current: 0 },
  };
  const app = express();
  app.use(express.json());
  registerAttachmentRoutes({ app, deps, adapter });
  const server: Server = app.listen(0);
  await new Promise((ready) => server.once('listening', ready));
  const { port } = server.address() as { port: number };
  adapter.resolvedPortRef.current = port;
  cleanups.push(
    () => new Promise<void>((closed) => {
      server.close(() => closed());
    }),
  );
  return { url: `http://127.0.0.1:${port}${ATTACHMENTS_ROUTE_PATH}`, sink };
}

describe('registerAttachmentRoutes — origin guard throwing', () => {
  it('answers POST with a redacted 500 and reports the throw to the internal-error sink', async () => {
    const { url, sink } = await throwingGuardHarness();
    const origin = new URL(url).origin;

    const response = await fetch(`${url}?batch=batch-guard-post&name=a.txt`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', origin },
      body: 'contents',
    });

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { error: { code: string; message: string; requestId: string } };
    expect(payload.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'an internal error occurred' });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith({
      source: 'attachment-upload',
      // The guard throws before a batch is read off the request, so the report carries none.
      batchId: null,
      correlationId: payload.error.requestId,
      error: expect.objectContaining({ message: 'origin policy unavailable' }),
    });
  });

  it('answers DELETE with a redacted 500 and reports the throw as a cleanup failure', async () => {
    const { url, sink } = await throwingGuardHarness();
    const origin = new URL(url).origin;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ batchId: 'batch-guard-delete', paths: [] }),
    });

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { error: { code: string; message: string; requestId: string } };
    expect(payload.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'an internal error occurred' });
    expect(sink).toHaveBeenCalledWith({
      source: 'attachment-cleanup',
      batchId: null,
      correlationId: payload.error.requestId,
      error: expect.objectContaining({ message: 'origin policy unavailable' }),
    });
  });
});

describe('createDiskAttachmentStore — same-inode content swap', () => {
  // `isUnchangedAttachment` compares regular-file/path/dev/inode/size only — no mtime, ctime or
  // content hash — so rewriting the registered file *in place* (same inode on every filesystem,
  // because `writeFile` truncates the existing file) with different bytes of the same length is
  // indistinguishable from the file registration accepted. This pins that TOCTOU window
  // deterministically; the companion "replaced by a different file of the same size" test in
  // `attachments.test.ts` only catches the swap when the filesystem hands out a fresh inode.
  it('accepts a registered file rewritten in place with same-size different bytes (reported, not fixed)', async () => {
    const store = await diskStore();
    const batchDirectory = await store.createBatchDirectory({ batchId: 'batch-inplace' });
    const filePath = resolve(batchDirectory, 'swap.txt');
    await writeFile(filePath, 'aaaaaa', { mode: 0o600 });
    const attachment = await store.register({
      input: { batchId: 'batch-inplace', path: filePath, name: 'swap.txt', kind: 'file', size: 6 },
    });
    await writeFile(filePath, 'bbbbbb', { mode: 0o600 });

    const claimed = await store.claim({ attachments: [attachment], runId: 'run-inplace' });

    expect(claimed.attachments.map((entry) => entry.path)).toEqual([await realpath(filePath)]);
    expect(await readFile(filePath, 'utf8')).toBe('bbbbbb');
  });
});
